import type { ChatMessage } from '../shared/protocol'

type Row = { id: string; ts: number; data: string }

export class ChatStore {
  constructor(private sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS chat_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, ts INTEGER NOT NULL, data TEXT NOT NULL)`)
  }

  add(m: Omit<ChatMessage, 'id' | 'ts'>): ChatMessage {
    const msg: ChatMessage = { ...m, id: crypto.randomUUID(), ts: Date.now() }
    const { id, ts, ...rest } = msg
    this.sql.exec('INSERT INTO chat_messages (id, ts, data) VALUES (?, ?, ?)', id, ts, JSON.stringify(rest))
    return msg
  }

  /** Last `limit` messages, oldest first. */
  recent(limit: number): ChatMessage[] {
    const rows = this.sql
      .exec<Row>('SELECT id, ts, data FROM chat_messages ORDER BY seq DESC LIMIT ?', limit)
      .toArray()
    return rows.reverse().map((r) => ({ id: r.id, ts: r.ts, ...JSON.parse(r.data) }))
  }
}
