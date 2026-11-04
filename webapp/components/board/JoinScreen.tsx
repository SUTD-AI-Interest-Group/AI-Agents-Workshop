'use client'

import { ArrowRight, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import { api, ApiError } from '@/lib/api'
import type { StoredSession } from '@/lib/session'
import { MonoLabel } from './primitives'

export function JoinScreen({ onJoined }: { onJoined: (s: StoredSession) => void }) {
  const [step, setStep] = useState<'pin' | 'name'>('pin')
  const [pin, setPin] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    if (step === 'pin') {
      if (!/^\d{6}$/.test(pin)) return setError('Enter all 6 digits of the board PIN.')
      return setStep('name')
    }
    if (!name.trim()) return setError('Add a name so your team knows who you are.')
    setBusy(true)
    try {
      onJoined(await api<StoredSession>('/api/join', { pin, name }))
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong_pin') {
        setStep('pin')
        setPin('')
        setError('That PIN didn’t match. Check the code on the screen and try again.')
      } else if (err instanceof ApiError && err.code === 'invalid_name') {
        setError('Use a name between 1 and 32 characters.')
      } else setError('Couldn’t reach the board. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-dvh bg-paper">
      <div className="mx-auto grid min-h-dvh max-w-5xl grid-cols-1 content-center gap-10 px-4 py-12 sm:px-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-16">
        <section className="flex min-w-0 flex-col justify-center gap-5">
          <MonoLabel className="text-signal">SUTD · AI Agents Workshop</MonoLabel>
          <h1 className="text-4xl font-semibold tracking-[-0.03em] text-foreground [overflow-wrap:anywhere] sm:text-5xl">
            One canvas. Your team, your crew.
          </h1>
          <p className="max-w-[46ch] text-base leading-relaxed text-muted-foreground">
            Frame the problem with your teammates, hand the research to your crewAI crew, and see what it finds land on the
            board next to your notes.
          </p>
        </section>

        <form onSubmit={submit} className="flex min-w-0 flex-col gap-6 rounded-[10px] border border-border bg-card p-5 sm:p-8" aria-labelledby="join-title">
          <div className="flex items-center justify-between gap-4">
            <h2 id="join-title" className="text-lg font-semibold tracking-[-0.01em]">
              {step === 'pin' ? 'Enter the board PIN' : 'What should we call you?'}
            </h2>
            <MonoLabel>Step {step === 'pin' ? '1' : '2'} / 2</MonoLabel>
          </div>

          {step === 'pin' ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="pin" className="text-muted-foreground">
                6-digit code from your facilitator
              </Label>
              <InputOTP
                id="pin"
                maxLength={6}
                inputMode="numeric"
                pattern="^[0-9]*$"
                autoFocus
                value={pin}
                onChange={(v) => (setPin(v), setError(null))}
                onComplete={() => setTimeout(() => submit(), 0)}
                aria-invalid={!!error}
              >
                <InputOTPGroup>
                  {Array.from({ length: 6 }, (_, i) => (
                    <InputOTPSlot key={i} index={i} className="size-10 font-mono text-lg sm:size-12 sm:text-xl" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="name" className="text-muted-foreground">
                Shown next to your cursor and in chat
              </Label>
              <Input id="name" autoFocus maxLength={32} value={name} placeholder="e.g. Priya" className="h-10" onChange={(e) => (setName(e.target.value), setError(null))} aria-invalid={!!error} />
            </div>
          )}

          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-2">
            {step === 'name' && (
              <Button type="button" variant="ghost" onClick={() => (setStep('pin'), setError(null))}>
                Change PIN
              </Button>
            )}
            <Button type="submit" className="ml-auto h-10 px-4" disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : null}
              {step === 'pin' ? 'Continue' : busy ? 'Joining' : 'Join the board'}
              {!busy && <ArrowRight />}
            </Button>
          </div>
        </form>
      </div>
    </main>
  )
}
