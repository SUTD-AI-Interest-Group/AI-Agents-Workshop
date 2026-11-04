"""STEPS 2 TO 4: Tasks. A task is the work that an agent must do.

A good task has a clear input, one specific action and an expected_output that you can check.
main.py puts values into `{brief}` and `{notes}` with kickoff(inputs={...}).
`context=[...]` sends the results of earlier tasks to a task (Step 4).
"""
from crewai import Agent, Task


# ----------------------------------------------------------------- STEP 2
def frame_task(agent: Agent, context: list[Task] | None = None) -> Task:
    return Task(
        description=(
            "Brief: {brief}\n\nInterview notes:\n{notes}\n\n"
            "Identify ONE target user and the most important problem they have forming project teams."
        ),
        expected_output="User: ...\nNeed: ...\nEvidence: (bullets, each with its source)\n"
        "Assumptions: ...\nHow might we: one question",
        agent=agent,
        context=context or [],
    )


# ----------------------------------------------------------------- STEP 3
def research_task(agent: Agent) -> Task:
    return Task(
        description=(
            "Brief: {brief}\n\nRead the files in the project folder and, if you can, search the web "
            "for existing team-matching tools. Focus on recurring pain points."
        ),
        expected_output="5-8 bullet findings, each ending with its source in [brackets], "
        "then a short 'Unverified assumptions' list.",
        agent=agent,
    )


# ----------------------------------------------------------------- STEP 4
def assess_task(agent: Agent, context: list[Task]) -> Task:
    return Task(
        description="Propose 2 solution ideas for the 'How might we' question and assess each "
        "for a 4-week pilot. Pick one.",
        expected_output="A table: idea | effort (S/M/L) | biggest risk. "
        "Then 'Recommendation: ...' with one sentence of reasoning.",
        agent=agent,
        context=context,
    )


def design_task(agent: Agent, context: list[Task]) -> Task:
    return Task(
        description="Design the user journey for the recommended idea.",
        expected_output="A numbered journey of at most 6 steps, plus the 3 screens needed, one line each.",
        agent=agent,
        context=context,
    )


def launch_task(agent: Agent, context: list[Task]) -> Task:
    return Task(
        description="Write a launch plan for the pilot. Then publish ONE card summarising the "
        "product and its key evidence with the publish_card tool.",
        expected_output="Tagline, 3 launch channels with one action each, the week-1 success "
        "metric, and the result of publishing the card.",
        agent=agent,
        context=context,
    )
