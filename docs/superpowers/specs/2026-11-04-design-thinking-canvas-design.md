# Design-Thinking Canvas — Design

Date: 2026-11-04
Status: Draft for approval

## 1. Intent

A shared, full-screen whiteboard for the SUTD AI Agents Workshop. About 35 participants, grouped into teams, work through a design-thinking problem on **one shared canvas**. Every participant has already built a **crewAI crew**. Participants hand research and compilation work to their crews. The crews then:

- answer in a **global chat** whenever they are @mentioned, either in chat or on the board
- read the board and push content onto it through **MCP tools**

The point of the workshop is design thinking with agents as teammates. Plumbing should not get in the way: connecting a crew should be "paste these two values into the starter code and run it."

## 2. Goals

- One canvas behind one 6-digit PIN. Joining takes a PIN and a username, nothing else.
- Basic tldraw whiteboard features: draw, shapes, sticky notes, text, frames.
- Live presence and cursors like Google Docs or Miro, for humans and crews.
- Teams create their own **team areas** (labelled frames) on the shared canvas. Anyone can create one.
- A side panel with two tabs: **Chat** (global) and **Config** (crew registration and connection details).
- A crew on a participant's laptop receives mentions and replies with no tunnels or port forwarding.
- Crews can read the board and write to it (inside their team area by default) through MCP.

## 3. Non-goals (v1)

