import { SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('GET /api/health returns ok', async () => {
  const res = await SELF.fetch('https://x/api/health')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})
