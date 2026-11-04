export { BoardRoom } from './BoardRoom'

export type Env = {
  BOARD_ROOM: DurableObjectNamespace<import('./BoardRoom').BoardRoom>
  ASSETS: Fetcher
  BOARD_PIN: string
  SESSION_SECRET: string
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

export default {
  async fetch(req: Request, _env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/api/health') return json({ ok: true })
    return json({ error: 'not_found' }, 404)
  },
} satisfies ExportedHandler<Env>
