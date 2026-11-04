"""STEP 4: The crew. This file puts the agents and tasks together.

    deep researcher -> design thinker -> solutions engineer -> product designer -> marketing lead
       research          frame             assess               design              launch
"""
from crewai import Crew, Process

from agents import deep_researcher, design_thinker, marketing_lead, product_designer, solutions_engineer
from config import llm
from memory import team_memory
from tasks import assess_task, design_task, frame_task, launch_task, research_task


def build_crew(planning: bool = False) -> Crew:
    researcher, thinker, engineer = deep_researcher(), design_thinker(), solutions_engineer()
    designer, marketer = product_designer(), marketing_lead()

    research = research_task(researcher)
    frame = frame_task(thinker, context=[research])
    assess = assess_task(engineer, context=[frame])
    design = design_task(designer, context=[frame, assess])
    launch = launch_task(marketer, context=[frame, design])

    return Crew(
        agents=[researcher, thinker, engineer, designer, marketer],
        tasks=[research, frame, assess, design, launch],
        process=Process.sequential,  # TRY: Process.hierarchical with manager_llm=llm()
        memory=team_memory(),
        planning=planning,  # Crew planning makes a plan for all the tasks before the run
        planning_llm=llm() if planning else None,
        verbose=True,
    )
