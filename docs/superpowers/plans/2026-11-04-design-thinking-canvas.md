# Design-Thinking Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PIN-gated, full-screen multiplayer tldraw canvas on Cloudflare with a global chat and a config panel. Participants' crewAI crews (on their laptops) receive @mentions through an outgoing WebSocket listener and act on the board through MCP and a results webhook.

**Architecture:** One Cloudflare Worker serves the Vite/React SPA and every API. All state lives in a single Durable Object, `BoardRoom` (`idFromName("main")`). It holds the tldraw `TLSocketRoom` (SQLite-backed), chat log, crew registry, browser "events" sockets, crew listener sockets, the mention router and the MCP server. The Worker only authenticates and forwards. The browser detects board mentions when someone finishes editing a shape and reports them to the server, which checks them.

**Tech Stack:** TypeScript, Vite 8, React 19, tldraw / @tldraw/sync / @tldraw/sync-core / @tldraw/tlschema 5.6.x, Wrangler 4, @cloudflare/vitest-pool-workers, @modelcontextprotocol/sdk 1.32.x, Playwright (smoke). Python 3.11+ with `websockets` for the listener.

**Spec:** `docs/superpowers/specs/2026-11-04-design-thinking-canvas-design.md`

## Global Constraints

- Hosting: Cloudflare Workers + **one** Durable Object class `BoardRoom` with SQLite storage (`new_sqlite_classes` migration). All state persists across restarts and redeploys.
- tldraw packages pinned to the same 5.6.x version. Licence key read from `VITE_TLDRAW_LICENSE_KEY` (build-time env, never committed).
- Worker secrets: `BOARD_PIN` (6 digits) and `SESSION_SECRET` (≥32 random bytes, hex). There is one canvas and one PIN, with no admin UI.
- Env contract shared with the starter (do not rename): `BOARD_URL` (site origin, e.g. `https://x.workers.dev`), `CREW_TOKEN`, `CANVAS_MCP_URL` (= `${origin}/mcp`), `WEBHOOK_URL` (= `${origin}/api/webhook`).
- This project writes **only** `workshop material/starter/workshop/board.py` inside the starter. It must not edit the starter's `pyproject.toml`. `board.py` may import only the stdlib and `websockets` (already a transitive dependency of `crewai[tools]==1.15.35`).
- Listener API (fixed by `labs/06_canvas.py`): `Board(url, token)`, `@board.on_mention`, `mention.text`, `mention.author`, `mention.context` (with a readable `__str__`), `mention.reply(text)`, handler return value = final reply, `board.run()` blocks and reconnects.
- Webhook payload: `POST /api/webhook`, `Authorization: Bearer <crew token>`, JSON `{event_id, crew, title, content, sources}`. The crew is identified by the token. `crew` is only informational. `content` is markdown, `sources` is `string[]`.
- Crews only ever react to mentions. Replies always go to chat.
- Values: hop limit **3**, per-crew queue **3**, mention timeout **10 min**, chat context **last 20 messages**, session token expiry **7 days**, PIN attempts **10 failures / IP / minute**, crew token format `crw_` + 32 hex chars (only a SHA-256 hash is stored), crew name `^[A-Za-z][A-Za-z0-9_-]{1,23}$` and unique case-insensitively.
- Scale: up to 35 humans + 35 crews online at the same time.

## Review Focus

1. **Brute-forcing the PIN:** the 11th wrong PIN from one IP within a minute gets HTTP 429, even if the 12th try would be correct. → Task 2.
2. **Mention text with punctuation and different case:** `"hey @falconcrew, thoughts?"` reaches `FalconCrew`. `"email@FalconCrew.com"` does not (the `@` must follow the start of the text or a non-word character). → Task 6.
3. **A board mention firing repeatedly:** re-finishing an edit on the same sticky with the same text must not deliver again. Changing the text must deliver again. → Task 7.
4. **A crew listener dropping mid-kickoff:** the "thinking" indicator clears, chat shows "FalconCrew disconnected — request dropped", the queue is discarded, and after reconnecting the crew only gets new mentions. → Task 7.
5. **Two listeners on one token** (a participant runs the lab twice): the newest connection wins and the older one is closed with code `4001` and reason `replaced`, so there are never double replies. The Python listener does **not** auto-reconnect after a 4001 close. → Tasks 7 and 11.

