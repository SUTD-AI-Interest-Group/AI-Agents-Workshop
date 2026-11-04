import { useState } from 'react'
import { api, ApiError } from './api'
import type { StoredSession } from './session'

export function JoinScreen({ onJoined }: { onJoined: (s: StoredSession) => void }) {
  const [step, setStep] = useState<'pin' | 'name'>('pin')
  const [pin, setPin] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (step === 'pin') {
      if (!/^\d{6}$/.test(pin)) return setError('Enter the 6-digit PIN.')
      return setStep('name')
    }
    setBusy(true)
    try {
      onJoined(await api<StoredSession>('/api/join', { pin, name }))
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong_pin') {
        setStep('pin')
        setPin('')
        setError('That PIN is not right. Check with your facilitator.')
      } else if (err instanceof ApiError && err.code === 'invalid_name') {
        setError('Pick a name between 1 and 32 characters.')
      } else setError('Could not reach the board. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="join">
      <form className="join-card" onSubmit={submit}>
        <h1>Design Thinking Canvas</h1>
        {step === 'pin' ? (
          <>
            <label htmlFor="pin">Board PIN</label>
            <input
              id="pin" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              className="pin-input" value={pin} placeholder="••••••"
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </>
        ) : (
          <>
            <label htmlFor="name">Your name</label>
            <input id="name" autoFocus maxLength={32} value={name} placeholder="How teammates will see you" onChange={(e) => setName(e.target.value)} />
          </>
        )}
        {error && <p className="join-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{step === 'pin' ? 'Continue' : busy ? 'Joining…' : 'Join board'}</button>
      </form>
    </div>
  )
}
