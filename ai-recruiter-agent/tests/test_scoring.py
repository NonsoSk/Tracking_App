import pytest

from recruiter_agent.schemas import (
    Priority,
    Recommendation,
    Requirement,
    RequirementAssessment,
    Verdict,
)
from recruiter_agent.scoring import decide, score

REQS = [
    Requirement(id="R1", text="Python", priority=Priority.MUST),
    Requirement(id="R2", text="LLMs", priority=Priority.MUST),
    Requirement(id="R3", text="Docker", priority=Priority.NICE),
]


def _assess(*verdicts: Verdict) -> list[RequirementAssessment]:
    return [
        RequirementAssessment(requirement_id=f"R{i}", verdict=v, evidence=["x"])
        for i, v in enumerate(verdicts, start=1)
    ]


def test_score_weights_must_haves_double():
    assert score(REQS, _assess(Verdict.MET, Verdict.MET, Verdict.NOT_MET)) == 80.0
    assert score(REQS, _assess(Verdict.NOT_MET, Verdict.NOT_MET, Verdict.MET)) == 20.0
    assert score([], []) == 0.0


@pytest.mark.parametrize(
    ("verdicts", "expected"),
    [
        ((Verdict.MET, Verdict.MET, Verdict.MET), Recommendation.ADVANCE),
        ((Verdict.MET, Verdict.PARTIAL, Verdict.MET), Recommendation.ADVANCE),  # 80
        ((Verdict.MET, Verdict.PARTIAL, Verdict.NOT_MET), Recommendation.HOLD),  # 60
        # A missing must-have caps the outcome at "hold" whatever the score.
        ((Verdict.MET, Verdict.NOT_MET, Verdict.MET), Recommendation.HOLD),
        ((Verdict.NOT_MET, Verdict.NOT_MET, Verdict.MET), Recommendation.REJECT),
    ],
)
def test_decide(verdicts, expected):
    _, recommendation, _ = decide(REQS, _assess(*verdicts))
    assert recommendation is expected


def test_borderline_scores_are_flagged_for_review():
    _, _, reasons = decide(REQS, _assess(Verdict.MET, Verdict.NOT_MET, Verdict.PARTIAL))  # 50
    assert any("threshold" in r for r in reasons)