---

## File Structure

```
webapp/
  package.json, tsconfig*.json, vite.config.ts, wrangler.jsonc, vitest.config.ts, index.html
  .dev.vars.example                 # BOARD_PIN, SESSION_SECRET for local dev
  shared/protocol.ts                # all wire types shared by worker + client
  worker/
    index.ts                        # Worker fetch: routing + auth, forwards to the DO
    auth.ts                         # session tokens, crew tokens, PIN rate limiting
    BoardRoom.ts                    # Durable Object: wires the modules below together
    chat.ts                         # ChatStore (SQLite)
    crews.ts                        # CrewRegistry (SQLite)
    mentions.ts                     # parseMentions + MentionRouter
    boardModel.ts                   # pure helpers over tldraw records: text, areas, placement, record builders
    boardWriter.ts                  # applies boardModel output to the TLSocketRoom (notes, sections, fallback area)
    mcp.ts                          # MCP server + tools
  src/
    main.tsx, App.tsx, api.ts, session.ts
    JoinScreen.tsx
    BoardPage.tsx                   # <Tldraw> + useSync + side panel layout
    useBoardEvents.ts               # events-socket hook (chat, crews, users, thinking)
    useBoardMentionDetector.ts      # detects edit-end @mentions on shapes
    panel/SidePanel.tsx, panel/ChatTab.tsx, panel/ConfigTab.tsx, panel/PresenceList.tsx
  test/*.test.ts                    # vitest (workers pool)
  python-tests/test_board.py        # pytest for the listener (run via uv --with)
  e2e/smoke.spec.ts                 # Playwright smoke against `wrangler dev`
workshop material/starter/workshop/board.py   # real listener (replaces placeholder)
docs/deploy.md, docs/participant-quickstart.md
```

## Shared wire types (`webapp/shared/protocol.ts`, created in Task 4 and extended later)

```ts
export type ChatMessage = { id: string; ts: number; authorType: 'human'|'crew'|'system';
  authorName: string; crewId?: string; areaName?: string; text: string;
  ref?: { shapeId: string; label: string } }
export type CrewInfo = { id: string; name: string; areaId: string|null; areaName: string|null;
  ownerUserId: string; online: boolean; busy: boolean }
export type OnlineUser = { userId: string; name: string }
// browser events socket
export type ServerEvent =
  | { type: 'init'; messages: ChatMessage[]; crews: CrewInfo[]; users: OnlineUser[] }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'crews'; crews: CrewInfo[] }
  | { type: 'users'; users: OnlineUser[] }
  | { type: 'thinking'; crewId: string; on: boolean }
export type ClientEvent = { type: 'chat'; text: string }
// crew listener socket
export type MentionPayload = { type: 'mention'; id: string; source: 'chat'|'board'; text: string;
  author: string; hop: number; shapeId?: string; context: MentionContext }
export type MentionContext = { recentChat?: { author: string; text: string }[];
  area?: { id: string; name: string }; nearby?: string[] }
export type ToCrew = { type: 'hello'; crew: CrewInfo } | MentionPayload | { type: 'ping' }
export type FromCrew = { type: 'reply'; mentionId: string; text: string; final: boolean }
  | { type: 'error'; mentionId: string; message: string } | { type: 'pong' }
```

---

### Task 1: Scaffold webapp (Worker + SPA + tests)

**Files:** Create everything at the `webapp/` root listed above, plus `worker/index.ts` and `src/main.tsx`/`App.tsx` stubs, `test/health.test.ts`.

**Interfaces:**
- Produces: `Env` type in `worker/index.ts` = `{ BOARD_ROOM: DurableObjectNamespace; ASSETS: Fetcher; BOARD_PIN: string; SESSION_SECRET: string }`. `npm run dev` (vite + wrangler via `@cloudflare/vite-plugin`), `npm test` (vitest workers pool), `npm run deploy`.

