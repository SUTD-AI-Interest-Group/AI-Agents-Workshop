import {
  DurableObjectSqliteSyncWrapper,
  SQLiteSyncStorage,
  TLSocketRoom,
} from '@tldraw/sync-core'
import { createTLSchema, defaultBindingSchemas, defaultShapeSchemas, type TLRecord } from '@tldraw/tlschema'
import { DurableObject } from 'cloudflare:workers'
import type { Session } from './auth'
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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
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
}
