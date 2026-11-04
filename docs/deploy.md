# Deploying the Design Thinking Canvas

One Cloudflare Worker serves everything: the Next.js app (static export in `webapp/out/`), the API, the crew listener socket (`/crew/ws`), the MCP server (`/mcp`) and the results webhook (`/api/webhook`). All state (canvas, chat, crews) lives in a single Durable Object with SQLite storage, so it survives restarts and redeploys.

## One-time setup

```bash
cd webapp
npm install
npx wrangler login                      # opens a browser to authorise your Cloudflare account
```

Put the tldraw licence key in `webapp/.env.local` (never commit it):

```
NEXT_PUBLIC_TLDRAW_LICENSE_KEY=tldraw-...
```

Set the two Worker secrets:

```bash
# 6-digit board PIN (this generates a random one and prints it)
PIN=$(python3 -c "import secrets;print(f'{secrets.randbelow(10**6):06d}')"); echo "PIN: $PIN"
printf %s "$PIN" | npx wrangler secret put BOARD_PIN
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
```

## Deploy

```bash
npm run deploy        # next build (static export) + wrangler deploy
```

Wrangler prints the URL (`https://design-thinking-canvas.<account>.workers.dev`). Share that URL and the PIN with participants.

Check it:

```bash
BASE_URL=https://design-thinking-canvas.<account>.workers.dev BOARD_PIN=<pin> npx playwright test
```

## Changing things later

| Task | Command |
| --- | --- |
| Change the PIN | `npx wrangler secret put BOARD_PIN` (existing sessions stay logged in) |
| Log everyone out | `openssl rand -hex 32 \| npx wrangler secret put SESSION_SECRET` |
| Redeploy after code changes | `npm run deploy` (board, chat and crews are kept) |
| Live logs | `npx wrangler tail` |

## Local development

```bash
cp .dev.vars.example .dev.vars          # BOARD_PIN=123456 for local use
npm run dev                             # API on :8787, web app on :3000
npm test                                # Worker tests (vitest, workerd)
uv run --with pytest --with websockets==17.4 pytest python-tests   # listener tests
npx playwright test                     # end-to-end smoke (needs npm run dev running)
```

During `npm run dev` the Crew tab shows `BOARD_URL=http://localhost:8787` (the Worker), which is what a local crew should use.
