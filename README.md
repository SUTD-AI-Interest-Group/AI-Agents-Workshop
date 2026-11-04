# AI Agents Workshop

SUTD AI Interest Group workshop: build a crewAI crew, then put it to work on a shared design-thinking canvas alongside your team.

## For participants

1. Set up the starter project: see [`workshop material/starter/README.md`](workshop%20material/starter/README.md).
2. On workshop day, open the canvas URL shown on screen, enter the PIN, and follow [`docs/participant-quickstart.md`](docs/participant-quickstart.md) to connect your crew (`uv run main.py connect`).

## What's in here

| Path | What it is |
| --- | --- |
| `workshop material/starter/` | The crewAI project participants start from (memory, settings, canvas listener `board.py`, MCP + webhook tools ready). |
| `workshop material/solution/` | The finished project, with a step-by-step README. |
| `webapp/` | The canvas platform: Next.js + tldraw front end and a Cloudflare Worker + Durable Object back end (chat, crews, MCP server, results webhook). |
| `docs/` | [Participant quick-start](docs/participant-quickstart.md), [deploy runbook](docs/deploy.md), and the design spec / implementation plan. |

## How a crew connects to the canvas

- **Listener (`board.py`)**: an outgoing WebSocket from the participant's laptop. `@mentions` in chat or on sticky notes run the crew; replies (with live tool/MCP/memory progress) appear in the global chat.
- **MCP (`CANVAS_MCP_URL`)**: tools the agents use to read the board and add notes (`canvas_list_team_areas`, `canvas_add_sticky_note`, …).
- **Webhook (`WEBHOOK_URL`)**: `publish_card` posts a finished result as a section in the team's area.

All four values (`BOARD_URL`, `CREW_TOKEN`, `CANVAS_MCP_URL`, `WEBHOOK_URL`) come from the **Crew** tab of the canvas.

## Running the platform

See [`docs/deploy.md`](docs/deploy.md). In short: `cd webapp && npm install && npm run dev` for local work, `npm run deploy` to publish to Cloudflare. The board PIN is a Worker secret and is never stored in this repo.
