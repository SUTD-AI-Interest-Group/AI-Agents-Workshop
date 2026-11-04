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
