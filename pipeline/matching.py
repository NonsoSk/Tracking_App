"""
Candidate ↔ requisition matching.

Each application gets a 0-100 score built from weighted components (skills,
tools, experience, qualification, course, certifications). Weights depend on
the hiring track: graduate trainees are judged more on qualification and
course, experienced hires more on experience and skills. Components with no
requirement on the requisition are left out and the weights re-balanced, so a
requisition that asks for no certifications does not penalise anyone.

The result is fully explainable: the breakdown stored on the application
lists what matched, what is missing and why the score is what it is.
"""

from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.utils import timezone

from core.choices import DEGREE_CLASS_RANK, EDUCATION_RANK, DegreeClass, EducationLevel, NyscStatus, TRAINEE_TYPES
from core.text import best_match, db_aliases, find_in_text, normalize, term_similarity

WEIGHTS = {
    "experienced": {"skills": 30, "tools": 15, "experience": 25, "education": 10, "course": 10, "certifications": 10},
    "trainee": {"skills": 20, "tools": 10, "experience": 5, "education": 25, "course": 30, "certifications": 10},
}

COMPONENT_LABELS = {
    "skills": "Skills",
    "tools": "Tools & software",
    "experience": "Experience",
    "education": "Qualification",
    "course": "Course of study",
    "certifications": "Certifications",
}

GRADES = [(80, "A", "Strong match"), (65, "B", "Good match"), (50, "C", "Fair match"), (0, "D", "Weak match")]


def grade_for(score: float) -> tuple[str, str]:
    for threshold, grade, label in GRADES:
        if score >= threshold:
            return grade, label
    return "D", "Weak match"


def _match_terms(required: list[str], candidate_terms: list[str], cv_text_norm: str, aliases) -> tuple[list, list]:
    """Return (matched, missing). ``matched`` items are dicts with evidence."""
    matched, missing = [], []
    for term in required:
        hit, similarity = best_match(term, candidate_terms, threshold=0.8)
        if hit:
            matched.append({"term": term, "evidence": hit if normalize(hit) != normalize(term) else "profile",
                            "confidence": round(similarity, 2)})
        elif cv_text_norm and find_in_text(term, cv_text_norm, aliases):
            matched.append({"term": term, "evidence": "mentioned in CV", "confidence": 0.9})
        else:
            missing.append(term)
    return matched, missing


def education_score(candidate_level: str, required_level: str) -> float:
    if not required_level:
        return 1.0
    if not candidate_level:
        return 0.0
    rank = dict(EDUCATION_RANK)
    if settings.RECRUITMENT["HND_EQUIVALENT_TO_BSC"]:
        rank[EducationLevel.HND] = rank[EducationLevel.BSC]
    gap = rank.get(required_level, 0) - rank.get(candidate_level, 0)
    if gap <= 0:
        return 1.0
    if gap == 1:
        return 0.6
    if gap == 2:
        return 0.25
    return 0.0


def experience_score(years: float, minimum: int, maximum: int | None) -> float:
    if minimum <= 0:
        base = 1.0
    elif years >= minimum:
        base = 1.0
    else:
        base = max(0.0, years / minimum)
    if maximum and years > maximum + 5:
        base *= 0.85  # heavily over-qualified for the grade
    return base


