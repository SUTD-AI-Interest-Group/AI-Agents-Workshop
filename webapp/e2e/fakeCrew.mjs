// Minimal crew listener for manual/e2e checks: replies "ok: <text>" to every mention.
// Usage: node e2e/fakeCrew.mjs <BOARD_URL> <CREW_TOKEN> [reply-prefix]
import WebSocket from 'ws'

const [url, token, prefix = 'ok: '] = process.argv.slice(2)
const ws = new WebSocket(url.replace(/^http/, 'ws') + '/crew/ws', { headers: { Authorization: `Bearer ${token}` } })
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw))
  if (m.type === 'hello') console.log(`hello ${m.crew.name}`)
  if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }))
  if (m.type === 'mention') {
    console.log(`mention [${m.source}] ${m.text}`)
    const steps = [
      ['task', 'Task: Research the brief'],
      ['agent', 'Researcher started'],
      ['memory', 'Searching memory: ' + m.text.slice(0, 40)],
      ['thinking', 'Researcher is thinking'],
      ['tool', 'Researcher → web_search'],
      ['mcp', 'canvas · get_area_content'],
    ]
    steps.forEach(([kind, text], i) =>
      setTimeout(() => ws.send(JSON.stringify({ type: 'reply', mentionId: m.id, text, final: false, kind })), 120 * (i + 1)),
    )
    setTimeout(() => ws.send(JSON.stringify({ type: 'reply', mentionId: m.id, text: prefix + m.text, final: true })), 120 * (steps.length + 2))
  }
})
ws.on('close', (code) => {
  console.log(`closed ${code}`)
  process.exit(0)
})
