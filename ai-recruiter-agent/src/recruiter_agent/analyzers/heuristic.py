"""A no-model baseline.

It parses requirements from the job description's section headings and judges
them by skill-concept coverage in the retrieved evidence. It is fast, free and
deterministic, which makes it the default engine, the fallback when a model
call fails, and the bar the LLM engine has to beat in the evals.
"""

from __future__ import annotations

import re

from ..retrieval import tokenize
from ..schemas import Priority, Requirement, RequirementAssessment, Verdict
from ..skills import concepts_in, mentions

_NICE_HEADING = re.compile(r"prefer|nice|bonus|plus|good to have|desirable", re.I)
_MUST_HEADING = re.compile(
    r"require|must|qualification|looking for|you have|you bring|skills|about you", re.I
)
_BULLET = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+(.*)$")


def _heading_priority(line: str) -> Priority | None | bool:
    """Return a priority for a heading line, None for other headings, False for non-headings."""
    stripped = line.strip().strip("#").strip()
    is_heading = line.lstrip().startswith("#") or (
        stripped.endswith(":") or (len(stripped) < 60 and not _BULLET.match(line))
    )
    if not stripped or not is_heading:
        return False
    if _NICE_HEADING.search(stripped):
        return Priority.NICE
    if _MUST_HEADING.search(stripped):
        return Priority.MUST
    return None


def _keywords(text: str) -> list[str]:
    concepts = concepts_in(text)
    if concepts:
        return concepts
    return tokenize(text)[:4]


class HeuristicAnalyzer:
    name = "heuristic"
    model: str | None = None

    def extract_requirements(self, job_description: str) -> list[Requirement]:
        section: Priority | None = None
        saw_section = False
        bullets: list[tuple[str, Priority | None]] = []
        for line in job_description.splitlines():
            bullet = _BULLET.match(line)
            if bullet:
                bullets.append((bullet.group(1).strip(), section))
                continue
            priority = _heading_priority(line)
            if priority is not False:
                section = priority
                saw_section = saw_section or priority is not None

        requirements: list[Requirement] = []
        for text, priority in bullets:
            if saw_section and priority is None:
                continue  # responsibilities, benefits, company blurb
            requirements.append(
                Requirement(
                    id=f"R{len(requirements) + 1}",
                    text=text,
                    priority=priority or Priority.MUST,
                    keywords=_keywords(text),
                )
            )
        return requirements

    def assess(self, requirement: Requirement, evidence: list[str]) -> RequirementAssessment:
        keywords = requirement.keywords or _keywords(requirement.text)
        found = [k for k in keywords if any(mentions(p, k) for p in evidence)]
        coverage = len(found) / len(keywords) if keywords else 0.0
        if coverage >= 0.6:
            verdict = Verdict.MET
        elif found:
            verdict = Verdict.PARTIAL
        else:
            verdict = Verdict.NOT_MET
        quotes = [p for p in evidence if any(mentions(p, k) for k in found)][:2]
        missing = sorted(set(keywords) - set(found))
        rationale = f"Matched {len(found)}/{len(keywords)} skill concepts"
        rationale += f"; missing: {', '.join(missing)}." if missing else "."
        return RequirementAssessment(
            requirement_id=requirement.id, verdict=verdict, evidence=quotes, rationale=rationale
        )

    def assess_many(
        self, items: list[tuple[Requirement, list[str]]]
    ) -> tuple[list[RequirementAssessment], list[str]]:
        return [self.assess(req, ev) for req, ev in items], []

    def interview_questions(
        self,
        job_title: str | None,
        requirements: list[Requirement],
        assessments: list[RequirementAssessment],
        limit: int = 5,
    ) -> list[str]:
        by_id = {r.id: r for r in requirements}
        gaps, strengths = [], []
        for a in assessments:
            req = by_id[a.requirement_id]
            if a.verdict is not Verdict.MET:
                gaps.append(
                    f'The role asks for "{req.text.rstrip(".")}". Walk me through the most '
                    "relevant work you have done here, and what you would need to ramp up on."
                )
            elif a.evidence and req.priority is Priority.MUST:
                strengths.append(
                    f'Your resume says "{a.evidence[0].rstrip(".")}". What was your own '
                    "contribution, and how did you measure whether it worked?"
                )
        return (gaps + strengths)[:limit]