- [ ] **Step 1:** `npm create cloudflare@latest` isn't used. Hand-write `package.json` with the stack above. Use `@cloudflare/vite-plugin` so `vite dev` runs the Worker and DO. In `wrangler.jsonc`: `main: worker/index.ts`, `assets: { not_found_handling: "single-page-application", run_worker_first: ["/api/*", "/mcp*", "/crew/*"] }`, DO binding `BOARD_ROOM` → class `BoardRoom`, migration `{ tag: "v1", new_sqlite_classes: ["BoardRoom"] }`, `compatibility_flags: ["nodejs_compat"]`.
- [ ] **Step 2:** Write `test/health.test.ts`: `SELF.fetch("https://x/api/health")` → status 200, JSON `{ ok: true }`.
- [ ] **Step 3:** Run `cd webapp && npm test` → FAIL (404).
- [ ] **Step 4:** Implement `GET /api/health` in `worker/index.ts`. Export an empty `BoardRoom extends DurableObject` so the binding resolves.
- [ ] **Step 5:** `npm test` → PASS. `npm run build` → succeeds.
- [ ] **Step 6:** Commit `feat(webapp): scaffold worker + vite spa`.

### Task 2: Auth — PIN join, session tokens, crew tokens

**Files:** Create `worker/auth.ts`, `test/auth.test.ts`. Modify `worker/index.ts`.

**Interfaces:**
- Produces:
  - `signSession(secret: string, s: { userId: string; name: string }, nowMs?: number): Promise<string>`, giving `base64url(json).base64url(hmac)` with an `exp` 7 days out
  - `verifySession(secret: string, token: string, nowMs?: number): Promise<{ userId: string; name: string } | null>`
  - `newCrewToken(): string`, `hashToken(t: string): Promise<string>` (hex SHA-256)
  - `getSession(req, env)`: reads `Authorization: Bearer` or the `?token=` query param, and returns the session or null
  - `POST /api/join` with `{pin: string, name: string}` → `200 {token, userId, name}`, `401 {error:"wrong_pin"}`, `400` if the name is empty after trimming or longer than 32 characters, `429 {error:"too_many_attempts"}`
- Rate limiting is counted inside the DO (`fetch` on the internal path `/internal/pin-attempt`, keyed by `CF-Connecting-IP`) so it holds across Worker isolates.

- [ ] **Step 1: Failing tests**:
  - sign→verify round-trip returns the same `{userId,name}`
  - a tampered payload gives `null`
  - an expired token (`nowMs` + 8 days) gives `null`
  - join with the right PIN gives 200 and a token that verifies
  - the wrong PIN gives 401
  - **10 wrong PINs from one IP, then the correct one → the 11th call gives 429** (Review Focus 1)
  - a 300-character name gives 400
- [ ] **Step 2:** `npm test test/auth.test.ts` → FAIL.
- [ ] **Step 3:** Implement with WebCrypto `HMAC-SHA-256` and constant-time comparison. Configure test bindings with `BOARD_PIN=123456` and `SESSION_SECRET=test` in `vitest.config.ts` (`miniflare.bindings`).
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5:** Commit `feat(auth): pin join, session + crew tokens`.

### Task 3: BoardRoom DO with tldraw sync + Join screen + canvas

**Files:** Modify `worker/BoardRoom.ts`, `worker/index.ts`. Create `src/JoinScreen.tsx`, `src/BoardPage.tsx`, `src/session.ts`, `src/api.ts`, `test/sync.test.ts`.

**Interfaces:**
- Consumes: `getSession` (Task 2).
- Produces:
  - `GET /api/sync?token=&sessionId=` (WebSocket) → DO `room.handleSocketConnect({ sessionId, socket, meta: { userId, name } })`. Returns 401 without a valid session.
  - In the DO: `this.room: TLSocketRoom<TLRecord, {userId:string;name:string}>` with `storage: new SQLiteSyncStorage({ sql: new DurableObjectSqliteSyncWrapper(ctx.storage, { tablePrefix: 'tldraw_' }) })`.
  - `session.ts`: `loadSession(): {token,userId,name}|null`, `saveSession(s)`, `clearSession()` (localStorage key `dtc.session`).
- Client: `App` shows `JoinScreen` (PIN input with 6-digit numeric `inputMode`, then a username) until a session exists, then `BoardPage`. `BoardPage` renders a full-viewport `<Tldraw store={useSync({ uri, assets })} licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY} />` and sets the user preference name to the session name, so cursors show usernames. Assets: use tldraw's inline base64 asset store (`inlineBase64AssetStore`); no R2 for v1. On a 401 from the API, clear the session and return to the PIN screen.

