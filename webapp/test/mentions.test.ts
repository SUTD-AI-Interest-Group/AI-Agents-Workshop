import { toRichText } from '@tldraw/tlschema'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { ToCrew } from '../shared/protocol'
import type { BoardRoom } from '../worker/BoardRoom'
import { buildFrame, buildNote } from '../worker/boardModel'
import { HOP_LIMIT, MENTION_TIMEOUT_MS, MentionRouter, type Pending } from '../worker/mentions'
import { collector, openEvents, openWs, post, registerCrew, roomStub, sessionToken, tick, uniq } from './helpers'

function fakeRouter() {
  const online = new Set<string>(['c1', 'c2'])
  const sent: { crewId: string; msg: ToCrew }[] = []
  const system: string[] = []
  const said: { crewId: string; text: string; m: Pending }[] = []
  const thinking: [string, boolean][] = []
  let now = 1_000
  const router = new MentionRouter({
    send: (crewId, msg) => (online.has(crewId) ? (sent.push({ crewId, msg }), true) : false),
    isOnline: (id) => online.has(id),
    crewName: (id) => ({ c1: 'Falcon', c2: 'Owl' })[id] ?? id,
    system: (t) => system.push(t),
    crewSays: (crewId, text, m) => said.push({ crewId, text, m }),
    thinking: (id, on) => thinking.push([id, on]),
    now: () => now,
  })
  const m = (text: string, hop = 0) => ({ source: 'chat' as const, text, author: 'alice', hop, context: {} })
  return { router, online, sent, system, said, thinking, m, advance: (ms: number) => (now += ms) }
}

const mentionIds = (sent: { msg: ToCrew }[]) => sent.map((s) => (s.msg.type === 'mention' ? s.msg.text : '?'))

describe('MentionRouter', () => {
  it('posts an offline notice when the crew is not connected', () => {
    const f = fakeRouter()
    f.online.delete('c1')
    f.router.deliver('c1', f.m('hi'))
    expect(f.system).toEqual(['Falcon is offline — mention not delivered'])
    expect(f.sent).toEqual([])
  })

  it('delivers, marks thinking, and serialises queued mentions in order', () => {
    const f = fakeRouter()
    f.router.deliver('c1', f.m('one'))
    f.router.deliver('c1', f.m('two'))
    f.router.deliver('c1', f.m('three'))
    expect(mentionIds(f.sent)).toEqual(['one'])
    expect(f.thinking).toEqual([['c1', true]])
    const first = f.sent[0].msg as { id: string }
    f.router.onReply('c1', { type: 'reply', mentionId: first.id, text: 'done one', final: true })
    expect(f.said.map((s) => s.text)).toEqual(['done one'])
    expect(mentionIds(f.sent)).toEqual(['one', 'two'])
  })

  it('posts a busy notice when the queue (3) overflows', () => {
    const f = fakeRouter()
    for (const t of ['a', 'b', 'c', 'd']) f.router.deliver('c1', f.m(t))
    expect(f.system).toEqual([])
    f.router.deliver('c1', f.m('e'))
    expect(f.system).toEqual(['Falcon is busy — try again shortly'])
  })

  it('posts progress replies without finishing the mention', () => {
    const f = fakeRouter()
    f.router.deliver('c1', f.m('one'))
    const id = (f.sent[0].msg as { id: string }).id
    f.router.onReply('c1', { type: 'reply', mentionId: id, text: 'working', final: false })
    expect(f.said.map((s) => s.text)).toEqual(['working'])
    expect(f.router.isBusy('c1')).toBe(true)
  })

  it('reports crew errors and moves on', () => {
    const f = fakeRouter()
    f.router.deliver('c1', f.m('one'))
    f.router.deliver('c1', f.m('two'))
    const id = (f.sent[0].msg as { id: string }).id
    f.router.onReply('c1', { type: 'error', mentionId: id, message: 'boom' })
    expect(f.system).toEqual(['Falcon hit an error: boom'])
    expect(mentionIds(f.sent)).toEqual(['one', 'two'])
  })

  it('times out a mention after 10 minutes', () => {
    const f = fakeRouter()
    f.router.deliver('c1', f.m('one'))
    f.advance(MENTION_TIMEOUT_MS - 1)
    f.router.tick()
    expect(f.system).toEqual([])
    f.advance(2)
    f.router.tick()
    expect(f.system).toEqual(['Falcon timed out'])
    expect(f.router.isBusy('c1')).toBe(false)
    expect(f.thinking.at(-1)).toEqual(['c1', false])
  })

  it('drops the active request and queue on disconnect, then delivers only new mentions', () => {
    const f = fakeRouter()
    f.router.deliver('c1', f.m('old'))
    f.router.deliver('c1', f.m('stale'))
    f.online.delete('c1')
    f.router.onDisconnect('c1')
    expect(f.system).toEqual(['Falcon disconnected — request dropped'])
    expect(f.thinking.at(-1)).toEqual(['c1', false])
    f.online.add('c1')
    f.router.deliver('c1', f.m('fresh'))
    expect(mentionIds(f.sent)).toEqual(['old', 'fresh'])
  })

  it(`stops delivering at hop ${HOP_LIMIT}`, () => {
    const f = fakeRouter()
    f.router.deliver('c1', f.m('loop', HOP_LIMIT))
    expect(f.sent).toEqual([])
    expect(f.system).toEqual([])
  })

  it('stays silent when a crew-originated mention (hop >= 1) hits an offline or busy crew', () => {
    const f = fakeRouter()
    f.online.delete('c2')
    f.router.deliver('c2', f.m('from a crew', 1))
    for (const t of ['a', 'b', 'c', 'd']) f.router.deliver('c1', f.m(t))
    f.router.deliver('c1', f.m('overflow from a crew', 1))
    expect(f.system).toEqual([])
  })

  it('ignores replies for an unknown mention id', () => {
    const f = fakeRouter()
    f.router.onReply('c1', { type: 'reply', mentionId: 'nope', text: 'x', final: true })
    expect(f.said).toEqual([])
  })
})

