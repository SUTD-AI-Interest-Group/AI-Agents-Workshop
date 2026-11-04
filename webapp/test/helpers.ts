import { SELF, env } from 'cloudflare:test'
import { signSession } from '../worker/auth'

export async function sessionToken(name = 'Alice', userId = crypto.randomUUID()) {
  return { token: await signSession(env.SESSION_SECRET, { userId, name }), userId, name }
}

export async function openWs(path: string): Promise<WebSocket> {
  const res = await SELF.fetch(`https://x${path}`, { headers: { Upgrade: 'websocket' } })
  if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade failed: ${res.status}`)
  res.webSocket.accept()
  return res.webSocket
}

export function roomStub() {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName('main'))
}

/** Buffers every JSON message on a socket so tests can await the next one matching a predicate. */
export function collector(ws: WebSocket) {
  const seen: any[] = []
  const waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data))
    seen.push(m)
    for (const w of [...waiters]) if (w.pred(m)) {
      waiters.splice(waiters.indexOf(w), 1)
      w.resolve(m)
    }
  })
  return {
    seen,
    next<T = any>(pred: (m: any) => boolean, timeoutMs = 2000): Promise<T> {
      const hit = seen.find(pred)
      if (hit) {
        seen.splice(seen.indexOf(hit), 1)
        return Promise.resolve(hit)
      }
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs)
        waiters.push({ pred, resolve: (m) => { clearTimeout(t); seen.splice(seen.indexOf(m), 1); resolve(m) } })
      })
    },
  }
}

export async function openEvents(name: string, userId?: string) {
  const s = await sessionToken(name, userId)
  const ws = await openWs(`/api/events?token=${encodeURIComponent(s.token)}`)
  const c = collector(ws)
  return { ws, c, ...s }
}

export const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms))

export async function post(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await SELF.fetch(`https://x${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: res.status, body: (await res.json()) as any }
}

export async function registerCrew(name: string, areaId: string | null = null, owner?: { token: string }) {
  const user = owner ?? (await sessionToken(`${name}-owner`))
  const r = await post('/api/crews', { name, areaId }, user.token)
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.body)}`)
  return { ...r.body, user } as { crew: import('../shared/protocol').CrewInfo; token: string; user: { token: string } }
}

let uniqCounter = 0
/** Storage persists across tests in a file, so crew names must be unique per test. */
export const uniq = (base: string) => `${base}${++uniqCounter}x${Math.floor(Math.random() * 1e4)}`.slice(0, 24)