- [ ] **Step 1: Failing tests**:
  - a WS upgrade to `/api/sync` without a token gives 401
  - with a valid token the upgrade gives 101
  - `runInDurableObject`: `room.updateStore(s => s.put(<a note record>))`, then construct a fresh `BoardRoom` over the same storage, and `getRecord(id)` is not null (persistence)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the DO (WebSocket accept via `WebSocketPair`, closing the session on socket close/error) and the client screens.
- [ ] **Step 4:** Tests PASS. Manual check: `npm run dev`, open two browser windows, join both, and see both cursors with names and live drawing. Reload, and the drawing is still there.
- [ ] **Step 5:** Commit `feat: pin-gated multiplayer tldraw canvas`.

### Task 4: Chat store + events socket

**Files:** Create `shared/protocol.ts`, `worker/chat.ts`, `src/useBoardEvents.ts`, `test/chat.test.ts`. Modify `worker/BoardRoom.ts`, `worker/index.ts`.

**Interfaces:**
- Produces:
  - `class ChatStore { constructor(sql: SqlStorage); add(m: Omit<ChatMessage,'id'|'ts'>): ChatMessage; recent(limit: number): ChatMessage[] /* oldest→newest */ }`
  - DO method `broadcast(e: ServerEvent)` to all events sockets
  - DO `postChat(m): ChatMessage` = add + broadcast. Later tasks use it for crew/system messages.
  - `GET /api/events?token=` (WebSocket). On connect: `init` with the last 200 messages, crews and users. A `ClientEvent` `chat` → `postChat({authorType:'human', authorName: session.name, text})` after trimming, ignored if empty, cut to 4000 characters. Online users = unique userIds across events sockets, broadcast as `users` on join and leave.
  - `useBoardEvents(token): { messages, crews, users, thinking: Set<string>, send(text) }`, which reconnects with backoff.

- [ ] **Step 1: Failing tests**:
  - `ChatStore` persists and `recent(2)` returns the last two oldest-first
  - two events sockets: A sends `{type:'chat',text:'hi'}`, and B receives a `chat` event with `authorName` = A's name
  - a new socket's `init.messages` includes `'hi'`
  - `users` lists both, then one after A closes
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: global chat over events socket`.

### Task 5: Crew registry + register / update / reclaim

**Files:** Create `worker/crews.ts`, `test/crews.test.ts`. Modify `worker/BoardRoom.ts`, `worker/index.ts`.

**Interfaces:**
- Produces:
  - `class CrewRegistry { constructor(sql); create(name, areaId|null, ownerUserId): {crew, token}; update(id, {name?, areaId?}); rotateToken(id, newOwnerUserId): string; byTokenHash(h): Crew|null; byName(name): Crew|null /* case-insensitive */; byOwner(userId): Crew|null; all(): Crew[] }`
  - `Crew` = the stored record (id, name, areaId, ownerUserId, tokenHash). `CrewInfo` is derived by the DO, which adds `areaName` (from the frame record), `online` and `busy`.
  - `POST /api/crews {name, areaId}` (session): 201 `{crew: CrewInfo, token}`. If the caller already owns a crew → 200, update the name/area, **no new token**, `token: null`. 409 `{error:"name_taken"}`. 400 `{error:"invalid_name"}`.
  - `POST /api/crews/reclaim {name}` (session): 200 `{crew, token}`. It rotates the token, sets the owner to the caller, and closes any live listener for that crew with `4001 "replaced"`.
  - `crewFromRequest(req)` inside the DO: Bearer header, `?token=`, or the `/mcp/<token>` path → Crew | null.
  - Any crew change broadcasts a `crews` event.

- [ ] **Step 1: Failing tests**:
  - create → `byTokenHash(hash(token))` finds it
  - `FalconCrew` then `falconcrew` → 409
  - `"1bad"` and `"has space"` → 400
  - the same owner registering twice → one crew, the second response has `token: null`, and the area is updated
  - reclaim from another user → the new token works and the old one no longer resolves
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat: crew registry and registration api`.

### Task 6: Board model helpers (pure)

**Files:** Create `worker/boardModel.ts`, `test/boardModel.test.ts`.