def compute_match(requisition, candidate) -> dict:
    track = "trainee" if requisition.employment_type in TRAINEE_TYPES else "experienced"
    weights = WEIGHTS[track]
    aliases = db_aliases()
    cv_norm = normalize(" ".join([candidate.cv_text or "", candidate.summary or ""]))
    candidate_skills = list(candidate.skills or []) + list(candidate.tools or [])
    candidate_tools = list(candidate.tools or []) + list(candidate.skills or [])
    candidate_certs = list(candidate.certifications or [])
    years = float(candidate.years_experience or 0)

    components = {}
    flags = []

    # Skills: required count fully, nice-to-have count half.
    required = list(requisition.required_skills or [])
    preferred = list(requisition.preferred_skills or [])
    if required or preferred:
        req_matched, req_missing = _match_terms(required, candidate_skills, cv_norm, aliases)
        pref_matched, pref_missing = _match_terms(preferred, candidate_skills, cv_norm, aliases)
        denominator = len(required) + 0.5 * len(preferred)
        value = (len(req_matched) + 0.5 * len(pref_matched)) / denominator if denominator else 1.0
        components["skills"] = {
            "score": value,
            "matched": req_matched + [dict(m, preferred=True) for m in pref_matched],
            "missing": req_missing,
            "missing_preferred": pref_missing,
            "detail": f"{len(req_matched)}/{len(required)} required" + (
                f", {len(pref_matched)}/{len(preferred)} nice-to-have" if preferred else ""),
        }
        if required and len(req_missing) > len(required) / 2:
            flags.append(f"Missing {len(req_missing)} of {len(required)} required skills")

    tools = list(requisition.tools or [])
    if tools:
        matched, missing = _match_terms(tools, candidate_tools, cv_norm, aliases)
        components["tools"] = {"score": len(matched) / len(tools), "matched": matched, "missing": missing,
                               "detail": f"{len(matched)}/{len(tools)} tools"}

    certs = list(requisition.certifications or [])
    if certs:
        matched, missing = _match_terms(certs, candidate_certs + candidate_skills, cv_norm, aliases)
        components["certifications"] = {"score": len(matched) / len(certs), "matched": matched, "missing": missing,
                                        "detail": f"{len(matched)}/{len(certs)} certifications"}

    if requisition.education_level or requisition.min_degree_class:
        value = education_score(candidate.highest_qualification, requisition.education_level)
        have = EducationLevel(candidate.highest_qualification).label if candidate.highest_qualification else "Not stated"
        detail = f"{have} vs {requisition.get_education_level_display()}"
        if value < 1:
            flags.append("Below minimum qualification" if candidate.highest_qualification else "Qualification not stated")
        if requisition.min_degree_class:
            required_rank = DEGREE_CLASS_RANK.get(requisition.min_degree_class, 0)
            have_rank = DEGREE_CLASS_RANK.get(candidate.degree_class)
            if have_rank is None:
                value *= 0.8
                detail += " · class of degree not stated"
                flags.append("Class of degree not stated")
            elif have_rank < required_rank:
                value *= 0.4
                detail += f" · {DegreeClass(candidate.degree_class).label} (below {requisition.get_min_degree_class_display()})"
                flags.append("Below required class of degree")
            else:
                detail += f" · {DegreeClass(candidate.degree_class).label}"
        components["education"] = {"score": value, "detail": detail}

    if requisition.requires_nysc and candidate.nysc_status not in {NyscStatus.COMPLETED, NyscStatus.EXEMPTED}:
        flags.append("NYSC not completed" if candidate.nysc_status else "NYSC status not stated")

    courses = list(requisition.courses or [])
    if courses:
        studied = [c for c in [candidate.course] + [e.get("course", "") for e in candidate.education_history or []] if c]
        best, best_course = 0.0, ""
        for accepted in courses:
            for course in studied:
                sim = term_similarity(accepted, course)
                if sim > best:
                    best, best_course = sim, accepted
        if best < 0.8 and cv_norm:
            hit = next((c for c in courses if find_in_text(c, cv_norm, aliases)), None)
            if hit:
                best, best_course = 0.7, hit
        components["course"] = {
            "score": best if best >= 0.5 else 0.0,
            "detail": f"{candidate.course or 'Not stated'}" + (f" ≈ {best_course}" if best_course and best >= 0.5 else
                                                               " — not in accepted courses"),
        }
        if best < 0.5:
            flags.append("Course not in accepted list")

    minimum = requisition.min_experience_years or 0
    if minimum or track == "experienced":
        value = experience_score(years, minimum, requisition.max_experience_years)
        # Years only count fully when the background is relevant (skills or course match;
        # tools only when neither is specified, since tools like Excel are generic).
        signals = [components[k]["score"] for k in ("skills", "course") if k in components]
        if not signals and "tools" in components:
            signals = [components["tools"]["score"]]
        relevance = max(signals) if signals else 1.0
        adjusted = value * max(0.3, min(1.0, relevance / 0.5))
        detail = f"{years:g} yrs vs {minimum}+ required"
        if adjusted < value:
            detail += " · weighted for relevance"
        components["experience"] = {"score": adjusted, "detail": detail}
        if minimum and years < minimum:
            flags.append(f"Experience below minimum ({years:g} of {minimum} years)")

    total_weight = sum(weights[k] for k in components)
    score = sum(weights[k] * components[k]["score"] for k in components) / total_weight * 100 if total_weight else 0
    score = round(score, 1)
    for key, comp in components.items():
        comp["weight"] = round(weights[key] / total_weight * 100, 1) if total_weight else 0
        comp["points"] = round(comp["weight"] * comp["score"], 1)
        comp["score"] = round(comp["score"], 3)
        comp["label"] = COMPONENT_LABELS[key]

    grade, label = grade_for(score)
    order = ["skills", "tools", "experience", "education", "course", "certifications"]
    return {
        "score": score,
        "grade": grade,
        "grade_label": label,
        "track": track,
        "components": {k: components[k] for k in order if k in components},
        "flags": flags,
    }


def score_application(application, save: bool = True) -> dict:
    result = compute_match(application.requisition, application.candidate)
    application.match_score = Decimal(str(result["score"]))
    application.match_grade = result["grade"]
    application.match_breakdown = result
    application.matched_at = timezone.now()
    if save:
        application.save(update_fields=["match_score", "match_grade", "match_breakdown", "matched_at", "updated_at"])
    return result


def rescore_requisition(requisition) -> int:
    count = 0
    for application in requisition.applications.select_related("candidate", "requisition"):
        score_application(application)
        count += 1
    return count


def rescore_candidate(candidate) -> int:
    count = 0
    for application in candidate.applications.select_related("requisition", "candidate"):
        score_application(application)
        count += 1
    return count
