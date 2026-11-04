"""Custom tool: Finds a keyword in all the files in the project folder (like grep)."""
from crewai.tools import tool

from config import SAMPLE_FILES

ROOT = SAMPLE_FILES.resolve()
MAX_MATCHES = 40


@tool("search_project_files")
def search_project_files(keyword: str) -> str:
    """Find all the lines in the project files that contain `keyword`. Upper and lower case are the same.
    Each result has this format: '<file>:<line no>: <line>'. Use this tool to find evidence quickly.
    Then use read_project_file to read the full file."""
    needle = keyword.lower().strip()
    if not needle:
        return "Error: The keyword is empty. Give a keyword."
    matches = []
    for path in sorted(p for p in ROOT.rglob("*") if p.is_file()):
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        for number, line in enumerate(lines, start=1):
            if needle in line.lower():
                matches.append(f"{path.relative_to(ROOT).as_posix()}:{number}: {line.strip()}")
    if not matches:
        return f"No lines contain {keyword!r}. Try a shorter keyword or a different keyword."
    extra = f"\n...and {len(matches) - MAX_MATCHES} more" if len(matches) > MAX_MATCHES else ""
    return "\n".join(matches[:MAX_MATCHES]) + extra
