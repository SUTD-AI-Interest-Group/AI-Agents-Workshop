"""Custom tool: Reads one file from the project folder. It does not read files outside the folder."""
from crewai.tools import tool

from config import SAMPLE_FILES

ROOT = SAMPLE_FILES.resolve()
MAX_CHARS = 20_000  # Keeps the tool output small for the context of the model


@tool("read_project_file")
def read_project_file(name: str) -> str:
    """Read one text file from the project folder. `name` is a file name from list_project_files, for example 'interviews.md'."""
    path = (ROOT / name).resolve()
    if not path.is_relative_to(ROOT):
        return "Error: This file is outside the project folder."
    if not path.is_file():
        return f"Error: There is no file with the name {name!r}. Use list_project_files to see the correct names."
    return path.read_text(encoding="utf-8")[:MAX_CHARS]