**Interfaces:**
- Produces (all pure over `TLRecord[]` or individual records):
  - `richTextToPlain(rt: TLRichText | undefined): string`: walks TipTap JSON nodes, joining paragraphs with `\n`
  - `shapeText(shape: TLShape): string`: richText for note/text/geo/arrow labels, and `props.name` for frames
  - `listAreas(records): { id: string; name: string; x: number; y: number; w: number; h: number }[]`: frames whose `parentId` is a page
  - `areaOf(records, shapeId): Area | null`: walks up `parentId`
  - `areaContent(records, areaId): string[]`: plain texts of descendants, ordered top-to-bottom and then left-to-right
  - `nearbyTexts(records, shapeId, radius = 600): string[]`
  - `nextNotePositions(records, areaId, count): {x,y}[]`: frame-relative grid with note 200×200, gap 20, padding 40, starting below the frame title. It skips cells that overlap existing children and returns `growTo?: number` (new frame height) when it runs out of rows.
  - `buildNote(opts: {parentId, x, y, text, color?, crewId}): TLShape`: `createShapeId()`, `toRichText(text)` from `@tldraw/tlschema`, default note props, `meta: { crewId }`
  - `buildText(opts)` (same signature, text shape) and `buildFrame({name, x, y, w, h})`
  - `parseMentions(text: string, crewNames: string[]): string[]`: regex `/(^|[^\w@])@([A-Za-z][A-Za-z0-9_-]*)/g`, case-insensitive match against crew names, returns canonical names, de-duplicated
- Every built record must pass `createTLSchema()` validation. Assert that in the tests via `schema.types.shape.validate(record)` (or the 5.6 equivalent).

- [ ] **Step 1: Failing tests**, with fixtures built from `buildFrame`/`buildNote`:
  - `richTextToPlain(toRichText("a\nb")) === "a\nb"`
  - `listAreas` returns only top-level frames
  - `areaOf` a note nested inside a group inside a frame gives that frame
  - `nextNotePositions` on an empty 1000×600 frame returns `(40, 80)`, `(260, 80)` …, and skips a cell occupied by an existing note
  - `buildNote` output validates against the schema
  - **`parseMentions("hey @falconcrew, thoughts?", ["FalconCrew"])` → `["FalconCrew"]`; `parseMentions("mail email@FalconCrew.com", ["FalconCrew"])` → `[]`** (Review Focus 2)
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat: board model helpers`.

### Task 7: Crew listener socket + mention router (chat + board mentions)

**Files:** Create `worker/mentions.ts`, `worker/boardWriter.ts` (only `snapshotRecords()` here; writing comes in Task 8), `test/mentions.test.ts`. Modify `worker/BoardRoom.ts`, `worker/index.ts`.

**Interfaces:**
- Consumes: `parseMentions`, `areaOf`, `nearbyTexts`, `shapeText` (Task 6), `CrewRegistry` (Task 5), `postChat`/`broadcast` (Task 4).
- Produces:
  - `GET /crew/ws` (WebSocket, crew token). Sends `hello`. One socket per crew: a new socket closes the old one with `4001 "replaced"` (Review Focus 5). The server sends `ping` every 30 s and drops the socket after 75 s without a `pong`. Online/busy changes broadcast `crews`.
  - `class MentionRouter { constructor(deps: { send(crewId, msg: ToCrew): boolean; isOnline(crewId): boolean; postChat; broadcast; now(): number }); deliver(crewId, m: Omit<MentionPayload,'type'|'id'>): void; onReply(crewId, r: FromCrew): void; onDisconnect(crewId): void; tick(): void /* timeouts */ }`
  - Rules:
    - Offline → system chat "`<Name>` is offline — mention not delivered".
    - Busy → queue (max 3, overflow gets a system chat "`<Name>` is busy — try again shortly").
    - On delivery → `thinking on`.
    - `reply` with `final:false` → crew chat message.
    - `final:true` or `error` → a crew chat message (for an error, a system "`<Name>` hit an error: …"), then `thinking off`, then the next item in the queue.
    - Timeout after 10 min → system "`<Name>` timed out" and moves on.
    - Disconnect while busy → system "`<Name>` disconnected — request dropped", the queue is cleared, `thinking off` (Review Focus 4).
  - Crew chat messages carry `crewId` and `areaName`, plus `ref` when the mention came from the board.
  - Chat mentions: on every `postChat`, run `parseMentions` and deliver to each mentioned crew except the author crew. Context = `recentChat` (last 20). Hop = 0 for humans. For crew-authored messages hop = the triggering mention's hop + 1, and nothing is delivered when hop ≥ 3.
  - Board mentions: `POST /api/mentions/board {shapeId}` (session). The server reads the shape, parses mentions in `shapeText`, de-duplicates on `(shapeId, crewId, sha256(text))` (persisted in a SQLite table), and delivers with `source:'board'`, `shapeId`, and context `{ area, nearby }`. Returns `{delivered: string[]}`.
  - Uses the DO alarm (`ctx.storage.setAlarm`) every 30 s while any crew is busy, to call `tick()` and send pings.

- [ ] **Step 1: Failing tests**:
  - **Router unit tests with fake deps:**
    - offline → offline notice
    - busy queue order
    - 4th queued item → busy notice
    - final reply posts and moves on to the next item
    - timeout after a fake `now` + 10 min
    - **disconnect while busy → "disconnected" notice, then after reconnecting a new mention is delivered and no stale item is** (RF4)
    - hop 3 → nothing delivered
    - a crew mentioning itself → ignored
  - **Integration:**
    - crew socket connected, human chat `"@FalconCrew hi"` → the socket receives a `mention` with `text` and `recentChat`; replying `final:true` → the events socket receives a crew `chat`
    - a second socket with the same token → the first one closes with code 4001
    - board mention: put a note with text `"@FalconCrew ideas?"` inside a frame, POST twice → the first call delivers, the second gives `delivered: []`; edit the text, POST again → it delivers (RF3)
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat: crew listener socket and mention routing`.

