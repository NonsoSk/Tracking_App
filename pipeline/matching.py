"""
Candidate ↔ requisition matching, strict, in the way an ATS screens and ranks.

1. Screening (must-haves). Each requirement the requisition sets must be met: the minimum qualification, the class
   of degree, one of the accepted courses, NYSC, the minimum years of experience and at least half of the required
   skills (MATCH_MIN_REQUIRED_SKILLS_PERCENT). Something the profile does not state counts as not met. A candidate
   who fails any of them is "Not eligible": score 0, grade X, ranked after everyone eligible.
2. Weighted score (0-100) from skills, tools, experience, qualification, course and certifications. Weights depend
   on the hiring track (trainees are judged more on qualification and course, experienced hires on experience and
   skills) and are spread over the criteria this requisition asks for, so they always add up to 100.

Terms count only when they truly match: the same term, an approved synonym (the knowledge base and the aliases HR
adds in the admin), or the required term written whole inside what the candidate wrote ("AutoCAD" in "AutoCAD
2D/3D"); a near spelling or a shared word is not enough. The full working is stored on the application, so HR can
see what was scored and how every point was earned.
"""

from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.utils import timezone

from core.choices import DEGREE_CLASS_RANK, EDUCATION_RANK, DegreeClass, EducationLevel, NyscStatus, TRAINEE_TYPES
from core.text import contains_phrase, db_aliases, find_in_text, normalize, tokens, variants

VERSION = 2
WEIGHTS = {
    "experienced": {"skills": 30, "tools": 15, "experience": 25, "education": 10, "course": 10, "certifications": 10},
    "trainee": {"skills": 20, "tools": 10, "experience": 5, "education": 25, "course": 30, "certifications": 10},
}
TRACK_LABELS = {"experienced": "Experienced hire", "trainee": "Graduate trainee"}
COMPONENT_LABELS = {
    "skills": "Skills", "tools": "Tools & software", "experience": "Experience", "education": "Qualification",
    "course": "Course of study", "certifications": "Certifications",
}
ORDER = ["skills", "tools", "experience", "education", "course", "certifications"]
GRADES = [(85, "A", "Excellent match"), (70, "B", "Strong match"), (55, "C", "Possible match"), (0, "D", "Weak match")]
NOT_ELIGIBLE = ("X", "Not eligible")
# Short forms of words in course names.
COURSE_WORDS = {"engg": "engineering", "eng": "engineering", "engr": "engineering", "sci": "science", "sc": "science",
                "tech": "technology", "mgt": "management", "mgmt": "management", "admin": "administration",
                "env": "environmental", "chem": "chemical", "mech": "mechanical", "elect": "electrical",
                "elec": "electrical", "comp": "computer", "petrol": "petroleum"}


def grade_for(score: float) -> tuple[str, str]:
    for threshold, grade, label in GRADES:
        if score >= threshold:
            return grade, label
    return "D", "Weak match"


def min_required_skills() -> float:
    return settings.RECRUITMENT.get("MATCH_MIN_REQUIRED_SKILLS_PERCENT", 50) / 100


# --------------------------------------------------------------------------- strict term matching
def singular(text: str) -> str:
    """Normalised text with simple plurals made singular, on both sides of a comparison ("simulations")."""
    return " ".join(w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w for w in text.split())


def strict_hit(required: str, have: list[str], aliases=None) -> tuple[str | None, str]:
    """(what the candidate wrote, how it matches) when one of ``have`` truly is the required term."""
    wanted = variants(required, aliases)
    plain = singular(normalize(required))
    wanted_one = {singular(v) for v in wanted}
    for item in have or []:
        norm = normalize(item)
        if not norm:
            continue
        if singular(norm) == plain:
            return item, "same term"
        if singular(norm) in wanted_one or wanted & variants(item, aliases):
            return item, "synonym"
        if any(len(v) >= 2 and contains_phrase(singular(norm), v) for v in wanted_one):
            return item, "includes it"
    return None, ""


def in_cv(term: str, cv_norm: str, cv_one: str, aliases) -> bool:
    return find_in_text(term, cv_norm, aliases) or any(
        len(v) >= 2 and contains_phrase(cv_one, singular(v)) for v in variants(term, aliases))


def match_terms(required: list[str], have: list[str], cv_norm: str, aliases) -> tuple[list[dict], list[str]]:
    """(found, missing). Each found item says where it was found: the profile or the CV text."""
    found, missing = [], []
    cv_one = singular(cv_norm) if cv_norm else ""
    for term in required:
        hit, how = strict_hit(term, have, aliases)
        if hit:
            found.append({"term": term, "evidence": "Profile", "wrote": hit, "how": how})
        elif cv_norm and in_cv(term, cv_norm, cv_one, aliases):
            found.append({"term": term, "evidence": "CV text", "wrote": term, "how": "written in the CV"})
        else:
            missing.append(term)
    return found, missing


def course_words(text: str) -> set[str]:
    return {COURSE_WORDS.get(t.strip("."), t.strip(".")) for t in tokens(text) if t.strip(".")}


