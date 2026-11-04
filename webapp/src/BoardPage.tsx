import { useSync } from '@tldraw/sync'
import { useCallback, useMemo } from 'react'
import { inlineBase64AssetStore, setUserPreferences, Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { wsUrl } from './api'
import type { StoredSession } from './session'

export function BoardPage({ session }: { session: StoredSession }) {
  useMemo(() => setUserPreferences({ id: session.userId, name: session.name }), [session.userId, session.name])
  // useSync rebuilds its store whenever `uri` changes identity, so it must be stable across renders.
  const uri = useCallback(() => wsUrl('/api/sync', { token: session.token }), [session.token])
  const store = useSync({
    uri,
    assets: inlineBase64AssetStore,
  })
  return (
    <div className="board">
      <div className="board-canvas">
        <Tldraw
          store={store}
          licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
          onMount={(editor) => {
            ;(window as unknown as { editor: unknown }).editor = editor // handle for e2e tests and debugging
          }}
        />
      </div>
    </div>
  )
}
