"""Canvas listener: connects your crew to the shared Design Thinking Canvas.

    from board import Board

    board = Board(url=BOARD_URL, token=CREW_TOKEN)

    @board.on_mention
    def handle(mention):          # mention.text, mention.author, mention.context
        mention.reply("on it...") # optional progress update, posted to the global chat
        return "final answer"     # posted to the global chat when your handler returns

    board.run()                   # blocks; reconnects automatically; Ctrl+C to stop

While your handler runs, the listener also forwards what your crew is doing (task and
agent starts, thinking, tool calls, MCP tool calls, memory and knowledge lookups) from
crewAI's event bus, so people see live progress under your crew's reply. Nothing to set up.

How it works: the listener opens an *outgoing* WebSocket to the board (so it works on
any Wi-Fi, no tunnels needed). Whenever someone writes @YourCrew in the chat or on a
sticky note, the board sends the mention here and your handler runs. One mention is
handled at a time; the board queues the rest.

Only needs the standard library and `websockets` (installed with crewAI).
"""

from __future__ import annotations

import json
import queue
import threading
import time
import traceback
from typing import Any, Callable, Optional

from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect

MAX_PROGRESS = 80  # per mention; the board keeps the last 100 anyway

REPLACED = 4001  # another listener connected with the same token
BAD_TOKEN = 4003  # the token was rejected
MAX_BACKOFF = 30.0


def _short(value: Any, n: int = 80) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= n else text[: n - 1] + "…"


def describe_event(event: Any) -> Optional[tuple[str, str]]:
    """Turn a crewAI event into a (kind, text) progress line, or None to skip it."""
    kind = getattr(event, "type", "")
    role = getattr(event, "agent_role", None) or getattr(getattr(event, "agent", None), "role", None)
    if kind == "tool_usage_started":
        return "tool", f"{role} → {event.tool_name}" if role else f"Using {event.tool_name}"
    if kind in ("tool_usage_error", "mcp_tool_execution_failed"):
        return "error", f"{event.tool_name} failed: {_short(getattr(event, 'error', ''), 120)}"
    if kind == "mcp_tool_execution_started":
        return "mcp", f"{getattr(event, 'server_name', 'mcp')} · {event.tool_name}"
    if kind == "memory_query_started":
        return "memory", f"Searching memory: {_short(getattr(event, 'query', ''))}"
    if kind == "memory_retrieval_started":
        return "memory", f"{role} is recalling memories" if role else "Recalling memories"
    if kind == "memory_save_started":
        return "memory", f"{role} saved to memory" if role else "Saved to memory"
    if kind == "knowledge_search_query_started":
        return "knowledge", f"{role} searched knowledge" if role else "Searched knowledge"
    if kind == "agent_reasoning_started":
        return "thinking", f"{role} is planning" if role else "Planning"
    if kind == "llm_call_started":
        return "thinking", f"{role} is thinking" if role else "Thinking"
    if kind == "agent_execution_started":
        return "agent", f"{role} started" if role else "Agent started"
    if kind == "task_started":
        task = getattr(event, "task", None)
        name = getattr(task, "name", None) or getattr(task, "description", "")
        return "task", f"Task: {_short(name)}"
    return None


_EVENT_CLASSES = {
    "crewai.events.types.tool_usage_events": ["ToolUsageStartedEvent", "ToolUsageErrorEvent"],
    "crewai.events.types.mcp_events": ["MCPToolExecutionStartedEvent", "MCPToolExecutionFailedEvent"],
    "crewai.events.types.memory_events": ["MemoryQueryStartedEvent", "MemoryRetrievalStartedEvent", "MemorySaveStartedEvent"],
    "crewai.events.types.knowledge_events": ["KnowledgeRetrievalStartedEvent"],
    "crewai.events.types.reasoning_events": ["AgentReasoningStartedEvent"],
    "crewai.events.types.llm_events": ["LLMCallStartedEvent"],
    "crewai.events.types.agent_events": ["AgentExecutionStartedEvent"],
    "crewai.events.types.task_events": ["TaskStartedEvent"],
}
_active_board: Optional["Board"] = None
_listener_installed = False


