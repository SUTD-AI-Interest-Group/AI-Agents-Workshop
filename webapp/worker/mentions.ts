import type { FromCrew, MentionPayload, ToCrew } from '../shared/protocol'

export const HOP_LIMIT = 3
export const QUEUE_LIMIT = 3
export const MENTION_TIMEOUT_MS = 10 * 60 * 1000

export type MentionInput = Omit<MentionPayload, 'type' | 'id'>
export type Pending = MentionInput & { id: string; deliveredAt?: number }

export type RouterDeps = {
  send(crewId: string, msg: ToCrew): boolean
  isOnline(crewId: string): boolean
  crewName(crewId: string): string
  system(text: string): void
  /** Post a crew-authored chat message produced while handling mention `m`. */
  crewSays(crewId: string, text: string, m: Pending): void
  thinking(crewId: string, on: boolean): void
  now(): number
}

/** One mention in flight per crew; up to QUEUE_LIMIT waiting. All state is in memory by design. */
export class MentionRouter {
  private active = new Map<string, Pending>()
  private queues = new Map<string, Pending[]>()

  constructor(private deps: RouterDeps) {}

  isBusy(crewId: string): boolean {
    return this.active.has(crewId)
  }

  activeId(crewId: string): string | null {
    return this.active.get(crewId)?.id ?? null
  }

  deliver(crewId: string, input: MentionInput): void {
    if (input.hop >= HOP_LIMIT) return
    const name = this.deps.crewName(crewId)
    if (!this.deps.isOnline(crewId)) return this.deps.system(`${name} is offline — mention not delivered`)
    const m: Pending = { ...input, id: crypto.randomUUID() }
    if (!this.active.has(crewId)) return this.start(crewId, m)
    const q = this.queues.get(crewId) ?? []
    if (q.length >= QUEUE_LIMIT) return this.deps.system(`${name} is busy — try again shortly`)
    q.push(m)
    this.queues.set(crewId, q)
  }

  onReply(crewId: string, r: FromCrew): void {
    if (r.type === 'pong') return
    const m = this.active.get(crewId)
    if (!m || m.id !== r.mentionId) return
    if (r.type === 'error') {
      this.deps.system(`${this.deps.crewName(crewId)} hit an error: ${String(r.message).slice(0, 500)}`)
      return this.finish(crewId)
    }
    const text = String(r.text ?? '').trim()
    if (text) this.deps.crewSays(crewId, text, m)
    if (r.final) this.finish(crewId)
  }

  onDisconnect(crewId: string): void {
    this.queues.delete(crewId)
    if (!this.active.has(crewId)) return
    this.active.delete(crewId)
    this.deps.system(`${this.deps.crewName(crewId)} disconnected — request dropped`)
    this.deps.thinking(crewId, false)
  }

  tick(): void {
    const now = this.deps.now()
    for (const [crewId, m] of [...this.active]) {
      if (now - (m.deliveredAt ?? now) >= MENTION_TIMEOUT_MS) {
        this.deps.system(`${this.deps.crewName(crewId)} timed out`)
        this.finish(crewId)
      }
    }
  }

  private start(crewId: string, m: Pending) {
    m.deliveredAt = this.deps.now()
    const { deliveredAt: _d, ...payload } = m
    if (!this.deps.send(crewId, { type: 'mention', ...payload })) {
      this.deps.system(`${this.deps.crewName(crewId)} is offline — mention not delivered`)
      return
    }
    this.active.set(crewId, m)
    this.deps.thinking(crewId, true)
  }

  private finish(crewId: string) {
    this.active.delete(crewId)
    this.deps.thinking(crewId, false)
    const next = this.queues.get(crewId)?.shift()
    if (next) this.start(crewId, next)
  }
}
