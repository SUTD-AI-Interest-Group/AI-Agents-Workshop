export type ChatMessage = {
  id: string
  ts: number
  authorType: 'human' | 'crew' | 'system'
  authorName: string
  crewId?: string
  areaName?: string
  text: string
  ref?: { shapeId: string; label: string }
}

export type CrewInfo = {
  id: string
  name: string
  areaId: string | null
  areaName: string | null
  ownerUserId: string
  online: boolean
  busy: boolean
}

export type OnlineUser = { userId: string; name: string }

// browser events socket
export type ServerEvent =
  | { type: 'init'; messages: ChatMessage[]; crews: CrewInfo[]; users: OnlineUser[] }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'crews'; crews: CrewInfo[] }
  | { type: 'users'; users: OnlineUser[] }
  | { type: 'thinking'; crewId: string; on: boolean }
export type ClientEvent = { type: 'chat'; text: string }

// crew listener socket
export type MentionContext = {
  recentChat?: { author: string; text: string }[]
  area?: { id: string; name: string }
  nearby?: string[]
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
  | { type: 'reply'; mentionId: string; text: string; final: boolean }
  | { type: 'error'; mentionId: string; message: string }
  | { type: 'pong' }

export const CHAT_MAX_LEN = 4000
export const CHAT_INIT_COUNT = 200
