import {
  DurableObjectSqliteSyncWrapper,
  SQLiteSyncStorage,
  TLSocketRoom,
} from '@tldraw/sync-core'
import { createTLSchema, defaultBindingSchemas, defaultShapeSchemas, type TLRecord } from '@tldraw/tlschema'
import { DurableObject } from 'cloudflare:workers'
import {
  CHAT_INIT_COUNT,
  CHAT_MAX_LEN,
  type ChatMessage,
  type ClientEvent,
  type CrewInfo,
  type OnlineUser,
  type ServerEvent,
} from '../shared/protocol'
import type { Session } from './auth'
import { ChatStore } from './chat'
import type { Env } from './index'

export const schema = createTLSchema({ shapes: defaultShapeSchemas, bindings: defaultBindingSchemas })

export type SessionMeta = Session

/** Header the Worker uses to hand a verified session to the DO. Never trusted from clients. */
export const SESSION_HEADER = 'x-dtc-session'

export function sessionOf(req: Request): Session | null {
  const raw = req.headers.get(SESSION_HEADER)
  return raw ? (JSON.parse(raw) as Session) : null
}

export class BoardRoom extends DurableObject<Env> {
  private room: TLSocketRoom<TLRecord, SessionMeta> | null = null
  readonly chat: ChatStore
  private eventSockets = new Map<WebSocket, Session>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.chat = new ChatStore(ctx.storage.sql)
  }

  getRoom(): TLSocketRoom<TLRecord, SessionMeta> {
    if (!this.room) {
      const sql = new DurableObjectSqliteSyncWrapper(this.ctx.storage, { tablePrefix: 'tldraw_' })
      this.room = new TLSocketRoom<TLRecord, SessionMeta>({
        schema,
        storage: new SQLiteSyncStorage<TLRecord>({ sql }),
      })
    }
    return this.room
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const session = sessionOf(req)
    if (url.pathname === '/api/sync' && session) return this.connectSync(url, session)
    if (url.pathname === '/api/events' && session) return this.connectEvents(session)
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  private connectSync(url: URL, session: Session): Response {
    const sessionId = url.searchParams.get('sessionId')
    if (!sessionId) return Response.json({ error: 'missing_session_id' }, { status: 400 })
    const { 0: client, 1: server } = new WebSocketPair()
    server.accept()
    this.getRoom().handleSocketConnect({ sessionId, socket: server, meta: session })
    return new Response(null, { status: 101, webSocket: client })
  }

  // ---- browser events socket: chat, crews, users ----

  private connectEvents(session: Session): Response {
    const { 0: client, 1: server } = new WebSocketPair()
    server.accept()
    this.eventSockets.set(server, session)
    this.send(server, { type: 'init', messages: this.chat.recent(CHAT_INIT_COUNT), crews: this.crewInfos(), users: this.onlineUsers() })
    this.broadcast({ type: 'users', users: this.onlineUsers() })
    server.addEventListener('message', (e) => this.onEventMessage(session, e.data))
    const drop = () => {
      if (this.eventSockets.delete(server)) this.broadcast({ type: 'users', users: this.onlineUsers() })
    }
    server.addEventListener('close', drop)
    server.addEventListener('error', drop)
    return new Response(null, { status: 101, webSocket: client })
  }

  private onEventMessage(session: Session, data: unknown) {
    let msg: ClientEvent
    try {
      msg = JSON.parse(String(data))
    } catch {
      return
    }
    if (msg.type !== 'chat' || typeof msg.text !== 'string') return
    const text = msg.text.trim().slice(0, CHAT_MAX_LEN)
    if (!text) return
    this.postChat({ authorType: 'human', authorName: session.name, text })
  }

  postChat(m: Omit<ChatMessage, 'id' | 'ts'>): ChatMessage {
    const message = this.chat.add(m)
    this.broadcast({ type: 'chat', message })
    return message
  }

  broadcast(e: ServerEvent) {
    const data = JSON.stringify(e)
    for (const ws of this.eventSockets.keys()) {
      try {
        ws.send(data)
      } catch {
        this.eventSockets.delete(ws)
      }
    }
  }

  private send(ws: WebSocket, e: ServerEvent) {
    ws.send(JSON.stringify(e))
  }

  onlineUsers(): OnlineUser[] {
    const byId = new Map<string, OnlineUser>()
    for (const s of this.eventSockets.values()) byId.set(s.userId, { userId: s.userId, name: s.name })
    return [...byId.values()]
  }

  crewInfos(): CrewInfo[] {
    return []
  }
}
