import { SELF, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { TLShape } from '@tldraw/tlschema'
import type { BoardRoom } from '../worker/BoardRoom'
import { buildFrame } from '../worker/boardModel'
import { snapshotRecords } from '../worker/boardWriter'
import { openEvents, openWs, registerCrew, roomStub, sessionToken, uniq } from './helpers'

let rpcId = 0
async function rpc(token: string | null, method: string, params: unknown = {}, path = '/mcp') {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await SELF.fetch(`https://x${path}`, {
    method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  })
  return { status: res.status, body: (await res.json()) as any }
}
const call = (token: string, name: string, args: Record<string, unknown> = {}) => rpc(token, 'tools/call', { name, arguments: args })
const text = (r: { body: any }) => r.body.result.content.map((c: { text: string }) => c.text).join('\n')

async function shapes(): Promise<TLShape[]> {
  let out: TLShape[] = []
  await runInDurableObject(roomStub(), async (i: BoardRoom) => {
    out = snapshotRecords(i.getRoom()).filter((r) => r.typeName === 'shape') as TLShape[]
  })
  return out
}

async function addFrame(name: string, x = 0) {
  const frame = buildFrame({ name, x, y: 0, w: 1000, h: 600 })
  await runInDurableObject(roomStub(), async (i: BoardRoom) => {
    await i.getRoom().updateStore((s) => s.put(frame as never))
  })
  return frame
}

const TOOLS = [
  'list_team_areas', 'get_area_content', 'get_board_overview', 'add_sticky_note', 'add_text',
  'add_section', 'get_recent_chat', 'post_chat_message', 'wait_for_mentions',
]

describe('MCP server', () => {
  it('lists all nine tools for a valid crew', async () => {
    const { token } = await registerCrew(uniq('Mcp'))
    const r = await rpc(token, 'tools/list')
    expect(r.status).toBe(200)
    expect(r.body.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([...TOOLS].sort())
  })

  it('rejects a bad token with 401', async () => {
    expect((await rpc('crw_00000000000000000000000000000000', 'tools/list')).status).toBe(401)
    expect((await rpc(null, 'tools/list')).status).toBe(401)
  })

  it('accepts the token in the URL path', async () => {
    const { token } = await registerCrew(uniq('Path'))
    const r = await rpc(null, 'tools/list', {}, `/mcp/${token}`)
    expect(r.status).toBe(200)
  })

  it('adds non-overlapping sticky notes inside the crew area, attributed to the crew', async () => {
    const frame = await addFrame(uniq('Area'))
    const { token, crew } = await registerCrew(uniq('Sticky'), frame.id)
    await call(token, 'add_sticky_note', { text: 'first idea' })
    await call(token, 'add_sticky_note', { text: 'second idea', color: 'blue' })
    const notes = (await shapes()).filter((s) => s.parentId === frame.id && s.type === 'note')
    expect(notes).toHaveLength(2)
    expect(notes.every((n) => (n.meta as { crewId: string }).crewId === crew.id)).toBe(true)
    const [a, b] = notes
    expect(a.x === b.x && a.y === b.y).toBe(false)
    const content = await call(token, 'get_area_content', {})
    expect(text(content)).toContain('first idea')
    expect(text(content)).toContain('second idea')
  })

  it('creates a fallback area for a crew without one and remembers it', async () => {
    const name = uniq('NoArea')
    const { token, crew } = await registerCrew(name)
    await call(token, 'add_sticky_note', { text: 'homeless idea' })
    const all = await shapes()
    const frame = all.find((s) => s.type === 'frame' && (s.props as { name: string }).name === `${name} area`)
    expect(frame).toBeTruthy()
    expect(all.some((s) => s.parentId === frame!.id && s.type === 'note')).toBe(true)
    await runInDurableObject(roomStub(), async (i: BoardRoom) => {
      expect(i.crews.byId(crew.id)?.areaId).toBe(frame!.id)
    })
  })

  it('addresses another area by name and errors on an unknown area', async () => {
    const target = await addFrame(uniq('Target'), 5000)
    const { token } = await registerCrew(uniq('Named'))
    const areaName = (target.props as { name: string }).name
    await call(token, 'add_text', { text: 'hello area', area: areaName.toLowerCase() })
    expect((await shapes()).some((s) => s.parentId === target.id && s.type === 'text')).toBe(true)
    const bad = await call(token, 'add_sticky_note', { text: 'x', area: 'Nowhere Land' })
    expect(bad.body.result.isError).toBe(true)
    expect(text(bad)).toContain('Unknown area')
  })

  it('adds a section with a heading and notes', async () => {
    const frame = await addFrame(uniq('Sec'), 9000)
    const { token } = await registerCrew(uniq('Section'), frame.id)
    await call(token, 'add_section', { title: 'Insights', items: ['a', 'b', 'c'] })
    const kids = (await shapes()).filter((s) => s.parentId === frame.id)
    expect(kids.filter((s) => s.type === 'text')).toHaveLength(1)
    expect(kids.filter((s) => s.type === 'note')).toHaveLength(3)
    const overview = await call(token, 'get_board_overview')
    expect(text(overview)).toContain('Insights')
  })

  it('posts chat messages as the crew and reads recent chat', async () => {
    const name = uniq('Chatty')
    const { token } = await registerCrew(name)
    const human = await openEvents('Alice')
    await human.c.next((m) => m.type === 'init')
    await call(token, 'post_chat_message', { text: 'hello from MCP' })
    const got = await human.c.next((m) => m.type === 'chat' && m.message.authorType === 'crew')
    expect(got.message).toMatchObject({ authorName: name, text: 'hello from MCP' })
    expect(text(await call(token, 'get_recent_chat', { limit: 5 }))).toContain('hello from MCP')
    human.ws.close()
  })

  it('wait_for_mentions receives mentions for a polling crew; a stale poller gets the offline notice', async () => {
    const name = uniq('Poll')
    const { token } = await registerCrew(name)
    // start polling, then mention while the poll is open
    const pending = call(token, 'wait_for_mentions', { timeout_seconds: 3 })
    await new Promise((r) => setTimeout(r, 200))
    const human = await openEvents('Alice')
    human.ws.send(JSON.stringify({ type: 'chat', text: `@${name} are you there?` }))
    const r = await pending
    expect(text(r)).toContain('are you there?')
    // a polling crew has no socket, so post_chat_message is its final answer
    await call(token, 'post_chat_message', { text: 'yes' })
    const done = await human.c.next((m) => m.type === 'chat_update' && m.message.status === 'done')
    expect(done.message.text).toBe('yes')
    await human.c.next((m) => m.type === 'thinking' && !m.on)
    human.ws.close()
  })

  it('schedules the housekeeping alarm for polling crews so stuck mentions can time out', async () => {
    await runInDurableObject(roomStub(), async (_i: BoardRoom, state) => {
      await state.storage.deleteAlarm()
    })
    const { token } = await registerCrew(uniq('Alarm'))
    await call(token, 'wait_for_mentions', { timeout_seconds: 1 })
    await runInDurableObject(roomStub(), async (_i: BoardRoom, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull()
    })
  })

  it('a crew that never polled and has no socket gets an offline notice', async () => {
    const name = uniq('Ghost')
    await registerCrew(name)
    const human = await openEvents('Alice')
    human.ws.send(JSON.stringify({ type: 'chat', text: `@${name} hello?` }))
    const sys = await human.c.next((m) => m.type === 'chat' && m.message.authorType === 'system')
    expect(sys.message.text).toBe(`${name} is offline — mention not delivered`)
    human.ws.close()
  })
})
