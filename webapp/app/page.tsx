'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { JoinScreen } from '@/components/board/JoinScreen'
import { loadSession, saveSession, type StoredSession } from '@/lib/session'

// tldraw touches window/document on import, so the board only ever renders in the browser.
const BoardPage = dynamic(() => import('@/components/board/BoardPage').then((m) => m.BoardPage), {
  ssr: false,
  loading: () => <div className="grid h-dvh place-items-center text-sm text-muted-foreground">Loading board…</div>,
})

export default function Page() {
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<StoredSession | null>(null)
  useEffect(() => {
    setSession(loadSession())
    setReady(true)
  }, [])
  if (!ready) return null
  if (!session)
    return (
      <JoinScreen
        onJoined={(s) => {
          saveSession(s)
          setSession(s)
        }}
      />
    )
  return <BoardPage session={session} />
}