def _install_crewai_listener() -> None:
    """Subscribe once to crewAI's event bus; events go to the board currently running."""
    global _listener_installed
    if _listener_installed:
        return
    _listener_installed = True
    try:
        import importlib

        from crewai.events import crewai_event_bus
    except Exception:
        return  # crewAI not installed: no live progress, everything else still works

    def forward(source: Any, event: Any) -> None:
        board = _active_board
        if board is not None:
            board._on_crew_event(source, event)

    for module_name, names in _EVENT_CLASSES.items():
        try:
            module = importlib.import_module(module_name)
        except Exception:
            continue
        for name in names:
            cls = getattr(module, name, None)
            if cls is not None:
                crewai_event_bus.on(cls)(forward)


class MentionContext:
    """What was around the mention. Attribute access, or str() for a prompt-ready summary."""

    def __init__(self, data: Optional[dict] = None):
        self._data = data or {}

    def __getattr__(self, name: str) -> Any:
        return self._data.get(name)

    def as_dict(self) -> dict:
        return dict(self._data)

    def __str__(self) -> str:
        parts = []
        area = self._data.get("area")
        if area:
            parts.append(f"Team area: {area.get('name')}")
        chat = self._data.get("recentChat") or []
        if chat:
            parts.append("Recent chat:\n" + "\n".join(f"- {m.get('author')}: {m.get('text')}" for m in chat))
        nearby = self._data.get("nearby") or []
        if nearby:
            parts.append("Nearby notes on the board:\n" + "\n".join(f"- {t}" for t in nearby))
        return "\n\n".join(parts) if parts else "(no extra context)"

    __repr__ = __str__


class Mention:
    """One @mention of your crew."""

    def __init__(self, board: "Board", payload: dict):
        self._board = board
        self.id: str = payload.get("id", "")
        self.text: str = payload.get("text", "")
        self.author: str = payload.get("author", "")
        self.source: str = payload.get("source", "chat")  # "chat" or "board" (a sticky note)
        self.shape_id: Optional[str] = payload.get("shapeId")
        self.context = MentionContext(payload.get("context"))

    def reply(self, text: str) -> None:
        """Post a progress update to the global chat without finishing the mention."""
        self._board._send({"type": "reply", "mentionId": self.id, "text": str(text), "final": False})

    def __repr__(self) -> str:
        return f"Mention(from={self.author!r}, source={self.source!r}, text={self.text!r})"


