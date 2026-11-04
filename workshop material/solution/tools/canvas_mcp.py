"""MCP: The connection to the MCP server of the canvas.

The canvas has tools such as list_team_areas, get_area_content, add_sticky_note and
post_chat_message. crewAI finds these tools automatically. To use them, add Agent(mcps=canvas_mcp()).
Your agents see them as canvas_list_team_areas, canvas_add_sticky_note, and so on.
"""
from crewai.mcp import MCPServerHTTP

from config import CANVAS_MCP_URL, CREW_TOKEN


def _short_canvas_tool_names() -> None:
    """crewAI puts the server address in front of each MCP tool name and cuts names at 64
    characters. With the long canvas address, every tool name became an unreadable hash.
    This makes the prefix "canvas" for the canvas server only. Other MCP servers keep
    crewAI's default names. (Uses a crewAI internal: crewai is pinned in pyproject.toml.)"""
    try:
        from crewai.mcp.tool_resolver import MCPToolResolver
    except ImportError:
        return
    default = MCPToolResolver._extract_server_name
    if getattr(default, "_canvas", False):
        return  # already done

    def server_name(url: str) -> str:
        if CANVAS_MCP_URL and url.rstrip("/") == CANVAS_MCP_URL.rstrip("/"):
            return "canvas"
        return default(url)

    server_name._canvas = True
    MCPToolResolver._extract_server_name = staticmethod(server_name)


def canvas_mcp() -> list:
    """Gives [MCPServerHTTP]. Gives [] if CANVAS_MCP_URL or CREW_TOKEN is empty in .env."""
    if not (CANVAS_MCP_URL and CREW_TOKEN):
        return []
    _short_canvas_tool_names()
    return [MCPServerHTTP(url=CANVAS_MCP_URL, headers={"Authorization": f"Bearer {CREW_TOKEN}"})]
