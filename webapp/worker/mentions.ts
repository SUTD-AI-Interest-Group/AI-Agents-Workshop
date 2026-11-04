import { PROGRESS_KINDS, type FromCrew, type MentionPayload, type ProgressItem, type ProgressKind, type ToCrew } from '../shared/protocol'

const asKind = (k: unknown): ProgressKind => (PROGRESS_KINDS as readonly unknown[]).includes(k) ? (k as ProgressKind) : 'note'

export const HOP_LIMIT = 3
export const QUEUE_LIMIT = 3
export const MENTION_TIMEOUT_MS = 10 * 60 * 1000

export type MentionInput = Omit<MentionPayload, 'type' | 'id'> & {
  /** Server-side only: the chat message that asked, so the crew's answer can be threaded under it. */
  origin?: { id: string; authorName: string; text: string }
}
export type Pending = MentionInput & { id: string; deliveredAt?: number }

export type RouterDeps = {
  send(crewId: string, msg: ToCrew): boolean
  isOnline(crewId: string): boolean
  crewName(crewId: string): string
  /** Board notices for people (offline / busy). */
  system(text: string): void
  /** A mention was handed to the crew: open its in-place chat message. */
  started(crewId: string, m: Pending): void
  /** Progress text for the in-flight mention's message. */
  progress(crewId: string, item: ProgressItem, m: Pending): void
  /** The crew's final answer replaces the working state. */
  finished(crewId: string, text: string, m: Pending): void
  /** The mention ended without an answer (error, timeout, disconnect). */
  failed(crewId: string, reason: string, m: Pending): void
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

  hasActive(): boolean {
    return this.active.size > 0
  }

  /** Returns true when the mention was started or queued. */
  deliver(crewId: string, input: MentionInput): boolean {
    if (input.hop >= HOP_LIMIT) return false
    const name = this.deps.crewName(crewId)
    // Notices only for people: a crew whose message happens to mention an unavailable crew shouldn't add chat noise.
    const notify = (text: string) => (input.hop === 0 ? this.deps.system(text) : undefined)
    if (!this.deps.isOnline(crewId)) {
      notify(`${name} is offline — mention not delivered`)
      return false
    }
    const m: Pending = { ...input, id: crypto.randomUUID() }
    if (!this.active.has(crewId)) return this.start(crewId, m)
    const q = this.queues.get(crewId) ?? []
    if (q.length >= QUEUE_LIMIT) {
      notify(`${name} is busy — try again shortly`)
      return false
    }
    q.push(m)
    this.queues.set(crewId, q)
    return true
  }

  onReply(crewId: string, r: FromCrew): void {
    if (r.type === 'pong') return
    const m = this.active.get(crewId)
    if (!m || m.id !== r.mentionId) return
    if (r.type === 'error') return this.end(crewId, () => this.deps.failed(crewId, `Hit an error: ${String(r.message).slice(0, 500)}`, m))
    const text = String(r.text ?? '').trim()
    if (!r.final) {
      if (text) this.deps.progress(crewId, { kind: asKind(r.kind), text: text.slice(0, 500) }, m)
      return
    }
    this.end(crewId, () => this.deps.finished(crewId, text, m))
  }

  /** Progress from outside the listener (e.g. an MCP chat post) for the in-flight mention. */
  addProgress(crewId: string, text: string): boolean {
    const m = this.active.get(crewId)
    if (!m) return false
    this.deps.progress(crewId, { kind: 'note', text: text.slice(0, 500) }, m)
    return true
  }

  /** Final answer from outside the listener (a polling crew's MCP chat post). */
  finishActive(crewId: string, text: string): boolean {
    const m = this.active.get(crewId)
    if (!m) return false
    this.end(crewId, () => this.deps.finished(crewId, text, m))
    return true
  }

  onDisconnect(crewId: string): void {
    this.queues.delete(crewId)
    const m = this.active.get(crewId)
    if (!m) return
    this.active.delete(crewId)
    this.deps.failed(crewId, 'Disconnected — request dropped', m)
    this.deps.thinking(crewId, false)
  }

  tick(): void {
    const now = this.deps.now()
    for (const [crewId, m] of [...this.active]) {
      if (now - (m.deliveredAt ?? now) >= MENTION_TIMEOUT_MS) {
        this.end(crewId, () => this.deps.failed(crewId, 'Timed out after 10 minutes', m))
      }
    }
  }

  private start(crewId: string, m: Pending): boolean {
    m.deliveredAt = this.deps.now()
    const { deliveredAt: _d, origin: _o, ...payload } = m
    if (!this.deps.send(crewId, { type: 'mention', ...payload })) {
      if (m.hop === 0) this.deps.system(`${this.deps.crewName(crewId)} is offline — mention not delivered`)
      return false
    }
    this.active.set(crewId, m)
    this.deps.started(crewId, m)
    this.deps.thinking(crewId, true)
    return true
  }

  /** Close the in-flight mention (running `report` first), then start the next queued one. */
  private end(crewId: string, report: () => void) {
    this.active.delete(crewId)
    report()
    this.deps.thinking(crewId, false)
    const next = this.queues.get(crewId)?.shift()
    if (next) this.start(crewId, next)
  }
}