### Task 8: Board writer + MCP server

**Files:** Modify `worker/boardWriter.ts`. Create `worker/mcp.ts`, `test/mcp.test.ts`. Modify `worker/BoardRoom.ts`, `worker/index.ts`.

**Interfaces:**
- Consumes: Task 6 helpers, `room.updateStore`, `CrewRegistry`, `ChatStore`, `postChat` (with mention routing at hop 1 for crew posts).
- Produces:
  - `boardWriter.addNotes(crew, areaId|null, texts: string[], color?): Promise<string[]>` (shape ids)
  - `boardWriter.addSection(crew, areaId|null, title, items: string[]): Promise<{headingId, noteIds}>`: a text heading on its own row, notes underneath
  - `resolveArea(crew, areaId|null)`: explicit → the crew's area → **fallback:** create a frame `"<CrewName> area"` 1200×800 placed 200 px to the right of the rightmost existing top-level shape, and save it as the crew's area. The frame grows when `growTo` is returned.
  - `POST /mcp` and `POST /mcp/<token>`: MCP streamable HTTP, **stateless** (a new `McpServer` + the SDK's Web-standard streamable HTTP transport per request, `sessionIdGenerator: undefined`, JSON responses enabled). 401 JSON-RPC error without a valid crew.
  - Tools (zod schemas; every result is text content):
    - `list_team_areas()`
    - `get_area_content({area?: string})`, where `area` is an id or name (case-insensitive)
    - `get_board_overview()`: every area with its name and first 10 texts
    - `add_sticky_note({text, area?, color?})`
    - `add_text({text, area?})`
    - `add_section({title, items: string[], area?})`
    - `get_recent_chat({limit?: number = 20})`
    - `post_chat_message({text})`
    - `wait_for_mentions({timeout_seconds?: number = 25})`: returns and clears mentions queued for this crew while it has **no** live listener socket. A crew counts as "polling" for 60 s after each `wait_for_mentions` call. While it's polling, `isOnline` is true and the router puts mentions into this mailbox (max 3) instead of posting "offline". Replies come through `post_chat_message` (which also clears `thinking`). Test: a crew that polled 10 s ago gets the mention in its mailbox, and a crew that polled 2 min ago gets the offline notice.
  - Unknown area → the tool returns `isError: true` with "Unknown area. Available: …".

- [ ] **Step 1: Failing tests** (drive the endpoint with a JSON-RPC `fetch`, or the SDK client with a fetch transport):
  - `tools/list` contains all 9 names
  - `add_sticky_note` with no area for a crew whose area exists → the record's `parentId` is that frame and `meta.crewId` is set
  - two notes do not overlap
  - a crew with no area → a frame "`FalconCrew area`" is created and holds the note
  - `get_area_content` returns the note text
  - `post_chat_message` → the events socket receives a crew chat message
  - `/mcp/<token>` works without a header
  - a bad token → 401
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat: mcp server with board tools`.

### Task 9: Results webhook

**Files:** Modify `worker/BoardRoom.ts`, `worker/index.ts`. Create `test/webhook.test.ts`.

**Interfaces:**
- Consumes: `boardWriter.addSection`, `postChat`.
- Produces: `POST /api/webhook` with a Bearer crew token and JSON `{event_id, crew, title, content, sources}`:
  - `content` is split into items on blank lines (paragraphs); each item is cut to 1000 characters, with at most 12 items
  - `sources` are added as one final note `"Sources:\n- …"`
  - it calls `addSection(crew, null, title, items)` and posts a crew chat message `"published: <title>"` with `ref` → the heading shape
  - responses: `200 {ok:true, shapeIds}`; a repeated `event_id` from the same crew → `200 {ok:true, duplicate:true}` and nothing is written; `401` for a bad token; `400` if `title` or `content` is missing
- [ ] **Step 1: Failing tests:**
  - a valid post creates a heading and notes in the crew area, and chat gets "published"
  - the same `event_id` again → `duplicate:true` and the record count is unchanged
  - no token → 401
  - missing title → 400
  - 20 paragraphs → 12 items plus a sources note
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat: results webhook`.

### Task 10: Side panel UI — chat, config, presence, board-mention detector

**Files:** Create `src/panel/*.tsx` and `src/useBoardMentionDetector.ts`. Modify `src/BoardPage.tsx`.

**Interfaces:**
- Consumes: `useBoardEvents` (Task 4), the `/api/crews` endpoints (Task 5), `/api/mentions/board` (Task 7), the `Editor` from `<Tldraw onMount>`.
- Behaviour:
  - **Layout:** canvas full-viewport; a right panel 360 px wide that collapses to a 40 px rail with a toggle; tabs **Chat** and **Config**; `PresenceList` at the top of the panel (humans, then crews with 🤖 and a green or grey dot).
  - **ChatTab:**
    - message list with auto-scroll and three variants: human, crew (🤖 name · area), system (muted)
    - "`<Name>` is thinking…" rows from `thinking`
    - a `ref` renders as a "↗ re: label" link that runs `editor.zoomToSelection` after `editor.select(shapeId)`, or "shape no longer exists" if it's missing
    - input with `@` autocomplete over `crews` (prefix match, arrow keys and Enter/Tab to insert `@Name `); Enter sends
  - **ConfigTab:**
    - when the user has no crew: a form with the crew name and an area `<select>` (from `editor` top-level frames, kept live with `editor.store.listen`, plus "none yet")
    - when they have a crew: its status, an editable area, and the copy-blocks
    - copy-blocks (each with a copy button), using the exact env names: `BOARD_URL=<origin>`, `CREW_TOKEN=<token or "hidden — reclaim to show a new one">`, `CANVAS_MCP_URL=<origin>/mcp`, `WEBHOOK_URL=<origin>/api/webhook`, plus `uv run labs/06_canvas.py`
    - the token is kept in `sessionStorage` (`dtc.crewToken`) to show again
    - a "Lost your token? Reclaim crew" form calls reclaim
  - **useBoardMentionDetector(editor, crews, token):** when `editor.getEditingShapeId()` changes from X to something else, read `shapeText` of X. If `parseMentions` finds any crew, `POST /api/mentions/board {shapeId: X}`. Server de-duplication makes repeats harmless.

- [ ] **Step 1:** Implement the components (UI work: verified manually and by the Task 12 smoke test, not unit-tested).
- [ ] **Step 2:** `npm run build` and `npx tsc --noEmit` → clean.
- [ ] **Step 3: Manual check** in two browsers:
  - chat both ways
  - autocomplete inserts `@Name`
  - registering a crew shows the env block
  - a frame created on the canvas appears in the area dropdown within 1 s
  - with a fake listener (`npx wscat -c "ws://localhost:5173/crew/ws?token=…"`), mentioning in chat and finishing a sticky edit with `@Name` both show thinking, and sending `{"type":"reply","mentionId":…,"text":"ok","final":true}` shows the reply; for the board mention, the ↗ link pans to the sticky
- [ ] **Step 4:** Commit `feat: side panel chat, config, presence`.

### Task 11: Python listener (`board.py`)

**Files:** Replace `workshop material/starter/workshop/board.py`. Create `webapp/python-tests/test_board.py`.

**Interfaces:**
- Consumes: the crew socket protocol (`ToCrew`/`FromCrew`, Task 7).
- Produces:
  - `class Board(url: str, token: str)`, `on_mention(fn) -> fn`, `run() -> None` (blocks until Ctrl+C)
  - `class Mention: id, text, author, source, shape_id, context: MentionContext; reply(text: str) -> None`
  - `class MentionContext`: attribute access to the payload's context, with `__str__` rendering readable text ("Recent chat:\n- alice: …", "Team area: …", "Nearby notes:\n- …"). `labs/06_canvas.py` uses `str(mention.context)`.
- Behaviour:
  - converts the URL `https→wss`/`http→ws` and appends `/crew/ws`
  - connects with `websockets.sync.client.connect(uri, additional_headers={"Authorization": f"Bearer {token}"})`
  - prints `Connected as @<name> (team area: …)` on `hello`
  - answers `ping` with `pong`
  - runs the handler in a worker thread, one at a time (the server serialises anyway)
  - the handler's return value (if it's not `None`) is sent as `final:true`; `None` sends `final:true` with text "(done)"
  - an exception sends `error` with `str(e)` and prints the traceback
  - reconnects with backoff of 1, 2, 4 … up to 30 s, printing one line per attempt
  - on close code `4001`: prints "Another listener took over this crew — exiting." and returns (Review Focus 5)
  - on close code `4003` (bad token): prints "CREW_TOKEN rejected — copy it again from the Config tab." and returns
  - while the handler runs, socket sends from `reply()` go through a lock
