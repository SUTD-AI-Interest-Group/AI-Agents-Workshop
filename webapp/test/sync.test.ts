import { SELF, env, runInDurableObject } from 'cloudflare:test'
import { expect, it } from 'vitest'
import { BoardRoom } from '../worker/BoardRoom'
import { roomStub, sessionToken } from './helpers'

it('rejects a sync upgrade without a session', async () => {
  const res = await SELF.fetch('https://x/api/sync?sessionId=abc', { headers: { Upgrade: 'websocket' } })
  expect(res.status).toBe(401)
})

it('accepts a sync upgrade with a valid session', async () => {
  const { token } = await sessionToken()
  const res = await SELF.fetch(`https://x/api/sync?sessionId=abc&token=${encodeURIComponent(token)}`, {
    headers: { Upgrade: 'websocket' },
  })
  expect(res.status).toBe(101)
  res.webSocket?.accept()
  res.webSocket?.close()
})

it('persists records across a fresh BoardRoom instance', async () => {
  const stub = roomStub()
  const page = { id: 'page:persist', typeName: 'page', name: 'Persist', index: 'a9', meta: {} }
  await runInDurableObject(stub, async (instance: BoardRoom) => {
    await instance.getRoom().updateStore((s) => s.put(page as never))
  })
  await runInDurableObject(stub, async (_instance: BoardRoom, state) => {
    const fresh = new BoardRoom(state, env)
    expect(fresh.getRoom().getRecord('page:persist')).toMatchObject({ name: 'Persist' })
  })
})

