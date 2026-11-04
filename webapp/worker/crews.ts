import { CREW_COLORS } from '../shared/protocol'
import { hashToken, newCrewToken } from './auth'

export type Crew = { id: string; name: string; areaId: string | null; ownerUserId: string; tokenHash: string; color: number | null }

export const CREW_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{1,23}$/

export class CrewRegistry {
  constructor(private sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS crews (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, name_lc TEXT NOT NULL UNIQUE,
      area_id TEXT, owner_user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE)`)
    try {
      sql.exec('ALTER TABLE crews ADD COLUMN color INTEGER') // added after first release
    } catch {
      /* column exists */
    }
  }

  private one(query: string, ...args: unknown[]): Crew | null {
    const rows = this.sql
      .exec<{ id: string; name: string; area_id: string | null; owner_user_id: string; token_hash: string; color: number | null }>(query, ...args)
      .toArray()
    const r = rows[0]
    return r ? { id: r.id, name: r.name, areaId: r.area_id, ownerUserId: r.owner_user_id, tokenHash: r.token_hash, color: r.color } : null
  }

  /** A random colour among the least-used ones, so crews stay distinct until the palette runs out. */
  pickColor(): number {
    const used = new Array(CREW_COLORS).fill(0)
    for (const r of this.sql.exec<{ color: number | null }>('SELECT color FROM crews').toArray()) if (r.color !== null) used[r.color]++
    const min = Math.min(...used)
    const options = used.flatMap((n, i) => (n === min ? [i] : []))
    return options[Math.floor(Math.random() * options.length)]
  }

  async create(name: string, areaId: string | null, ownerUserId: string): Promise<{ crew: Crew; token: string }> {
    const token = newCrewToken()
    const crew: Crew = { id: crypto.randomUUID(), name, areaId, ownerUserId, tokenHash: await hashToken(token), color: this.pickColor() }
    this.sql.exec(
      'INSERT INTO crews (id, name, name_lc, area_id, owner_user_id, token_hash, color) VALUES (?, ?, ?, ?, ?, ?, ?)',
      crew.id, name, name.toLowerCase(), areaId, ownerUserId, crew.tokenHash, crew.color,
    )
    return { crew, token }
  }

  update(id: string, patch: { name?: string; areaId?: string | null }): Crew | null {
    if (patch.name !== undefined) this.sql.exec('UPDATE crews SET name = ?, name_lc = ? WHERE id = ?', patch.name, patch.name.toLowerCase(), id)
    if (patch.areaId !== undefined) this.sql.exec('UPDATE crews SET area_id = ? WHERE id = ?', patch.areaId, id)
    return this.byId(id)
  }

  async rotateToken(id: string, newOwnerUserId: string): Promise<string> {
    const token = newCrewToken()
    this.sql.exec('UPDATE crews SET token_hash = ?, owner_user_id = ? WHERE id = ?', await hashToken(token), newOwnerUserId, id)
    return token
  }

  byId(id: string) {
    return this.one('SELECT * FROM crews WHERE id = ?', id)
  }
  byTokenHash(h: string) {
    return this.one('SELECT * FROM crews WHERE token_hash = ?', h)
  }
  byName(name: string) {
    return this.one('SELECT * FROM crews WHERE name_lc = ?', name.toLowerCase())
  }
  byOwner(userId: string) {
    return this.one('SELECT * FROM crews WHERE owner_user_id = ?', userId)
  }
  all(): Crew[] {
    return this.sql
      .exec<{ id: string }>('SELECT id FROM crews ORDER BY name_lc')
      .toArray()
      .map((r) => this.byId(r.id)!)
  }
}
