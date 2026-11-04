import {
  createShapeId,
  toRichText,
  type TLDefaultColorStyle,
  type TLParentId,
  type TLRecord,
  type TLShape,
  type TLShapeId,
} from '@tldraw/tlschema'
import { getIndexAbove, type IndexKey } from '@tldraw/utils'
import { shapeText } from '../shared/text'

export type Area = { id: string; name: string; x: number; y: number; w: number; h: number }

export const NOTE = 200
export const GAP = 20
export const PAD = 40
export const TOP = 80

const isShape = (r: TLRecord): r is TLShape => r.typeName === 'shape'

function shapeMap(records: TLRecord[]): Map<string, TLShape> {
  return new Map(records.filter(isShape).map((s) => [s.id, s]))
}

/** Approximate size of a shape (no rotation), good enough for placement and proximity. */
export function shapeSize(s: TLShape): { w: number; h: number } {
  const p = s.props as { w?: number; h?: number; scale?: number; growY?: number }
  if (s.type === 'note') return { w: NOTE * (p.scale ?? 1), h: (NOTE + (p.growY ?? 0)) * (p.scale ?? 1) }
  if (s.type === 'text') return { w: p.w ?? NOTE, h: 50 }
  return { w: p.w ?? NOTE, h: p.h ?? NOTE }
}

/** Page-space top-left of a shape, summing parent offsets. */
export function pagePos(map: Map<string, TLShape>, s: TLShape): { x: number; y: number } {
  let x = s.x
  let y = s.y
  let parent = map.get(s.parentId)
  while (parent) {
    x += parent.x
    y += parent.y
    parent = map.get(parent.parentId)
  }
  return { x, y }
}

const isTopLevel = (s: TLShape) => s.parentId.startsWith('page:')

export function listAreas(records: TLRecord[]): Area[] {
  return records
    .filter(isShape)
    .filter((s) => s.type === 'frame' && isTopLevel(s))
    .map((s) => {
      const p = s.props as { w: number; h: number; name: string }
      return { id: s.id, name: p.name, x: s.x, y: s.y, w: p.w, h: p.h }
    })
}

export function areaOf(records: TLRecord[], shapeId: string): Area | null {
  const map = shapeMap(records)
  let s = map.get(shapeId)
  while (s && !isTopLevel(s)) s = map.get(s.parentId)
  if (!s || s.id === shapeId || s.type !== 'frame') return null
  return listAreas([s]).at(0) ?? null
}

function descendants(map: Map<string, TLShape>, rootId: string): TLShape[] {
  const out: TLShape[] = []
  const walk = (id: string) => {
    for (const s of map.values()) if (s.parentId === id) {
      out.push(s)
      walk(s.id)
    }
  }
  walk(rootId)
  return out
}

/** Non-empty texts inside an area, top-to-bottom then left-to-right. */
export function areaContent(records: TLRecord[], areaId: string): string[] {
  const map = shapeMap(records)
  return descendants(map, areaId)
    .map((s) => ({ s, p: pagePos(map, s), t: shapeText(s).trim() }))
    .filter((e) => e.t)
    .sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x)
    .map((e) => e.t)
}

export function nearbyTexts(records: TLRecord[], shapeId: string, radius = 600): string[] {
  const map = shapeMap(records)
  const target = map.get(shapeId)
  if (!target) return []
  const center = (s: TLShape) => {
    const p = pagePos(map, s)
    const { w, h } = shapeSize(s)
    return { x: p.x + w / 2, y: p.y + h / 2 }
  }
  const c = center(target)
  return [...map.values()]
    .filter((s) => s.id !== shapeId)
    .map((s) => ({ d: Math.hypot(center(s).x - c.x, center(s).y - c.y), t: shapeText(s).trim() }))
    .filter((e) => e.t && e.d <= radius)
    .sort((a, b) => a.d - b.d)
    .map((e) => e.t)
}

/** Frame-relative grid cells for `count` new notes that avoid existing children. */
export function nextNotePositions(
  records: TLRecord[],
  areaId: string,
  count: number,
): { positions: { x: number; y: number }[]; growTo?: number } {
  const map = shapeMap(records)
  const frame = map.get(areaId)
  if (!frame) return { positions: [] }
  const { w: fw, h: fh } = frame.props as { w: number; h: number }
  const occupied = [...map.values()]
    .filter((s) => s.parentId === areaId)
    .map((s) => ({ x: s.x, y: s.y, ...shapeSize(s) }))
  const overlaps = (x: number, y: number) =>
    occupied.some((o) => x < o.x + o.w && x + NOTE > o.x && y < o.y + o.h && y + NOTE > o.y)
  const cols = Math.max(1, Math.floor((fw - 2 * PAD + GAP) / (NOTE + GAP)))
  const positions: { x: number; y: number }[] = []
  for (let row = 0; positions.length < count; row++) {
    for (let col = 0; col < cols && positions.length < count; col++) {
      const x = PAD + col * (NOTE + GAP)
      const y = TOP + row * (NOTE + GAP)
      if (!overlaps(x, y)) positions.push({ x, y })
    }
    if (row > 500) break
  }
  const bottom = Math.max(...positions.map((p) => p.y + NOTE)) + PAD
  return bottom > fh ? { positions, growTo: bottom } : { positions }
}

/** Index above every existing sibling under `parentId`. */
export function nextIndex(records: TLRecord[], parentId: string): IndexKey {
  const siblings = records.filter(isShape).filter((s) => s.parentId === parentId).map((s) => s.index).sort()
  return getIndexAbove(siblings.at(-1) ?? null)
}

type Base = { parentId: string; x: number; y: number; index?: IndexKey }

function base(type: string, o: Base, meta: Record<string, string>) {
  return {
    id: createShapeId() as TLShapeId,
    typeName: 'shape' as const,
    type,
    x: o.x,
    y: o.y,
    rotation: 0,
    index: o.index ?? getIndexAbove(null),
    parentId: o.parentId as TLParentId,
    isLocked: false,
    opacity: 1,
    meta,
  }
}

export function buildNote(o: Base & { text: string; color?: TLDefaultColorStyle; crewId: string }): TLShape {
  return {
    ...base('note', o, { crewId: o.crewId }),
    props: {
      color: o.color ?? 'yellow', labelColor: 'black', size: 'm', font: 'draw', fontSizeAdjustment: null,
      align: 'middle', verticalAlign: 'middle', growY: 0, url: '', richText: toRichText(o.text), scale: 1, textLastEditedBy: null,
    },
  } as unknown as TLShape
}

export function buildText(o: Base & { text: string; crewId: string; w?: number }): TLShape {
  return {
    ...base('text', o, { crewId: o.crewId }),
    props: { color: 'black', size: 'l', font: 'sans', textAlign: 'start', w: o.w ?? 600, richText: toRichText(o.text), scale: 1, autoSize: true },
  } as unknown as TLShape
}

export function buildFrame(o: { name: string; x: number; y: number; w: number; h: number; parentId?: string; index?: IndexKey }): TLShape {
  return {
    ...base('frame', { parentId: o.parentId ?? 'page:page', x: o.x, y: o.y, index: o.index }, {}),
    props: { w: o.w, h: o.h, name: o.name, color: 'black' },
  } as unknown as TLShape
}
