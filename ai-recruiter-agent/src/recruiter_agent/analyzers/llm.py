"""LLM-backed analyzer built from LangChain runnables.

Every call is ``prompt | model | PydanticOutputParser`` with a retry, so it works
with any chat model, including ones without native structured output (small
local models). Per-requirement assessments run concurrently through
``Runnable.batch``. If an assessment still fails after the retry, that one
requirement falls back to the heuristic baseline and the screening is flagged
for human review instead of failing the whole request.
"""

from __future__ import annotations

import logging

from langchain_core.language_models import BaseChatModel
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import Runnable

from ..config import Settings
from ..prompts import ASSESS_REQUIREMENT, EXTRACT_REQUIREMENTS, INTERVIEW_QUESTIONS
from ..schemas import (
    AssessmentOutput,
    InterviewQuestions,
    Requirement,
    RequirementAssessment,
    RequirementList,
)
from .heuristic import HeuristicAnalyzer

log = logging.getLogger(__name__)


def build_chat_model(settings: Settings) -> BaseChatModel:
    """Create the chat model for the configured provider.

    Provider packages are imported lazily so the heuristic engine and the tests
    need neither of them installed.
    """
    if settings.llm_provider == "ollama":
        from langchain_ollama import ChatOllama

        return ChatOllama(
            model=settings.llm_model,
            base_url=settings.ollama_base_url,
            temperature=settings.temperature,
            format="json",
        )
    if settings.llm_provider == "bedrock":
        from langchain_aws import ChatBedrockConverse

        return ChatBedrockConverse(
            model=settings.llm_model,
            region_name=settings.aws_region,
            temperature=settings.temperature,
        )
    raise ValueError(f"Unknown LLM provider: {settings.llm_provider}")


def _structured(prompt: ChatPromptTemplate, llm: BaseChatModel, schema: type) -> Runnable:
    parser = PydanticOutputParser(pydantic_object=schema)
    chain = prompt.partial(format_instructions=parser.get_format_instructions()) | llm | parser
    return chain.with_retry(stop_after_attempt=2)


class LLMAnalyzer:
    name = "llm"

    def __init__(self, llm: BaseChatModel, model_name: str | None = None, max_concurrency: int = 4):
        self.model = model_name
        self.max_concurrency = max_concurrency
        self._fallback = HeuristicAnalyzer()
        self._extract = _structured(EXTRACT_REQUIREMENTS, llm, RequirementList)
        self._assess = _structured(ASSESS_REQUIREMENT, llm, AssessmentOutput)
        self._questions = _structured(INTERVIEW_QUESTIONS, llm, InterviewQuestions)

    def extract_requirements(self, job_description: str) -> list[Requirement]:
        result: RequirementList = self._extract.invoke({"job_description": job_description})
        # Re-number so ids are unique and stable whatever the model returned.
        return [
            req.model_copy(update={"id": f"R{i}"})
            for i, req in enumerate(result.requirements, start=1)
        ]

    def assess_many(
        self, items: list[tuple[Requirement, list[str]]]
    ) -> tuple[list[RequirementAssessment], list[str]]:
        inputs = [
            {
                "priority": req.priority.value,
                "requirement": req.text,
                "evidence": "\n".join(f"- {p}" for p in evidence) or "(no relevant excerpts)",
            }
            for req, evidence in items
        ]
        outputs = self._assess.batch(
            inputs, config={"max_concurrency": self.max_concurrency}, return_exceptions=True
        )
        assessments, reasons = [], []
        for (req, evidence), out in zip(items, outputs, strict=True):
            if isinstance(out, Exception):
                log.warning("assessment failed for %s: %s", req.id, out)
                reasons.append(f"Model output for {req.id} was unusable; used baseline instead.")
                assessments.append(self._fallback.assess(req, evidence))
                continue
            assessments.append(RequirementAssessment(requirement_id=req.id, **out.model_dump()))
        return assessments, reasons

    def interview_questions(
        self,
        job_title: str | None,
        requirements: list[Requirement],
        assessments: list[RequirementAssessment],
        limit: int = 5,
    ) -> list[str]:
        by_id = {r.id: r for r in requirements}
        findings = "\n".join(
            f"- [{a.verdict.value}] ({by_id[a.requirement_id].priority.value}) "
            f"{by_id[a.requirement_id].text}"
            + (f' | evidence: "{a.evidence[0]}"' if a.evidence else "")
            for a in assessments
        )
        try:
            result: InterviewQuestions = self._questions.invoke(
                {"job_title": job_title or "this role", "limit": limit, "findings": findings}
            )
            return result.questions[:limit]
        except Exception as exc:  # questions are a nice-to-have; never fail the screening
            log.warning("question generation failed: %s", exc)
            return self._fallback.interview_questions(job_title, requirements, assessments, limit)
