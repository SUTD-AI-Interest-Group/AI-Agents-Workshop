import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor, TLShapeId } from 'tldraw'
import type { ChatMessage, CrewInfo } from '../../shared/protocol'

type Props = {
  editor: Editor | null
  messages: ChatMessage[]
  crews: CrewInfo[]
  thinking: Set<string>
  connected: boolean
  send(text: string): boolean
}

function RefLink({ editor, shapeId, label }: { editor: Editor | null; shapeId: string; label: string }) {
  const [missing, setMissing] = useState(false)
  return (
    <button
      className="ref-link"
      onClick={() => {
        const id = shapeId as TLShapeId
        if (!editor?.getShape(id)) return setMissing(true)
        editor.select(id)
        editor.zoomToSelection({ animation: { duration: 300 } })
      }}
    >
      {missing ? 'shape no longer exists' : `↗ re: ${label}`}
    </button>
  )
}

export function ChatTab({ editor, messages, crews, thinking, connected, send }: Props) {
  const [text, setText] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, thinking.size])

  // @-autocomplete on the word under the caret
  const query = useMemo(() => {
    const m = text.match(/(^|[^\w@])@([A-Za-z0-9_-]*)$/)
    return m ? m[2].toLowerCase() : null
  }, [text])
  const options = query === null ? [] : crews.filter((c) => c.name.toLowerCase().startsWith(query)).slice(0, 6)

  function insert(name: string) {
    setText((t) => t.replace(/@([A-Za-z0-9_-]*)$/, `@${name} `))
    setSel(0)
    inputRef.current?.focus()
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (options.length) {
      if (e.key === 'ArrowDown') return e.preventDefault(), setSel((s) => (s + 1) % options.length)
      if (e.key === 'ArrowUp') return e.preventDefault(), setSel((s) => (s - 1 + options.length) % options.length)
      if (e.key === 'Enter' || e.key === 'Tab') return e.preventDefault(), insert(options[Math.min(sel, options.length - 1)].name)
      if (e.key === 'Escape') return setText((t) => t + ' ')
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (send(text)) setText('')
    }
  }

  const crewById = new Map(crews.map((c) => [c.id, c]))

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && <p className="muted empty">No messages yet. Say hi, or type @ to mention a crew.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.authorType}`}>
            {m.authorType !== 'system' && (
              <div className="msg-head">
                <span className="msg-author">{m.authorType === 'crew' ? `🤖 ${m.authorName}` : m.authorName}</span>
                {m.areaName && <span className="muted"> · {m.areaName}</span>}
                <span className="muted msg-time">{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            )}
            <div className="msg-text">{m.text}</div>
            {m.ref && <RefLink editor={editor} shapeId={m.ref.shapeId} label={m.ref.label} />}
          </div>
        ))}
        {[...thinking].map((id) => (
          <div key={id} className="msg msg-thinking muted">
            🤖 {crewById.get(id)?.name ?? 'A crew'} is thinking…
          </div>
        ))}
      </div>
      <div className="chat-input">
        {options.length > 0 && (
          <ul className="mention-menu" role="listbox">
            {options.map((c, i) => (
              <li key={c.id} role="option" aria-selected={i === sel} className={i === sel ? 'active' : ''} onMouseDown={(e) => (e.preventDefault(), insert(c.name))}>
                🤖 {c.name} <span className="muted">{c.online ? 'online' : 'offline'}</span>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={inputRef}
          rows={2}
          value={text}
          placeholder={connected ? 'Message everyone · @ to mention a crew' : 'Reconnecting…'}
          onChange={(e) => (setText(e.target.value), setSel(0))}
          onKeyDown={onKey}
        />
      </div>
    </div>
  )
}
