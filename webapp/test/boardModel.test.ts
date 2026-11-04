import { toRichText, type TLRecord, type TLShape } from '@tldraw/tlschema'
import { describe, expect, it } from 'vitest'
import { parseMentions, richTextToPlain, shapeText } from '../shared/text'
import { schema } from '../worker/BoardRoom'
import {
  areaContent,
  areaOf,
  buildFrame,
  buildNote,
  buildText,
  listAreas,
  nearbyTexts,
  nextNotePositions,
} from '../worker/boardModel'

const PAGE = 'page:page'
const page = { id: PAGE, typeName: 'page', name: 'Page 1', index: 'a1', meta: {} } as unknown as TLRecord

function validate(r: TLShape) {
  schema.validateRecord(null as never, r as never, 'initialize', null)
}

describe('text helpers', () => {
  it('flattens rich text paragraphs with newlines', () => {
    expect(richTextToPlain(toRichText('a\nb'))).toBe('a\nb')
    expect(richTextToPlain(undefined)).toBe('')
  })
  it('reads note text and frame names', () => {
    const f = buildFrame({ name: 'Team Falcon', x: 0, y: 0, w: 100, h: 100 })
    const n = buildNote({ parentId: f.id, x: 0, y: 0, text: 'hello', crewId: 'c1' })
    expect(shapeText(n)).toBe('hello')
    expect(shapeText(f)).toBe('Team Falcon')
  })
})

describe('parseMentions', () => {
  it('matches case-insensitively and ignores trailing punctuation', () => {
    expect(parseMentions('hey @falconcrew, thoughts?', ['FalconCrew'])).toEqual(['FalconCrew'])
  })
  it('ignores email-like text', () => {
    expect(parseMentions('mail email@FalconCrew.com', ['FalconCrew'])).toEqual([])
  })
  it('dedupes and ignores unknown names', () => {
    expect(parseMentions('@A1 @a1 @Nobody @B2', ['A1', 'B2'])).toEqual(['A1', 'B2'])
  })
  it('does not match a crew name that is only a prefix of the mention', () => {
    expect(parseMentions('@FalconCrewX hi', ['FalconCrew'])).toEqual([])
  })
})

describe('areas', () => {
  const frame = buildFrame({ name: 'Team Falcon', x: 1000, y: 0, w: 1000, h: 600 })
  const nested = buildFrame({ name: 'inner', x: 10, y: 10, w: 100, h: 100, parentId: frame.id })
  const group = { ...buildText({ parentId: frame.id, x: 0, y: 0, text: '', crewId: '' }), type: 'group', props: {} } as unknown as TLShape
  const deep = buildNote({ parentId: group.id, x: 0, y: 0, text: 'deep idea', crewId: 'c' })
  const other = buildNote({ parentId: PAGE, x: 1100, y: 100, text: 'loose', crewId: 'c' })
  const records = [page, frame, nested, group, deep, other] as TLRecord[]

  it('lists only top-level frames', () => {
    expect(listAreas(records).map((a) => a.name)).toEqual(['Team Falcon'])
  })
  it('finds the area of a deeply nested shape', () => {
    expect(areaOf(records, deep.id)?.id).toBe(frame.id)
    expect(areaOf(records, other.id)).toBeNull()
  })
  it('returns area content texts', () => {
    expect(areaContent(records, frame.id)).toContain('deep idea')
    expect(areaContent(records, frame.id)).not.toContain('loose')
  })
  it('finds nearby texts', () => {
    expect(nearbyTexts(records, other.id)).toContain('Team Falcon')
  })
})

describe('placement', () => {
  it('lays notes on a grid inside an empty frame', () => {
    const frame = buildFrame({ name: 'A', x: 0, y: 0, w: 1000, h: 600 })
    const { positions } = nextNotePositions([page, frame] as TLRecord[], frame.id, 3)
    expect(positions).toEqual([{ x: 40, y: 80 }, { x: 260, y: 80 }, { x: 480, y: 80 }])
  })
  it('skips occupied cells', () => {
    const frame = buildFrame({ name: 'A', x: 0, y: 0, w: 1000, h: 600 })
    const taken = buildNote({ parentId: frame.id, x: 40, y: 80, text: 'x', crewId: 'c' })
    const { positions } = nextNotePositions([page, frame, taken] as TLRecord[], frame.id, 1)
    expect(positions).toEqual([{ x: 260, y: 80 }])
  })
  it('asks the frame to grow when it runs out of rows', () => {
    const frame = buildFrame({ name: 'A', x: 0, y: 0, w: 300, h: 300 })
    const { positions, growTo } = nextNotePositions([page, frame] as TLRecord[], frame.id, 2)
    expect(positions).toEqual([{ x: 40, y: 80 }, { x: 40, y: 300 }])
    expect(growTo).toBe(540)
  })
})

describe('record builders', () => {
  it('builds schema-valid notes, texts and frames attributed to the crew', () => {
    const f = buildFrame({ name: 'A', x: 0, y: 0, w: 100, h: 100 })
    const n = buildNote({ parentId: f.id, x: 1, y: 2, text: 'hi', crewId: 'crew-1', color: 'blue' })
    const t = buildText({ parentId: f.id, x: 1, y: 2, text: 'title', crewId: 'crew-1' })
    for (const r of [f, n, t]) expect(() => validate(r)).not.toThrow()
    expect(n.meta).toEqual({ crewId: 'crew-1' })
    expect(n.parentId).toBe(f.id)
  })
})
