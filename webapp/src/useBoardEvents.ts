import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, CrewInfo, OnlineUser, ServerEvent } from '../shared/protocol'
import { wsUrl } from './api'

export type BoardEvents = {
  connected: boolean
  messages: ChatMessage[]
  crews: CrewInfo[]
  users: OnlineUser[]
  thinking: Set<string>
  send(text: string): boolean
}

/** Keeps one events socket open (with backoff reconnect) and mirrors chat, crews, users and thinking state. */
export function useBoardEvents(token: string): BoardEvents {
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [crews, setCrews] = useState<CrewInfo[]>([])
  const [users, setUsers] = useState<OnlineUser[]>([])
  const [thinking, setThinking] = useState<Set<string>>(new Set())
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let closed = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    function connect() {
      const ws = new WebSocket(wsUrl('/api/events', { token }))
      wsRef.current = ws
      ws.onopen = () => {
        attempt = 0
        setConnected(true)
      }
      ws.onmessage = (e) => {
        const ev = JSON.parse(String(e.data)) as ServerEvent
        switch (ev.type) {
          case 'init':
            setMessages(ev.messages)
            setCrews(ev.crews)
            setUsers(ev.users)
            setThinking(new Set(ev.crews.filter((c) => c.busy).map((c) => c.id)))
            break
          case 'chat':
            setMessages((m) => [...m, ev.message])
            break
          case 'crews':
            setCrews(ev.crews)
            break
          case 'users':
            setUsers(ev.users)
            break
          case 'thinking':
            setThinking((prev) => {
              const next = new Set(prev)
              if (ev.on) next.add(ev.crewId)
              else next.delete(ev.crewId)
              return next
            })
            break
        }
      }
      ws.onclose = () => {
        setConnected(false)
        if (closed) return
        const delay = Math.min(1000 * 2 ** attempt++, 15000)
        timer = setTimeout(connect, delay)
      }
    }
    connect()
    return () => {
      closed = true
      clearTimeout(timer)
      wsRef.current?.close()
    }
  }, [token])

  const send = useCallback((text: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || !text.trim()) return false
    ws.send(JSON.stringify({ type: 'chat', text }))
    return true
  }, [])

  return { connected, messages, crews, users, thinking, send }
}
