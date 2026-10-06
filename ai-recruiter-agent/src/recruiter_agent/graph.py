"""The screening agent, orchestrated as a LangGraph state machine.

    preprocess -> extract_requirements -> retrieve_evidence -> assess -> decide
                                                                          |
                                         interview_questions <- (not reject)
                                                  |
                                                 END

Each node is small and pure apart from its analyzer call, so nodes can be
tested, swapped or re-ordered on their own, and LangGraph gives tracing and
streaming of intermediate state for free.
"""

from __future__ import annotations

import logging
import operator
import time
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph

from .analyzers import Analyzer, HeuristicAnalyzer
from .config import Settings
from .guardrails import detect_injection, redact, verify_citations
from .prompts import PROMPT_VERSION
from .retrieval import BM25EvidenceRetriever, split_passages
from .schemas import (
    Recommendation,
    Requirement,
    RequirementAssessment,
    ScreeningRequest,
    ScreeningResult,
)
from .scoring import decide
from .skills import expand_query

log = logging.getLogger(__name__)
MIN_REQUIREMENTS = 3


class ScreeningState(TypedDict, total=False):
    job_title: str | None
    job_description: str
    resume: str
    passages: list[str]
    requirements: list[Requirement]
    evidence: dict[str, list[str]]
    assessments: list[RequirementAssessment]
    score: float
    recommendation: Recommendation
    interview_questions: list[str]
    review_reasons: Annotated[list[str], operator.add]


class ScreeningAgent:
    def __init__(self, analyzer: Analyzer, settings: Settings):
        self.analyzer = analyzer
        self.settings = settings
        self._baseline = HeuristicAnalyzer()
        self.graph = self._build()

    # -- nodes -----------------------------------------------------------------

    def _preprocess(self, state: ScreeningState) -> dict:
        resume, counts = redact(state["resume"])
        reasons = []
        hits = detect_injection(state["resume"])
        if hits:
            reasons.append(f"Possible prompt injection in resume: {hits[0]!r}.")
        log.info("redacted %s", {k: v for k, v in counts.items() if v})
        return {"resume": resume, "passages": split_passages(resume), "review_reasons": reasons}

    def _extract_requirements(self, state: ScreeningState) -> dict:
        reasons = []
        try:
            requirements = self.analyzer.extract_requirements(state["job_description"])
        except Exception as exc:
            log.warning("requirement extraction failed: %s", exc)
            requirements = []
        if len(requirements) < MIN_REQUIREMENTS and not isinstance(
            self.analyzer, HeuristicAnalyzer
        ):
            reasons.append("Requirement extraction returned too few items; used baseline parser.")
            requirements = self._baseline.extract_requirements(state["job_description"])
        if len(requirements) < MIN_REQUIREMENTS:
            reasons.append(f"Only {len(requirements)} requirements found in the job description.")
        return {"requirements": requirements, "review_reasons": reasons}

    def _retrieve_evidence(self, state: ScreeningState) -> dict:
        retriever = BM25EvidenceRetriever(passages=state["passages"], k=self.settings.retrieval_k)
        evidence = {
            req.id: [d.page_content for d in retriever.invoke(expand_query(req.text, req.keywords))]
            for req in state["requirements"]
        }
        return {"evidence": evidence}

    def _assess(self, state: ScreeningState) -> dict:
        items = [(req, state["evidence"][req.id]) for req in state["requirements"]]
        assessments, reasons = self.analyzer.assess_many(items)
        return {
            "assessments": verify_citations(assessments, state["resume"]),
            "review_reasons": reasons,
        }

    def _decide(self, state: ScreeningState) -> dict:
        value, recommendation, reasons = decide(
            state["requirements"],
            state["assessments"],
            self.settings.advance_threshold,
            self.settings.hold_threshold,
        )
        return {"score": value, "recommendation": recommendation, "review_reasons": reasons}

    def _interview_questions(self, state: ScreeningState) -> dict:
        questions = self.analyzer.interview_questions(
            state.get("job_title"), state["requirements"], state["assessments"]
        )
        return {"interview_questions": questions}

    @staticmethod
    def _route_after_decide(state: ScreeningState) -> str:
        # Skip question generation (and its model cost) for clear rejections.
        if state["recommendation"] is Recommendation.REJECT and not state.get("review_reasons"):
            return END
        return "interview_questions"

    def _build(self):
        g = StateGraph(ScreeningState)
        g.add_node("preprocess", self._preprocess)
        g.add_node("extract_requirements", self._extract_requirements)
        g.add_node("retrieve_evidence", self._retrieve_evidence)
        g.add_node("assess", self._assess)
        g.add_node("decide", self._decide)
        g.add_node("interview_questions", self._interview_questions)
        g.add_edge(START, "preprocess")
        g.add_edge("preprocess", "extract_requirements")
        g.add_edge("extract_requirements", "retrieve_evidence")
        g.add_edge("retrieve_evidence", "assess")
        g.add_edge("assess", "decide")
        g.add_conditional_edges("decide", self._route_after_decide, ["interview_questions", END])
        g.add_edge("interview_questions", END)
        return g.compile()

    # -- public API --------------------------------------------------------------

    def screen(self, request: ScreeningRequest) -> ScreeningResult:
        started = time.perf_counter()
        state: ScreeningState = self.graph.invoke(
            {
                "job_title": request.job_title,
                "job_description": request.job_description,
                "resume": request.resume,
                "review_reasons": [],
            }
        )
        reasons = list(dict.fromkeys(state.get("review_reasons", [])))
        return ScreeningResult(
            candidate_id=request.candidate_id,
            job_title=request.job_title,
            score=state["score"],
            recommendation=state["recommendation"],
            requires_human_review=bool(reasons),
            review_reasons=reasons,
            requirements=state["requirements"],
            assessments=state["assessments"],
            interview_questions=state.get("interview_questions", []),
            engine=self.analyzer.name,
            model=self.analyzer.model,
            prompt_version=PROMPT_VERSION,
            latency_ms=round((time.perf_counter() - started) * 1000),
        )
