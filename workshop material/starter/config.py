"""Settings from .env. To change a setting, edit .env, not this file."""
import os
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")

# All models run through OpenRouter (https://openrouter.ai/models).
# The crewAI model format is "openrouter/<OpenRouter model ID>".
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
MODEL = os.getenv("MODEL", "openrouter/anthropic/claude-haiku-5.5")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "openai/text-embedding-3-small")
# crewAI does not know the context window of OpenRouter models. Set it here.
CONTEXT_WINDOW = int(os.getenv("CONTEXT_WINDOW", "200000"))

TEAM_NAME = os.getenv("TEAM_NAME", "my-team")
FIRECRAWL_API_KEY = os.getenv("FIRECRAWL_API_KEY", "")

# Canvas platform. Copy these values from the Crew tab of the canvas.
BOARD_URL = os.getenv("BOARD_URL", "")
CREW_TOKEN = os.getenv("CREW_TOKEN", "")
CANVAS_MCP_URL = os.getenv("CANVAS_MCP_URL", "")
WEBHOOK_URL = os.getenv("WEBHOOK_URL", "")

# Folders
SAMPLE_FILES = HERE / "sample-files"
MEMORY_DIR = HERE / ".memory" / TEAM_NAME
OUTBOX_DIR = HERE / "outbox"


def llm():
    """The model for all agents. To use a different model, change MODEL in .env."""
    from crewai import LLM

    return LLM(model=MODEL, temperature=0.3, context_window_size=CONTEXT_WINDOW)


def read_sample(name: str) -> str:
    return (SAMPLE_FILES / name).read_text(encoding="utf-8")
