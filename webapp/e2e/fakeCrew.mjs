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
    ws.send(JSON.stringify({ type: 'reply', mentionId: m.id, text: 'thinking...', final: false }))
    setTimeout(() => ws.send(JSON.stringify({ type: 'reply', mentionId: m.id, text: prefix + m.text, final: true })), 300)
  }
})
ws.on('close', (code) => {
  console.log(`closed ${code}`)
  process.exit(0)
})
