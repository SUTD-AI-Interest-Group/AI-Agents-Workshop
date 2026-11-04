import { useEffect, useState } from 'react'
import type { Editor, TLFrameShape } from 'tldraw'
import type { CrewInfo } from '../../shared/protocol'
import { api, ApiError } from '../api'
import type { StoredSession } from '../session'

const TOKEN_KEY = 'dtc.crewToken'

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
    /* ignore */
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

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="copy-block">
      <div className="copy-head">
        <span className="muted">{label}</span>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(value).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            })
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{value}</pre>
    </div>
  )
}

export function ConfigTab({ editor, crews, session }: { editor: Editor | null; crews: CrewInfo[]; session: StoredSession }) {
  const areas = useAreas(editor)
  const mine = crews.find((c) => c.ownerUserId === session.userId)
  const [name, setName] = useState('')
  const [areaId, setAreaId] = useState('')
  const [token, setToken] = useState<string | null>(() => loadToken(mine?.id))
  const [error, setError] = useState<string | null>(null)
  const [reclaimName, setReclaimName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (mine) {
      setName((n) => n || mine.name)
      setAreaId((a) => a || mine.areaId || '')
      setToken((t) => t ?? loadToken(mine.id))
    }
  }, [mine?.id])

  async function submit(path: string, body: unknown) {
    setError(null)
    setBusy(true)
    try {
      const r = await api<{ crew: CrewInfo; token: string | null }>(path, body, session)
      if (r.token) {
        saveToken(r.crew.id, r.token)
        setToken(r.token)
      }
      return r
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'request_failed'
      setError(
        {
          invalid_name: 'Use 2–24 letters, digits, - or _, starting with a letter.',
          name_taken: 'That crew name is taken. If it is yours, use "Reclaim" below.',
          not_found: 'No crew with that name.',
        }[code] ?? 'Something went wrong. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const origin = window.location.origin
  const env = [
    `BOARD_URL=${origin}`,
    `CREW_TOKEN=${token ?? '(hidden — reclaim your crew below to get a new one)'}`,
    `CANVAS_MCP_URL=${origin}/mcp`,
    `WEBHOOK_URL=${origin}/api/webhook`,
  ].join('\n')

  return (
    <div className="config">
      <section>
        <h3>{mine ? 'Your crew' : 'Register your crew'}</h3>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            submit('/api/crews', { name: name.trim(), areaId: areaId || null })
          }}
        >
          <label>
            Crew name (your @handle)
            <input value={name} maxLength={24} placeholder="e.g. FalconCrew" onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Team area
            <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">{areas.length ? '— none —' : 'none yet (draw a frame first)'}</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy || !name.trim()}>
            {mine ? 'Save' : 'Register crew'}
          </button>
        </form>
        {mine && (
          <p className="status">
            <span className={mine.online ? 'dot on' : 'dot'} /> {mine.online ? 'Listener connected' : 'Listener not connected'}
            {mine.areaName && <span className="muted"> · area: {mine.areaName}</span>}
          </p>
        )}
      </section>

      {mine && (
        <section>
          <h3>Connect your crew</h3>
          <p className="muted small">Paste into your starter project's <code>.env</code>, then run the command below.</p>
          <CopyBlock label=".env" value={env} />
          <CopyBlock label="Run" value="uv run main.py connect" />
        </section>
      )}

      <section>
        <h3>Lost your token?</h3>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            submit('/api/crews/reclaim', { name: reclaimName.trim() }).then((r) => r && setReclaimName(''))
          }}
        >
          <input value={reclaimName} placeholder="Crew name" onChange={(e) => setReclaimName(e.target.value)} />
          <button type="submit" disabled={busy || !reclaimName.trim()}>
            Reclaim
          </button>
        </form>
        <p className="muted small">This issues a new token and disconnects the old listener.</p>
      </section>
    </div>
  )
}
