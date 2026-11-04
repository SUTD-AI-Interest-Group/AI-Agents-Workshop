"""Custom tool: Lists the files that an agent can read."""
from crewai.tools import tool

from config import SAMPLE_FILES

ROOT = SAMPLE_FILES.resolve()


@tool("list_project_files")
def list_project_files() -> str:
    """List the files in the project folder. Use this tool first to see the files that you can read."""
    return "\n".join(sorted(p.relative_to(ROOT).as_posix() for p in ROOT.rglob("*") if p.is_file()))
