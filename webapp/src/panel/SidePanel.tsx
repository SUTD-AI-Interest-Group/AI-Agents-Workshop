import { useState } from 'react'
import type { Editor } from 'tldraw'
import type { StoredSession } from '../session'
import type { BoardEvents } from '../useBoardEvents'
import { ChatTab } from './ChatTab'
import { ConfigTab } from './ConfigTab'
import { PresenceList } from './PresenceList'

export function SidePanel({ editor, events, session }: { editor: Editor | null; events: BoardEvents; session: StoredSession }) {
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState<'chat' | 'config'>('chat')
  if (!open)
    return (
      <aside className="panel collapsed">
        <button className="panel-toggle" aria-label="Open panel" onClick={() => setOpen(true)}>
          ‹
        </button>
      </aside>
    )
  return (
    <aside className="panel">
      <header className="panel-head">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
            Chat
          </button>
          <button role="tab" aria-selected={tab === 'config'} className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')}>
            Config
          </button>
        </div>
        <button className="panel-toggle" aria-label="Collapse panel" onClick={() => setOpen(false)}>
          ›
        </button>
      </header>
      <PresenceList users={events.users} crews={events.crews} me={session.userId} />
      {tab === 'chat' ? (
        <ChatTab editor={editor} messages={events.messages} crews={events.crews} thinking={events.thinking} connected={events.connected} send={events.send} />
      ) : (
        <ConfigTab editor={editor} crews={events.crews} session={session} />
      )}
    </aside>
  )
}
