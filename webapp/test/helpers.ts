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
