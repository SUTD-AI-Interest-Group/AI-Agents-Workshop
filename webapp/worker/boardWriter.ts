import type { TLSocketRoom } from '@tldraw/sync-core'
import type { TLRecord } from '@tldraw/tlschema'

/** Current document records of the room (shapes, pages, ...). */
export function snapshotRecords(room: TLSocketRoom<TLRecord, any>): TLRecord[] {
  return room.getCurrentSnapshot().documents.map((d) => d.state as TLRecord)
}
