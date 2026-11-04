'use client'

import { MessageSquare, PanelRightClose, PanelRightOpen, Settings2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Editor } from 'tldraw'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { StoredSession } from '@/lib/session'
import type { BoardEvents } from '@/lib/useBoardEvents'
import { ChatTab } from './ChatTab'
import { ConfigTab } from './ConfigTab'
import { PresenceList } from './PresenceList'

export function SidePanel({ editor, events, session }: { editor: Editor | null; events: BoardEvents; session: StoredSession }) {
  const [open, setOpen] = useState(true)
  // On phone-width screens the panel covers the canvas, so start collapsed there.
  useEffect(() => {
    if (window.matchMedia('(max-width: 639px)').matches) setOpen(false)
  }, [])
  const [tab, setTab] = useState<string>('chat')

  if (!open)
    return (
      <aside className="flex w-11 flex-none flex-col items-center border-l-2 border-frame bg-card pt-2">
        <Button variant="ghost" size="icon" aria-label="Open panel" onClick={() => setOpen(true)}>
          <PanelRightOpen />
        </Button>
      </aside>
    )

  return (
    <aside className="flex w-[360px] flex-none flex-col border-l-2 border-frame bg-card text-card-foreground max-sm:absolute max-sm:inset-0 max-sm:z-[400] max-sm:w-full max-sm:border-l-0">
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <TabsList className="h-9 gap-1 bg-transparent p-0">
            {[
              { value: 'chat', icon: MessageSquare, label: 'Chat' },
              { value: 'config', icon: Settings2, label: 'Crew' },
            ].map(({ value, icon: Icon, label }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="hm-cut hm-cut-sm h-8 flex-none rounded-none border-0 px-3 font-display text-[15px] tracking-[0.04em] text-ink-2 uppercase shadow-none after:hidden hover:bg-sunken data-active:bg-frame! data-active:text-graphite-ink! data-active:shadow-none"
              >
                <Icon /> {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button variant="ghost" size="icon" aria-label="Collapse panel" onClick={() => setOpen(false)}>
            <PanelRightClose />
          </Button>
        </div>
        <PresenceList users={events.users} crews={events.crews} me={session.userId} />
        <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col">
          <ChatTab editor={editor} messages={events.messages} crews={events.crews} thinking={events.thinking} connected={events.connected} send={events.send} />
        </TabsContent>
        <TabsContent value="config" className="min-h-0 flex-1 overflow-y-auto">
          <ConfigTab editor={editor} crews={events.crews} session={session} />
        </TabsContent>
      </Tabs>
    </aside>
  )
}