def course_hit(accepted: list[str], studied: list[str], aliases) -> tuple[str | None, str | None, str]:
    """(accepted course, the candidate's course, how) for the first accepted course the candidate studied."""
    for wanted in accepted:
        hit, how = strict_hit(wanted, studied, aliases)
        if hit:
            return wanted, hit, how
        words = course_words(wanted)
        for course in studied:
            if words and words <= course_words(course):
                return wanted, course, "covers it"
    return None, None, ""


def course_note(accepted: str, studied: str, how: str) -> str:
    if how == "same term":
        return f"Matches “{accepted}”"
    if how == "synonym":
        return f"“{studied}” is another name for “{accepted}”"
    return f"“{studied}” covers “{accepted}”"


# --------------------------------------------------------------------------- helpers kept for other modules
def meets_education(candidate_level: str, required_level: str) -> bool:
    if not required_level:
        return True
    if not candidate_level:
        return False
    rank = dict(EDUCATION_RANK)
    if settings.RECRUITMENT["HND_EQUIVALENT_TO_BSC"]:
        rank[EducationLevel.HND] = rank[EducationLevel.BSC]
    return rank.get(candidate_level, 0) >= rank.get(required_level, 0)


def education_score(candidate_level: str, required_level: str) -> float:
    return 1.0 if meets_education(candidate_level, required_level) else 0.0


def experience_score(years: float, minimum: int, maximum: int | None) -> float:
    base = 1.0 if minimum <= 0 or years >= minimum else max(0.0, years / minimum)
    if maximum and years > maximum + 5:
        base *= 0.85  # well over the experience the grade is for
    return base


def label_of(choices, value, empty="Not stated") -> str:
    try:
        return choices(value).label if value else empty
    except ValueError:
        return value


# --------------------------------------------------------------------------- the match
def has_requirements(requisition) -> bool:
    """Whether the vacancy asks for anything a candidate can be scored on (a requisition loaded from the tracker
    has none until HR adds them)."""
    return any([requisition.required_skills, requisition.preferred_skills, requisition.tools,
                requisition.certifications, requisition.courses, requisition.education_level,
                requisition.min_degree_class, requisition.requires_nysc, requisition.min_experience_years])


