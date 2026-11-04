import type { ChatMessage } from '../shared/protocol'

type Row = { id: string; ts: number; data: string }

export class ChatStore {
  constructor(private sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS chat_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, ts INTEGER NOT NULL, data TEXT NOT NULL)`)
    sql.exec('CREATE INDEX IF NOT EXISTS chat_messages_id ON chat_messages (id)')
  }

  add(m: Omit<ChatMessage, 'id' | 'ts'>): ChatMessage {
    const msg: ChatMessage = { ...m, id: crypto.randomUUID(), ts: Date.now() }
    const { id, ts, ...rest } = msg
    this.sql.exec('INSERT INTO chat_messages (id, ts, data) VALUES (?, ?, ?)', id, ts, JSON.stringify(rest))
    return msg
  }

  get(id: string): ChatMessage | null {
    const row = this.sql.exec<Row>('SELECT id, ts, data FROM chat_messages WHERE id = ?', id).toArray()[0]
    return row ? { id: row.id, ts: row.ts, ...JSON.parse(row.data) } : null
  }

  /** Apply `patch` to a stored message; returns the updated message (null if unknown). */
  update(id: string, patch: (m: ChatMessage) => Partial<ChatMessage>): ChatMessage | null {
    const row = this.sql.exec<Row>('SELECT id, ts, data FROM chat_messages WHERE id = ?', id).toArray()[0]
    if (!row) return null
    const current: ChatMessage = { id: row.id, ts: row.ts, ...JSON.parse(row.data) }
    const next: ChatMessage = { ...current, ...patch(current), id: row.id, ts: row.ts }
    const { id: _i, ts: _t, ...rest } = next
    this.sql.exec('UPDATE chat_messages SET data = ? WHERE id = ?', JSON.stringify(rest), id)
    return next
  }

  /** Last `limit` messages, oldest first. */
  recent(limit: number): ChatMessage[] {
    const rows = this.sql
      .exec<Row>('SELECT id, ts, data FROM chat_messages ORDER BY seq DESC LIMIT ?', limit)
      .toArray()
    return rows.reverse().map((r) => ({ id: r.id, ts: r.ts, ...JSON.parse(r.data) }))
  }
}
