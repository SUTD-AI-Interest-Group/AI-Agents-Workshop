import { runInDurableObject } from 'cloudflare:test'
import { expect, it } from 'vitest'
import type { BoardRoom } from '../worker/BoardRoom'
import { CREW_COLORS } from '../shared/protocol'
import { collector, openEvents, openWs, registerCrew, roomStub, uniq } from './helpers'

it('gives each new crew a stable colour, all distinct until the palette is used up', async () => {
  const before = new Set<number>()
  await runInDurableObject(roomStub(), async (i: BoardRoom) => {
    for (const c of i.crewInfos()) before.add(c.color)
  })
  const fresh: number[] = []
  for (let k = 0; k < CREW_COLORS - before.size; k++) fresh.push((await registerCrew(uniq('Hue'))).crew.color)
  expect(new Set([...before, ...fresh]).size).toBe(Math.max(before.size, CREW_COLORS))
  for (const c of fresh) expect(c).toBeGreaterThanOrEqual(0)
  // sticks: the stored colour is what later reads return
  const one = await registerCrew(uniq('Stick'))
  await runInDurableObject(roomStub(), async (i: BoardRoom) => {
    expect(i.crewInfo(i.crews.byId(one.crew.id)!).color).toBe(one.crew.color)
  })
})

it('stores a reply-to preview on threaded human replies and ignores unknown targets', async () => {
  const a = await openEvents('Alice')
  const b = await openEvents('Bob')
  await b.c.next((m) => m.type === 'init')
  a.ws.send(JSON.stringify({ type: 'chat', text: 'original question about lunch queues' }))
  const original = await b.c.next((m) => m.type === 'chat' && m.message.text.startsWith('original'))
  b.ws.send(JSON.stringify({ type: 'chat', text: 'my answer', replyTo: original.message.id }))
  const reply = await a.c.next((m) => m.type === 'chat' && m.message.text === 'my answer')
  expect(reply.message.replyTo).toEqual({ id: original.message.id, authorName: 'Alice', text: 'original question about lunch queues' })
  b.ws.send(JSON.stringify({ type: 'chat', text: 'orphan', replyTo: 'nope' }))
  const orphan = await a.c.next((m) => m.type === 'chat' && m.message.text === 'orphan')
  expect(orphan.message.replyTo).toBeUndefined()
  a.ws.close()
  b.ws.close()
})

async function connect(name: string) {
  const reg = await registerCrew(name)
  const ws = await openWs(`/crew/ws?token=${reg.token}`)
  const c = collector(ws)
  await c.next((m) => m.type === 'hello')
  return { ...reg, ws, c, name }
}

it('threads a crew answer under the message that mentioned it', async () => {
  const crew = await connect(uniq('Thread'))
  const human = await openEvents('Alice')
  human.ws.send(JSON.stringify({ type: 'chat', text: `@${crew.name} summarise interviews` }))
  const asked = await human.c.next((m) => m.type === 'chat' && m.message.authorType === 'human')
  const working = await human.c.next((m) => m.type === 'chat' && m.message.authorType === 'crew')
  expect(working.message.replyTo).toMatchObject({ id: asked.message.id, authorName: 'Alice' })
  crew.ws.close()
  human.ws.close()
})

it('replying to a crew message asks that crew, with the replied-to text as context', async () => {
  const crew = await connect(uniq('Follow'))
  const human = await openEvents('Alice')
  human.ws.send(JSON.stringify({ type: 'chat', text: `@${crew.name} first question` }))
  const m1 = await crew.c.next((m) => m.type === 'mention')
  crew.ws.send(JSON.stringify({ type: 'reply', mentionId: m1.id, text: 'first answer', final: true }))
  const done = await human.c.next((m) => m.type === 'chat_update' && m.message.status === 'done')
  human.ws.send(JSON.stringify({ type: 'chat', text: 'can you expand on that?', replyTo: done.message.id }))
  const m2 = await crew.c.next((m) => m.type === 'mention')
  expect(m2).toMatchObject({ text: 'can you expand on that?', author: 'Alice', hop: 0 })
  expect(m2.context.replyTo).toEqual({ author: crew.name, text: 'first answer' })
  crew.ws.close()
  human.ws.close()
})
