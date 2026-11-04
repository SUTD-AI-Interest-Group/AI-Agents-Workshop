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
import { CREW_NAME_RE, CrewRegistry, type Crew } from './crews'
import { hashToken, tokenFromRequest } from './auth'
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
  readonly crews: CrewRegistry
  /** Live crew listener sockets (Task 7). */
  protected crewSockets = new Map<string, WebSocket>()
  private eventSockets = new Map<WebSocket, Session>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.chat = new ChatStore(ctx.storage.sql)
    this.crews = new CrewRegistry(ctx.storage.sql)
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
    if (url.pathname === '/api/crews' && session && req.method === 'POST') return this.registerCrew(req, session)
    if (url.pathname === '/api/crews/reclaim' && session && req.method === 'POST') return this.reclaimCrew(req, session)
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

  // ---- crews ----

  crewInfo(c: Crew): CrewInfo {
    const area = c.areaId ? (this.getRoom().getRecord(c.areaId) as { props?: { name?: string } } | undefined) : undefined
    return {
      id: c.id,
      name: c.name,
      areaId: c.areaId,
      areaName: area?.props?.name ?? null,
      ownerUserId: c.ownerUserId,
      online: this.isCrewOnline(c.id),
      busy: this.isCrewBusy(c.id),
    }
  }

  crewInfos(): CrewInfo[] {
    return this.crews.all().map((c) => this.crewInfo(c))
  }

  broadcastCrews() {
    this.broadcast({ type: 'crews', crews: this.crewInfos() })
  }

  isCrewOnline(crewId: string): boolean {
    return this.crewSockets.has(crewId)
  }

  isCrewBusy(_crewId: string): boolean {
    return false
  }

  /** Crew token from Bearer header, ?token=, or a /mcp/<token> path. */
  async crewFromRequest(req: Request): Promise<Crew | null> {
    const m = new URL(req.url).pathname.match(/^\/mcp\/(crw_[0-9a-f]{32})$/)
    const token = m?.[1] ?? tokenFromRequest(req)
    return token ? this.crews.byTokenHash(await hashToken(token)) : null
  }

  private async registerCrew(req: Request, session: Session): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown; areaId?: unknown }
    const name = String(body.name ?? '').trim()
    const areaId = typeof body.areaId === 'string' && body.areaId ? body.areaId : null
    if (!CREW_NAME_RE.test(name)) return Response.json({ error: 'invalid_name' }, { status: 400 })
    const taken = this.crews.byName(name)
    const mine = this.crews.byOwner(session.userId)
    if (taken && taken.id !== mine?.id) return Response.json({ error: 'name_taken' }, { status: 409 })
    if (mine) {
      const crew = this.crews.update(mine.id, { name, areaId })!
      this.broadcastCrews()
      return Response.json({ crew: this.crewInfo(crew), token: null })
    }
    const { crew, token } = await this.crews.create(name, areaId, session.userId)
    this.broadcastCrews()
    return Response.json({ crew: this.crewInfo(crew), token }, { status: 201 })
  }

  private async reclaimCrew(req: Request, session: Session): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown }
    const crew = this.crews.byName(String(body.name ?? '').trim())
    if (!crew) return Response.json({ error: 'not_found' }, { status: 404 })
    const token = await this.crews.rotateToken(crew.id, session.userId)
    this.closeCrewSocket(crew.id, 4001, 'replaced')
    this.broadcastCrews()
    return Response.json({ crew: this.crewInfo(this.crews.byId(crew.id)!), token })
  }

  closeCrewSocket(crewId: string, code: number, reason: string) {
    const ws = this.crewSockets.get(crewId)
    if (!ws) return
    this.crewSockets.delete(crewId)
    try {
      ws.close(code, reason)
    } catch {
      /* already closed */
    }
  }
}
