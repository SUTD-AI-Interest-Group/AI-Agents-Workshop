"""STEPS 2 TO 4: Agents. An agent is the worker that does a task.

Step 2: design_thinker()    One agent with no tools. Try planning=True.
Step 3: deep_researcher()   The agent with tools.
Step 4: Three more agents make a product team of five.

Change the roles, goals, backstories and tools. Then compare the results.
"""
from crewai import Agent
from crewai.agent.planning_config import PlanningConfig

from config import llm
from tools import (
    canvas_mcp,
    list_project_files,
    publish_card,
    read_project_file,
    search_project_files,
    web_search_tools,
)


# ----------------------------------------------------------------- STEP 2
def design_thinker(planning: bool = False) -> Agent:
    return Agent(
        role="Design thinker",
        goal="Turn research into one sharp, evidence-backed problem statement",
        backstory="You run design-thinking workshops. You separate evidence from assumptions "
        "and write 'How might we...' questions.",
        llm=llm(),
        # With planning, the agent makes a plan before it starts
        planning_config=PlanningConfig(max_steps=5, reasoning_effort="low") if planning else None,
        allow_delegation=False,
        max_iter=6,  # Maximum number of loops for the agent
        verbose=True,
    )


# ----------------------------------------------------------------- STEP 3
def deep_researcher() -> Agent:
    return Agent(
        role="Deep researcher",
        goal="Find evidence about how students form project teams and what goes wrong",
        backstory="You dig through interviews and the web. You cite a file name or URL for "
        "every claim and clearly label anything you could not verify.",
        tools=[list_project_files, read_project_file, search_project_files, *web_search_tools()],
        mcps=canvas_mcp(),  # The canvas tools show here when CANVAS_MCP_URL and CREW_TOKEN are set
        llm=llm(),
        max_iter=8,
        verbose=True,
    )


# ----------------------------------------------------------------- STEP 4
def solutions_engineer() -> Agent:
    return Agent(
        role="Solutions engineer",
        goal="Judge what is technically feasible to pilot in 4 weeks with a student team",
        backstory="You've shipped many campus tools. You prefer boring, reliable tech and "
        "always name the riskiest assumption.",
        llm=llm(),
        max_iter=4,
        verbose=True,
    )


def product_designer() -> Agent:
    return Agent(
        role="Product designer",
        goal="Design the simplest user journey that solves the framed problem",
        backstory="You design for busy students on their phones. Fewer screens is better.",
        llm=llm(),
        max_iter=4,
        verbose=True,
        # TRY: mcps=canvas_mcp(). Then the designer can put its journey on the canvas.
    )


def marketing_lead() -> Agent:
    return Agent(
        role="Marketing lead",
        goal="Write a launch plan that gets the first 50 students to try the pilot",
        backstory="You grew several student clubs from zero. You know what makes students click.",
        tools=[publish_card],
        mcps=canvas_mcp(),
        llm=llm(),
        max_iter=5,
        verbose=True,
    )
