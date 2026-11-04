import { useSync } from '@tldraw/sync'
import { useCallback, useMemo, useState } from 'react'
import { type Editor, inlineBase64AssetStore, setUserPreferences, Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { wsUrl } from './api'
import { SidePanel } from './panel/SidePanel'
import type { StoredSession } from './session'
import { useBoardEvents } from './useBoardEvents'
import { useBoardMentionDetector } from './useBoardMentionDetector'

export function BoardPage({ session }: { session: StoredSession }) {
  useMemo(() => setUserPreferences({ id: session.userId, name: session.name }), [session.userId, session.name])
  // useSync rebuilds its store whenever `uri` changes identity, so it must be stable across renders.
  const uri = useCallback(() => wsUrl('/api/sync', { token: session.token }), [session.token])
  const store = useSync({ uri, assets: inlineBase64AssetStore })
  const [editor, setEditor] = useState<Editor | null>(null)
  const events = useBoardEvents(session.token)
  useBoardMentionDetector(editor, events.crews, session)

  return (
    <div className="board">
      <div className="board-canvas">
        <Tldraw
          store={store}
          licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
          onMount={(e) => {
            setEditor(e)
            ;(window as unknown as { editor: unknown }).editor = e // handle for e2e tests and debugging
          }}
        />
      </div>
      <SidePanel editor={editor} events={events} session={session} />
    </div>
  )
}
