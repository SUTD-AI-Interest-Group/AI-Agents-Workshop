import { SELF, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { hashToken, newCrewToken, signSession, verifySession } from '../worker/auth'

const DAY = 24 * 60 * 60 * 1000

describe('session tokens', () => {
  it('round-trips', async () => {
    const t = await signSession('s', { userId: 'u1', name: 'Alice' })
    expect(await verifySession('s', t)).toEqual({ userId: 'u1', name: 'Alice' })
  })
  it('rejects a tampered payload', async () => {
    const t = await signSession('s', { userId: 'u1', name: 'Alice' })
    const [, sig] = t.split('.')
    const forged = btoa(JSON.stringify({ userId: 'u2', name: 'Eve', exp: Date.now() + DAY })).replace(/=+$/, '') + '.' + sig
    expect(await verifySession('s', forged)).toBeNull()
  })
  it('rejects a token signed with another secret', async () => {
    const t = await signSession('other', { userId: 'u1', name: 'Alice' })
    expect(await verifySession('s', t)).toBeNull()
  })
  it('rejects an expired token', async () => {
    const now = Date.now()
    const t = await signSession('s', { userId: 'u1', name: 'Alice' }, now)
    expect(await verifySession('s', t, now + 8 * DAY)).toBeNull()
  })
  it('rejects garbage', async () => {
    expect(await verifySession('s', 'nope')).toBeNull()
  })
})

describe('crew tokens', () => {
  it('has the crw_ + 32 hex format and hashes deterministically', async () => {
    const t = newCrewToken()
    expect(t).toMatch(/^crw_[0-9a-f]{32}$/)
    expect(await hashToken(t)).toBe(await hashToken(t))
    expect(await hashToken(t)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('POST /api/join', () => {
  const join = (body: unknown) =>
    SELF.fetch('https://x/api/join', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

  it('returns a verifiable token for the right PIN', async () => {
    const res = await join({ pin: '123456', name: '  Alice ' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string; userId: string; name: string }
    expect(body.name).toBe('Alice')
    expect(await verifySession(env.SESSION_SECRET, body.token)).toEqual({ userId: body.userId, name: 'Alice' })
  })
  it('rejects a wrong PIN with 401', async () => {
    const res = await join({ pin: '000000', name: 'Alice' })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'wrong_pin' })
  })
  it('rejects an empty or overlong name with 400', async () => {
    expect((await join({ pin: '123456', name: '   ' })).status).toBe(400)
    expect((await join({ pin: '123456', name: 'x'.repeat(300) })).status).toBe(400)
  })
})
