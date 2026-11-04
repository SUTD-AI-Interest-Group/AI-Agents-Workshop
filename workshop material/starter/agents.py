"""STEPS 2 TO 4: Agents. An agent is the worker that does a task.

Put each agent in its own function. The function returns a crewAI Agent.
Thus, main.py and crew.py can make a new agent each time.
"""
from crewai import Agent

from config import llm


def default_agent() -> Agent:
    """A simple agent. Copy this function for each new agent."""
    return Agent(
        role="Assistant",
        goal="Help the team with their design project",
        backstory="You are a helpful, concise teammate.",
        llm=llm(),
        max_iter=5,  # Maximum number of loops for the agent
        verbose=True,
    )


# Write your agents below this line.
