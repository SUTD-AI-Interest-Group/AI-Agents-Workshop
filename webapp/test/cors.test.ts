import { SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('answers API preflight requests', async () => {
  const res = await SELF.fetch('https://x/api/join', {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' },
  })
  expect(res.status).toBe(204)
  expect(res.headers.get('access-control-allow-origin')).toBe('*')
  expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization')
})

it('adds CORS headers to API responses', async () => {
  const res = await SELF.fetch('https://x/api/join', {
    method: 'POST', headers: { Origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ pin: 'x', name: 'a' }),
  })
  expect(res.status).toBe(401)
  expect(res.headers.get('access-control-allow-origin')).toBe('*')
})
