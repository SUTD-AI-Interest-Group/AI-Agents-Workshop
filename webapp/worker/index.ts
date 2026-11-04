import { getSession, signSession, type Session } from './auth'
import { SESSION_HEADER } from './BoardRoom'

export { BoardRoom } from './BoardRoom'

export type Env = {
  BOARD_ROOM: DurableObjectNamespace<import('./BoardRoom').BoardRoom>
  ASSETS: Fetcher
  BOARD_PIN: string
  SESSION_SECRET: string
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/api/health') return json({ ok: true })
    if (url.pathname === '/api/join' && req.method === 'POST') return join(req, env)
    if (url.pathname === '/crew/ws' || url.pathname === '/api/webhook' || url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return forward(req, env, null)
    if (['/api/sync', '/api/events', '/api/crews', '/api/crews/reclaim', '/api/mentions/board'].includes(url.pathname)) {
      const session = await getSession(req, env)
      if (!session) return json({ error: 'unauthorized' }, 401)
      return forward(req, env, session)
    }
    return json({ error: 'not_found' }, 404)
  },
} satisfies ExportedHandler<Env>

async function readJson<T>(req: Request): Promise<Partial<T>> {
  try {
    const v = await req.json()
    return v && typeof v === 'object' ? (v as Partial<T>) : {}
  } catch {
    return {}
  }
}

async function join(req: Request, env: Env): Promise<Response> {
  const body = await readJson<{ pin: string; name: string }>(req)
  if (String(body.pin ?? '') !== env.BOARD_PIN) return json({ error: 'wrong_pin' }, 401)
  const name = String(body.name ?? '').trim()
  if (!name || name.length > 32) return json({ error: 'invalid_name' }, 400)
  const userId = crypto.randomUUID()
  const token = await signSession(env.SESSION_SECRET, { userId, name })
  return json({ token, userId, name })
}

/** Forward to the single BoardRoom DO, attaching the verified session (client-sent copies are replaced). */
export function forward(req: Request, env: Env, session: Session | null): Promise<Response> {
  const headers = new Headers(req.headers)
  headers.delete(SESSION_HEADER)
  if (session) headers.set(SESSION_HEADER, JSON.stringify(session))
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName('main'))
  return stub.fetch(new Request(req, { headers }))
}
