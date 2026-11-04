import { toRichText } from '@tldraw/tlschema'
import { SELF, runInDurableObject } from 'cloudflare:test'
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
  const events: string[] = []
  const thinking: [string, boolean][] = []
  let now = 1_000
  const router = new MentionRouter({
    send: (crewId, msg) => (online.has(crewId) ? (sent.push({ crewId, msg }), true) : false),
    isOnline: (id) => online.has(id),
    crewName: (id) => ({ c1: 'Falcon', c2: 'Owl' })[id] ?? id,
    system: (t) => system.push(t),
    started: (crewId, m: Pending) => events.push(`start ${crewId} ${m.text}`),
    progress: (crewId, text) => events.push(`progress ${crewId} ${text}`),
    finished: (crewId, text) => events.push(`final ${crewId} ${text}`),
    failed: (crewId, reason) => events.push(`failed ${crewId} ${reason}`),
    thinking: (id, on) => thinking.push([id, on]),
    now: () => now,
  })
  const m = (text: string, hop = 0) => ({ source: 'chat' as const, text, author: 'alice', hop, context: {} })
  return { router, online, sent, system, events, thinking, m, advance: (ms: number) => (now += ms) }
}

const mentionIds = (sent: { msg: ToCrew }[]) => sent.map((s) => (s.msg.type === 'mention' ? s.msg.text : '?'))
const idOf = (f: ReturnType<typeof fakeRouter>, i = 0) => (f.sent[i].msg as { id: string }).id

