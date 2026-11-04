'use client'

import { useSync } from '@tldraw/sync'
import { useCallback, useMemo, useState } from 'react'
import { type Editor, inlineBase64AssetStore, setUserPreferences, Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { wsUrl } from '@/lib/api'
import type { StoredSession } from '@/lib/session'
import { useBoardEvents } from '@/lib/useBoardEvents'
import { useBoardMentionDetector } from '@/lib/useBoardMentionDetector'
import { SidePanel } from './SidePanel'

export function BoardPage({ session }: { session: StoredSession }) {
  useMemo(() => setUserPreferences({ id: session.userId, name: session.name }), [session.userId, session.name])
  // useSync rebuilds its store whenever `uri` changes identity, so it must be stable across renders.
  const uri = useCallback(() => wsUrl('/api/sync', { token: session.token }), [session.token])
  const store = useSync({ uri, assets: inlineBase64AssetStore })
  const [editor, setEditor] = useState<Editor | null>(null)
  const events = useBoardEvents(session.token)
  useBoardMentionDetector(editor, events.crews, session)

  return (
    <div className="fixed inset-0 flex bg-background">
      <div className="relative min-w-0 flex-1">
        <Tldraw
          store={store}
          licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
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