async function connectCrew(name = uniq('Crew'), areaId: string | null = null) {
  const reg = await registerCrew(name, areaId)
  const ws = await openWs(`/crew/ws?token=${reg.token}`)
  const c = collector(ws)
  await c.next((m) => m.type === 'hello')
  return { ...reg, ws, c, name }
}

describe('crew socket + routing', () => {
  it('delivers a chat mention to the crew and relays its final reply to chat', async () => {
    const crew = await connectCrew()
    const human = await openEvents('Alice')
    await human.c.next((m) => m.type === 'init')
    human.ws.send(JSON.stringify({ type: 'chat', text: `@${crew.name.toLowerCase()} hi` }))
    const mention = await crew.c.next((m) => m.type === 'mention')
    expect(mention).toMatchObject({ source: 'chat', text: `@${crew.name.toLowerCase()} hi`, author: 'Alice', hop: 0 })
    expect(mention.context.recentChat.at(-1)).toMatchObject({ author: 'Alice' })
    await human.c.next((m) => m.type === 'thinking' && m.on)
    crew.ws.send(JSON.stringify({ type: 'reply', mentionId: mention.id, text: 'hello back', final: true }))
    const reply = await human.c.next((m) => m.type === 'chat' && m.message.authorType === 'crew')
    expect(reply.message).toMatchObject({ authorName: crew.name, crewId: crew.crew.id, text: 'hello back' })
    await human.c.next((m) => m.type === 'thinking' && !m.on)
    crew.ws.close()
    human.ws.close()
  })

  it('marks the crew online in the crew list while connected', async () => {
    const watcher = await openEvents('W')
    await watcher.c.next((m) => m.type === 'init')
    const crew = await connectCrew()
    await watcher.c.next((m) => m.type === 'crews' && m.crews.some((c: any) => c.id === crew.crew.id && c.online))
    crew.ws.close()
    await watcher.c.next((m) => m.type === 'crews' && m.crews.some((c: any) => c.id === crew.crew.id && !c.online))
    watcher.ws.close()
  })

  it('closes the older socket with 4001 when the same crew connects again', async () => {
    const crew = await connectCrew()
    const closed = new Promise<number>((r) => crew.ws.addEventListener('close', (e) => r(e.code)))
    const second = await openWs(`/crew/ws?token=${crew.token}`)
    expect(await closed).toBe(4001)
    second.close()
  })

  it('closes with 4003 on a bad token', async () => {
    const ws = await openWs('/crew/ws?token=crw_00000000000000000000000000000000')
    const code = await new Promise<number>((r) => ws.addEventListener('close', (e) => r(e.code)))
    expect(code).toBe(4003)
  })

  it('lets a crew reply mention another crew, with the hop count incremented', async () => {
    const a = await connectCrew()
    const b = await connectCrew()
    const human = await openEvents('Alice')
    human.ws.send(JSON.stringify({ type: 'chat', text: `@${a.name} ask the other crew` }))
    const m1 = await a.c.next((m) => m.type === 'mention')
    a.ws.send(JSON.stringify({ type: 'reply', mentionId: m1.id, text: `@${b.name} what do you think? also @${a.name}`, final: true }))
    const m2 = await b.c.next((m) => m.type === 'mention')
    expect(m2.hop).toBe(1)
    await tick(100)
    expect(a.c.seen.filter((m) => m.type === 'mention')).toEqual([]) // no self-mention
    for (const s of [a.ws, b.ws, human.ws]) s.close()
  })
})

describe('board mentions', () => {
  async function putShapes(...shapes: any[]) {
    await runInDurableObject(roomStub(), async (i: BoardRoom) => {
      await i.getRoom().updateStore((s) => shapes.forEach((sh) => s.put(sh)))
    })
  }

  it('delivers once per text, again after the text changes', async () => {
    const frame = buildFrame({ name: 'Team Falcon', x: 0, y: 0, w: 1000, h: 600 })
    const crew = await connectCrew(uniq('Board'), frame.id)
    const note = buildNote({ parentId: frame.id, x: 40, y: 80, text: `@${crew.name} ideas?`, crewId: '' })
    await putShapes(frame, note)
    const user = await sessionToken('Alice')

    const r1 = await post('/api/mentions/board', { shapeId: note.id }, user.token)
    expect(r1.body).toEqual({ delivered: [crew.name] })
    const m = await crew.c.next((x) => x.type === 'mention')
    expect(m).toMatchObject({ source: 'board', shapeId: note.id, author: 'Alice' })
    expect(m.context.area).toEqual({ id: frame.id, name: 'Team Falcon' })

    const r2 = await post('/api/mentions/board', { shapeId: note.id }, user.token)
    expect(r2.body).toEqual({ delivered: [] })

    await putShapes({ ...note, props: { ...(note.props as object), richText: toRichText(`@${crew.name} more ideas?`) } })
    const r3 = await post('/api/mentions/board', { shapeId: note.id }, user.token)
    expect(r3.body).toEqual({ delivered: [crew.name] })
    crew.ws.close()
  })

  it('returns 404 for an unknown shape and 401 without a session', async () => {
    const user = await sessionToken('Alice')
    expect((await post('/api/mentions/board', { shapeId: 'shape:nope' }, user.token)).status).toBe(404)
    expect((await post('/api/mentions/board', { shapeId: 'shape:nope' })).status).toBe(401)
  })
})
