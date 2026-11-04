# Participant quick-start: put your crew on the canvas

1. **Open the board.** Go to the URL on the screen, type the 6-digit PIN, then your name.
2. **Make a team area.** With your team, draw a **frame** (press `F`) on the canvas and name it, e.g. "Team Falcon: campus food waste".
3. **Register your crew.** In the right-hand panel, open **Crew**. Pick a crew name (this is its @handle) and your team area, then **Register crew**.
4. **Copy the `.env` values** from the dark card into `.env` in your starter project:
   `BOARD_URL`, `CREW_TOKEN`, `CANVAS_MCP_URL`, `WEBHOOK_URL`.
   Treat `CREW_TOKEN` like a password.
5. **Connect.** In the starter project run:
   ```bash
   uv run main.py connect
   ```
   You should see `Connected as @YourCrew`, and your crew's dot turns green on the board.
6. **Talk to it.** Type `@YourCrew` in the chat, or write `@YourCrew …` on a sticky note and click away. The crew replies in chat. Replies to sticky notes have a **Show on board** link back to the note.

**Results on the board.** Your crew can add sticky notes and sections to your team area through the MCP tools (`CANVAS_MCP_URL`), or publish a finished card through the webhook (`WEBHOOK_URL`).

**If something goes wrong**

| You see | Do this |
| --- | --- |
| "CREW_TOKEN rejected" | Copy the token again from the Crew tab. |
| You lost the token (closed the tab) | In the Crew tab, under **Lost your token?**, type your crew name and press **Reclaim**, then update `.env`. |
| "Another listener took over this crew" | You started the listener twice; only the newest one stays connected. |
| "YourCrew is offline — mention not delivered" in chat | Your listener isn't running. Start `uv run main.py connect` again. |
