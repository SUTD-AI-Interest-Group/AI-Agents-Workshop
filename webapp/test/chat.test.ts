import { runInDurableObject } from 'cloudflare:test'
import { expect, it } from 'vitest'
import type { BoardRoom } from '../worker/BoardRoom'
import { ChatStore } from '../worker/chat'
import { openEvents, roomStub, tick } from './helpers'

it('ChatStore persists messages and returns recent ones oldest-first', async () => {
  await runInDurableObject(roomStub(), async (_i: BoardRoom, state) => {
    const store = new ChatStore(state.storage.sql)
    store.add({ authorType: 'human', authorName: 'A', text: 'one' })
    store.add({ authorType: 'human', authorName: 'A', text: 'two' })
    store.add({ authorType: 'human', authorName: 'A', text: 'three' })
    const again = new ChatStore(state.storage.sql)
    expect(again.recent(2).map((m) => m.text)).toEqual(['two', 'three'])
  })
})

it('rejects an events upgrade without a session', async () => {
  const { SELF } = await import('cloudflare:test')
  const res = await SELF.fetch('https://x/api/events', { headers: { Upgrade: 'websocket' } })
  expect(res.status).toBe(401)
})

it('broadcasts chat to every events socket and replays it on init', async () => {
  const a = await openEvents('Alice')
  const b = await openEvents('Bob')
  await a.c.next((m) => m.type === 'init')
  await b.c.next((m) => m.type === 'init')
  a.ws.send(JSON.stringify({ type: 'chat', text: '  hi there  ' }))
  const got = await b.c.next((m) => m.type === 'chat')
  expect(got.message).toMatchObject({ authorType: 'human', authorName: 'Alice', text: 'hi there' })

  const late = await openEvents('Carol')
  const init = await late.c.next((m) => m.type === 'init')
  expect(init.messages.map((m: { text: string }) => m.text)).toContain('hi there')
  for (const s of [a, b, late]) s.ws.close()
})

it('ignores empty chat and truncates long chat', async () => {
  const a = await openEvents('Alice')
  await a.c.next((m) => m.type === 'init')
  a.ws.send(JSON.stringify({ type: 'chat', text: '   ' }))
  a.ws.send(JSON.stringify({ type: 'chat', text: 'x'.repeat(5000) }))
  const got = await a.c.next((m) => m.type === 'chat')
  expect(got.message.text.length).toBe(4000)
  a.ws.close()
})

it('tracks online users across events sockets', async () => {
  const a = await openEvents('Alice')
  const b = await openEvents('Bob')
  await b.c.next((m) => m.type === 'users' && m.users.length === 2)
  a.ws.close()
  const after = await b.c.next((m) => m.type === 'users' && m.users.length === 1)
  expect(after.users[0].name).toBe('Bob')
  b.ws.close()
  await tick()
})