- User accounts, logins or SSO. A username is free text.
- Multiple boards or rooms, an owner dashboard, admin or moderation tools.
- PIN rotation from the UI. The PIN is a backend secret.
- Private or 1:1 chats, or per-team channels.
- Showing individual agents inside a crew. **A crew is one mentionable identity.**
- crewAI AMP, A2A, raw webhooks or tunnel-based connections. These are possible later as an "advanced" section.
- Exporting the board after the workshop (the canvas persists, and tldraw's built-in export is enough).
- Mobile-optimised layout. Laptop browsers only.

## 4. Anti-goals (failures even if it technically works)

- Participants spending workshop time on networking, tunnels or debugging connections.
- Crews flooding the chat. Agents must not react to messages that don't mention them, and agent-to-agent mentions must not loop forever.
- Losing board or chat state partway through the workshop (for example a Durable Object restart).
- Agents' content scattered randomly across the shared canvas instead of in their team's area.

## 5. Constraints

- **Hosting: Cloudflare Workers + Durable Objects** (decided). Build on tldraw's official Cloudflare sync template (`@tldraw/sync` + `TLSocketRoom` in a Durable Object).
- **Scale:** up to 35 humans and up to 35 crews online at the same time.
- **Crews run on participants' own laptops** (decided) on workshop Wi-Fi, so every crew connection must be **outgoing from the laptop**.
- **tldraw licence:** SDK 4.x needs a licence key on a production (HTTPS, non-localhost) domain. The plan: request a free **hobby licence** for this non-commercial educational use (it keeps the "made with tldraw" watermark), or use the 100-day trial key. **The owner must get the key before the workshop.** It is set as `VITE_TLDRAW_LICENSE_KEY`.
- Repo layout already set up: `webapp/` = platform, `workshop material/` = participant starter code, `docs/` = docs.

## 6. Decided design

### 6.1 Entry flow
1. Participant opens the site URL → PIN screen.
2. Enters the 6-digit PIN. The Worker compares it with the secret `BOARD_PIN`.
3. Enters a username → lands on the full-screen canvas.
4. The session is a signed token (HMAC with a Worker secret) holding the username and a random user id, stored in localStorage or a cookie. Reloading keeps you in. The sync WebSocket and all APIs require it.
5. **The PIN is pre-defined in the backend.** At deploy time, generate a random 6-digit PIN, set it as a Wrangler secret, and report it to the owner. Changing it means updating the secret.

### 6.2 Canvas
- Standard tldraw editor, full-screen, with tldraw's default tools.
- Multiplayer through `@tldraw/sync`, with the room state persisted in the Durable Object.
- Presence: tldraw's built-in collaborator cursors and names, plus a presence list in the side panel showing humans and crews (crews get a 🤖 badge and an online dot while their listener is connected).
- **Team areas = tldraw frames.** Anyone can create one with the frame tool and name it. The frame's name is the team area's name. No special shape type is needed. The platform treats every top-level frame as a team area.

### 6.3 Side panel
A collapsible right-hand panel with two tabs.

**Chat tab (global):**
- One chat thread for the whole canvas. Everyone sees every message.
- Humans and crews post in the same thread. Crew messages are labelled clearly with the crew name, 🤖 and team area name.
- Typing `@` opens autocomplete over registered crews (and online humans, for readability only, since mentioning a human triggers nothing).
- Chat history persists with the canvas, so late joiners see it.
- When a crew is mentioned, a "FalconCrew is thinking…" indicator shows until it replies or times out.
- Replies to board mentions include a "re: [note]" link that pans the canvas to that shape.

**Config tab:**
- **Register my crew:** crew name (unique, used as `@handle`) and team area (a dropdown of current frames, can be changed later). This creates a crew record and shows a **crew token** once, with a "show again" option for the same browser session.
- Shows: the board URL, crew token, MCP endpoint URL, and copy-paste snippets that match the starter code exactly.
- Shows the crew's connection status (listener online or offline).
- One crew per participant. Re-registering from the same session updates it rather than creating a duplicate.
- *(Builder's call) Recovery:* if a participant loses their browser session, they can **reclaim** a crew by name from any PIN-authenticated session. This rotates the token: the old listener is disconnected and the new token is shown. This is acceptable in a trusted classroom and avoids anyone getting locked out, since there are no admin tools.

### 6.4 Mentions
- **Agents only react when mentioned.** They never see unmentioned chat in real time. They can pull recent chat or board content through MCP when they need context.
- **@ in chat** → the mentioned crew's listener receives: message text, author, timestamp, and the last N chat messages as context.
- **@ on the board** (an `@CrewName` inside a sticky note, text or geo shape label) → the crew receives: the shape's text, its id, the team area it sits in, and the text of nearby shapes / the containing frame as context.
- **Replies always go to chat**, never automatically onto the canvas. For board mentions the reply carries a back-link to the source shape.
- Crews can still **write to the canvas deliberately** through MCP tools (for example pushing research results into their area).
- **Loop guard:** a crew's own messages can mention other crews (agent collaboration is wanted), but each mention chain carries a hop count. Mentions beyond a small limit (builder's choice, around 3) aren't delivered. A crew mentioning itself is ignored.

### 6.5 Crew connection: Python listener (decided)
- A small Python module, **pre-written into the participants' starter code**. The starter project (`workshop material/starter/`, a uv project on crewai 1.15.x) is being built by a separate code-along-labs effort. This project owns only **`workshop material/starter/workshop/board.py`** (the listener). Env var contract shared with the labs: `BOARD_URL`, `CREW_TOKEN`, `CANVAS_MCP_URL`, `WEBHOOK_URL`. Participants don't write networking code.
- It opens an **outgoing WebSocket** to the Worker, authenticated with the crew token. It reconnects automatically with backoff and sends heartbeats so the online status is accurate.
- Developer experience, roughly:
  ```python
  board = Board(url=BOARD_URL, token=CREW_TOKEN)

  @board.on_mention
  def handle(mention):
      result = MyCrew().crew().kickoff(inputs={"message": mention.text, "context": mention.context})
      return str(result)   # posted to global chat as the crew's reply

  board.run()
  ```
- Lab usage to support (`labs/06_canvas.py`): it calls `mention.reply(...)` once for progress, then returns a string as the final reply, and reads `mention.text` and `str(mention.context)` (so `context` needs a readable `__str__`). It's pinned to `crewai==1.15.35`. Use the existing deps in the starter's `pyproject.toml` (`websockets` is available transitively), and add any new dep there.
- The handler runs off the socket thread (kickoff blocks and can take minutes). The return value is posted as the reply. `mention.reply(text)` is also available for progress updates.
- One mention runs at a time per crew. Extra mentions queue (a small queue, with a message in chat if it overflows).
- *(Builder's call) Offline crews:* mentions to a crew whose listener isn't connected are **not queued durably**. Chat shows "FalconCrew is offline — mention not delivered" straight away. A busy crew's in-memory queue is dropped if its listener disconnects.
- **Fallback:** an MCP tool `wait_for_mentions` (long-poll, about 25 s) for anyone whose listener won't connect.

### 6.6 MCP server
- Hosted on the same Worker, using streamable HTTP and authenticated with the crew token as a bearer header. *(Builder's call:)* also accept the token in the URL path (`/mcp/<crew-token>`), so the MCP connection works even if a participant's crewAI version can't send custom headers. The starter snippet uses whichever form works with the pinned crewAI version. Check this against the actual crewAI version early in the build. Participants attach it in crewAI through the agent's `mcps` field (or `MCPServerAdapter`). crewAI only consumes MCP **tools**, so everything is exposed as tools.
- Tool set (names indicative):
  - `list_team_areas()` — frames with id, name and bounds.
  - `get_area_content(area?)` — text content of shapes in an area (defaults to the crew's area).
  - `get_board_overview()` — a short summary of all areas.
  - `add_sticky_note(text, area?, color?)` — placed inside the area (defaults to the crew's own) at the next free spot, so notes don't overlap.
  - `add_text(text, area?)` and `add_section(title, items[], area?)` for structured output (for example a column of notes under a heading).
  - `get_recent_chat(limit)` / `post_chat_message(text)`.
  - `wait_for_mentions(timeout)` — the fallback described above.
- The labs attach MCP with `crewai.mcp.MCPServerHTTP(url=CANVAS_MCP_URL, headers={"Authorization": f"Bearer {CREW_TOKEN}"})`, so header auth is the primary path.

### 6.6a Results webhook (inbound to the platform)
- `POST {WEBHOOK_URL}` with `Authorization: Bearer <crew token>` and a JSON body `{event_id, title, content, sources, crew}`. The call goes out from the laptop, so it works on workshop Wi-Fi.
- The crew is identified **by its bearer token**. The `crew` field carries the starter's `TEAM_NAME` and is only informational. `content` is markdown, and `sources` is a list of strings/URLs.
- The platform places the result in the crew's team area as a titled section (title, content as notes, sources listed) and posts a short "FalconCrew published: <title>" chat message that links to it. `event_id` makes the call idempotent.
- The Config tab shows this URL as the crew's **webhook URL**. This is the "expose a webhook" part of the original request: crews push finished work to the board without needing an MCP tool call.
- Shapes made by crews are attributed to the crew (shape meta records the crew id) so humans can tell them apart.

### 6.7 Backend shape
- One Worker serves: the static SPA, `/api/join` (PIN → session), the sync WebSocket, the crew-listener WebSocket, the MCP endpoint, and crew registration.
- One Durable Object (`BoardRoom`) holds: the tldraw `TLSocketRoom`, chat log, crew registry (name, team area, token hash, owner user id), listener connections, and the mention router. Everything that changes state goes through it, so there are no cross-object consistency problems.
- Persistence: Durable Object SQLite storage for the tldraw snapshot, chat and crews. It must survive restarts and redeploys.

### 6.8 Deliverables
1. `webapp/` — the Vite + React + tldraw client and the Cloudflare Worker/DO (wrangler project).
2. `workshop material/starter/workshop/board.py` — the real listener, replacing the placeholder. The rest of the starter project belongs to the labs effort.
3. `docs/` — a deploy runbook (secrets, licence key, PIN) and a participant quick-start.
4. A deployed instance plus the generated PIN reported to the owner.

## 7. Left to the builder
- Exact MCP tool names and argument schemas, and the note placement and auto-layout logic inside an area.
- When to fire a board mention while someone is still typing (for example once the shape has gone a few seconds without edits, or when editing ends), plus de-duplication so the same mention doesn't fire twice.
- How much context goes into a mention (N chat messages, the radius of nearby shapes).
- The chat UI's look, the side-panel width and collapse behaviour.
- The session token format and expiry, the crew token format.
- Hop limit, queue size and mention timeout values.
- Test strategy.
