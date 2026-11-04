import { clearSession, type StoredSession } from './session'

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
  }
}

export function wsUrl(path: string, params: Record<string, string>): string {
  const u = new URL(path, window.location.href)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}

/** JSON request; on 401 for an authed call the session is cleared and the page reloads to the PIN screen. */
export async function api<T>(path: string, body?: unknown, session?: StoredSession | null): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (session) headers.authorization = `Bearer ${session.token}`
  const res = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    if (res.status === 401 && session) {
      clearSession()
      window.location.reload()
    }
    throw new ApiError(res.status, data.error ?? 'request_failed')
  }
  return data
}
