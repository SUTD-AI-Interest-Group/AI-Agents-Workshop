'use client'

import { ArrowUpRight, Bot, ChevronRight, CornerUpLeft, SendHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor, TLShapeId } from 'tldraw'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { ChatMessage, CrewInfo, ReplyPreview } from '@/shared/protocol'
import { crewColor, MonoLabel, StatusDot } from './primitives'

type Props = {
  editor: Editor | null
  messages: ChatMessage[]
  crews: CrewInfo[]
  thinking: Set<string>
  connected: boolean
  send(text: string, replyTo?: string): boolean
}

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Scroll a message into view and flash it, for thread quotes. */
function jumpTo(id: string) {
  const el = document.getElementById(`msg-${id}`)
  if (!el) return
  el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  el.dataset.flash = 'true'
  setTimeout(() => delete el.dataset.flash, 1200)
}

function RefLink({ editor, shapeId, label }: { editor: Editor | null; shapeId: string; label: string }) {
  const [missing, setMissing] = useState(false)
  if (missing) return <MonoLabel className="normal-case tracking-normal">That note was deleted</MonoLabel>
  return (
    <button
      type="button"
      className="group inline-flex max-w-full items-center gap-1 rounded-sm font-mono text-[11px] text-muted-foreground outline-none hover:text-signal focus-visible:ring-2 focus-visible:ring-ring"
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

/** iMessage-style quote of the message this one replies to. */
function ThreadQuote({ reply, color }: { reply: ReplyPreview; color?: string }) {
  return (
    <button
      type="button"
      onClick={() => jumpTo(reply.id)}
      className="mb-1 flex w-full min-w-0 items-start gap-1.5 rounded-[6px] bg-sunken px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Replying to ${reply.authorName}: ${reply.text}. Jump to message`}
    >
      <CornerUpLeft className="mt-0.5 size-3 flex-none text-muted-foreground" aria-hidden />
      <span className="min-w-0 text-xs leading-snug">
        <span className="font-semibold" style={color ? { color } : undefined}>
          {reply.authorName}
        </span>
        <span className="line-clamp-2 text-muted-foreground [overflow-wrap:anywhere]">{reply.text}</span>
      </span>
    </button>
  )
}

/** A crew's reply to a mention: working (live progress) → answer, with the progress folded away. */
function CrewBody({ m }: { m: ChatMessage }) {
  const [open, setOpen] = useState(false)
  const progress = m.progress ?? []
  if (m.status === 'working')
    return (
      <div className="flex flex-col gap-1" aria-live="polite">
        <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <StatusDot state="busy" />
          Working on it
        </span>
        {progress.length > 0 && (
          <ul className="flex flex-col gap-0.5 border-l border-border pl-2 text-[13px] text-muted-foreground">
            {progress.map((p, i) => (
              <li key={i} className={cn('whitespace-pre-wrap [overflow-wrap:anywhere]', i === progress.length - 1 && 'text-foreground')}>
                {p}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  return (
    <div className="flex flex-col gap-1">
      {progress.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-sm font-mono text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className={cn('size-3 transition-transform duration-150', open && 'rotate-90')} aria-hidden />
            {progress.length} progress {progress.length === 1 ? 'update' : 'updates'}
          </button>
          {open && (
            <ul className="mt-1 flex flex-col gap-0.5 border-l border-border pl-2 text-[13px] text-muted-foreground">
              {progress.map((p, i) => (
                <li key={i} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className={cn('whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]', m.status === 'failed' ? 'text-destructive' : 'text-foreground')}>
        {m.text}
      </p>
    </div>
  )
}

function Message({ m, editor, crewById, onReply }: { m: ChatMessage; editor: Editor | null; crewById: Map<string, CrewInfo>; onReply(m: ChatMessage): void }) {
  if (m.authorType === 'system')
    return (
      <li id={`msg-${m.id}`} className="py-1 text-center font-mono text-[11px] text-muted-foreground" role="status">
        {m.text}
      </li>
    )
  const crew = m.authorType === 'crew'
  const color = crew ? crewColor(m.crewId ? crewById.get(m.crewId)?.color : undefined) : undefined
  const quoteColor = (r: ReplyPreview) => {
    const c = [...crewById.values()].find((x) => x.name === r.authorName)
    return c ? crewColor(c.color) : undefined
  }
  return (
    <li
      id={`msg-${m.id}`}
      className="group/msg relative -mx-2 flex flex-col gap-0.5 rounded-[6px] px-2 py-1 transition-colors duration-300 data-[flash=true]:bg-accent-wash"
    >
      <div className={cn('flex flex-col gap-0.5', crew && 'border-l-2 pl-3')} style={crew ? { borderColor: color } : undefined}>
        {m.replyTo && <ThreadQuote reply={m.replyTo} color={quoteColor(m.replyTo)} />}
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="flex min-w-0 items-center gap-1 truncate text-[13px] font-semibold" style={color ? { color } : undefined}>
            {crew && <Bot className="size-3.5 flex-none" aria-hidden />}
            {m.authorName}
          </span>
          {m.areaName && <MonoLabel className="truncate normal-case tracking-normal">{m.areaName}</MonoLabel>}
          <time className="ml-auto flex-none font-mono text-[11px] text-muted-foreground" dateTime={new Date(m.ts).toISOString()}>
            {time(m.ts)}
          </time>
        </div>
        {m.status ? <CrewBody m={m} /> : <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{m.text}</p>}
        {m.ref && <RefLink editor={editor} shapeId={m.ref.shapeId} label={m.ref.label} />}
      </div>
      <button
        type="button"
        onClick={() => onReply(m)}
        aria-label={`Reply to ${m.authorName}`}
        className="absolute top-1 right-12 inline-flex items-center gap-1 rounded-[6px] border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground opacity-0 shadow-xs outline-none group-hover/msg:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring max-sm:opacity-100"
      >
        <CornerUpLeft className="size-3" aria-hidden />
        Reply
      </button>
    </li>
  )
}

export function ChatTab({ editor, messages, crews, connected, send }: Props) {
  const [text, setText] = useState('')
  const [sel, setSel] = useState(0)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastLen = useRef(0)

  // Follow new messages only when the reader is already near the bottom.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160
    if (nearBottom || lastLen.current === 0) el.scrollTop = el.scrollHeight
    lastLen.current = messages.length
  }, [messages])

  const query = useMemo(() => {
    const m = text.match(/(^|[^\w@])@([A-Za-z0-9_-]*)$/)
    return m ? m[2].toLowerCase() : null
  }, [text])
  const options = query === null ? [] : crews.filter((c) => c.name.toLowerCase().startsWith(query)).slice(0, 6)
  const crewById = useMemo(() => new Map(crews.map((c) => [c.id, c])), [crews])

  function insert(name: string) {
    setText((t) => t.replace(/@([A-Za-z0-9_-]*)$/, `@${name} `))
    setSel(0)
    inputRef.current?.focus()
  }

  function submit() {
    if (send(text, replyTo?.id)) {
      setText('')
      setReplyTo(null)
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (options.length) {
      if (e.key === 'ArrowDown') return e.preventDefault(), setSel((s) => (s + 1) % options.length)
      if (e.key === 'ArrowUp') return e.preventDefault(), setSel((s) => (s - 1 + options.length) % options.length)
      if (e.key === 'Enter' || e.key === 'Tab') return e.preventDefault(), insert(options[Math.min(sel, options.length - 1)].name)
      if (e.key === 'Escape') return e.preventDefault(), setText((t) => t + ' ')
    }
    if (e.key === 'Escape' && replyTo) return e.preventDefault(), setReplyTo(null)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const replyingToCrew = replyTo?.authorType === 'crew'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-center gap-2 px-2">
            <p className="text-sm font-medium text-foreground">No messages yet</p>
            <p className="text-sm text-muted-foreground">
              Everyone on the board shares this chat. Type <span className="font-mono text-foreground">@</span> and a crew name to
              send it a request; crews reply here. Hover a message to reply in a thread.
            </p>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((m) => (
              <Message
                key={m.id}
                m={m}
                editor={editor}
                crewById={crewById}
                onReply={(msg) => {
                  setReplyTo(msg)
                  inputRef.current?.focus()
                }}
              />
            ))}
          </ol>
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
                <Bot className="size-3.5" style={{ color: crewColor(c.color) }} aria-hidden />
                <span className="font-medium" style={{ color: crewColor(c.color) }}>
                  {c.name}
                </span>
                <MonoLabel className="ml-auto">{c.online ? 'online' : 'offline'}</MonoLabel>
              </li>
            ))}
          </ul>
        )}
        {replyTo && (
          <div className="mb-2 flex items-start gap-2 rounded-[6px] border border-border bg-sunken px-2 py-1.5">
            <CornerUpLeft className="mt-0.5 size-3.5 flex-none text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1 text-xs">
              <span className="text-muted-foreground">Replying to </span>
              <span className="font-semibold" style={replyingToCrew ? { color: crewColor(replyTo.crewId ? crewById.get(replyTo.crewId)?.color : undefined) } : undefined}>
                {replyTo.authorName}
              </span>
              {replyingToCrew && <span className="text-muted-foreground">: the crew will answer in this thread</span>}
              <p className="truncate text-muted-foreground">{replyTo.text || 'working…'}</p>
            </div>
            <button
              type="button"
              aria-label="Cancel reply"
              onClick={() => setReplyTo(null)}
              className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            rows={2}
            value={text}
            aria-label="Message everyone"
            placeholder={connected ? (replyTo ? 'Reply in thread' : 'Message everyone. @ to mention a crew') : 'Reconnecting to the board…'}
            disabled={!connected}
            onChange={(e) => (setText(e.target.value), setSel(0))}
            onKeyDown={onKey}
            className="max-h-40 min-h-[2.75rem] resize-none bg-paper text-sm"
          />
          <Button type="button" size="icon" aria-label="Send message" disabled={!connected || !text.trim()} onClick={submit}>
            <SendHorizontal />
          </Button>
        </div>
        <MonoLabel className="mt-2 block normal-case tracking-normal">Enter to send · Shift+Enter for a new line{replyTo ? ' · Esc to cancel reply' : ''}</MonoLabel>
      </div>
    </div>
  )
}
