"""STEP 1: Memory. The agents of your team keep information in memory between runs.

The memory is on disk in .memory/<TEAM_NAME>/. It stays after a restart.
Step 4 gives the same memory to the crew.
"""
from crewai import Memory

from config import EMBEDDING_MODEL, MEMORY_DIR, OPENROUTER_API_KEY, llm


def team_memory() -> Memory:
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    return Memory(
        llm=llm(),  # Tags and summarizes each memory
        embedder={  # Finds memories by meaning
            "provider": "openrouter",
            "config": {"api_key": OPENROUTER_API_KEY, "model_name": EMBEDDING_MODEL},
        },
        storage=str(MEMORY_DIR),
    )


# Step 1 exercise: Replace these decisions with the decisions of your team.
TEAM_DECISIONS = [
    "Our pilot is with ONE student club, not the whole school.",
    "Students do not want to install a new app. The tool must work in Telegram or in a browser.",
    "Week-1 success metric: 50 students create a profile.",
]
