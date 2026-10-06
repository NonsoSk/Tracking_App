"""Turns per-requirement verdicts into a score and a recommendation.

This step is deliberately deterministic. The model judges evidence; a transparent
rule a recruiter can read decides what that means, so the outcome can be
explained and audited, and thresholds can be tuned without touching prompts.
"""

from __future__ import annotations

from .schemas import Priority, Recommendation, Requirement, RequirementAssessment, Verdict

VERDICT_VALUE = {Verdict.MET: 1.0, Verdict.PARTIAL: 0.5, Verdict.NOT_MET: 0.0}
PRIORITY_WEIGHT = {Priority.MUST: 2.0, Priority.NICE: 1.0}
BORDERLINE_MARGIN = 5.0


def score(requirements: list[Requirement], assessments: list[RequirementAssessment]) -> float:
    by_id = {a.requirement_id: a for a in assessments}
    total = earned = 0.0
    for req in requirements:
        weight = PRIORITY_WEIGHT[req.priority]
        total += weight
        if req.id in by_id:
            earned += weight * VERDICT_VALUE[by_id[req.id].verdict]
    return round(100 * earned / total, 1) if total else 0.0


def decide(
    requirements: list[Requirement],
    assessments: list[RequirementAssessment],
    advance_threshold: float = 75.0,
    hold_threshold: float = 50.0,
) -> tuple[float, Recommendation, list[str]]:
    """Return (score, recommendation, review reasons)."""
    value = score(requirements, assessments)
    by_id = {a.requirement_id: a for a in assessments}
    missing_must = [
        r
        for r in requirements
        if r.priority is Priority.MUST
        and by_id.get(r.id)
        and by_id[r.id].verdict is Verdict.NOT_MET
    ]

    if not missing_must and value >= advance_threshold:
        recommendation = Recommendation.ADVANCE
    elif len(missing_must) <= 1 and value >= hold_threshold:
        recommendation = Recommendation.HOLD
    else:
        recommendation = Recommendation.REJECT

    reasons: list[str] = []
    if any(abs(value - t) < BORDERLINE_MARGIN for t in (advance_threshold, hold_threshold)):
        reasons.append(f"Score {value} is within {BORDERLINE_MARGIN} points of a threshold.")
    unverified = [a.requirement_id for a in assessments if not a.evidence_verified]
    if unverified:
        reasons.append(f"Unverified evidence for {', '.join(unverified)}.")
    return value, recommendation, reasons
