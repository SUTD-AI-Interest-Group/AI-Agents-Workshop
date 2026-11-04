"""STEP 3: Tools. With tools, your agents can do actions. Each tool has its own file.

These tools are ready. They connect your crew to the canvas:
    canvas_mcp.py      The MCP server of the canvas (needs CANVAS_MCP_URL and CREW_TOKEN)
    publish_card.py    Sends a result to the webhook of the canvas (or keeps it in ./outbox/)

In the workshop, you write more tools. For example:
    A custom tool that reads files from sample-files/
    A web search tool (Firecrawl)

To add a tool:
    1. Make a new file: tools/<name>.py
    2. Import the tool below.
    3. Add the tool name to __all__.
"""
from tools.canvas_mcp import canvas_mcp
from tools.publish_card import publish_card

__all__ = ["canvas_mcp", "publish_card"]
