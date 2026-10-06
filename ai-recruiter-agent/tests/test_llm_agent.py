"""The LLM engine end to end, with a scripted model standing in for the LLM."""

import re

from conftest import ScriptedChatModel, as_json

from recruiter_agent.analyzers.llm import LLMAnalyzer
from recruiter_agent.graph import ScreeningAgent
from recruiter_agent.schemas import Recommendation, ScreeningRequest, Verdict

REQUIREMENTS = {
    "requirements": [
        {
            "id": "x",
            "text": "Python backend engineering",
            "priority": "must_have",
            "keywords": ["python"],
        },
        {
            "id": "y",
            "text": "Production LLM applications",
            "priority": "must_have",
            "keywords": ["llm"],
        },
        {"id": "z", "text": "Kubernetes", "priority": "nice_to_have", "keywords": ["kubernetes"]},
    ]
}


def _assess(prompt: str) -> str:
    requirement = re.search(r"Requirement \(\w+\): (.*)", prompt).group(1)
    if requirement.startswith("Python"):
        return as_json(
            {
                "verdict": "met",
                "evidence": ["6 years building Python backend systems"],
                "rationale": "Six years of Python backend work.",
            }
        )
    if requirement.startswith("Production LLM"):
        # An invented quote: the guardrail must catch it.
        return as_json(
            {
                "verdict": "met",
                "evidence": ["Led OpenAI's GPT-5 launch"],
                "rationale": "Senior LLM experience.",
            }
        )
    return "Sure! Here is my answer: it looks good."  # not JSON at all


def _agent(settings, **overrides) -> tuple[ScreeningAgent, ScriptedChatModel]:
    handlers = {
        "requirement_extraction": lambda _: as_json(REQUIREMENTS),
        "requirement_assessment": _assess,
        "interview_questions": lambda _: as_json({"questions": ["Q1?", "Q2?"]}),
    }
    handlers.update(overrides)
    model = ScriptedChatModel(handlers=handlers)
    return ScreeningAgent(LLMAnalyzer(model, model_name="scripted"), settings), model


def _screen(agent, ai_job, resume):
    return agent.screen(ScreeningRequest(job_description=ai_job, resume=resume("c01")))


def test_llm_pipeline_with_guardrails(settings, ai_job, resume):
    agent, model = _agent(settings)
    result = _screen(agent, ai_job, resume)

    assert [r.id for r in result.requirements] == ["R1", "R2", "R3"]  # re-numbered
    python, llm, k8s = result.assessments
    assert (python.verdict, python.evidence_verified) == (Verdict.MET, True)
    # The invented quote is downgraded from met to partial and flagged.
    assert (llm.verdict, llm.evidence_verified) == (Verdict.PARTIAL, False)
    # Unparseable output falls back to the baseline instead of failing the request.
    assert k8s.rationale.startswith("Matched")
    assert result.requires_human_review
    assert any("R2" in r for r in result.review_reasons)
    assert any("R3" in r and "baseline" in r for r in result.review_reasons)
    assert result.recommendation is Recommendation.HOLD
    assert result.interview_questions == ["Q1?", "Q2?"]
    assert result.engine == "llm" and result.model == "scripted"


def test_model_never_sees_pii_or_protected_attributes(settings, ai_job, resume):
    agent, model = _agent(settings)
    agent.screen(ScreeningRequest(job_description=ai_job, resume=resume("c12")))
    sent = "\n".join(model.prompts)
    for secret in (
        "Age: 45",
        "Female",
        "Married",
        "helen.ba@example.com",
        "555-0199",
        "helen-example",
    ):
        assert secret not in sent


def test_falls_back_to_baseline_parser_when_extraction_fails(settings, ai_job, resume):
    agent, _ = _agent(settings, requirement_extraction=lambda _: "not json")
    result = _screen(agent, ai_job, resume)
    assert len(result.requirements) == 8  # the baseline parser's reading of the job
    assert any("baseline parser" in r for r in result.review_reasons)
