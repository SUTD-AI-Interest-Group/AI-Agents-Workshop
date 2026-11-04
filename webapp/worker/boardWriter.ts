import type { TLSocketRoom } from '@tldraw/sync-core'
import type { TLDefaultColorStyle, TLRecord, TLShape } from '@tldraw/tlschema'
import { getIndexAbove, type IndexKey } from '@tldraw/utils'
import {
  GAP,
  NOTE,
  PAD,
  TOP,
  buildFrame,
  buildNote,
  buildText,
  listAreas,
  nextIndex,
  nextNotePositions,
  shapeSize,
  type Area,
} from './boardModel'
import type { Crew } from './crews'

/** Current document records of the room (shapes, pages, ...). */
export function snapshotRecords(room: TLSocketRoom<TLRecord, any>): TLRecord[] {
  return room.getCurrentSnapshot().documents.map((d) => d.state as TLRecord)
}

export class UnknownAreaError extends Error {
  constructor(public available: string[]) {
    super(`Unknown area. Available: ${available.length ? available.join(', ') : '(none yet)'}`)
  }
}

const FALLBACK_W = 1200
const FALLBACK_H = 800
const HEADING_H = 70

/** Writes crew output onto the canvas, always inside a team area. */
export class BoardWriter {
  constructor(
    private room: () => TLSocketRoom<TLRecord, any>,
    private setCrewArea: (crewId: string, areaId: string) => void,
  ) {}

  private records() {
    return snapshotRecords(this.room())
  }

  /** Explicit area (id or case-insensitive name) → crew's area → newly created "<Crew> area" frame. */
  async resolveArea(crew: Crew, areaRef: string | null | undefined): Promise<Area> {
    const areas = listAreas(this.records())
    if (areaRef) {
      const hit = areas.find((a) => a.id === areaRef) ?? areas.find((a) => a.name.toLowerCase() === areaRef.trim().toLowerCase())
      if (!hit) throw new UnknownAreaError(areas.map((a) => a.name))
      return hit
    }
    const own = crew.areaId ? areas.find((a) => a.id === crew.areaId) : undefined
    if (own) return own
    return this.createFallbackArea(crew)
  }

  private async createFallbackArea(crew: Crew): Promise<Area> {
    const records = this.records()
    const page = records.find((r) => r.typeName === 'page')?.id ?? 'page:page'
    const top = records.filter((r): r is TLShape => r.typeName === 'shape' && r.parentId === page)
    const right = top.length ? Math.max(...top.map((s) => s.x + shapeSize(s).w)) : -200
    const frame = buildFrame({ name: `${crew.name} area`, x: right + 200, y: 0, w: FALLBACK_W, h: FALLBACK_H, parentId: page, index: nextIndex(records, page) })
    await this.room().updateStore((s) => s.put(frame))
    this.setCrewArea(crew.id, frame.id)
    return { id: frame.id, name: `${crew.name} area`, x: frame.x, y: frame.y, w: FALLBACK_W, h: FALLBACK_H }
  }

  private async grow(areaId: string, h: number) {
    await this.room().updateStore((s) => {
      const f = s.get(areaId) as TLShape | null
      if (f && (f.props as { h: number }).h < h) s.put({ ...f, props: { ...(f.props as object), h } } as TLShape)
    })
  }

  private indices(records: TLRecord[], parentId: string, n: number): IndexKey[] {
    const out: IndexKey[] = []
    let i = nextIndex(records, parentId)
    for (let k = 0; k < n; k++) {
      out.push(i)
      i = getIndexAbove(i)
    }
    return out
  }

  async addNotes(crew: Crew, areaRef: string | null | undefined, texts: string[], color?: TLDefaultColorStyle): Promise<string[]> {
    const area = await this.resolveArea(crew, areaRef)
    const records = this.records()
    const { positions, growTo } = nextNotePositions(records, area.id, texts.length)
    const idx = this.indices(records, area.id, texts.length)
    const notes = texts.map((text, i) => buildNote({ parentId: area.id, ...positions[i], index: idx[i], text, color, crewId: crew.id }))
    await this.room().updateStore((s) => notes.forEach((n) => s.put(n)))
    if (growTo) await this.grow(area.id, growTo)
    return notes.map((n) => n.id)
  }

  async addText(crew: Crew, areaRef: string | null | undefined, text: string): Promise<string> {
    const { headingId } = await this.addSection(crew, areaRef, text, [])
    return headingId
  }

  /** A heading on its own row below existing content, then a grid of notes beneath it. */
  async addSection(crew: Crew, areaRef: string | null | undefined, title: string, items: string[]): Promise<{ headingId: string; noteIds: string[]; areaId: string }> {
    const area = await this.resolveArea(crew, areaRef)
    const records = this.records()
    const kids = records.filter((r): r is TLShape => r.typeName === 'shape' && r.parentId === area.id)
    const startY = kids.length ? Math.max(...kids.map((s) => s.y + shapeSize(s).h)) + GAP * 2 : TOP
    const cols = Math.max(1, Math.floor((area.w - 2 * PAD + GAP) / (NOTE + GAP)))
    const idx = this.indices(records, area.id, items.length + 1)
    const heading = buildText({ parentId: area.id, x: PAD, y: startY, index: idx[0], text: title, crewId: crew.id, w: Math.max(200, area.w - 2 * PAD) })
    const notes = items.map((text, i) =>
      buildNote({
        parentId: area.id, index: idx[i + 1], text, crewId: crew.id,
        x: PAD + (i % cols) * (NOTE + GAP), y: startY + HEADING_H + Math.floor(i / cols) * (NOTE + GAP),
      }),
    )
    await this.room().updateStore((s) => [heading, ...notes].forEach((r) => s.put(r)))
    const rows = Math.ceil(items.length / cols)
    const bottom = startY + HEADING_H + rows * (NOTE + GAP) + PAD
    if (bottom > area.h) await this.grow(area.id, bottom)
    return { headingId: heading.id, noteIds: notes.map((n) => n.id), areaId: area.id }
  }
}
