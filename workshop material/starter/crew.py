"""STEP 4: The crew. This file puts the agents and tasks together.

In build_crew(), make the agents and the tasks.
Connect the tasks with context=[...]. Then return a Crew.
"""
from crewai import Crew


def build_crew(planning: bool = False) -> Crew:
    raise NotImplementedError("Write build_crew() in crew.py (Step 4).")
