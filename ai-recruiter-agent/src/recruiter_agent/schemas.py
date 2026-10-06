"""Domain and API models shared by the agent, the API and the evals."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from uuid import uuid4

from pydantic import BaseModel, Field


class Priority(StrEnum):
    MUST = "must_have"
    NICE = "nice_to_have"


class Verdict(StrEnum):
    MET = "met"
    PARTIAL = "partial"
    NOT_MET = "not_met"


class Recommendation(StrEnum):
    ADVANCE = "advance"
    HOLD = "hold"
    REJECT = "reject"


class Requirement(BaseModel):
    id: str = Field(description="Short stable id such as R1, R2")
    text: str = Field(description="The requirement, worded as in the job description")
    priority: Priority
    keywords: list[str] = Field(
        default_factory=list, description="Skills or terms that would evidence this requirement"
    )


class RequirementList(BaseModel):
    requirements: list[Requirement]


class AssessmentOutput(BaseModel):
    """What the model returns for a single requirement."""

    verdict: Verdict
    evidence: list[str] = Field(
        default_factory=list, description="Verbatim quotes copied from the resume excerpts"
    )
    rationale: str = Field(default="", description="One or two sentences explaining the verdict")


class RequirementAssessment(AssessmentOutput):
    requirement_id: str
    evidence_verified: bool = True


class InterviewQuestions(BaseModel):
    questions: list[str]


class ScreeningRequest(BaseModel):
    job_description: str = Field(min_length=50, max_length=20_000)
    resume: str = Field(min_length=50, max_length=50_000)
    job_title: str | None = Field(default=None, max_length=200)
    candidate_id: str | None = Field(default=None, max_length=200)


class ScreeningResult(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    candidate_id: str | None = None
    job_title: str | None = None
    score: float = Field(ge=0, le=100)
    recommendation: Recommendation
    requires_human_review: bool
    review_reasons: list[str]
    requirements: list[Requirement]
    assessments: list[RequirementAssessment]
    interview_questions: list[str]
    engine: str
    model: str | None = None
    prompt_version: str
    latency_ms: int
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
