"""The canvas MCP tools must reach the model with readable names, whatever the deploy URL.

crewAI prefixes MCP tool names with the server URL and truncates to 64 chars, so on
long hosts every tool became an opaque hash. Run with the starter's environment:
  cd "workshop material/starter" && uv run --with pytest pytest ../../webapp/python-tests/test_canvas_mcp.py
"""
import importlib
import os
import sys
from pathlib import Path

import pytest

STARTER = Path(__file__).resolve().parents[2] / "workshop material" / "starter"
LIVE = "https://design-thinking-canvas.design-thinking-canvas.workers.dev/mcp"


@pytest.fixture()
def canvas(monkeypatch):
    monkeypatch.setenv("CANVAS_MCP_URL", LIVE)
    monkeypatch.setenv("CREW_TOKEN", "crw_test")
    monkeypatch.syspath_prepend(str(STARTER))
    for name in ["config", "tools", "tools.canvas_mcp"]:
        sys.modules.pop(name, None)
    return importlib.import_module("tools.canvas_mcp")


def test_canvas_tools_get_short_readable_names_on_a_long_host(canvas):
    from crewai.mcp.tool_resolver import MCPToolResolver
    from crewai.utilities.string_utils import sanitize_tool_name

    servers = canvas.canvas_mcp()
    assert len(servers) == 1
    prefix = MCPToolResolver._extract_server_name(servers[0].url)
    assert prefix == "canvas"
    for tool in ["get_board_overview", "add_sticky_note", "wait_for_mentions"]:
        assert sanitize_tool_name(f"{prefix}_{tool}") == f"canvas_{tool}"


def test_other_mcp_servers_keep_crewai_default_names(canvas):
    from crewai.mcp.tool_resolver import MCPToolResolver

    canvas.canvas_mcp()
    assert MCPToolResolver._extract_server_name("https://mcp.example.com/sse") == "mcp_example_com_sse"
