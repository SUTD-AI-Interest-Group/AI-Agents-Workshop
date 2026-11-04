export type ChatMessage = {
  id: string
  ts: number
  authorType: 'human' | 'crew' | 'system'
  authorName: string
  crewId?: string
  areaName?: string
  text: string
  ref?: { shapeId: string; label: string }
  /** Crew replies to a mention live in one message: 'working' (with progress lines) → 'done' | 'failed'. */
  /** iMessage-style thread link: a preview of the message this one answers. */
  replyTo?: ReplyPreview
  status?: 'working' | 'done' | 'failed'
  progress?: ProgressItem[]
  mentionId?: string
}

/** What a crew was doing, forwarded live from its crewAI events. */
export const PROGRESS_KINDS = ['note', 'task', 'agent', 'thinking', 'tool', 'mcp', 'memory', 'knowledge', 'error'] as const
export type ProgressKind = (typeof PROGRESS_KINDS)[number]
export type ProgressItem = { kind: ProgressKind; text: string }
export const PROGRESS_MAX = 100

export type ReplyPreview = { id: string; authorName: string; text: string }

/** Number of distinct crew colours (tokens --hm-crew-0 … --hm-crew-9). */
export const CREW_COLORS = 10

export type CrewInfo = {
  id: string
  name: string
  areaId: string | null
  areaName: string | null
  ownerUserId: string
  online: boolean
  busy: boolean
  /** Index into the crew colour palette; assigned once at registration. */
  color: number
}

export type OnlineUser = { userId: string; name: string }

// browser events socket
export type ServerEvent =
  | { type: 'init'; messages: ChatMessage[]; crews: CrewInfo[]; users: OnlineUser[] }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'chat_update'; message: ChatMessage }
  | { type: 'crews'; crews: CrewInfo[] }
  | { type: 'users'; users: OnlineUser[] }
  | { type: 'thinking'; crewId: string; on: boolean }
export type ClientEvent = { type: 'chat'; text: string; replyTo?: string }

// crew listener socket
export type MentionContext = {
  recentChat?: { author: string; text: string }[]
  area?: { id: string; name: string }
  nearby?: string[]
  /** When the person replied to a message in a thread, the message they replied to. */
  replyTo?: { author: string; text: string }
}
export type MentionPayload = {
  type: 'mention'
  id: string
  source: 'chat' | 'board'
  text: string
  author: string
  hop: number
  shapeId?: string
  context: MentionContext
}
export type ToCrew = { type: 'hello'; crew: CrewInfo } | MentionPayload | { type: 'ping' }
export type FromCrew =
  | { type: 'reply'; mentionId: string; text: string; final: boolean; kind?: string }
  | { type: 'error'; mentionId: string; message: string }
  | { type: 'pong' }

export const CHAT_MAX_LEN = 4000
export const CHAT_INIT_COUNT = 200
