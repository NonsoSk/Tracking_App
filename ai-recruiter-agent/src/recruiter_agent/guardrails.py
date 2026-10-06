"""Deterministic guardrails around the model.

* ``redact`` strips contact details and protected attributes before any model
  sees the resume, so they cannot influence the assessment.
* ``detect_injection`` flags resumes that try to instruct the screener.
* ``verify_citations`` checks that every quote the model cites really is in the
  resume, and downgrades "met" verdicts that rest on invented evidence.
"""

from __future__ import annotations

import re
import unicodedata

from .schemas import RequirementAssessment, Verdict

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_URL = re.compile(r"(?:https?://|www\.)\S+|\b(?:linkedin|github)\.com/\S+", re.I)
_PHONE_CANDIDATE = re.compile(r"\+?\(?\d[\d\s().-]{7,}\d")
_PROTECTED_LINE = re.compile(
    r"^[ \t]*(?:age|date of birth|dob|gender|sex|marital status|nationality|religion|race|"
    r"ethnicity|pronouns)[ \t]*[:\-].*$",
    re.I | re.M,
)

_INJECTION = re.compile(
    r"ignore (?:all |any )?(?:previous|prior|above) instructions|disregard (?:the|all|previous)"
    r"|you are now|system prompt|rate (?:this|me|the) candidate|recommend (?:advance|hiring)"
    r"|as an ai (?:model|assistant)",
    re.I,
)


def redact(text: str) -> tuple[str, dict[str, int]]:
    """Return the text with PII and protected attributes removed, plus counts."""
    counts = {"email": 0, "url": 0, "phone": 0, "protected_attribute": 0}

    text, counts["protected_attribute"] = _PROTECTED_LINE.subn("[REDACTED ATTRIBUTE]", text)
    text, counts["email"] = _EMAIL.subn("[EMAIL]", text)
    text, counts["url"] = _URL.subn("[URL]", text)

    def _phone(match: re.Match[str]) -> str:
        digits = sum(ch.isdigit() for ch in match.group())
        # 9+ digits: a phone number; fewer is usually a date range like 2019-2023.
        if 9 <= digits <= 15:
            counts["phone"] += 1
            return "[PHONE]"
        return match.group()

    text = _PHONE_CANDIDATE.sub(_phone, text)
    return text, counts


def detect_injection(text: str) -> list[str]:
    return [m.group() for m in _INJECTION.finditer(text)]


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    text = text.replace("–", "-").replace("—", "-")
    text = re.sub(r"[\"'‘’“”`]", "", text)
    return re.sub(r"\s+", " ", text).strip(" .-*•")


def quote_in_source(quote: str, source: str) -> bool:
    """True if the quote (or each part of an elided quote) appears in the source."""
    normalized_source = _normalize(source)
    parts = [p for p in re.split(r"\.\.\.|…", quote) if p.strip()]
    return bool(parts) and all(_normalize(p) in normalized_source for p in parts)


def verify_citations(
    assessments: list[RequirementAssessment], source: str
) -> list[RequirementAssessment]:
    verified: list[RequirementAssessment] = []
    for a in assessments:
        ok = all(quote_in_source(q, source) for q in a.evidence)
        if a.verdict is not Verdict.NOT_MET and not a.evidence:
            ok = False
        if ok:
            verified.append(a)
            continue
        verdict = Verdict.PARTIAL if a.verdict is Verdict.MET else a.verdict
        note = "Evidence could not be found verbatim in the resume."
        verified.append(
            a.model_copy(
                update={
                    "verdict": verdict,
                    "evidence_verified": False,
                    "rationale": f"{a.rationale} {note}".strip(),
                }
            )
        )
    return verified