describe('MentionRouter', () => {
  it('posts an offline notice and reports not-accepted when the crew is not connected', () => {
    const f = fakeRouter()
    f.online.delete('c1')
    expect(f.router.deliver('c1', f.m('hi'))).toBe(false)
    expect(f.system).toEqual(['Falcon is offline — mention not delivered'])
    expect(f.sent).toEqual([])
    expect(f.events).toEqual([])
  })

  it('starts one in-place message per mention and serialises queued mentions', () => {
    const f = fakeRouter()
    expect(f.router.deliver('c1', f.m('one'))).toBe(true)
    expect(f.router.deliver('c1', f.m('two'))).toBe(true)
    expect(mentionIds(f.sent)).toEqual(['one'])
    expect(f.events).toEqual(['start c1 one'])
    expect(f.thinking).toEqual([['c1', true]])
    f.router.onReply('c1', { type: 'reply', mentionId: idOf(f), text: 'done one', final: true })
    expect(f.events).toEqual(['start c1 one', 'final c1 done one', 'start c1 two'])
    expect(mentionIds(f.sent)).toEqual(['one', 'two'])
  })

  it('posts a busy notice and reports not-accepted when the queue (3) overflows', () => {
    const f = fakeRouter()
    for (const t of ['a', 'b', 'c', 'd']) expect(f.router.deliver('c1', f.m(t))).toBe(true)
    expect(f.system).toEqual([])
    expect(f.router.deliver('c1', f.m('e'))).toBe(false)
    expect(f.system).toEqual(['Falcon is busy — try again shortly'])
  })

  it('turns non-final replies into progress on the same message', () => {
    const f = fakeRouter()
    f.router.deliver('c1', f.m('one'))
    f.router.onReply('c1', { type: 'reply', mentionId: idOf(f), text: 'working', final: false })
    expect(f.events).toEqual(['start c1 one', 'progress c1 working'])
    expect(f.router.isBusy('c1')).toBe(true)
  })

  it('progress() adds to the active mention without finishing it', () => {
    const f = fakeRouter()
    f.router.deliver('c1', f.m('one'))
    expect(f.router.addProgress('c1', 'via MCP')).toBe(true)
    expect(f.router.isBusy('c1')).toBe(true)
    expect(f.router.addProgress('c2', 'nobody active')).toBe(false)
    expect(f.events).toEqual(['start c1 one', 'progress c1 via MCP'])
  })

  it('marks the message failed on a crew error and moves on, with no separate notice', () => {
    const f = fakeRouter()
    f.router.deliver('c1', f.m('one'))
    f.router.deliver('c1', f.m('two'))
    f.router.onReply('c1', { type: 'error', mentionId: idOf(f), message: 'boom' })
    expect(f.events).toEqual(['start c1 one', 'failed c1 Hit an error: boom', 'start c1 two'])
    expect(f.system).toEqual([])
  })

  it('times out a mention after 10 minutes', () => {
    const f = fakeRouter()
    f.router.deliver('c1', f.m('one'))
    f.advance(MENTION_TIMEOUT_MS - 1)
    f.router.tick()
    expect(f.events).toEqual(['start c1 one'])
    f.advance(2)
    f.router.tick()
    expect(f.events.at(-1)).toBe('failed c1 Timed out after 10 minutes')
    expect(f.router.isBusy('c1')).toBe(false)
    expect(f.thinking.at(-1)).toEqual(['c1', false])
  })

  it('fails the active request and drops the queue on disconnect, then delivers only new mentions', () => {
    const f = fakeRouter()
    f.router.deliver('c1', f.m('old'))
    f.router.deliver('c1', f.m('stale'))
    f.online.delete('c1')
    f.router.onDisconnect('c1')
    expect(f.events.at(-1)).toBe('failed c1 Disconnected — request dropped')
    expect(f.thinking.at(-1)).toEqual(['c1', false])
    f.online.add('c1')
    f.router.deliver('c1', f.m('fresh'))
    expect(mentionIds(f.sent)).toEqual(['old', 'fresh'])
  })

  it(`stops delivering at hop ${HOP_LIMIT}`, () => {
    const f = fakeRouter()
    expect(f.router.deliver('c1', f.m('loop', HOP_LIMIT))).toBe(false)
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
    expect(f.events).toEqual([])
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
  it('shows one in-place crew message: working with progress, then the final answer', async () => {
    const crew = await connectCrew()
    const human = await openEvents('Alice')
    await human.c.next((m) => m.type === 'init')
    human.ws.send(JSON.stringify({ type: 'chat', text: `@${crew.name.toLowerCase()} hi` }))
    const mention = await crew.c.next((m) => m.type === 'mention')
    expect(mention).toMatchObject({ source: 'chat', text: `@${crew.name.toLowerCase()} hi`, author: 'Alice', hop: 0 })
    expect(mention.context.recentChat.at(-1)).toMatchObject({ author: 'Alice' })

    const working = await human.c.next((m) => m.type === 'chat' && m.message.authorType === 'crew')
    expect(working.message).toMatchObject({ authorName: crew.name, crewId: crew.crew.id, status: 'working', text: '', progress: [] })

    crew.ws.send(JSON.stringify({ type: 'reply', mentionId: mention.id, text: 'searching…', final: false }))
    const p1 = await human.c.next((m) => m.type === 'chat_update')
    expect(p1.message).toMatchObject({ id: working.message.id, status: 'working', progress: ['searching…'] })

    crew.ws.send(JSON.stringify({ type: 'reply', mentionId: mention.id, text: 'hello back', final: true }))
    const done = await human.c.next((m) => m.type === 'chat_update' && m.message.status === 'done')
    expect(done.message).toMatchObject({ id: working.message.id, text: 'hello back', progress: ['searching…'] })
    await human.c.next((m) => m.type === 'thinking' && !m.on)
    // no separate chat messages were created for progress or the final answer
    expect(human.c.seen.filter((m) => m.type === 'chat' && m.message.authorType === 'crew')).toEqual([])

    const late = await openEvents('Late')
    const init = await late.c.next((m) => m.type === 'init')
    expect(init.messages.find((m: { id: string }) => m.id === working.message.id)).toMatchObject({ status: 'done', text: 'hello back' })
    for (const s of [crew.ws, human.ws, late.ws]) s.close()
  })

  it('treats an MCP post_chat_message during a socket mention as progress, keeping the final answer', async () => {
    const crew = await connectCrew()
    const human = await openEvents('Alice')
    human.ws.send(JSON.stringify({ type: 'chat', text: `@${crew.name} go` }))
    const mention = await crew.c.next((m) => m.type === 'mention')
    const r = await SELF.fetch('https://x/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${crew.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'post_chat_message', arguments: { text: 'interim finding' } } }),
    })
    expect(r.status).toBe(200)
    await human.c.next((m) => m.type === 'chat_update' && m.message.progress?.includes('interim finding'))
    crew.ws.send(JSON.stringify({ type: 'reply', mentionId: mention.id, text: 'the real answer', final: true }))
    const done = await human.c.next((m) => m.type === 'chat_update' && m.message.status === 'done')
    expect(done.message.text).toBe('the real answer')
    crew.ws.close()
    human.ws.close()
  })

  it('reclaiming a crew mid-mention fails the in-flight request instead of leaving it busy', async () => {
    const crew = await connectCrew()
    const human = await openEvents('Alice')
    human.ws.send(JSON.stringify({ type: 'chat', text: `@${crew.name} go` }))
    await crew.c.next((m) => m.type === 'mention')
    const newcomer = await sessionToken('Newcomer')
    expect((await post('/api/crews/reclaim', { name: crew.name }, newcomer.token)).status).toBe(200)
    const failed = await human.c.next((m) => m.type === 'chat_update' && m.message.status === 'failed')
    expect(failed.message.text).toBe('Disconnected — request dropped')
    await runInDurableObject(roomStub(), async (i: BoardRoom) => {
      expect(i.router.isBusy(crew.crew.id)).toBe(false)
    })
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

  it('does not burn the dedupe when the crew was offline; delivers once it connects', async () => {
    const frame = buildFrame({ name: 'Team Owl', x: 3000, y: 0, w: 1000, h: 600 })
    const name = uniq('Late')
    const reg = await registerCrew(name, frame.id)
    const note = buildNote({ parentId: frame.id, x: 40, y: 80, text: `@${name} ideas?`, crewId: '' })
    await putShapes(frame, note)
    const user = await sessionToken('Alice')
    expect((await post('/api/mentions/board', { shapeId: note.id }, user.token)).body).toEqual({ delivered: [] })
    const ws = await openWs(`/crew/ws?token=${reg.token}`)
    const c = collector(ws)
    await c.next((m) => m.type === 'hello')
    expect((await post('/api/mentions/board', { shapeId: note.id }, user.token)).body).toEqual({ delivered: [name] })
    ws.close()
  })

  it('uses the client-reported text when the synced shape lags behind', async () => {
    const frame = buildFrame({ name: 'Team Lag', x: 6000, y: 0, w: 1000, h: 600 })
    const crew = await connectCrew(uniq('Lag'), frame.id)
    const note = buildNote({ parentId: frame.id, x: 40, y: 80, text: `@${crew.name.slice(0, 3)}`, crewId: '' }) // stale partial text
    await putShapes(frame, note)
    const user = await sessionToken('Alice')
    const r = await post('/api/mentions/board', { shapeId: note.id, text: `@${crew.name} full question` }, user.token)
    expect(r.body).toEqual({ delivered: [crew.name] })
    const m = await crew.c.next((x) => x.type === 'mention')
    expect(m.text).toBe(`@${crew.name} full question`)
    crew.ws.close()
  })

  it('returns 404 for an unknown shape and 401 without a session', async () => {
    const user = await sessionToken('Alice')
    expect((await post('/api/mentions/board', { shapeId: 'shape:nope' }, user.token)).status).toBe(404)
    expect((await post('/api/mentions/board', { shapeId: 'shape:nope' })).status).toBe(401)
  })
})
