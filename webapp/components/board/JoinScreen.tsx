'use client'

import { ArrowRight, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import { api, ApiError } from '@/lib/api'
import type { StoredSession } from '@/lib/session'
import { cn } from '@/lib/utils'

function HudLabel({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn('font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-graphite-muted', className)} {...props} />
}

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
    <main className="relative min-h-dvh overflow-hidden bg-graphite text-graphite-ink">
      {/* Cover art: full-bleed on desktop (its left half is ink-black), a banner on small screens. */}
      <img
        src="/brand/manga-cover.webp"
        alt="Manga illustration: a student at a control desk, reaching out with a grin, as small drone agents with red eyes circle the SUTD campus."
        className="pointer-events-none block h-[40vh] w-full object-cover object-[72%_center] select-none md:absolute md:inset-0 md:h-full md:object-[78%_center] lg:object-right"
      />
      {/* keep the left column ink-black where the art would otherwise run under the form */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 hidden w-[70%] bg-[linear-gradient(90deg,var(--hm-graphite)_58%,transparent)] md:block lg:w-[46%] lg:bg-[linear-gradient(90deg,var(--hm-graphite)_70%,transparent)]" />

      <div className="relative flex min-h-[60vh] flex-col justify-center gap-8 px-5 py-10 md:min-h-dvh md:px-[6vw]">
        <div className="flex min-w-0 max-w-[30rem] flex-col gap-5">
          <div className="flex items-center gap-3">
            <img src="/brand/sutd-ai.jpg" alt="SUTD AI" className="size-11 rounded-[2px] ring-1 ring-graphite-2" />
            <HudLabel>SUTD AI // Design Thinking Canvas</HudLabel>
          </div>
          <h1 className="font-display text-[clamp(3.75rem,8vw,7rem)] leading-[0.9] font-normal tracking-[0.005em] text-graphite-ink [overflow-wrap:anywhere]">
            AI Agents
          </h1>
          <img src="/brand/crewai.svg" alt="crewAI" className="h-auto w-40 sm:w-48" />
          <p className="max-w-[36ch] text-[15px] leading-relaxed text-graphite-muted">
            One shared canvas. Frame the problem with your team, send your crew to research, and watch what it finds land on the board.
          </p>
        </div>

        {/* HUD panel: a red cut-corner frame around an ink panel */}
        <div className="hm-cut w-full max-w-[26rem] bg-signal p-[1.5px]">
          <form onSubmit={submit} className="hm-cut hm-tone-dark flex flex-col gap-5 bg-graphite p-5 sm:p-6" aria-labelledby="join-title">
            <div className="flex items-center justify-between gap-4">
              <h2 id="join-title" className="font-display text-2xl font-normal tracking-[0.02em] text-graphite-ink uppercase">
                {step === 'pin' ? 'Access code' : 'Pilot name'}
              </h2>
              <HudLabel className="text-signal-on-dark">Step 0{step === 'pin' ? '1' : '2'} / 02</HudLabel>
            </div>

            {step === 'pin' ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="pin" className="text-graphite-muted">
                  6-digit PIN from your facilitator
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
                  <InputOTPGroup className="gap-1.5">
                    {Array.from({ length: 6 }, (_, i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="size-10 rounded-[2px] border border-graphite-2 bg-graphite font-mono text-lg text-graphite-ink first:rounded-[2px] last:rounded-[2px] data-[active=true]:border-signal-on-dark data-[active=true]:ring-signal-on-dark/40 sm:size-12 sm:text-xl"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="name" className="text-graphite-muted">
                  Shown next to your cursor and in chat
                </Label>
                <Input
                  id="name"
                  autoFocus
                  maxLength={32}
                  value={name}
                  placeholder="e.g. Priya"
                  className="h-11 rounded-[2px] border-graphite-2 bg-graphite text-base text-graphite-ink placeholder:text-graphite-muted focus-visible:border-signal-on-dark"
                  onChange={(e) => (setName(e.target.value), setError(null))}
                  aria-invalid={!!error}
                />
              </div>
            )}

            {error && (
              <p role="alert" className="font-mono text-[12px] leading-snug text-signal-on-dark">
                ⚠ {error}
              </p>
            )}

            <div className="flex items-center gap-2">
              {step === 'name' && (
                <Button type="button" variant="ghost" className="text-graphite-muted hover:bg-graphite-2 hover:text-graphite-ink" onClick={() => (setStep('pin'), setError(null))}>
                  Change PIN
                </Button>
              )}
              <Button type="submit" className="hm-cut hm-cut-sm ml-auto h-11 rounded-none px-5 font-display text-base tracking-[0.04em] uppercase" disabled={busy}>
                {busy ? <LoaderCircle className="animate-spin" /> : null}
                {step === 'pin' ? 'Continue' : busy ? 'Joining' : 'Launch'}
                {!busy && <ArrowRight />}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </main>
  )
}
