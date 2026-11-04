import {
  DurableObjectSqliteSyncWrapper,
  SQLiteSyncStorage,
  TLSocketRoom,
} from '@tldraw/sync-core'
import { createTLSchema, defaultBindingSchemas, defaultShapeSchemas, type TLRecord } from '@tldraw/tlschema'
import { DurableObject } from 'cloudflare:workers'
import {
  CHAT_INIT_COUNT,
  CHAT_MAX_LEN,
  type ChatMessage,
  type ClientEvent,
  type CrewInfo,
  type OnlineUser,
  type ServerEvent,
} from '../shared/protocol'
import type { Session } from './auth'
import { ChatStore } from './chat'
import { CREW_NAME_RE, CrewRegistry, type Crew } from './crews'
import { areaContent, areaOf, listAreas, nearbyTexts } from './boardModel'
import { BoardWriter, snapshotRecords } from './boardWriter'
import { handleMcp, type McpHost } from './mcp'
import { MentionRouter, type MentionInput, type Pending } from './mentions'
import { parseMentions, shapeText } from '../shared/text'
import type { FromCrew, MentionPayload, ToCrew } from '../shared/protocol'
import { hashToken, tokenFromRequest } from './auth'
import type { Env } from './index'

export const schema = createTLSchema({ shapes: defaultShapeSchemas, bindings: defaultBindingSchemas })

export type SessionMeta = Session

/** Header the Worker uses to hand a verified session to the DO. Never trusted from clients. */
export const SESSION_HEADER = 'x-dtc-session'

export function sessionOf(req: Request): Session | null {
  const raw = req.headers.get(SESSION_HEADER)
  return raw ? (JSON.parse(raw) as Session) : null
}