- [ ] **Step 1: Failing tests** with an in-process `websockets.sync.server.serve` fake:
  - receives the auth header
  - a mention → the handler gets the text, and `str(context)` contains "alice"
  - the return value arrives as a `final` reply
  - `reply()` arrives as `final:false` before the final
  - an exception → an `error` message
  - the server closes with 4001 → `run()` returns within 2 s
  - the server drops the socket → the client reconnects
  - Run: `cd webapp && uv run --with pytest --with websockets pytest python-tests -q` → FAIL.
- [ ] **Step 2:** Implement → PASS. Also run `cd "workshop material/starter" && uv run python -c "from workshop.board import Board"` → no error.
- [ ] **Step 3:** Commit `feat: python crew listener`.

### Task 12: Deploy, PIN, docs, end-to-end smoke

**Files:** Create `docs/deploy.md`, `docs/participant-quickstart.md`, `webapp/e2e/smoke.spec.ts`, `webapp/.dev.vars.example`.

- [ ] **Step 1:** Write `e2e/smoke.spec.ts` (Playwright against `npm run dev`):
  - two browser contexts join with the PIN from `.dev.vars`
  - A draws a rectangle and B sees it
  - A sends chat and B sees it
  - A registers crew `SmokeCrew`
  - start a Node `ws` fake listener with the token, which replies "pong-reply"
  - B sends `@SmokeCrew hello`, and both see "pong-reply"
  - Run `npx playwright test` → PASS.
- [ ] **Step 2: Real crew check.** Point the starter's `.env` at `localhost`, run `uv run labs/06_canvas.py`, and mention it from the browser. The reply appears, and a `publish_card` webhook call shows up as a section on the canvas.
- [ ] **Step 3: Deploy.**
  - The owner runs `npx wrangler login`.
  - Generate a PIN with `python3 -c "import secrets;print(f'{secrets.randbelow(10**6):06d}')"`.
  - Run `wrangler secret put BOARD_PIN` and `wrangler secret put SESSION_SECRET` (`openssl rand -hex 32`).
  - Build with `VITE_TLDRAW_LICENSE_KEY` set, then `npm run deploy`.
- [ ] **Step 4:** Run the smoke test against the deployed URL (`BASE_URL=… npx playwright test`). Check there is no tldraw licence console error on the deployed domain.
- [ ] **Step 5:** `docs/deploy.md` covers secrets, the licence key, PIN rotation and redeploying. `docs/participant-quickstart.md` covers: open the URL → PIN → name → Config tab → copy the env block → `uv run labs/06_canvas.py` → mention your crew. Report the URL and PIN to the owner.
- [ ] **Step 6:** Commit `docs: deploy runbook and participant quickstart`.
