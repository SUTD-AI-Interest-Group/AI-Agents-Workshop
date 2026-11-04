"""Run one step of the project:

    uv run main.py check              STEP 0  Check the model and the memory
    uv run main.py memory             STEP 1  Keep and find team decisions
    uv run main.py agent              STEP 2  One agent does one task
    uv run main.py tools              STEP 3  Test your tools without the model
    uv run main.py crew  [--plan]     STEP 4  Run your crew (build it in crew.py)
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

    question = "Where are we running the pilot?"  # TRY: Ask your own questions
    print(f"\nQ: {question}")
    for match in memory.recall(question, limit=3):
        print(f"  {match.score:.2f}  {match.record.content}")


def step_agent():
    from agents import default_agent
    from memory import team_memory
    from tasks import default_task

    # STEP 2: Use the agent and the task that you write in agents.py and tasks.py
    agent = default_agent()
    task = default_task(agent)
    result = Crew(agents=[agent], tasks=[task], memory=team_memory()).kickoff(inputs=INPUTS)
    show(result)


def step_tools():
    import tools

    print("Tools available:", ", ".join(tools.__all__))
    print("canvas MCP:", "configured" if tools.canvas_mcp() else "not set (add CANVAS_MCP_URL and CREW_TOKEN to .env)")
    print(tools.publish_card.run(title="Test card", content="Hello from Step 3", sources=["brief.md"]))

    # STEP 3: Test each new tool here before you give it to an agent.
    # Example: print(tools.my_tool.run(name="brief.md"))


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
        "agent": step_agent,
        "tools": step_tools,
        "crew": lambda: step_crew(plan),
        "connect": step_connect,
    }
    if step not in steps:
        sys.exit(__doc__)
    try:
        steps[step]()
    except NotImplementedError as e:
        sys.exit(f"Not built yet. {e}")
