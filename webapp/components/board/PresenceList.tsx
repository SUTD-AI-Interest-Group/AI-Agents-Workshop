'use client'

import { Bot, ChevronDown, UsersRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { CrewInfo, OnlineUser } from '@/shared/protocol'
import { crewColor, MonoLabel, StatusDot } from './primitives'

const OPEN_KEY = 'dtc.presenceOpen'

/** Stable pseudo-random number per name, so the cloud doesn't reshuffle on every update. */
const hash = (s: string) => [...s].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381)

type Word =
  | { kind: 'user'; key: string; name: string; me: boolean }
  | { kind: 'crew'; key: string; crew: CrewInfo }

function sizeOf(w: Word): string {
  const online = w.kind === 'user' || w.crew.online
  if (!online) return 'text-[11.5px]'
  return ['text-[13px]', 'text-sm', 'text-[15px]'][hash(w.key) % 3]
}

export function PresenceList({ users, crews, me }: { users: OnlineUser[]; crews: CrewInfo[]; me: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === '1')
    } catch {
      /* storage unavailable: stay collapsed */
    }
  }, [])
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !o
    })
  }

  const online = crews.filter((c) => c.online).length
  const busy = crews.filter((c) => c.busy).length

  // Online people and crews mixed into a cloud; offline crews trail at the end.
  const words = useMemo<Word[]>(() => {
    const live: Word[] = [
      ...users.map((u) => ({ kind: 'user' as const, key: `u:${u.userId}`, name: u.name, me: u.userId === me })),
      ...crews.filter((c) => c.online).map((c) => ({ kind: 'crew' as const, key: `c:${c.id}`, crew: c })),
    ].sort((a, b) => (a.kind === 'user' && a.me ? -1 : b.kind === 'user' && b.me ? 1 : hash(a.key) - hash(b.key)))
    const idle: Word[] = crews.filter((c) => !c.online).map((c) => ({ kind: 'crew' as const, key: `c:${c.id}`, crew: c }))
    return [...live, ...idle]
  }, [users, crews, me])

  return (
    <div className="flex-none">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="presence-cloud"
        className="flex h-10 w-full items-center gap-3 px-4 text-left outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="flex items-center gap-1.5 text-[13px]">
          <UsersRound className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="font-medium tabular-nums">{users.length}</span>
          <span className="text-muted-foreground">{users.length === 1 ? 'person' : 'people'}</span>
        </span>
        <span className="flex items-center gap-1.5 text-[13px]">
          <Bot className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="font-medium tabular-nums">
            {online}
            <span className="text-muted-foreground">/{crews.length}</span>
          </span>
          <span className="text-muted-foreground">crews online</span>
        </span>
        {busy > 0 && (
          <span className="flex items-center gap-1.5">
            <StatusDot state="busy" />
            <MonoLabel className="normal-case tracking-normal">{busy} working</MonoLabel>
          </span>
        )}
        <ChevronDown className={cn('ml-auto size-4 text-muted-foreground transition-transform duration-150', open && 'rotate-180')} aria-hidden />
        <span className="sr-only">{open ? 'Hide' : 'Show'} everyone on the board</span>
      </button>

      {open && (
        <div
          id="presence-cloud"
          className="grid h-[88px] auto-cols-max grid-flow-col grid-rows-3 items-center gap-x-4 gap-y-0.5 overflow-x-auto overflow-y-hidden px-4 pb-2 [scrollbar-width:thin]"
          aria-label="Everyone on the board"
        >
          {words.map((w) =>
            w.kind === 'user' ? (
              <span key={w.key} className={cn('flex items-center gap-1 whitespace-nowrap font-medium text-foreground', sizeOf(w))}>
                {w.name}
                {w.me && <span className="text-[11px] font-normal text-muted-foreground">you</span>}
              </span>
            ) : (
              <Tooltip key={w.key}>
                <TooltipTrigger
                  className={cn('flex items-center gap-1 whitespace-nowrap rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', sizeOf(w), w.crew.online ? 'font-semibold' : 'text-muted-foreground')}
                  style={w.crew.online ? { color: crewColor(w.crew.color) } : undefined}
                >
                  {w.crew.busy ? <StatusDot state="busy" /> : <Bot className="size-3.5 flex-none" aria-hidden />}
                  {w.crew.name}
                </TooltipTrigger>
                <TooltipContent>
                  {w.crew.busy ? 'Working on a mention' : w.crew.online ? 'Listener connected' : 'Offline: mentions won’t be delivered'}
                  {w.crew.areaName ? ` · ${w.crew.areaName}` : ''}
                </TooltipContent>
              </Tooltip>
            ),
          )}
        </div>
      )}
    </div>
  )
}
