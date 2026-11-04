"""STEP 3: Tools. With tools, your agents can do actions. Each tool has its own file.

    list_project_files.py   Custom tool. Lists the files in sample-files/.
    read_project_file.py    Custom tool. Reads one file from sample-files/.
    search_project_files.py Custom tool. Finds the lines that contain a keyword (Step 3 exercise).
    web_search.py           Firecrawl web search (needs FIRECRAWL_API_KEY)
    canvas_mcp.py           The MCP server of the canvas (needs CANVAS_MCP_URL and CREW_TOKEN)
    publish_card.py         Sends a result to a remote webhook (or keeps it in ./outbox/)

The model reads the docstring of a tool as its description.
In the docstring, tell the model what the tool does, what to send and what it gives back.

Step 3 exercise: Participants write search_project_files.py.
They copy read_project_file.py, change the code, import it below and give it to the researcher.
"""
from tools.canvas_mcp import canvas_mcp
from tools.list_project_files import list_project_files
from tools.publish_card import publish_card
from tools.read_project_file import read_project_file
from tools.search_project_files import search_project_files
from tools.web_search import web_search_tools

__all__ = ["list_project_files", "read_project_file", "search_project_files", "web_search_tools", "canvas_mcp", "publish_card"]
