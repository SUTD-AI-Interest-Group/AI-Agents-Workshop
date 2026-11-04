"""Web search with Firecrawl (https://firecrawl.dev). This tool comes with crewAI."""
from config import FIRECRAWL_API_KEY


def web_search_tools() -> list:
    """Gives [FirecrawlSearchTool]. If FIRECRAWL_API_KEY is empty, it gives [] and the project still runs."""
    if not FIRECRAWL_API_KEY:
        return []
    from crewai_tools import FirecrawlSearchTool

    return [FirecrawlSearchTool(config={"limit": 5})]  # Firecrawl search() gets these settings
