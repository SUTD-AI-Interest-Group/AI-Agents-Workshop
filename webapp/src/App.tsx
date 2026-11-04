import { useState } from 'react'
import { BoardPage } from './BoardPage'
import { JoinScreen } from './JoinScreen'
import { loadSession, saveSession, type StoredSession } from './session'
import './styles.css'

export function App() {
  const [session, setSession] = useState<StoredSession | null>(() => loadSession())
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
