# AI Agents Workshop: starter

In this workshop, you build a crew of AI agents. The crew works on one brief: **"Help SUTD students find the right project teammates."** At the end, your crew joins a shared canvas with the crews of all the other teams.

The project starts almost empty. You write the agents, tasks, tools and crew during the workshop. You can run the project after each step. `main.py` runs the parts that you have built.

The full project is in `../solution/`.

## Setup

Do these steps before the workshop.

1. Install uv. Refer to <https://docs.astral.sh/uv/getting-started/installation/>.
2. Go to the project folder:
   ```bash
   cd "workshop material/starter"
   ```
3. Install Python 3.12 and crewAI:
   ```bash
   uv sync
   ```
4. Make your settings file:
   ```bash
   cp .env.example .env
   ```
5. Open `.env`. Add your OpenRouter key to `OPENROUTER_API_KEY`. Get a key at <https://openrouter.ai/keys>.
6. Do a check of the model and the memory:
   ```bash
   uv run main.py check
   ```

All the models run through **OpenRouter**. `MODEL` sets the model for the agents. `EMBEDDING_MODEL` sets the model for memory search.

## Files

| File | Status |
|---|---|
| `config.py` | Ready. Reads the settings from `.env`. `llm()` gives the OpenRouter model. |
| `memory.py` | Ready. `team_memory()` gives the memory for your team (Step 1). |
| `tools/canvas_mcp.py` | Ready. Connects your agents to the MCP server of the canvas. |
| `tools/publish_card.py` | Ready. Sends a result to the webhook of the canvas. |
| `board.py` | Ready. Connects your crew to the canvas. The platform team supplies this file. Do not change it. |
| `agents.py` | **You write this.** It starts with `default_agent()`. |
| `tasks.py` | **You write this.** It starts with `default_task()`. |
| `tools/` | **You write this.** Put each new tool in its own file. |
| `crew.py` | **You write this.** It contains `build_crew()`. |
| `sample-files/` | The brief, interview notes, survey results and a list of existing solutions. |

## Steps

| Step | Command | What you build |
|---|---|---|
| 0 | `uv run main.py check` | Nothing. This step checks your keys. |
| 1 | `uv run main.py memory` | The decisions of your team, in `memory.py`. |
| 2 | `uv run main.py agent` | An agent in `agents.py` and a task in `tasks.py`. |
| 3 | `uv run main.py tools` | Tools in `tools/`. Then you give the tools to an agent. |
| 4 | `uv run main.py crew` | The crew in `crew.py`. Add `--plan` to turn on crew planning. |
| 5 | `uv run main.py connect` | The connection to the canvas. Add the canvas values to `.env` first. |

## Troubleshooting

| Problem | Action |
|---|---|
| Error 401 or `User not found` | Make sure that `OPENROUTER_API_KEY` in `.env` is correct. Make sure that your OpenRouter account has credits. |
| `Not built yet: ...` | The file for that step is still empty. Build it, or look at `../solution/`. |
| The agent does not use the tools | Use a `MODEL` that supports tool calling. Make the description of the tool clearer. |
| You want to start again | Delete the `.memory/` and `outbox/` folders. |

crewAI documentation: <https://docs.crewai.com>. The project uses `crewai==1.15.35`.
