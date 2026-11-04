import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import * as z from 'zod'
import type { MentionPayload } from '../shared/protocol'
import type { Crew } from './crews'

const COLORS = ['black', 'grey', 'light-violet', 'violet', 'blue', 'light-blue', 'yellow', 'orange', 'green', 'light-green', 'light-red', 'red', 'white'] as const

/** What the MCP tools need from the BoardRoom. */
export type McpHost = {
  listAreas(): { id: string; name: string }[]
  areaContent(crew: Crew, area?: string): Promise<{ name: string; texts: string[] }>
  overview(): { name: string; texts: string[] }[]
  addNotes(crew: Crew, area: string | undefined, texts: string[], color?: string): Promise<string[]>
  addText(crew: Crew, area: string | undefined, text: string): Promise<string>
  addSection(crew: Crew, area: string | undefined, title: string, items: string[]): Promise<{ headingId: string; noteIds: string[] }>
  recentChat(limit: number): { author: string; text: string }[]
  postAsCrew(crew: Crew, text: string): void
  waitForMentions(crew: Crew, timeoutMs: number): Promise<MentionPayload[]>
}

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })

async function guarded(fn: () => Promise<string> | string) {
  try {
    return ok(await fn())
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

export function buildMcpServer(host: McpHost, crew: Crew): McpServer {
  const server = new McpServer({ name: 'design-thinking-canvas', version: '1.0.0' })
  const area = z.string().optional().describe('Team area name or id. Defaults to your crew\'s own area.')

  server.registerTool('list_team_areas', { description: 'List the team areas (labelled frames) on the canvas.', inputSchema: {} }, () =>
    guarded(() => JSON.stringify(host.listAreas())),
  )
  server.registerTool('get_area_content', { description: 'Read the text of every note and label inside a team area.', inputSchema: { area } }, ({ area }) =>
    guarded(async () => {
      const r = await host.areaContent(crew, area)
      return `Area "${r.name}":\n` + (r.texts.length ? r.texts.map((t) => `- ${t}`).join('\n') : '(empty)')
    }),
  )
  server.registerTool('get_board_overview', { description: 'Summarise every team area (name and first items).', inputSchema: {} }, () =>
    guarded(() => host.overview().map((a) => `## ${a.name}\n` + (a.texts.map((t) => `- ${t}`).join('\n') || '(empty)')).join('\n\n') || 'No team areas yet.'),
  )
  server.registerTool(
    'add_sticky_note',
    { description: 'Add a sticky note to a team area (your own by default).', inputSchema: { text: z.string().min(1), area, color: z.enum(COLORS).optional() } },
    ({ text, area, color }) => guarded(async () => `Added note ${(await host.addNotes(crew, area, [text], color))[0]}`),
  )
  server.registerTool('add_text', { description: 'Add a text label to a team area.', inputSchema: { text: z.string().min(1), area } }, ({ text, area }) =>
    guarded(async () => `Added text ${await host.addText(crew, area, text)}`),
  )
  server.registerTool(
    'add_section',
    { description: 'Add a titled section: a heading with a row of sticky notes beneath it.', inputSchema: { title: z.string().min(1), items: z.array(z.string()).max(30), area } },
    ({ title, items, area }) =>
      guarded(async () => {
        const r = await host.addSection(crew, area, title, items)
        return `Added section with ${r.noteIds.length} notes`
      }),
  )
  server.registerTool('get_recent_chat', { description: 'Read recent messages from the global chat.', inputSchema: { limit: z.number().int().min(1).max(100).optional() } }, ({ limit }) =>
    guarded(() => host.recentChat(limit ?? 20).map((m) => `${m.author}: ${m.text}`).join('\n') || '(no messages)'),
  )
  server.registerTool('post_chat_message', { description: 'Post a message to the global chat as your crew.', inputSchema: { text: z.string().min(1) } }, ({ text }) =>
    guarded(() => {
      host.postAsCrew(crew, text)
      return 'Posted.'
    }),
  )
  server.registerTool(
    'wait_for_mentions',
    {
      description: 'Fallback when the Python listener cannot connect: wait for @mentions of your crew. Reply with post_chat_message.',
      inputSchema: { timeout_seconds: z.number().min(1).max(25).optional() },
    },
    ({ timeout_seconds }) =>
      guarded(async () => {
        const ms = await host.waitForMentions(crew, (timeout_seconds ?? 25) * 1000)
        if (!ms.length) return 'No new mentions.'
        return ms
          .map((m) => `[${m.source}] ${m.author}: ${m.text}` + (m.context.area ? `\n(team area: ${m.context.area.name})` : ''))
          .join('\n\n')
      }),
  )
  return server
}

export async function handleMcp(req: Request, host: McpHost, crew: Crew | null): Promise<Response> {
  if (!crew)
    return Response.json({ jsonrpc: '2.0', error: { code: -32001, message: 'Invalid crew token' }, id: null }, { status: 401 })
  const server = buildMcpServer(host, crew)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  return transport.handleRequest(req)
}