class Board:
    def __init__(self, url: str, token: str):
        if not url or not token:
            raise ValueError("Board needs BOARD_URL and CREW_TOKEN; copy them from the board's Crew tab.")
        self.url = url.rstrip("/")
        self.token = token.strip()
        base = self.url.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
        self.ws_url = f"{base}/crew/ws"
        self._handler: Optional[Callable[[Mention], Any]] = None
        self._ws = None
        self._send_lock = threading.Lock()
        self._stop = threading.Event()
        self._jobs: "queue.Queue[Optional[Mention]]" = queue.Queue()
        self._backoff_start = 1.0
        self._greeted = False  # set when the board says hello on the current connection
        self._current: Optional[Mention] = None
        self._progress_lock = threading.Lock()
        self._last_progress: Optional[tuple[str, str]] = None
        self._progress_sent = 0

    # ---- public API -------------------------------------------------------

    def on_mention(self, fn: Callable[[Mention], Any]) -> Callable[[Mention], Any]:
        """Decorator: register the function that handles each @mention."""
        self._handler = fn
        return fn

    def run(self) -> None:
        """Connect and handle mentions until Ctrl+C (reconnects automatically)."""
        if self._handler is None:
            raise RuntimeError("Register a handler first with @board.on_mention")
        global _active_board
        _active_board = self
        _install_crewai_listener()
        worker = threading.Thread(target=self._work, daemon=True)
        worker.start()
        backoff = self._backoff_start
        try:
            while not self._stop.is_set():
                self._greeted = False
                code = self._connect_once()
                if self._greeted:
                    backoff = self._backoff_start  # the last connection worked: retry quickly after a blip
                if code == REPLACED:
                    print("Another listener took over this crew. Exiting.")
                    return
                if code == BAD_TOKEN:
                    print("CREW_TOKEN rejected. Copy it again from the board's Crew tab.")
                    return
                if self._stop.is_set():
                    return
                print(f"Disconnected from the board. Reconnecting in {backoff:.0f}s…")
                self._stop.wait(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF) if backoff else self._backoff_start
        except KeyboardInterrupt:
            print("\nStopped.")
        finally:
            self._stop.set()
            self._jobs.put(None)

    def stop(self) -> None:
        """Stop run() from another thread."""
        self._stop.set()
        ws = self._ws
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass

    # ---- internals ----------------------------------------------------------

    def _connect_once(self) -> Optional[int]:
        """One connection lifetime. Returns the close code (None if we never connected)."""
        try:
            with connect(self.ws_url, additional_headers={"Authorization": f"Bearer {self.token}"}, open_timeout=10) as ws:
                self._ws = ws
                for raw in ws:
                    self._on_message(raw)
                return ws.close_code
        except ConnectionClosed as e:
            return e.rcvd.code if e.rcvd else None
        except (OSError, TimeoutError) as e:
            if not self._stop.is_set():
                print(f"Couldn't reach {self.url} ({e.__class__.__name__}). Is BOARD_URL right?")
            return None
        except Exception as e:  # handshake rejected, bad URL, ...
            if not self._stop.is_set():
                print(f"Connection failed: {e}")
            return None
        finally:
            self._ws = None

    def _on_message(self, raw: Any) -> None:
        try:
            msg = json.loads(raw)
        except (TypeError, ValueError):
            return
        kind = msg.get("type")
        if kind == "ping":
            self._send({"type": "pong"})
        elif kind == "hello":
            self._greeted = True
            crew = msg.get("crew") or {}
            area = crew.get("areaName") or "no team area yet"
            print(f"Connected as @{crew.get('name')} (team area: {area}). Waiting for mentions…")
        elif kind == "mention":
            m = Mention(self, msg)
            print(f"@mention from {m.author} ({m.source}): {m.text[:80]}")
            self._jobs.put(m)

    def _work(self) -> None:
        """Runs handlers one at a time, off the socket thread (crew kickoffs can take minutes)."""
        while True:
            m = self._jobs.get()
            if m is None:
                return
            with self._progress_lock:
                self._current, self._last_progress, self._progress_sent = m, None, 0
            try:
                result = self._handler(m)  # type: ignore[misc]
                text = "(done)" if result is None else str(getattr(result, "raw", result))
                self._send({"type": "reply", "mentionId": m.id, "text": text, "final": True})
            except Exception as e:
                traceback.print_exc()
                self._send({"type": "error", "mentionId": m.id, "message": str(e) or e.__class__.__name__})
            finally:
                with self._progress_lock:
                    self._current = None

    def _on_crew_event(self, source: Any, event: Any) -> None:
        """crewAI event → typed progress line on the mention being handled (deduped, capped)."""
        try:
            line = describe_event(event)
        except Exception:
            return
        if line is None:
            return
        with self._progress_lock:
            m = self._current
            if m is None or line == self._last_progress or self._progress_sent >= MAX_PROGRESS:
                return
            self._last_progress = line
            self._progress_sent += 1
        kind, text = line
        self._send({"type": "reply", "mentionId": m.id, "text": text, "final": False, "kind": kind})

    def _send(self, payload: dict) -> bool:
        ws = self._ws
        if ws is None:
            return False
        with self._send_lock:
            try:
                ws.send(json.dumps(payload))
                return True
            except Exception:
                return False
