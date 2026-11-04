import { runInDurableObject } from 'cloudflare:test'
import { expect, it } from 'vitest'
import type { TLShape } from '@tldraw/tlschema'
import { shapeText } from '../shared/text'
import type { BoardRoom } from '../worker/BoardRoom'
import { buildFrame } from '../worker/boardModel'
import { snapshotRecords } from '../worker/boardWriter'
import { openEvents, post, registerCrew, roomStub, uniq } from './helpers'

async function crewWithArea(x: number) {
  const frame = buildFrame({ name: uniq('Hook'), x, y: 0, w: 1000, h: 600 })
  await runInDurableObject(roomStub(), async (i: BoardRoom) => {
    await i.getRoom().updateStore((s) => s.put(frame as never))
  })
  const reg = await registerCrew(uniq('Pub'), frame.id)
  return { ...reg, frame }
}

async function kids(frameId: string): Promise<TLShape[]> {
  let out: TLShape[] = []
  await runInDurableObject(roomStub(), async (i: BoardRoom) => {
    out = snapshotRecords(i.getRoom()).filter((r) => r.typeName === 'shape' && (r as TLShape).parentId === frameId) as TLShape[]
  })
  return out
}

const card = (over: Record<string, unknown> = {}) => ({
  event_id: `evt-${crypto.randomUUID()}`, crew: 'my-team', title: 'Key insight',
  content: 'Students skip lunch.\n\nQueues are long.', sources: ['interviews.md', 'https://x.test/a'], ...over,
})

it('publishes a card as a section in the crew area and announces it in chat', async () => {
  const { token, frame, crew } = await crewWithArea(20_000)
  const human = await openEvents('Alice')
  await human.c.next((m) => m.type === 'init')
  const r = await post('/api/webhook', card(), token)
  expect(r.status).toBe(200)
  expect(r.body.ok).toBe(true)
  const shapes = await kids(frame.id)
  const texts = shapes.map((s) => shapeText(s))
  expect(texts).toContain('Key insight')
  expect(texts).toContain('Students skip lunch.')
  expect(texts).toContain('Queues are long.')
  expect(texts).toContain('Sources:\n- interviews.md\n- https://x.test/a')
  const chat = await human.c.next((m) => m.type === 'chat' && m.message.authorType === 'crew')
  expect(chat.message).toMatchObject({ crewId: crew.id, text: 'published: Key insight' })
  expect(chat.message.ref.shapeId).toBe(shapes.find((s) => shapeText(s) === 'Key insight')!.id)
  human.ws.close()
})

it('ignores a repeated event_id from the same crew', async () => {
  const { token, frame } = await crewWithArea(30_000)
  const c = card()
  await post('/api/webhook', c, token)
  const before = (await kids(frame.id)).length
  const again = await post('/api/webhook', c, token)
  expect(again.body).toEqual({ ok: true, duplicate: true })
  expect((await kids(frame.id)).length).toBe(before)
})

it('rejects missing token (401) and missing title or content (400)', async () => {
  const { token } = await crewWithArea(40_000)
  expect((await post('/api/webhook', card())).status).toBe(401)
  expect((await post('/api/webhook', card({ title: '' }), token)).status).toBe(400)
  expect((await post('/api/webhook', card({ content: undefined }), token)).status).toBe(400)
})

it('caps content at 12 items plus a sources note', async () => {
  const { token, frame } = await crewWithArea(50_000)
  const content = Array.from({ length: 20 }, (_, i) => `para ${i}`).join('\n\n')
  await post('/api/webhook', card({ content }), token)
  const notes = (await kids(frame.id)).filter((s) => s.type === 'note')
  expect(notes).toHaveLength(13)
})