def compute_match(requisition, candidate) -> dict:
    track = "trainee" if requisition.employment_type in TRAINEE_TYPES else "experienced"
    if not has_requirements(requisition):  # nothing to score against: never a score of 100 for everyone
        return {"version": VERSION, "unscored": True, "score": 0.0, "weighted_score": 0.0, "eligible": None,
                "grade": "", "grade_label": "Not scored: the vacancy has no requirements yet", "track": track,
                "track_label": TRACK_LABELS[track], "weights": {}, "screening": [], "components": {},
                "flags": ["Add the vacancy's requirements (skills, courses, qualification, experience) to score"]}
    aliases = db_aliases()
    cv_norm = normalize(" ".join([candidate.cv_text or "", candidate.summary or ""]))
    skills_have = list(candidate.skills or []) + list(candidate.tools or [])
    certs_have = list(candidate.certifications or []) + list(candidate.skills or [])
    years = None if candidate.years_experience is None else float(candidate.years_experience)
    screening, components, notes = [], {}, []

    def screen(key, label, needed, has, passed, note=""):
        screening.append({"key": key, "label": label, "needed": needed, "has": has, "passed": bool(passed),
                          "note": note})

    # ---- 1. Screening: every must-have the requisition sets
    if requisition.education_level:
        screen("qualification", "Minimum qualification", requisition.get_education_level_display(),
               label_of(EducationLevel, candidate.highest_qualification),
               meets_education(candidate.highest_qualification, requisition.education_level),
               "" if candidate.highest_qualification else "Not stated on the profile")
    if requisition.min_degree_class:
        have_rank = DEGREE_CLASS_RANK.get(candidate.degree_class)
        screen("degree_class", "Class of degree", f"{requisition.get_min_degree_class_display()} or better",
               label_of(DegreeClass, candidate.degree_class),
               have_rank is not None and have_rank >= DEGREE_CLASS_RANK.get(requisition.min_degree_class, 0),
               "" if have_rank is not None else "Not stated on the profile")
    courses = list(requisition.courses or [])
    studied = list(dict.fromkeys(c.strip() for c in [candidate.course] + [e.get("course", "") for e in
                                                                           candidate.education_history or []] if c and c.strip()))
    course_match = course_hit(courses, studied, aliases) if courses else (None, None, "")
    if courses:
        screen("course", "Accepted course", ", ".join(courses), ", ".join(studied) or "Not stated",
               course_match[0], course_note(*course_match) if course_match[0] else
               ("" if studied else "Not stated on the profile"))
    if requisition.requires_nysc:
        screen("nysc", "NYSC", "Completed or exempted", label_of(NyscStatus, candidate.nysc_status),
               candidate.nysc_status in {NyscStatus.COMPLETED, NyscStatus.EXEMPTED})
    minimum = requisition.min_experience_years or 0
    if minimum:
        screen("experience", "Minimum experience", f"{minimum}+ years",
               "Not stated" if years is None else f"{years:g} years", years is not None and years >= minimum)
    required = list(requisition.required_skills or [])
    req_found, req_missing = match_terms(required, skills_have, cv_norm, aliases)
    if required:
        need = min_required_skills()
        screen("required_skills", "Required skills", f"At least {round(need * 100)}% of {len(required)}",
               f"{len(req_found)} of {len(required)} found", len(req_found) >= need * len(required))
    eligible = all(s["passed"] for s in screening)

    # ---- 2. Weighted score
    preferred = list(requisition.preferred_skills or [])
    if required or preferred:
        pref_found, pref_missing = match_terms(preferred, skills_have, cv_norm, aliases)
        denominator = len(required) + 0.5 * len(preferred)
        components["skills"] = {
            "share": (len(req_found) + 0.5 * len(pref_found)) / denominator,
            "asked": f"{len(required)} required" + (f", {len(preferred)} nice to have (half value each)" if preferred else ""),
            "found": f"{len(req_found)} of {len(required)} required" + (
                f", {len(pref_found)} of {len(preferred)} nice to have" if preferred else ""),
            "matched": req_found + [dict(m, preferred=True) for m in pref_found],
            "missing": req_missing, "missing_preferred": pref_missing,
        }
    tools = list(requisition.tools or [])
    if tools:
        found, missing = match_terms(tools, list(candidate.tools or []) + list(candidate.skills or []), cv_norm, aliases)
        components["tools"] = {"share": len(found) / len(tools), "asked": f"{len(tools)} tools",
                               "found": f"{len(found)} of {len(tools)}", "matched": found, "missing": missing}
    certs = list(requisition.certifications or [])
    if certs:
        found, missing = match_terms(certs, certs_have, cv_norm, aliases)
        components["certifications"] = {"share": len(found) / len(certs), "asked": f"{len(certs)} certifications",
                                        "found": f"{len(found)} of {len(certs)}", "matched": found, "missing": missing}
    if requisition.education_level or requisition.min_degree_class:
        checks = [s for s in screening if s["key"] in {"qualification", "degree_class"}]
        components["education"] = {
            "share": 1.0 if all(s["passed"] for s in checks) else 0.0,
            "asked": " · ".join(s["needed"] for s in checks), "found": " · ".join(s["has"] for s in checks)}
    if courses:
        components["course"] = {"share": 1.0 if course_match[0] else 0.0, "asked": ", ".join(courses),
                                "found": course_note(*course_match) if course_match[0]
                                else (", ".join(studied) or "Not stated") + " — not an accepted course"}
    if minimum or track == "experienced":
        value = experience_score(years or 0, minimum, requisition.max_experience_years)
        # Years count in full only when the background is relevant: the skills or the course match.
        signals = [components[k]["share"] for k in ("skills", "course") if k in components]
        if not signals and "tools" in components:
            signals = [components["tools"]["share"]]
        relevance = max(signals) if signals else 1.0
        factor = max(0.3, min(1.0, relevance / 0.5))
        found = "Not stated" if years is None else f"{years:g} years"
        if factor < 1:
            found += f" · counted at {round(factor * 100)}% as the skills and course barely match"
            notes.append("Experience counted in part: the skills and course barely match the role")
        if requisition.max_experience_years and (years or 0) > requisition.max_experience_years + 5:
            found += " · well over the range for the grade"
        components["experience"] = {"share": value * factor, "asked": f"{minimum}+ years" if minimum else "Any",
                                    "found": found}

    weights = WEIGHTS[track]
    keys = [k for k in ORDER if k in components]
    total = sum(weights[k] for k in keys)
    spread = {k: round(weights[k] / total * 100, 1) for k in keys} if total else {}
    if spread:  # make the weights add up to exactly 100
        largest = max(keys, key=lambda k: spread[k])
        spread[largest] = round(spread[largest] + 100 - sum(spread.values()), 1)
    for k in keys:
        comp = components[k]
        comp.update(label=COMPONENT_LABELS[k], weight=spread[k], share=round(comp["share"], 3),
                    percent=round(comp["share"] * 100), points=round(spread[k] * comp["share"], 1))
    weighted = round(sum(components[k]["points"] for k in keys), 1) if keys else 0.0

    failed = [s for s in screening if not s["passed"]]
    if eligible:
        score, (grade, label) = weighted, grade_for(weighted)
    else:
        score, (grade, label) = 0.0, NOT_ELIGIBLE
    flags = [f"{s['label']}: {s['has']} (needs {s['needed']})" for s in failed] + notes
    return {
        "version": VERSION, "score": score, "weighted_score": weighted, "eligible": eligible, "grade": grade,
        "grade_label": label, "track": track, "track_label": TRACK_LABELS[track],
        "weights": {k: weights[k] for k in keys}, "screening": screening,
        "components": {k: components[k] for k in keys}, "flags": flags,
    }


def score_application(application, save: bool = True) -> dict:
    result = compute_match(application.requisition, application.candidate)
    application.match_score = Decimal(str(result["score"]))
    application.match_grade = result["grade"]
    application.match_breakdown = result
    application.matched_at = None if result.get("unscored") else timezone.now()
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
