'use client'

import { Check, Copy, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Editor, TLFrameShape } from 'tldraw'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, apiOrigin, ApiError } from '@/lib/api'
import type { StoredSession } from '@/lib/session'
import { cn } from '@/lib/utils'
import type { CrewInfo } from '@/shared/protocol'
import { MonoLabel, StatusDot } from './primitives'

const TOKEN_KEY = 'dtc.crewToken'
const NO_AREA = '__none__'

function loadToken(crewId: string | undefined): string | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY)
    const v = raw ? (JSON.parse(raw) as { crewId: string; token: string }) : null
    return v && v.crewId === crewId ? v.token : null
  } catch {
    return null
  }
}
function saveToken(crewId: string, token: string) {
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ crewId, token }))
  } catch {
    /* private mode: the token only lives in memory */
  }
}

/** Top-level frames on the current page, kept live. */
function useAreas(editor: Editor | null) {
  const [areas, setAreas] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    if (!editor) return
    const read = () => {
      const page = editor.getCurrentPageId()
      const next = editor
        .getCurrentPageShapes()
        .filter((s): s is TLFrameShape => s.type === 'frame' && s.parentId === page)
        .map((s) => ({ id: s.id, name: s.props.name || 'Untitled frame' }))
      setAreas((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    read()
    return editor.store.listen(read, { scope: 'document' })
  }, [editor])
  return areas
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      onClick={() =>
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        })
      }
      className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-graphite-2 px-2 font-mono text-[11px] text-graphite-ink outline-none transition-colors duration-150 hover:border-graphite-muted focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <Check className="size-3.5 text-ok" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

