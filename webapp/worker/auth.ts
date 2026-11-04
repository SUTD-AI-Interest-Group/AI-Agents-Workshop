export type Session = { userId: string; name: string }

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function signSession(secret: string, s: Session, nowMs = Date.now()): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ userId: s.userId, name: s.name, exp: nowMs + SESSION_TTL_MS })))
  return `${payload}.${b64url(await hmac(secret, payload))}`
}

export async function verifySession(secret: string, token: string, nowMs = Date.now()): Promise<Session | null> {
  const [payload, sig, extra] = token.split('.')
  if (!payload || !sig || extra !== undefined) return null
  try {
    if (!timingSafeEqual(fromB64url(sig), await hmac(secret, payload))) return null
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)))
    if (typeof data.exp !== 'number' || data.exp < nowMs) return null
    if (typeof data.userId !== 'string' || typeof data.name !== 'string') return null
    return { userId: data.userId, name: data.name }
  } catch {
    return null
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function newCrewToken(): string {
  return 'crw_' + hex(crypto.getRandomValues(new Uint8Array(16)))
}

export async function hashToken(t: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(t))))
}

/** Bearer header or ?token= query param. */
export function tokenFromRequest(req: Request): string | null {
  const h = req.headers.get('authorization')
  if (h?.toLowerCase().startsWith('bearer ')) return h.slice(7).trim()
  return new URL(req.url).searchParams.get('token')
}

export async function getSession(req: Request, env: { SESSION_SECRET: string }): Promise<Session | null> {
  const t = tokenFromRequest(req)
  return t ? verifySession(env.SESSION_SECRET, t) : null
}
