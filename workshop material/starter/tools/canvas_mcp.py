"""MCP: The connection to the MCP server of the canvas.

The canvas has tools such as list_team_areas, get_area_content, add_sticky_note and
post_chat_message. crewAI finds these tools automatically. To use them, add Agent(mcps=canvas_mcp()).
"""
from crewai.mcp import MCPServerHTTP

from config import CANVAS_MCP_URL, CREW_TOKEN


def canvas_mcp() -> list:
    """Gives [MCPServerHTTP]. Gives [] if CANVAS_MCP_URL or CREW_TOKEN is empty in .env."""
    if not (CANVAS_MCP_URL and CREW_TOKEN):
        return []
    return [MCPServerHTTP(url=CANVAS_MCP_URL, headers={"Authorization": f"Bearer {CREW_TOKEN}"})]