export class BoardRoom extends DurableObject<Env> {
  private room: TLSocketRoom<TLRecord, SessionMeta> | null = null
  readonly chat: ChatStore
  readonly crews: CrewRegistry
  /** Live crew listener sockets (Task 7). */
  protected crewSockets = new Map<string, WebSocket>()
  private lastPong = new Map<string, number>()
  readonly router: MentionRouter
  readonly writer: BoardWriter
  /** Crews using the MCP wait_for_mentions fallback: last poll time and undelivered mentions. */
  private lastPoll = new Map<string, number>()
  private mailbox = new Map<string, MentionPayload[]>()
  private eventSockets = new Map<WebSocket, Session>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.chat = new ChatStore(ctx.storage.sql)
    this.crews = new CrewRegistry(ctx.storage.sql)
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS webhook_events (crew_id TEXT NOT NULL, event_id TEXT NOT NULL, PRIMARY KEY (crew_id, event_id))')
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS board_mentions (shape_id TEXT NOT NULL, crew_id TEXT NOT NULL, text_hash TEXT NOT NULL, PRIMARY KEY (shape_id, crew_id, text_hash))',
    )
    this.router = new MentionRouter({
      send: (crewId, msg) => this.sendToCrew(crewId, msg),
      isOnline: (crewId) => this.isCrewOnline(crewId),
      crewName: (crewId) => this.crews.byId(crewId)?.name ?? 'Crew',
      system: (text) => this.postChat({ authorType: 'system', authorName: 'Board', text }),
      crewSays: (crewId, text, m) => this.crewSays(crewId, text, m),
      thinking: (crewId, on) => {
        this.broadcast({ type: 'thinking', crewId, on })
        this.broadcastCrews()
      },
      now: () => Date.now(),
    })
    this.writer = new BoardWriter(
      () => this.getRoom(),
      (crewId, areaId) => {
        this.crews.update(crewId, { areaId })
        this.broadcastCrews()
      },
    )
  }

  getRoom(): TLSocketRoom<TLRecord, SessionMeta> {
    if (!this.room) {
      const sql = new DurableObjectSqliteSyncWrapper(this.ctx.storage, { tablePrefix: 'tldraw_' })
      this.room = new TLSocketRoom<TLRecord, SessionMeta>({
        schema,
        storage: new SQLiteSyncStorage<TLRecord>({ sql }),
      })
    }
    return this.room
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const session = sessionOf(req)
    if (url.pathname === '/api/sync' && session) return this.connectSync(url, session)
    if (url.pathname === '/api/events' && session) return this.connectEvents(session)
    if (url.pathname === '/api/crews' && session && req.method === 'POST') return this.registerCrew(req, session)
    if (url.pathname === '/api/crews/reclaim' && session && req.method === 'POST') return this.reclaimCrew(req, session)
    if (url.pathname === '/api/mentions/board' && session && req.method === 'POST') return this.boardMention(req, session)
    if (url.pathname === '/crew/ws') return this.connectCrew(req)
    if (url.pathname === '/api/webhook' && req.method === 'POST') return this.webhook(req)
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return handleMcp(req, this.mcpHost(), await this.crewFromRequest(req))
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  private connectSync(url: URL, session: Session): Response {
    const sessionId = url.searchParams.get('sessionId')
    if (!sessionId) return Response.json({ error: 'missing_session_id' }, { status: 400 })
    const { 0: client, 1: server } = new WebSocketPair()
    server.accept()
    this.getRoom().handleSocketConnect({ sessionId, socket: server, meta: session })
    return new Response(null, { status: 101, webSocket: client })
  }

  // ---- browser events socket: chat, crews, users ----

  private connectEvents(session: Session): Response {
    const { 0: client, 1: server } = new WebSocketPair()
    server.accept()
    this.eventSockets.set(server, session)
    this.send(server, { type: 'init', messages: this.chat.recent(CHAT_INIT_COUNT), crews: this.crewInfos(), users: this.onlineUsers() })
    this.broadcast({ type: 'users', users: this.onlineUsers() })
    server.addEventListener('message', (e) => this.onEventMessage(session, e.data))
    const drop = () => {
      if (this.eventSockets.delete(server)) this.broadcast({ type: 'users', users: this.onlineUsers() })
    }
    server.addEventListener('close', drop)
    server.addEventListener('error', drop)
    return new Response(null, { status: 101, webSocket: client })
  }

  private onEventMessage(session: Session, data: unknown) {
    let msg: ClientEvent
    try {
      msg = JSON.parse(String(data))
    } catch {
      return
    }
    if (msg.type !== 'chat' || typeof msg.text !== 'string') return
    const text = msg.text.trim().slice(0, CHAT_MAX_LEN)
    if (!text) return
    this.postChat({ authorType: 'human', authorName: session.name, text })
    this.routeChatMentions(text, session.name, 0, null)
  }

  // ---- mentions ----

  private recentChatContext() {
    return this.chat.recent(20).map((m) => ({ author: m.authorName, text: m.text }))
  }

  private routeChatMentions(text: string, author: string, hop: number, authorCrewId: string | null) {
    const names = this.crews.all()
    for (const name of parseMentions(text, names.map((c) => c.name))) {
      const crew = names.find((c) => c.name === name)!
      if (crew.id === authorCrewId) continue
      this.router.deliver(crew.id, { source: 'chat', text, author, hop, context: { recentChat: this.recentChatContext() } })
    }
  }

  private crewSays(crewId: string, text: string, m: Pending) {
    const crew = this.crews.byId(crewId)
    if (!crew) return
    const info = this.crewInfo(crew)
    const ref = m.source === 'board' && m.shapeId ? { shapeId: m.shapeId, label: m.text.slice(0, 60) } : undefined
    this.postChat({ authorType: 'crew', authorName: crew.name, crewId, areaName: info.areaName ?? undefined, text, ref })
    this.routeChatMentions(text, crew.name, m.hop + 1, crewId)
  }

  private async boardMention(req: Request, session: Session): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as { shapeId?: unknown }
    const shapeId = String(body.shapeId ?? '')
    const records = snapshotRecords(this.getRoom())
    const shape = records.find((r) => r.id === shapeId && r.typeName === 'shape')
    if (!shape) return Response.json({ error: 'not_found' }, { status: 404 })
    const text = shapeText(shape as never).trim()
    const crews = this.crews.all()
    const textHash = await hashToken(text)
    const area = areaOf(records, shapeId)
    const delivered: string[] = []
    for (const name of parseMentions(text, crews.map((c) => c.name))) {
      const crew = crews.find((c) => c.name === name)!
      const fresh = this.ctx.storage.sql
        .exec('INSERT OR IGNORE INTO board_mentions (shape_id, crew_id, text_hash) VALUES (?, ?, ?) RETURNING 1', shapeId, crew.id, textHash)
        .toArray().length
      if (!fresh) continue
      const input: MentionInput = {
        source: 'board', text, author: session.name, hop: 0, shapeId,
        context: { area: area ? { id: area.id, name: area.name } : undefined, nearby: nearbyTexts(records, shapeId).slice(0, 20) },
      }
      this.router.deliver(crew.id, input)
      delivered.push(name)
    }
    return Response.json({ delivered })
  }

  // ---- crew listener socket ----

  private async connectCrew(req: Request): Promise<Response> {
    const crew = await this.crewFromRequest(req)
    const { 0: client, 1: server } = new WebSocketPair()
    server.accept()
    if (!crew) {
      server.close(4003, 'invalid token')
      return new Response(null, { status: 101, webSocket: client })
    }
    if (this.crewSockets.has(crew.id)) {
      this.closeCrewSocket(crew.id, 4001, 'replaced')
      this.router.onDisconnect(crew.id)
    }
    this.crewSockets.set(crew.id, server)
    this.lastPong.set(crew.id, Date.now())
    server.addEventListener('message', (e) => this.onCrewMessage(crew.id, e.data))
    const drop = () => {
      if (this.crewSockets.get(crew.id) !== server) return // superseded socket
      this.crewSockets.delete(crew.id)
      this.router.onDisconnect(crew.id)
      this.broadcastCrews()
    }
    server.addEventListener('close', drop)
    server.addEventListener('error', drop)
    this.sendToCrew(crew.id, { type: 'hello', crew: this.crewInfo(crew) })
    this.broadcastCrews()
    await this.ensureAlarm()
    return new Response(null, { status: 101, webSocket: client })
  }

  private onCrewMessage(crewId: string, data: unknown) {
    let msg: FromCrew
    try {
      msg = JSON.parse(String(data))
    } catch {
      return
    }
    this.lastPong.set(crewId, Date.now())
    this.router.onReply(crewId, msg)
  }

  private isPolling(crewId: string): boolean {
    return Date.now() - (this.lastPoll.get(crewId) ?? 0) < 60_000
  }

  private sendToCrew(crewId: string, msg: ToCrew): boolean {
    const ws = this.crewSockets.get(crewId)
    if (!ws && msg.type === 'mention' && this.isPolling(crewId)) {
      const box = this.mailbox.get(crewId) ?? []
      box.push(msg)
      this.mailbox.set(crewId, box)
      return true
    }
    if (!ws) return false
    try {
      ws.send(JSON.stringify(msg))
      return true
    } catch {
      return false
    }
  }

  private async ensureAlarm() {
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + 30_000)
  }

  /** Every 30 s while crews are connected: ping, drop silent sockets, time out stuck mentions. */
  async alarm() {
    const now = Date.now()
    for (const crewId of [...this.crewSockets.keys()]) {
      if (now - (this.lastPong.get(crewId) ?? now) > 75_000) {
        this.closeCrewSocket(crewId, 4000, 'heartbeat timeout')
        this.router.onDisconnect(crewId)
        this.broadcastCrews()
      } else this.sendToCrew(crewId, { type: 'ping' })
    }
    this.router.tick()
    if (this.crewSockets.size) await this.ctx.storage.setAlarm(now + 30_000)
  }

  postChat(m: Omit<ChatMessage, 'id' | 'ts'>): ChatMessage {
    const message = this.chat.add(m)
    this.broadcast({ type: 'chat', message })
    return message
  }

  broadcast(e: ServerEvent) {
    const data = JSON.stringify(e)
    for (const ws of this.eventSockets.keys()) {
      try {
        ws.send(data)
      } catch {
        this.eventSockets.delete(ws)
      }
    }
  }

  private send(ws: WebSocket, e: ServerEvent) {
    ws.send(JSON.stringify(e))
  }

  onlineUsers(): OnlineUser[] {
    const byId = new Map<string, OnlineUser>()
    for (const s of this.eventSockets.values()) byId.set(s.userId, { userId: s.userId, name: s.name })
    return [...byId.values()]
  }

  // ---- crews ----

  crewInfo(c: Crew): CrewInfo {
    const area = c.areaId ? (this.getRoom().getRecord(c.areaId) as { props?: { name?: string } } | undefined) : undefined
    return {
      id: c.id,
      name: c.name,
      areaId: c.areaId,
      areaName: area?.props?.name ?? null,
      ownerUserId: c.ownerUserId,
      online: this.isCrewOnline(c.id),
      busy: this.isCrewBusy(c.id),
    }
  }

  crewInfos(): CrewInfo[] {
    return this.crews.all().map((c) => this.crewInfo(c))
  }

  broadcastCrews() {
    this.broadcast({ type: 'crews', crews: this.crewInfos() })
  }

  isCrewOnline(crewId: string): boolean {
    return this.crewSockets.has(crewId) || this.isPolling(crewId)
  }

  // ---- results webhook ----

  private async webhook(req: Request): Promise<Response> {
    const crew = await this.crewFromRequest(req)
    if (!crew) return Response.json({ error: 'unauthorized' }, { status: 401 })
    const body = (await req.json().catch(() => ({}))) as { event_id?: unknown; title?: unknown; content?: unknown; sources?: unknown }
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : ''
    const content = typeof body.content === 'string' ? body.content.trim() : ''
    if (!title || !content) return Response.json({ error: 'title_and_content_required' }, { status: 400 })
    const eventId = typeof body.event_id === 'string' && body.event_id ? body.event_id.slice(0, 200) : crypto.randomUUID()
    const fresh = this.ctx.storage.sql
      .exec('INSERT OR IGNORE INTO webhook_events (crew_id, event_id) VALUES (?, ?) RETURNING 1', crew.id, eventId)
      .toArray().length
    if (!fresh) return Response.json({ ok: true, duplicate: true })
    const items = content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).slice(0, 12).map((p) => p.slice(0, 1000))
    const sources = Array.isArray(body.sources) ? body.sources.map(String).filter(Boolean).slice(0, 20) : []
    if (sources.length) items.push('Sources:\n' + sources.map((s) => `- ${s}`).join('\n'))
    const r = await this.writer.addSection(crew, null, title, items)
    const latest = this.crews.byId(crew.id)!
    this.postChat({
      authorType: 'crew', authorName: latest.name, crewId: latest.id, areaName: this.crewInfo(latest).areaName ?? undefined,
      text: `published: ${title}`, ref: { shapeId: r.headingId, label: title.slice(0, 60) },
    })
    return Response.json({ ok: true, shapeIds: [r.headingId, ...r.noteIds] })
  }

  // ---- MCP host ----

  private mcpHost(): McpHost {
    const records = () => snapshotRecords(this.getRoom())
    return {
      listAreas: () => listAreas(records()).map((a) => ({ id: a.id, name: a.name })),
      areaContent: async (crew, area) => {
        const a = await this.writer.resolveArea(crew, area)
        return { name: a.name, texts: areaContent(records(), a.id) }
      },
      overview: () => {
        const r = records()
        return listAreas(r).map((a) => ({ name: a.name, texts: areaContent(r, a.id).slice(0, 10) }))
      },
      addNotes: (crew, area, texts, color) => this.writer.addNotes(this.fresh(crew), area, texts, color as never),
      addText: (crew, area, text) => this.writer.addText(this.fresh(crew), area, text),
      addSection: (crew, area, title, items) => this.writer.addSection(this.fresh(crew), area, title, items),
      recentChat: (limit) => this.chat.recent(limit).map((m) => ({ author: m.authorName, text: m.text })),
      postAsCrew: (crew, text) => this.postAsCrew(crew.id, text),
      waitForMentions: (crew, timeoutMs) => this.waitForMentions(crew.id, timeoutMs),
    }
  }

  /** Re-read a crew so writes see its latest area (a fallback area may have just been created). */
  private fresh(crew: Crew): Crew {
    return this.crews.byId(crew.id) ?? crew
  }

  /** MCP chat post: finishes an in-flight mention if there is one, otherwise a plain crew message. */
  private postAsCrew(crewId: string, text: string) {
    const active = this.router.activeId(crewId)
    if (active) return this.router.onReply(crewId, { type: 'reply', mentionId: active, text, final: true })
    this.crewSays(crewId, text, { id: '', source: 'chat', text: '', author: '', hop: 0, context: {} })
  }

  private async waitForMentions(crewId: string, timeoutMs: number): Promise<MentionPayload[]> {
    const deadline = Date.now() + timeoutMs
    const wasOnline = this.isCrewOnline(crewId)
    this.lastPoll.set(crewId, Date.now())
    if (!wasOnline) this.broadcastCrews()
    while (Date.now() < deadline) {
      const box = this.mailbox.get(crewId)
      if (box?.length) {
        this.mailbox.delete(crewId)
        return box
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    this.lastPoll.set(crewId, Date.now())
    return []
  }

  isCrewBusy(crewId: string): boolean {
    return this.router?.isBusy(crewId) ?? false
  }

  /** Crew token from Bearer header, ?token=, or a /mcp/<token> path. */
  async crewFromRequest(req: Request): Promise<Crew | null> {
    const m = new URL(req.url).pathname.match(/^\/mcp\/(crw_[0-9a-f]{32})$/)
    const token = m?.[1] ?? tokenFromRequest(req)
    return token ? this.crews.byTokenHash(await hashToken(token)) : null
  }

  private async registerCrew(req: Request, session: Session): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown; areaId?: unknown }
    const name = String(body.name ?? '').trim()
    const areaId = typeof body.areaId === 'string' && body.areaId ? body.areaId : null
    if (!CREW_NAME_RE.test(name)) return Response.json({ error: 'invalid_name' }, { status: 400 })
    const taken = this.crews.byName(name)
    const mine = this.crews.byOwner(session.userId)
    if (taken && taken.id !== mine?.id) return Response.json({ error: 'name_taken' }, { status: 409 })
    if (mine) {
      const crew = this.crews.update(mine.id, { name, areaId })!
      this.broadcastCrews()
      return Response.json({ crew: this.crewInfo(crew), token: null })
    }
    const { crew, token } = await this.crews.create(name, areaId, session.userId)
    this.broadcastCrews()
    return Response.json({ crew: this.crewInfo(crew), token }, { status: 201 })
  }

  private async reclaimCrew(req: Request, session: Session): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown }
    const crew = this.crews.byName(String(body.name ?? '').trim())
    if (!crew) return Response.json({ error: 'not_found' }, { status: 404 })
    const token = await this.crews.rotateToken(crew.id, session.userId)
    this.closeCrewSocket(crew.id, 4001, 'replaced')
    this.broadcastCrews()
    return Response.json({ crew: this.crewInfo(this.crews.byId(crew.id)!), token })
  }

  closeCrewSocket(crewId: string, code: number, reason: string) {
    const ws = this.crewSockets.get(crewId)
    if (!ws) return
    this.crewSockets.delete(crewId)
    try {
      ws.close(code, reason)
    } catch {
      /* already closed */
    }
  }
}
