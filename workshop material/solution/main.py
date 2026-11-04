"""Run one step of the project:

    uv run main.py check              STEP 0  Check the model and the memory
    uv run main.py memory             STEP 1  Keep and find team decisions
    uv run main.py agent [--plan]     STEP 2  One agent does one task
    uv run main.py tools              STEP 3  Test each tool, then an agent uses them
    uv run main.py crew  [--plan]     STEP 4  Run the crew of five agents
    uv run main.py connect            STEP 5  Connect your crew to the shared canvas
    uv run main.py connect --local "your question"   (Test step 5 without the canvas)
"""
import sys

from crewai import Crew

import config
from config import read_sample

INPUTS = {"brief": read_sample("brief.md"), "notes": read_sample("interviews.md")}


def step_check():
    print(f"model={config.MODEL}  embeddings={config.EMBEDDING_MODEL}")
    if not config.OPENROUTER_API_KEY:
        sys.exit("OPENROUTER_API_KEY is empty. Copy .env.example to .env, then add your key.")
    print("model says:", config.llm().call("Reply with just: ready"))
    from memory import team_memory

    team_memory().recall("test", limit=1)
    print("memory and embeddings: OK")
    for key in ["FIRECRAWL_API_KEY", "BOARD_URL", "CREW_TOKEN", "CANVAS_MCP_URL", "WEBHOOK_URL"]:
        print(f"  [{'set' if getattr(config, key) else '  '}] {key}")


def step_memory():
    from memory import TEAM_DECISIONS, team_memory

    memory = team_memory()
    for decision in TEAM_DECISIONS:
        memory.remember(decision)

    # TRY: Ask a question that memory cannot answer. Look at the result.
    question = "Where are we running the pilot?"
    print(f"\nQ: {question}")
    for match in memory.recall(question, limit=3):
        print(f"  {match.score:.2f}  {match.record.content}")


def step_agent(planning: bool):
    from agents import design_thinker
    from memory import team_memory
    from tasks import frame_task

    thinker = design_thinker(planning=planning)
    task = frame_task(thinker)
    result = Crew(agents=[thinker], tasks=[task], memory=team_memory()).kickoff(inputs=INPUTS)
    show(result)


def step_tools():
    from agents import deep_researcher
    from tasks import research_task
    from tools import (
        canvas_mcp,
        list_project_files,
        publish_card,
        read_project_file,
        search_project_files,
        web_search_tools,
    )

    print("--- Test each tool without the model")
    print(list_project_files.run())
    print(read_project_file.run(name="brief.md")[:200], "...")
    print(read_project_file.run(name="../.env"))  # The tool must refuse this path
    print(search_project_files.run(keyword="schedul"))
    for search in web_search_tools():
        print(str(search.run(query="student project teammate matching"))[:500])
    if not web_search_tools():
        print("web search: FIRECRAWL_API_KEY is empty")
    print("canvas MCP:", "configured" if canvas_mcp() else "not set (add CANVAS_MCP_URL and CREW_TOKEN to .env)")
    print(publish_card.run(title="Test card", content="Hello from Step 3", sources=["brief.md"]))

    print("\n--- The agent now selects the tools")
    researcher = deep_researcher()
    show(Crew(agents=[researcher], tasks=[research_task(researcher)]).kickoff(inputs=INPUTS))


def step_crew(planning: bool):
    from crew import build_crew

    result = build_crew(planning=planning).kickoff(inputs=INPUTS)
    for out in result.tasks_output:  # Shows each handoff. Look for information that the next agent did not get.
        print(f"\n--- {out.agent} ---\n{out.raw[:500]}")
    show(result)


def step_connect():
    from board import Board
    from crew import build_crew

    def run_crew(text: str, context: str = "") -> str:
        brief = f"{INPUTS['brief']}\n\nRequest from the canvas: {text}\n\nContext:\n{context}"
        return build_crew().kickoff(inputs={**INPUTS, "brief": brief}).raw

    if "--local" in sys.argv:
        print(run_crew(sys.argv[-1] if len(sys.argv) > 3 else "What should we build?"))
        return
    if not (config.BOARD_URL and config.CREW_TOKEN):
        sys.exit("Add BOARD_URL and CREW_TOKEN to .env. Copy them from the Config tab of the canvas.")

    board = Board(url=config.BOARD_URL, token=config.CREW_TOKEN)

    @board.on_mention
    def handle(mention):
        mention.reply("The crew is working on your request. This can take some minutes.")
        # TRY: Send quick questions to one agent. Use the full crew only for research requests.
        return run_crew(mention.text, str(mention.context))

    print(f"Listening for @mentions on {config.BOARD_URL} (Ctrl+C to stop)")
    board.run()


def show(result):
    print("\n================ RESULT ================\n")
    print(result.raw)
    print("\ntokens:", result.token_usage)


if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else ""
    plan = "--plan" in sys.argv
    steps = {
        "check": step_check,
        "memory": step_memory,
        "agent": lambda: step_agent(plan),
        "tools": step_tools,
        "crew": lambda: step_crew(plan),
        "connect": step_connect,
    }
    if step not in steps:
        sys.exit(__doc__)
    steps[step]()