/** The panel's one dark beat: the values a crew needs, as they'd appear in .env. */
function EnvCard({ rows, command }: { rows: [string, string, boolean?][]; command: string }) {
  const env = rows.map(([k, v]) => `${k}=${v}`).join('\n')
  return (
    <figure className="hm-cut hm-tone-dark overflow-hidden bg-graphite text-graphite-ink">
      <figcaption className="flex items-center justify-between border-b border-graphite-2 px-3 py-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-graphite-muted">.env</span>
        <CopyButton value={env} label=".env values" />
      </figcaption>
      <dl className="flex flex-col gap-1.5 px-3 py-3 font-mono text-[12px] leading-snug">
        {rows.map(([k, v, secret]) => (
          <div key={k} className="min-w-0">
            <dt className="text-graphite-muted">{k}</dt>
            <dd className={cn('break-all', secret ? 'text-signal-on-dark' : 'text-graphite-ink')}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center justify-between gap-2 border-t border-graphite-2 px-3 py-2">
        <code className="truncate font-mono text-[12px]">
          <span className="text-graphite-muted">$ </span>
          {command}
        </code>
        <CopyButton value={command} label="run command" />
      </div>
    </figure>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b-2 border-frame px-4 py-5 last:border-b-0">
      <h3 className="font-display text-lg leading-none tracking-[0.03em] text-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

const ERRORS: Record<string, string> = {
  invalid_name: 'Use 2–24 letters, digits, - or _, starting with a letter.',
  name_taken: 'That name is taken. If it’s your crew, reclaim it below.',
  not_found: 'No crew has that name. Check the spelling.',
}

export function ConfigTab({ editor, crews, session }: { editor: Editor | null; crews: CrewInfo[]; session: StoredSession }) {
  const areas = useAreas(editor)
  const mine = crews.find((c) => c.ownerUserId === session.userId)
  const [name, setName] = useState('')
  const [areaId, setAreaId] = useState<string>(NO_AREA)
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [reclaimName, setReclaimName] = useState('')
  const [busy, setBusy] = useState<'save' | 'reclaim' | null>(null)

  // When your crew changes (first load, or after reclaiming another one), show that crew's details and token.
  useEffect(() => {
    if (!mine) return
    setName(mine.name)
    setAreaId(mine.areaId ?? NO_AREA)
    setToken(loadToken(mine.id))
  }, [mine?.id])

  async function submit(kind: 'save' | 'reclaim', path: string, body: unknown) {
    setError(null)
    setSaved(false)
    setBusy(kind)
    try {
      const r = await api<{ crew: CrewInfo; token: string | null }>(path, body, session)
      if (r.token) {
        saveToken(r.crew.id, r.token)
        setToken(r.token)
      }
      if (kind === 'save') setSaved(true)
      if (kind === 'reclaim') {
        setReclaimName('')
        setName(r.crew.name)
        setAreaId(r.crew.areaId ?? NO_AREA)
      }
    } catch (e) {
      setError(ERRORS[e instanceof ApiError ? e.code : ''] ?? 'Something went wrong. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const origin = apiOrigin()
  const areaItems = [{ value: NO_AREA, label: areas.length ? 'No team area' : 'No frames yet — draw one first' }, ...areas.map((a) => ({ value: a.id, label: a.name }))]

  return (
    <div className="flex flex-col">
      <Section title={mine ? 'Your crew' : 'Register your crew'}>
        {!mine && <p className="text-sm text-muted-foreground">Give your crew a handle so people can @mention it. One crew per person.</p>}
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit('save', '/api/crews', { name: name.trim(), areaId: areaId === NO_AREA ? null : areaId })
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="crew-name">Crew name</Label>
            <Input id="crew-name" value={name} maxLength={24} placeholder="FalconCrew" className="font-mono" onChange={(e) => (setName(e.target.value), setSaved(false))} aria-invalid={!!error && !busy} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="crew-area">Team area</Label>
            <Select items={areaItems} value={areaId} onValueChange={(v) => (setAreaId(String(v ?? NO_AREA)), setSaved(false))}>
              <SelectTrigger id="crew-area" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {areaItems.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Your crew writes its notes inside this frame.</p>
          </div>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" className="hm-cut hm-cut-sm rounded-none px-4 font-display tracking-[0.04em] uppercase" disabled={!!busy || !name.trim()}>
              {busy === 'save' && <LoaderCircle className="animate-spin" />}
              {mine ? 'Save changes' : 'Register crew'}
            </Button>
            {saved && <MonoLabel className="text-ok">Saved</MonoLabel>}
          </div>
        </form>
        {mine && (
          <div className="hm-tone flex items-center gap-2 border-2 border-frame bg-paper px-3 py-2 text-[13px]">
            <StatusDot state={mine.busy ? 'busy' : mine.online ? 'on' : 'off'} />
            <span>{mine.busy ? 'Working on a mention' : mine.online ? 'Listener connected' : 'Listener not running'}</span>
            {mine.areaName && <MonoLabel className="ml-auto truncate normal-case tracking-normal">{mine.areaName}</MonoLabel>}
          </div>
        )}
      </Section>

      {mine && (
        <Section title="Connect your crew">
          <p className="text-sm text-muted-foreground">
            Paste these into <span className="font-mono text-foreground">.env</span> in your starter project, then run the command.
          </p>
          <EnvCard
            command="uv run main.py connect"
            rows={[
              ['BOARD_URL', origin],
              ['CREW_TOKEN', token ?? 'hidden — reclaim below for a new one', !!token],
              ['CANVAS_MCP_URL', `${origin}/mcp`],
              ['WEBHOOK_URL', `${origin}/api/webhook`],
            ]}
          />
          {token && <p className="text-xs text-muted-foreground">The token is shown in this tab only. Treat it like a password.</p>}
        </Section>
      )}

      <Section title="Lost your token?">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit('reclaim', '/api/crews/reclaim', { name: reclaimName.trim() })
          }}
        >
          <Label htmlFor="reclaim" className="sr-only">
            Crew name to reclaim
          </Label>
          <Input id="reclaim" value={reclaimName} placeholder="Crew name" className="min-w-0 flex-1 font-mono" onChange={(e) => setReclaimName(e.target.value)} />
          <Button type="submit" variant="outline" className="rounded-none border-2 border-frame font-display tracking-[0.04em] uppercase" disabled={!!busy || !reclaimName.trim()}>
            {busy === 'reclaim' && <LoaderCircle className="animate-spin" />}
            Reclaim
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">Issues a new token and disconnects the old listener.</p>
      </Section>
    </div>
  )
}
