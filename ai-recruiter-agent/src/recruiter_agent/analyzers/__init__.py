"""Analyzers do the judgement work inside the screening graph.

Both implementations expose the same three methods, so the graph does not care
whether a model is involved.
"""

from __future__ import annotations

from typing import Protocol

from ..config import Settings
from ..schemas import Requirement, RequirementAssessment
from .heuristic import HeuristicAnalyzer


class Analyzer(Protocol):
    name: str
    model: str | None

    def extract_requirements(self, job_description: str) -> list[Requirement]: ...

    def assess_many(
        self, items: list[tuple[Requirement, list[str]]]
    ) -> tuple[list[RequirementAssessment], list[str]]:
        """Return assessments in input order, plus any review reasons raised."""
        ...

    def interview_questions(
        self,
        job_title: str | None,
        requirements: list[Requirement],
        assessments: list[RequirementAssessment],
        limit: int = 5,
    ) -> list[str]: ...


def build_analyzer(settings: Settings) -> Analyzer:
    if settings.engine == "heuristic":
        return HeuristicAnalyzer()
    from .llm import LLMAnalyzer, build_chat_model

    return LLMAnalyzer(
        build_chat_model(settings),
        model_name=settings.llm_model,
        max_concurrency=settings.max_concurrency,
    )


__all__ = ["Analyzer", "HeuristicAnalyzer", "build_analyzer"]
