"""Tests for the crew listener (workshop material/starter/board.py) against an in-process fake board server."""
import importlib.util
import json
import pathlib
import queue
import threading
import time

import pytest
from websockets.sync.server import serve

ROOT = pathlib.Path(__file__).resolve().parents[2]
BOARD_PY = ROOT / "workshop material" / "starter" / "board.py"


def load_board():
    spec = importlib.util.spec_from_file_location("board_under_test", BOARD_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class FakeServer:
    """Accepts crew sockets on /crew/ws; records headers and messages; scripted per-connection behaviour."""

    def __init__(self, on_connect):
        self.on_connect = on_connect
        self.connections = 0
        self.headers = []
        self.received = queue.Queue()
        self.server = serve(self._handler, "127.0.0.1", 0)
        self.port = self.server.socket.getsockname()[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.port}"

    def _handler(self, ws):
        self.connections += 1
        self.headers.append(ws.request.headers)
        self.on_connect(self, ws, self.connections)

    def pump(self, ws):
        for raw in ws:
            self.received.put(json.loads(raw))

    def next(self, timeout=3):
        return self.received.get(timeout=timeout)

    def close(self):
        self.server.shutdown()


HELLO = {"type": "hello", "crew": {"id": "c1", "name": "FalconCrew", "areaId": None, "areaName": "Team Falcon", "ownerUserId": "u", "online": True, "busy": False}}


def mention(mid="m1", text="@FalconCrew hi"):
    return {
        "type": "mention", "id": mid, "source": "chat", "text": text, "author": "alice", "hop": 0,
        "context": {"recentChat": [{"author": "alice", "text": text}], "area": {"id": "shape:a", "name": "Team Falcon"}, "nearby": ["idea one"]},
    }


def run_in_thread(board):
    t = threading.Thread(target=board.run, daemon=True)
    t.start()
    return t


def test_sends_bearer_token_and_relays_reply_and_final():
    def on_connect(srv, ws, n):
        ws.send(json.dumps(HELLO))
        ws.send(json.dumps(mention()))
        srv.pump(ws)

    srv = FakeServer(on_connect)
    mod = load_board()
    board = mod.Board(url=srv.url, token="crw_test")
    seen = {}

    @board.on_mention
    def handle(m):
        seen["text"] = m.text
        seen["author"] = m.author
        seen["context"] = str(m.context)
        m.reply("working on it")
        return "final answer"

    run_in_thread(board)
    progress = srv.next()
    final = srv.next()
    assert srv.headers[0]["Authorization"] == "Bearer crw_test"
    assert progress == {"type": "reply", "mentionId": "m1", "text": "working on it", "final": False}
    assert final == {"type": "reply", "mentionId": "m1", "text": "final answer", "final": True}
    assert seen["text"] == "@FalconCrew hi" and seen["author"] == "alice"
    assert "alice" in seen["context"] and "Team Falcon" in seen["context"] and "idea one" in seen["context"]
    board.stop()
    srv.close()


def test_handler_exception_sends_error():
    def on_connect(srv, ws, n):
        ws.send(json.dumps(HELLO))
        ws.send(json.dumps(mention()))
        srv.pump(ws)

    srv = FakeServer(on_connect)
    board = load_board().Board(url=srv.url, token="t")

    @board.on_mention
    def handle(m):
        raise RuntimeError("boom")

    run_in_thread(board)
    assert srv.next() == {"type": "error", "mentionId": "m1", "message": "boom"}
    board.stop()
    srv.close()


def test_none_return_sends_done():
    def on_connect(srv, ws, n):
        ws.send(json.dumps(HELLO))
        ws.send(json.dumps(mention()))
        srv.pump(ws)

    srv = FakeServer(on_connect)
    board = load_board().Board(url=srv.url, token="t")
    board.on_mention(lambda m: None)
    run_in_thread(board)
    assert srv.next() == {"type": "reply", "mentionId": "m1", "text": "(done)", "final": True}
    board.stop()
    srv.close()


def test_answers_ping_with_pong():
    def on_connect(srv, ws, n):
        ws.send(json.dumps(HELLO))
        ws.send(json.dumps({"type": "ping"}))
        srv.pump(ws)

    srv = FakeServer(on_connect)
    board = load_board().Board(url=srv.url, token="t")
    board.on_mention(lambda m: "x")
    run_in_thread(board)
    assert srv.next() == {"type": "pong"}
    board.stop()
    srv.close()


@pytest.mark.parametrize("code", [4001, 4003])
def test_run_returns_on_replaced_or_bad_token(code):
    def on_connect(srv, ws, n):
        ws.close(code, "bye")

    srv = FakeServer(on_connect)
    board = load_board().Board(url=srv.url, token="t")
    board.on_mention(lambda m: "x")
    t = run_in_thread(board)
    t.join(timeout=2)
    assert not t.is_alive()
    assert srv.connections == 1
    srv.close()


def test_reconnects_after_drop():
    def on_connect(srv, ws, n):
        if n == 1:
            ws.close(1011, "server restart")
            return
        ws.send(json.dumps(HELLO))
        srv.pump(ws)

    srv = FakeServer(on_connect)
    mod = load_board()
    board = mod.Board(url=srv.url, token="t")
    board._backoff_start = 0.05  # keep the test fast
    board.on_mention(lambda m: "x")
    run_in_thread(board)
    deadline = time.time() + 3
    while srv.connections < 2 and time.time() < deadline:
        time.sleep(0.05)
    assert srv.connections >= 2
    board.stop()
    srv.close()


def test_url_conversion():
    mod = load_board()
    assert mod.Board(url="https://x.workers.dev/", token="t").ws_url == "wss://x.workers.dev/crew/ws"
    assert mod.Board(url="http://localhost:8787", token="t").ws_url == "ws://localhost:8787/crew/ws"


class Ev:
    """Stand-in for a crewAI event: just a `type` string plus fields."""

    def __init__(self, type, **fields):
        self.type = type
        self.__dict__.update(fields)


class Agent:
    def __init__(self, role):
        self.role = role


class Task:
    def __init__(self, name=None, description=""):
        self.name = name
        self.description = description


def test_describe_event_maps_crewai_events_to_progress():
    d = load_board().describe_event
    assert d(Ev("tool_usage_started", tool_name="web_search", agent_role="Researcher")) == ("tool", "Researcher → web_search")
    assert d(Ev("mcp_tool_execution_started", tool_name="add_sticky_note", server_name="canvas", agent_role=None)) == ("mcp", "canvas · add_sticky_note")
    assert d(Ev("memory_query_started", query="lunch queues interviews", agent_role="Researcher")) == ("memory", "Searching memory: lunch queues interviews")
    assert d(Ev("memory_save_started", agent_role="Writer")) == ("memory", "Writer saved to memory")
    assert d(Ev("knowledge_search_query_started", agent_role="Researcher")) == ("knowledge", "Researcher searched knowledge")
    assert d(Ev("agent_reasoning_started", agent_role="Planner")) == ("thinking", "Planner is planning")
    assert d(Ev("llm_call_started", agent_role="Writer")) == ("thinking", "Writer is thinking")
    assert d(Ev("agent_execution_started", agent=Agent("Analyst"))) == ("agent", "Analyst started")
    assert d(Ev("task_started", task=Task(name="Research brief"))) == ("task", "Task: Research brief")
    assert d(Ev("tool_usage_error", tool_name="web_search", agent_role="Researcher", error="429")) == ("error", "web_search failed: 429")
    assert d(Ev("llm_stream_chunk")) is None


def test_crew_events_become_typed_progress_for_the_current_mention_only():
    def on_connect(srv, ws, n):
        ws.send(json.dumps(HELLO))
        ws.send(json.dumps(mention()))
        srv.pump(ws)

    srv = FakeServer(on_connect)
    mod = load_board()
    board = mod.Board(url=srv.url, token="t")
    board._on_crew_event(None, Ev("tool_usage_started", tool_name="early", agent_role="X"))  # no mention yet: ignored

    @board.on_mention
    def handle(m):
        board._on_crew_event(None, Ev("tool_usage_started", tool_name="web_search", agent_role="Researcher"))
        board._on_crew_event(None, Ev("llm_call_started", agent_role="Writer"))
        board._on_crew_event(None, Ev("llm_call_started", agent_role="Writer"))  # duplicate: dropped
        board._on_crew_event(None, Ev("memory_query_started", query="q", agent_role="Writer"))
        return "done"

    run_in_thread(board)
    got = [srv.next() for _ in range(4)]
    assert got[:3] == [
        {"type": "reply", "mentionId": "m1", "text": "Researcher → web_search", "final": False, "kind": "tool"},
        {"type": "reply", "mentionId": "m1", "text": "Writer is thinking", "final": False, "kind": "thinking"},
        {"type": "reply", "mentionId": "m1", "text": "Searching memory: q", "final": False, "kind": "memory"},
    ]
    assert got[3]["final"] is True
    board._on_crew_event(None, Ev("tool_usage_started", tool_name="late", agent_role="X"))  # after: ignored
    with pytest.raises(queue.Empty):
        srv.next(timeout=0.3)
    board.stop()
    srv.close()
