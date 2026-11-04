'use client'

import { Bot } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { CrewInfo, OnlineUser } from '@/shared/protocol'
import { crewColor, MonoLabel, StatusDot } from './primitives'

export function PresenceList({ users, crews, me }: { users: OnlineUser[]; crews: CrewInfo[]; me: string }) {
  const online = crews.filter((c) => c.online).length
  return (
    <div className="flex max-h-36 flex-col gap-2 overflow-y-auto px-4 py-3">
      <div className="flex items-baseline justify-between">
        <MonoLabel>People · {users.length}</MonoLabel>
        {crews.length > 0 && (
          <MonoLabel>
            Crews · {online}/{crews.length} online
          </MonoLabel>
        )}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
        {users.map((u) => (
          <li key={u.userId} className="flex items-center gap-1.5 text-foreground">
            <StatusDot state="on" />
            {u.name}
            {u.userId === me && <span className="text-muted-foreground">you</span>}
          </li>
        ))}
        {crews.map((c) => (
          <li key={c.id}>
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <StatusDot state={c.busy ? 'busy' : c.online ? 'on' : 'off'} />
                <Bot className="size-3.5" style={{ color: crewColor(c.color) }} aria-hidden />
                <span className={c.online ? 'font-medium' : 'text-muted-foreground'} style={c.online ? { color: crewColor(c.color) } : undefined}>
                  {c.name}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {c.busy ? 'Working on a mention' : c.online ? 'Listener connected' : 'Offline — mentions won’t be delivered'}
                {c.areaName ? ` · ${c.areaName}` : ''}
              </TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  )
}
