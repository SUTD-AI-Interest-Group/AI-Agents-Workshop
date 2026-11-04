'use client'

import { ArrowUpRight, Bot, SendHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor, TLShapeId } from 'tldraw'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { ChatMessage, CrewInfo } from '@/shared/protocol'
import { MonoLabel, StatusDot } from './primitives'

type Props = {
  editor: Editor | null
  messages: ChatMessage[]
  crews: CrewInfo[]
  thinking: Set<string>
  connected: boolean
  send(text: string): boolean
}

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function RefLink({ editor, shapeId, label }: { editor: Editor | null; shapeId: string; label: string }) {
  const [missing, setMissing] = useState(false)
  if (missing) return <MonoLabel className="normal-case tracking-normal">That note was deleted</MonoLabel>
  return (
    <button
      type="button"
      className="group mt-1 inline-flex max-w-full items-center gap-1 rounded-sm font-mono text-[11px] text-muted-foreground outline-none hover:text-signal focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => {
        const id = shapeId as TLShapeId
        if (!editor?.getShape(id)) return setMissing(true)
        editor.select(id)
        editor.zoomToSelection({ animation: { duration: 300 } })
      }}
    >
      <ArrowUpRight className="size-3 flex-none" aria-hidden />
      <span className="truncate underline-offset-2 group-hover:underline">Show on board: {label}</span>
    </button>
  )
}

function Message({ m, editor }: { m: ChatMessage; editor: Editor | null }) {
  if (m.authorType === 'system')
    return (
      <li className="py-1 text-center font-mono text-[11px] text-muted-foreground" role="status">
        {m.text}
      </li>
    )
  const crew = m.authorType === 'crew'
  return (
    <li className={cn('flex flex-col gap-0.5', crew && 'border-l-2 border-signal pl-3')}>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className={cn('flex min-w-0 items-center gap-1 truncate text-[13px] font-semibold', crew ? 'text-signal' : 'text-foreground')}>
          {crew && <Bot className="size-3.5 flex-none" aria-hidden />}
          {m.authorName}
        </span>
        {m.areaName && <MonoLabel className="truncate normal-case tracking-normal">{m.areaName}</MonoLabel>}
        <time className="ml-auto flex-none font-mono text-[11px] text-muted-foreground" dateTime={new Date(m.ts).toISOString()}>
          {time(m.ts)}
        </time>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{m.text}</p>
      {m.ref && <RefLink editor={editor} shapeId={m.ref.shapeId} label={m.ref.label} />}
    </li>
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

  function submit() {
    if (send(text)) setText('')
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (options.length) {
      if (e.key === 'ArrowDown') return e.preventDefault(), setSel((s) => (s + 1) % options.length)
      if (e.key === 'ArrowUp') return e.preventDefault(), setSel((s) => (s - 1 + options.length) % options.length)
      if (e.key === 'Enter' || e.key === 'Tab') return e.preventDefault(), insert(options[Math.min(sel, options.length - 1)].name)
      if (e.key === 'Escape') return e.preventDefault(), setText((t) => t + ' ')
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const crewById = new Map(crews.map((c) => [c.id, c]))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-center gap-2 px-2">
            <p className="text-sm font-medium text-foreground">No messages yet</p>
            <p className="text-sm text-muted-foreground">
              Everyone on the board shares this chat. Type <span className="font-mono text-foreground">@</span> and a crew name to
              send it a request; crews reply here.
            </p>
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {messages.map((m) => (
              <Message key={m.id} m={m} editor={editor} />
            ))}
          </ol>
        )}
        {thinking.size > 0 && (
          <ul className="mt-4 flex flex-col gap-1.5" aria-label="Crews working">
            {[...thinking].map((id) => (
              <li key={id} className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <StatusDot state="busy" />
                {crewById.get(id)?.name ?? 'A crew'} is working on it
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="relative border-t border-border p-3">
        {options.length > 0 && (
          <ul role="listbox" aria-label="Mention a crew" className="absolute inset-x-3 bottom-full mb-2 overflow-hidden rounded-[6px] border border-border bg-popover p-1 shadow-sm">
            {options.map((c, i) => (
              <li
                key={c.id}
                role="option"
                aria-selected={i === sel}
                onMouseDown={(e) => (e.preventDefault(), insert(c.name))}
                onMouseEnter={() => setSel(i)}
                className={cn('flex cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-sm', i === sel && 'bg-accent')}
              >
                <StatusDot state={c.busy ? 'busy' : c.online ? 'on' : 'off'} />
                <Bot className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="font-medium">{c.name}</span>
                <MonoLabel className="ml-auto">{c.online ? 'online' : 'offline'}</MonoLabel>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            rows={2}
            value={text}
            aria-label="Message everyone"
            placeholder={connected ? 'Message everyone. @ to mention a crew' : 'Reconnecting to the board…'}
            disabled={!connected}
            onChange={(e) => (setText(e.target.value), setSel(0))}
            onKeyDown={onKey}
            className="max-h-40 min-h-[2.75rem] resize-none bg-paper text-sm"
          />
          <Button type="button" size="icon" aria-label="Send message" disabled={!connected || !text.trim()} onClick={submit}>
            <SendHorizontal />
          </Button>
        </div>
        <MonoLabel className="mt-2 block normal-case tracking-normal">Enter to send · Shift+Enter for a new line</MonoLabel>
      </div>
    </div>
  )
}
