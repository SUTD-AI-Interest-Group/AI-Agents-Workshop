# AI Agents Workshop: full solution

The crew has five AI agents. They work on one brief: **"Help SUTD students find the right project teammates."** The crew also connects to the shared canvas of the workshop.

Compare this project with your own code. If you are behind, copy the parts that you need.

## Setup

1. Go to the project folder:
   ```bash
   cd "workshop material/solution"
   ```
2. Install the packages:
   ```bash
   uv sync
   ```
3. Make your settings file:
   ```bash
   cp .env.example .env
   ```
4. Open `.env`. Add your `OPENROUTER_API_KEY`. You can also add a `FIRECRAWL_API_KEY` for web search.
5. Do a check of the setup:
   ```bash
   uv run main.py check
   ```

All the models run through **OpenRouter**. `MODEL` sets the model for the agents. The default is `openrouter/anthropic/claude-haiku-5.5`. `EMBEDDING_MODEL` sets the model for memory search. The default is `openai/text-embedding-3-small`.

## Project layout

```
main.py         Runs each step:  uv run main.py <step>
config.py       Reads .env. llm() gives the OpenRouter model for all agents.
memory.py       Step 1: the memory of the team
agents.py       Steps 2 to 4: the five agents
tasks.py        Steps 2 to 4: the five tasks
tools/          Step 3: one file for each tool
crew.py         Step 4: puts the agents, tasks and memory into a crew
board.py        Step 5: the connection to the canvas (from the platform team)
sample-files/   The brief, interview notes, survey results and existing solutions
```

Each step adds to the step before it. You can run each step at any time with `main.py`.

---

## Step 0: Check the setup

Command: `uv run main.py check`

This step sends one request to the model. Then it does one memory search. Both must work. Memory search uses a different model (the embedding model), so a good model reply does not prove that memory works.

## Step 1: Memory

File: `memory.py`. Command: `uv run main.py memory`

```python
Memory(
    llm=llm(),                                    # Tags and summarizes each memory
    embedder={"provider": "openrouter", ...},     # Changes text into vectors for search
    storage=".memory/<TEAM_NAME>",                # Keeps the memory on disk after a restart
)
```

- `memory.remember("...")` keeps a decision.
- `memory.recall("question", limit=3)` gives the closest matches. Each match has a score.
- You build memory first, without an agent. Thus, you can see what goes into memory and what comes out.
- Each team has its own memory folder. `TEAM_NAME` in `.env` sets the folder name.
- Steps 2 and 4 give the same memory to the crew.

**Note:** A question with no stored answer still gets a result, but with a low score. Recall finds text that has a similar meaning. It does not check if the text is true.

## Step 2: One agent and one task

Files: `agents.py` (`design_thinker`) and `tasks.py` (`frame_task`).

```bash
uv run main.py agent           # Without planning
uv run main.py agent --plan    # The agent makes a plan before it starts
```

- The **agent** is the worker. It has a `role`, a `goal`, a `backstory` and an `llm`. `max_iter=6` sets the maximum number of loops for the agent.
- The **task** is the work. The `description` has placeholders: `{brief}` and `{notes}`. The `expected_output` tells the agent the format of the result: User, Need, Evidence, Assumptions and "How might we".
- The agent does the task in a crew of one: `Crew(agents=[a], tasks=[t], memory=...)`. Then `.kickoff(inputs={...})` puts the values into the placeholders.
- **Planning agent:** `planning_config=PlanningConfig(max_steps=5, reasoning_effort="low")` tells the agent to plan its steps first. Compare the quality and the token count with the run without planning.

## Step 3: Tools

Files: `tools/` and `agents.py` (`deep_researcher`). Command: `uv run main.py tools`

First, this step runs each tool directly, without the model. Then the researcher agent selects the tools for `research_task`.

| File | Type | Function |
|---|---|---|
| `list_project_files.py` | Custom `@tool` | Lists the files in `sample-files/`. |
| `read_project_file.py` | Custom `@tool` | Reads one file. It refuses paths outside the folder. Try `../.env`. |
| `search_project_files.py` | Custom `@tool` | Finds a keyword in all the files. This is the Step 3 exercise. |
| `web_search.py` | crewAI tool | `FirecrawlSearchTool` gives the top 5 web results. If `FIRECRAWL_API_KEY` is empty, the project does not use this tool. |
| `canvas_mcp.py` | MCP server | `MCPServerHTTP` with a bearer token. crewAI finds the canvas tools automatically. |
| `publish_card.py` | Remote webhook | Sends `{event_id, crew, title, content, sources}` to `WEBHOOK_URL`. If `WEBHOOK_URL` is empty, the tool keeps the card in `outbox/`. |

Important points:
- The model reads the docstring of a tool as the tool description. Write the docstring for the model.
- When a tool has a problem, it gives an error message. It does not stop the program. Thus, the agent can try again.
- The platform uses `event_id` to find duplicate cards. If a request is sent two times, the platform keeps only one card.
- Put MCP servers in `Agent(mcps=[...])`. Put all other tools in `Agent(tools=[...])`.

## Step 4: The crew

File: `crew.py`. Command: `uv run main.py crew` (add `--plan` to turn on crew planning)

```
deep researcher -> design thinker -> solutions engineer -> product designer -> marketing lead
   research          frame             assess                design              launch
```

- `Process.sequential` runs the tasks in order. Thus, you can see each handoff. `main.py` shows the output of each task.
- `context=[...]` on a task sends the results of earlier tasks to that task. For example, `design` gets the results of `frame` and `assess`.
- The marketing lead uses `publish_card` at the end. This sends the result of the crew to the canvas.
- `memory=team_memory()` gives all the agents the decisions from Step 1.
- `--plan` turns on **crew planning**: `Crew(planning=True, planning_llm=llm())`. The crew plans all the tasks before the run starts. Agent planning (Step 2) plans the work of one agent only.

## Step 5: Connect to the canvas

Command: `uv run main.py connect`

1. Register your crew in the **Config** tab of the canvas.
2. Copy `BOARD_URL`, `CREW_TOKEN`, `CANVAS_MCP_URL` and `WEBHOOK_URL` into `.env`.
3. Run `uv run main.py connect`.

`board.py` keeps a connection open from your laptop to the platform. When a person types `@` and your crew name in the chat or on the canvas, `handle(mention)` runs the full crew on the request. The chat shows the result. Through MCP, the crew can also read the areas of other teams and add sticky notes to its own area.

To test without the canvas, run `uv run main.py connect --local "What should we build?"`.

---

## More things to try

- Send quick questions to one agent. Use the full crew only for research requests. Refer to the `TRY` comment in `main.py` (`step_connect`).
- Give `mcps=canvas_mcp()` to the product designer. Then the designer can put the user journey on the canvas as sticky notes.
- Use `Process.hierarchical` with `manager_llm=llm()`. Compare the result with the sequential run.
