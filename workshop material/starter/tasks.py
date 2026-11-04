"""STEPS 2 TO 4: Tasks. A task is the work that an agent must do.

A good task has a clear input, one specific action and an expected_output that you can check.
main.py puts values into `{brief}` and `{notes}` with kickoff(inputs={...}).
"""
from crewai import Agent, Task


def default_task(agent: Agent) -> Task:
    """A simple task. Copy this function for each new task."""
    return Task(
        description="Brief: {brief}\n\nSummarise the brief in your own words.",
        expected_output="Three bullet points.",
        agent=agent,
    )


# Write your tasks below this line.
