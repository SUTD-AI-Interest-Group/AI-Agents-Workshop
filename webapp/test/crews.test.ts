import { runInDurableObject } from 'cloudflare:test'
import { expect, it } from 'vitest'
import { hashToken } from '../worker/auth'
import type { BoardRoom } from '../worker/BoardRoom'
import { CrewRegistry } from '../worker/crews'
import { openEvents, post, registerCrew, roomStub, sessionToken, uniq } from './helpers'

it('CrewRegistry finds a created crew by token hash and by name case-insensitively', async () => {
  await runInDurableObject(roomStub(), async (_i: BoardRoom, state) => {
    const reg = new CrewRegistry(state.storage.sql)
    const { crew, token } = await reg.create('FalconCrew', null, 'u1')
    expect(reg.byTokenHash(await hashToken(token))?.id).toBe(crew.id)
    expect(reg.byName('falconcrew')?.id).toBe(crew.id)
    expect(reg.byOwner('u1')?.id).toBe(crew.id)
  })
})

it('registers a crew and returns a token once', async () => {
  const name = uniq('Falcon')
  const r = await registerCrew(name, null)
  expect(r.crew).toMatchObject({ name, online: false, busy: false })
  expect(r.token).toMatch(/^crw_[0-9a-f]{32}$/)
})

it('rejects a duplicate name regardless of case', async () => {
  const name = uniq('Dup')
  await registerCrew(name)
  const other = await sessionToken('Other')
  const r = await post('/api/crews', { name: name.toLowerCase(), areaId: null }, other.token)
  expect(r.status).toBe(409)
  expect(r.body).toEqual({ error: 'name_taken' })
})

it('rejects invalid names', async () => {
  const u = await sessionToken('U')
  expect((await post('/api/crews', { name: '1bad', areaId: null }, u.token)).status).toBe(400)
  expect((await post('/api/crews', { name: 'has space', areaId: null }, u.token)).status).toBe(400)
  expect((await post('/api/crews', { name: 'x', areaId: null }, u.token)).status).toBe(400)
})

it('requires a session', async () => {
  expect((await post('/api/crews', { name: 'NoAuth', areaId: null })).status).toBe(401)
})

it('updates instead of duplicating when the same owner registers again', async () => {
  const first = await registerCrew('OwlCrew', null)
  const again = await post('/api/crews', { name: 'OwlCrew', areaId: 'shape:area1' }, first.user.token)
  expect(again.status).toBe(200)
  expect(again.body.token).toBeNull()
  expect(again.body.crew).toMatchObject({ id: first.crew.id, areaId: 'shape:area1' })
})

it('reclaim rotates the token and transfers ownership', async () => {
  const first = await registerCrew('HawkCrew')
  const newcomer = await sessionToken('Newcomer')
  const r = await post('/api/crews/reclaim', { name: 'hawkcrew' }, newcomer.token)
  expect(r.status).toBe(200)
  expect(r.body.token).not.toBe(first.token)
  expect(r.body.crew.ownerUserId).toBe(newcomer.userId)
  await runInDurableObject(roomStub(), async (i: BoardRoom) => {
    expect(i.crews.byTokenHash(await hashToken(first.token))).toBeNull()
    expect(i.crews.byTokenHash(await hashToken(r.body.token))?.name).toBe('HawkCrew')
  })
})

it('reclaim of an unknown crew is 404', async () => {
  const u = await sessionToken('U')
  expect((await post('/api/crews/reclaim', { name: 'Nobody' }, u.token)).status).toBe(404)
})

it('broadcasts the crew list when a crew is registered', async () => {
  const watcher = await openEvents('Watcher')
  await watcher.c.next((m) => m.type === 'init')
  await registerCrew('BeeCrew')
  const ev = await watcher.c.next((m) => m.type === 'crews' && m.crews.some((c: { name: string }) => c.name === 'BeeCrew'))
  expect(ev.crews.length).toBeGreaterThan(0)
  watcher.ws.close()
})
