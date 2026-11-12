"""
Candidate ↔ requisition matching, the way an ATS screens and ranks, without ruling people out on wording.

1. Key requirements, checked and shown for the hiring manager: the minimum qualification and years of experience,
   at least half of the required skills (MATCH_MIN_REQUIRED_SKILLS_PERCENT), an accepted or related course, the
   class of degree and NYSC. A detail the CV does not mention is "Not stated: confirm". Missing a key requirement
   never zeroes the score or rules anyone out: the score still counts everything the candidate has, and the hiring
   manager decides whether they stay in the running (Application.eligibility).
2. Weighted score (0-100) from what the job description asks for (each requirement and duty judged against the
   candidate's jobs by meaning: pipeline/criteria.py), skills, tools, experience, fit with the job, qualification,
   course and certifications. Weights depend on the hiring track and are spread over the criteria this requisition
   asks for (adding up to 100). For an experienced hire, the main experience the JD asks for is a key requirement and
   holds the score at 69 when only partly shown (54 when not shown): general experience is never a strong match for a
   job that asks for something specific.

A term counts when the candidate has it in any of these ways:
- the same term, or an approved synonym ("MS Word" = "Microsoft Word"; the knowledge base and HR's skill tags);
- the required term written inside what the candidate wrote ("AutoCAD" in "AutoCAD 2D/3D");
- a broader term that includes it ("Microsoft 365" covers Excel, Word and PowerPoint; HSE Level 3 covers Level 1), or
  one of its parts for a suite (Excel shows Microsoft Office use);
- similar wording in the CV ("reconciled vendor statements" for "Vendor reconciliation"): counted at 75%.
Fit with the job compares the job description and title with the candidate's summary, past roles and CV, word stems
rather than exact phrases, so what the candidate did counts even when it is not written the way the JD puts it.
The full working is stored on the application, so HR can see what was scored and how every point was earned.
"""

from __future__ import annotations

import re
from collections import Counter
from decimal import Decimal
from functools import lru_cache

from django.conf import settings
from django.utils import timezone

from core.choices import DEGREE_CLASS_RANK, EDUCATION_RANK, DegreeClass, EducationLevel, NyscStatus, TRAINEE_TYPES
from core.text import contains_phrase, db_aliases, normalize, tokens, variants

VERSION = 5
WEIGHTS = {
    "experienced": {"jd": 25, "skills": 20, "tools": 8, "experience": 15, "relevance": 10, "education": 7, "course": 8,
                    "certifications": 7},
    "trainee": {"jd": 10, "skills": 15, "tools": 8, "experience": 5, "relevance": 8, "education": 22, "course": 22,
                "certifications": 10},
}
TRACK_LABELS = {"experienced": "Experienced hire", "trainee": "Graduate trainee"}
COMPONENT_LABELS = {
    "jd": "What the JD asks for", "skills": "Skills", "tools": "Tools & software", "experience": "Experience", "relevance": "Fit with the job",
    "education": "Qualification", "course": "Course of study", "certifications": "Certifications",
}
ORDER = ["jd", "skills", "tools", "experience", "relevance", "education", "course", "certifications"]
GRADES = [(85, "A", "Excellent match"), (70, "B", "Strong match"), (55, "C", "Possible match"), (0, "D", "Weak match")]
SIMILAR_CREDIT = 0.75          # a skill found only as similar wording in the CV
RELATED_COURSE_CREDIT = 0.6    # a related course rather than an accepted one
NOT_STATED = "Not stated: confirm with the candidate"
# Short forms of words in course names.
COURSE_WORDS = {"engg": "engineering", "eng": "engineering", "engr": "engineering", "sci": "science", "sc": "science",
                "tech": "technology", "mgt": "management", "mgmt": "management", "admin": "administration",
                "env": "environmental", "chem": "chemical", "mech": "mechanical", "elect": "electrical",
                "elec": "electrical", "comp": "computer", "petrol": "petroleum", "accountancy": "accounting"}
# Words that say nothing about the job on their own (left out of "fit with the job" and similar wording).
GENERIC = set("""
a an and or the of in on to for with by at as from into within across all any other others etc including such per
via is are be been being was were will shall should must may can could would this that these those it its their our
your his her they we you he she i me my us them who which what when where how than then also well very more most
responsible responsibilities responsibility ensure ensuring ensures work working worked works team teams company
organisation organization candidate candidates year years experience experienced ability able strong good excellent
knowledge skill skills required requirement requirements minimum degree job role roles position duties duty key main
daily provide providing provides support supporting supports assist assisting assists relevant related field fields
area areas level levels new high well various general effective effectively efficient efficiently proficiency
proficient understanding plus advantage added preferred desirable using use used make making manner time timely
accurate accurately proper properly appropriate overall day days month months week weeks across staff personnel
department departments unit units section plant site office officer officers assistant manager senior junior
executive lead head intern trainee graduate supervisor specialist associate member members limited ltd plc nigeria
indorama iefcl eleme person people ensure carry carried carrying out activities activity task tasks function functions
summary description overview purpose objective objectives one two three four five six way ways review reviews note
notes receive received receiving timely etc e.g ie i.e end start prepare prepares preparing prepared
""".split())
# Where a job description moves from the work to the requirements (scored on their own: qualification, course,
# certifications, tools), so "fit with the job" looks at the work only.
REQUIREMENTS_HEADING = re.compile(
    r"^\s*(?:minimum\s+|key\s+)?(?:requirements?|qualifications?(?:\s+and\s+experience)?|education(?:al)?\b.*|"
    r"skills(?:\s+and\s+(?:competenc\w+|experience))?|person specification|what you (?:need|bring)|"
    r"experience required|required (?:skills|experience|qualifications?)|competencies)\s*:?\s*$", re.I | re.M)
TITLE_GENERIC = {"officer", "assistant", "manager", "senior", "junior", "executive", "lead", "head", "intern",
                 "trainee", "graduate", "staff", "supervisor", "specialist", "associate", "principal", "chief",
                 "deputy", "general", "team", "member", "i", "ii", "iii", "level"}
# Bare words that are also ordinary English: in the CV text they count only written as a product name ("Excel",
# capitalised, next to other office words or in a list), never "I excel at" or "a word".
AMBIGUOUS_WORDS = {"word", "excel", "access", "teams", "outlook", "office", "project", "sheets", "docs", "slides"}
OFFICE_CONTEXT = re.compile(r"microsoft|\bms\b|office|word|excel|powerpoint|outlook|access|spreadsheet|computer|"
                            r"google|software|packages?|tools?|[,/|•;]", re.I)


def grade_for(score: float) -> tuple[str, str]:
    for threshold, grade, label in GRADES:
        if score >= threshold:
            return grade, label
    return "D", "Weak match"


def min_required_skills() -> float:
    return settings.RECRUITMENT.get("MATCH_MIN_REQUIRED_SKILLS_PERCENT", 50) / 100


# --------------------------------------------------------------------------- word stems
STEM_SUFFIXES = ("ational", "ations", "ation", "ments", "ment", "ings", "ing", "ities", "ity", "ives", "ive",
                 "ers", "er", "ies", "ied", "ed", "es", "s", "ly", "al")


@lru_cache(maxsize=65536)
def stem(word: str) -> str:
    """'reconciliation', 'reconciled', 'reconciles' -> 'reconcil…' (compared by prefix, see same_stem)."""
    word = word.lower()
    if len(word) <= 4:
        return word
    for suffix in STEM_SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 4:
            return word[:-len(suffix)]
    return word


def same_stem(a: str, b: str) -> bool:
    if a == b:
        return True
    short, long_ = sorted((a, b), key=len)
    return len(short) >= 5 and long_.startswith(short)


def stems_of(text: str, *, keep_generic: bool = False) -> list[str]:
    words = re.findall(r"[a-z][a-z0-9+#]*", normalize(text))
    return [stem(w) for w in words if (keep_generic or w not in GENERIC) and (len(w) >= 3)]


def singular(text: str) -> str:
    """Normalised text with simple plurals made singular, on both sides of a comparison ("simulations")."""
    return " ".join(w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w for w in text.split())


# --------------------------------------------------------------------------- what the candidate has, read once
class Evidence:
    """Everything about a candidate that terms are looked for in, prepared once per candidate."""

    def __init__(self, candidate):
        history = [f"{(w or {}).get('job_title', '')}\n{(w or {}).get('description', '')}"
                   for w in candidate.work_history or []]
        self.raw = "\n".join(filter(None, [candidate.cv_text or "", candidate.summary or "",
                                            candidate.current_job_title or "", *history]))
        self.norm = normalize(self.raw)
        self.one = singular(self.norm)
        self.lines = [line for line in re.split(r"[\n.;•]+", self.raw) if line.strip()]
        self.line_stems = [stems_of(line) for line in self.lines]
        self.by_key: dict[str, set[int]] = {}
        for index, line_stems in enumerate(self.line_stems):
            for s in line_stems:
                self.by_key.setdefault(s[:5], set()).add(index)
                self.by_key.setdefault("=" + s, set()).add(index)
        self.titles = [t for t in [candidate.current_job_title or ""] + [
            (w or {}).get("job_title", "") for w in candidate.work_history or []] if t and t.strip()]
        self.has_story = bool(self.raw.strip() or self.titles)
        story = " ".join([candidate.summary or "", candidate.current_job_title or ""] + [
            f"{(w or {}).get('job_title', '')} {(w or {}).get('description', '')}" for w in candidate.work_history or []])
        self.story_stems = set(stems_of(story)) | {s for line in self.line_stems for s in line}
        self.story_keys: dict[str, set[str]] = {}
        for s in self.story_stems:
            self.story_keys.setdefault(s[:5], set()).add(s)

    def lines_with(self, s: str) -> set[int]:
        hits = set(self.by_key.get("=" + s, set()))
        if len(s) >= 5:
            for index in self.by_key.get(s[:5], set()):
                if any(same_stem(s, t) for t in self.line_stems[index]):
                    hits.add(index)
        return hits

    def similar(self, term: str) -> str:
        """The CV line that says the same thing in other words, or ''."""
        wanted = list(dict.fromkeys(stems_of(term)))
        if not wanted or (len(wanted) == 1 and len(wanted[0]) < 5):
            return ""  # too short to judge by its stem alone: exact matching was already tried
        common = None
        for s in wanted:
            hits = self.lines_with(s)
            common = hits if common is None else common & hits
            if not common:
                return ""
        line = self.lines[min(common)].strip()
        return line if len(line) <= 90 else line[:87] + "…"

    def has_stem(self, s: str) -> bool:
        if len(s) < 5:
            return s in self.story_stems
        return any(same_stem(s, t) for t in self.story_keys.get(s[:5], ()))


def evidence_for(candidate) -> Evidence:
    key = (candidate.pk, candidate.updated_at, len(candidate.cv_text or ""))
    cached = getattr(candidate, "_match_evidence", None)
    if cached and cached[0] == key:
        return cached[1]
    evidence = Evidence(candidate)
    candidate._match_evidence = (key, evidence)
    return evidence


# --------------------------------------------------------------------------- term matching
def strict_hit(required: str, have: list[str], aliases=None) -> tuple[str | None, str]:
    """(what the candidate wrote, how it matches) when one of ``have`` is the required term or a synonym of it."""
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


def in_cv(term: str, evidence: Evidence, aliases) -> bool:
    """The term (or a synonym) written in the CV. Ordinary words ('excel', 'word') count only as product names."""
    for v in variants(term, aliases):
        if len(v) < 2:
            continue
        if v in AMBIGUOUS_WORDS:
            for line in evidence.lines:
                if re.search(rf"\b{re.escape(v.capitalize())}\b|\b{re.escape(v.upper())}\b", line) \
                        and len(OFFICE_CONTEXT.findall(line)) >= 2:
                    return True
            continue
        if contains_phrase(evidence.norm, v) or contains_phrase(evidence.one, singular(v)):
            return True
    return False


def covering_terms(term: str, aliases=None) -> list[str]:
    """Broader terms (or a suite's parts) that also meet this one: 'Microsoft 365' for 'Microsoft Excel'."""
    from requisitions.knowledge_base import COVERED_BY

    found = []
    for v in variants(term, aliases):
        for other in COVERED_BY.get(v, ()):
            if other not in found:
                found.append(other)
    return found


def match_terms(required: list[str], have: list[str], evidence: Evidence | None, aliases) -> tuple[list[dict], list[str]]:
    """(found, missing). Each found item says where it was found, how it matches and the credit it earns."""
    found, missing = [], []
    for term in required:
        hit, how = strict_hit(term, have, aliases)
        if hit:
            found.append({"term": term, "evidence": "Profile", "wrote": hit, "how": how, "credit": 1.0})
            continue
        if evidence and in_cv(term, evidence, aliases):
            found.append({"term": term, "evidence": "CV text", "wrote": term, "how": "written in the CV", "credit": 1.0})
            continue
        cover = None
        for broader in covering_terms(term, aliases):
            hit, _ = strict_hit(broader, have, aliases)
            if hit:
                cover = ("Profile", hit)
            elif evidence and in_cv(broader, evidence, aliases):
                cover = ("CV text", broader)
            if cover:
                break
        if cover:
            found.append({"term": term, "evidence": cover[0], "wrote": cover[1],
                          "how": f"covered by “{cover[1]}”", "credit": 1.0})
            continue
        line = evidence.similar(term) if evidence else ""
        if line:
            found.append({"term": term, "evidence": "CV text", "wrote": line, "how": "similar wording in the CV",
                          "credit": SIMILAR_CREDIT})
            continue
        missing.append(term)
    return found, missing


def credit(found: list[dict]) -> float:
    return sum(item.get("credit", 1.0) for item in found)


# --------------------------------------------------------------------------- courses
def course_words(text: str) -> set[str]:
    return {COURSE_WORDS.get(t.strip("."), t.strip(".")) for t in tokens(text) if t.strip(".")}


def course_hit(accepted: list[str], studied: list[str], aliases) -> tuple[str | None, str | None, str]:
    """(accepted course, the candidate's course, how) for the first accepted course the candidate studied, or a
    course in the same family (how = "related")."""
    for wanted in accepted:
        hit, how = strict_hit(wanted, studied, aliases)
        if hit:
            return wanted, hit, how
        words = course_words(wanted)
        for course in studied:
            if words and words <= course_words(course):
                return wanted, course, "covers it"
    from requisitions.knowledge_base import COURSE_FAMILIES

    def in_family(course, family):
        have = course_words(course)
        return any(course_words(member) <= have for member in family if course_words(member))

    for wanted in accepted:
        for family in COURSE_FAMILIES:
            if not in_family(wanted, family):
                continue
            for course in studied:
                if in_family(course, family):
                    return wanted, course, "related"
    return None, None, ""


def course_note(accepted: str, studied: str, how: str) -> str:
    if how == "same term":
        return f"Matches “{accepted}”"
    if how == "synonym":
        return f"“{studied}” is another name for “{accepted}”"
    if how == "related":
        return f"“{studied}” is related to “{accepted}”"
    return f"“{studied}” covers “{accepted}”"


# --------------------------------------------------------------------------- fit with the job
def job_work(text: str) -> str:
    """The part of a job description about the work: before its requirements section, if it has one."""
    match = REQUIREMENTS_HEADING.search(text or "")
    return text[:match.start()] if match and match.start() > 40 else (text or "")


def job_keywords(requisition, limit: int = 20) -> list[tuple[str, str, int]]:
    """(stem, the word as the JD writes it, weight) for what the job is about: its title (counted three times) and
    its description of the work."""
    weights, shown = Counter(), {}
    for text, weight in ((requisition.title or "", 3), (job_work(requisition.job_description or ""), 1)):
        for word in re.findall(r"[a-z][a-z0-9+#]*", normalize(text)):
            if word in GENERIC or word in TITLE_GENERIC or len(word) < 3:
                continue
            s = stem(word)
            weights[s] += weight
            shown.setdefault(s, word)
    return [(s, shown[s], w) for s, w in weights.most_common(limit)]


def title_core(title: str) -> list[str]:
    return [stem(w) for w in re.findall(r"[a-z][a-z0-9+#]*", normalize(title))
            if w not in TITLE_GENERIC and w not in GENERIC and len(w) >= 2]


def relevance(requisition, candidate, evidence: Evidence) -> dict | None:
    """How well what the candidate has done (summary, past roles, CV) fits what the job is about."""
    keywords = job_keywords(requisition)
    core = title_core(requisition.title or "")
    if not keywords and not core:
        return None
    matched = [(s, word, w) for s, word, w in keywords if evidence.has_stem(s)]
    missing = [word for s, word, w in keywords if not evidence.has_stem(s)]
    total = sum(w for _, _, w in keywords)
    coverage = sum(w for _, _, w in matched) / total if total else 0.0
    keyword_share = min(1.0, coverage / 0.6)  # 60% of what the job is about, by weight, earns full marks
    best_title, title_share = "", 0.0
    for title in evidence.titles:
        have = set(stems_of(title, keep_generic=True))
        if not core:
            break
        share = sum(1 for s in core if any(same_stem(s, t) for t in have)) / len(core)
        if share > title_share:
            best_title, title_share = title, share
    if evidence.titles and core:
        share = 0.6 * keyword_share + 0.4 * title_share
    else:
        share = keyword_share
    found = f"{len(matched)} of {len(keywords)} things the job is about appear in the CV"
    if best_title and title_share:
        found += f" · past role “{best_title}” {'matches' if title_share == 1 else 'is close to'} the job title"
    return {
        "share": share, "asked": f"The job title and description ({len(keywords)} key words)",
        "found": found,
        "matched": [{"term": word, "evidence": "", "wrote": word, "how": "in the CV, summary or past roles",
                     "credit": 1.0} for _, word, _ in matched[:12]],
        "missing": [], "missing_preferred": missing[:8],
    }


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
    has none until HR adds them or its job description)."""
    from .criteria import jd_criteria

    return any([requisition.required_skills, requisition.preferred_skills, requisition.tools,
                requisition.certifications, requisition.courses, requisition.education_level,
                requisition.min_degree_class, requisition.requires_nysc, requisition.min_experience_years]) or any(
        c.kind in {"experience", "knowledge", "duty"} and c.origin != "title" for c in jd_criteria(requisition))


def compute_match(requisition, candidate, aliases=None, assessment=None) -> dict:
    """The match of one candidate to one requisition. ``assessment`` is Claude's reading of the JD against the CV
    (pipeline/ai_assess.py), used in place of the rules' verdicts on the JD's requirements when given."""
    from candidates.experience import length_text

    from .criteria import assess
    track = "trainee" if requisition.employment_type in TRAINEE_TYPES else "experienced"
    if not has_requirements(requisition):  # nothing to score against: never a score of 100 for everyone
        return {"version": VERSION, "unscored": True, "score": 0.0, "weighted_score": 0.0, "eligible": None,
                "grade": "", "grade_label": "Not scored: the vacancy has no requirements yet", "track": track,
                "track_label": TRACK_LABELS[track], "weights": {}, "screening": [], "components": {},
                "flags": ["Add the vacancy's requirements (skills, courses, qualification, experience) to score"]}
    aliases = db_aliases() if aliases is None else aliases
    evidence = evidence_for(candidate)
    skills_have = list(candidate.skills or []) + list(candidate.tools or [])
    certs_have = list(candidate.certifications or []) + list(candidate.skills or [])
    years = None if candidate.years_experience is None else float(candidate.years_experience)
    screening, components, notes = [], {}, []

    def screen(key, label, needed, has, passed, note="", unknown=False):
        screening.append({"key": key, "label": label, "needed": needed, "has": has, "passed": bool(passed),
                          "unknown": unknown, "note": note})

    # ---- 1. Screening: every must-have the requisition sets
    if requisition.education_level:
        screen("qualification", "Minimum qualification", requisition.get_education_level_display(),
               label_of(EducationLevel, candidate.highest_qualification),
               meets_education(candidate.highest_qualification, requisition.education_level),
               "" if candidate.highest_qualification else "Not stated on the profile")
    if requisition.min_degree_class:
        have_rank = DEGREE_CLASS_RANK.get(candidate.degree_class)
        if have_rank is None:  # many CVs do not give the class: confirm it, do not rule the candidate out
            screen("degree_class", "Class of degree", f"{requisition.get_min_degree_class_display()} or better",
                   "Not stated", True, NOT_STATED, unknown=True)
        else:
            screen("degree_class", "Class of degree", f"{requisition.get_min_degree_class_display()} or better",
                   label_of(DegreeClass, candidate.degree_class),
                   have_rank >= DEGREE_CLASS_RANK.get(requisition.min_degree_class, 0))
    courses = list(requisition.courses or [])
    studied = list(dict.fromkeys(c.strip() for c in [candidate.course] + [e.get("course", "") for e in
                                                                           candidate.education_history or []] if c and c.strip()))
    course_match = course_hit(courses, studied, aliases) if courses and studied else (None, None, "")
    if courses:
        if not studied:
            screen("course", "Accepted course", ", ".join(courses), "Not stated", True, NOT_STATED, unknown=True)
        else:
            screen("course", "Accepted course", ", ".join(courses), ", ".join(studied), course_match[0],
                   course_note(*course_match) if course_match[0] else "Not an accepted or related course")
    if requisition.requires_nysc:
        if not candidate.nysc_status:
            screen("nysc", "NYSC", "Completed or exempted", "Not stated", True, NOT_STATED, unknown=True)
        else:
            screen("nysc", "NYSC", "Completed or exempted", label_of(NyscStatus, candidate.nysc_status),
                   candidate.nysc_status in {NyscStatus.COMPLETED, NyscStatus.EXEMPTED})
    minimum = requisition.min_experience_years or 0
    if minimum:
        screen("experience", "Minimum experience", f"{minimum}+ years",
               "Not stated" if years is None else f"{years:g} years", years is not None and years >= minimum)
    # The JD's own experience requirements, judged job by job (pipeline/criteria.py): the main ones are key
    # requirements for an experienced hire.
    jd = assess(requisition, candidate, ai=assessment) if evidence.has_story else None
    for row in (jd or {}).get("criteria", []):
        if not row["core"]:
            continue
        subject = row["subject"] or row["text"]
        needed = (f"{row['years']:g}+ years in {subject}" if row["years"] else f"Experience in {subject}")
        if row["origin"] == "title":
            needed += " (from the job title)"
        unknown = row["unknown"] or row["verdict"] == "unclear"
        screen(f"jd_{row['id']}", f"Experience: {subject}", needed, row["evidence"],
               row["verdict"] == "met" or unknown,
               ("Judged by Claude" if row["source"] == "AI" else "") + (": confirm" if unknown else ""),
               unknown=unknown)
    required = list(requisition.required_skills or [])
    req_found, req_missing = match_terms(required, skills_have, evidence, aliases)
    if required:
        need = min_required_skills()
        screen("required_skills", "Required skills", f"At least {round(need * 100)}% of {len(required)}",
               f"{len(req_found)} of {len(required)} found", len(req_found) >= need * len(required))
    meets_all = all(s["passed"] for s in screening)

    # ---- 2. Weighted score
    required_keys = {normalize(r) for r in required}
    preferred = [p for p in requisition.preferred_skills or [] if normalize(p) not in required_keys]
    if required or preferred:
        pref_found, pref_missing = match_terms(preferred, skills_have, evidence, aliases)
        denominator = len(required) + 0.5 * len(preferred)
        components["skills"] = {
            "share": (credit(req_found) + 0.5 * credit(pref_found)) / denominator,
            "asked": f"{len(required)} required" + (f", {len(preferred)} nice to have (half value each)" if preferred else ""),
            "found": f"{len(req_found)} of {len(required)} required" + (
                f", {len(pref_found)} of {len(preferred)} nice to have" if preferred else ""),
            "matched": req_found + [dict(m, preferred=True) for m in pref_found],
            "missing": req_missing, "missing_preferred": pref_missing,
        }
    tools = list(requisition.tools or [])
    if tools:
        found, missing = match_terms(tools, list(candidate.tools or []) + list(candidate.skills or []), evidence, aliases)
        components["tools"] = {"share": credit(found) / len(tools), "asked": f"{len(tools)} tools",
                               "found": f"{len(found)} of {len(tools)}", "matched": found, "missing": missing}
    certs = list(requisition.certifications or [])
    if certs:
        found, missing = match_terms(certs, certs_have, evidence, aliases)
        components["certifications"] = {"share": credit(found) / len(certs), "asked": f"{len(certs)} certifications",
                                        "found": f"{len(found)} of {len(certs)}", "matched": found, "missing": missing}
    if requisition.education_level or requisition.min_degree_class:
        checks = [s for s in screening if s["key"] in {"qualification", "degree_class"}]
        share = 0.0
        if all(s["passed"] for s in checks):
            share = 0.75 if any(s["unknown"] for s in checks) else 1.0
        components["education"] = {
            "share": share, "asked": " · ".join(s["needed"] for s in checks),
            "found": " · ".join(s["has"] for s in checks) + (" (class not stated: counted at 75%)" if share == 0.75 else "")}
    if courses:
        if course_match[0]:
            share = RELATED_COURSE_CREDIT if course_match[2] == "related" else 1.0
            found_text = course_note(*course_match) + (f" (counted at {round(share * 100)}%)" if share < 1 else "")
        else:
            share = 0.0
            found_text = (", ".join(studied) + " — not an accepted or related course") if studied else NOT_STATED
        components["course"] = {"share": share, "asked": ", ".join(courses), "found": found_text}
    fit = relevance(requisition, candidate, evidence) if evidence.has_story else None
    if fit:  # left out when there is no CV text or past role to judge it by (e.g. a profile loaded from Excel)
        components["relevance"] = fit
    if jd:
        components["jd"] = {"share": jd["share"], "asked": jd["asked"], "found": jd["found"],
                            "criteria": jd["criteria"], "ai": jd["ai"]}
    relevant = (jd or {}).get("weighted_months")
    if relevant is not None and (minimum or track == "experienced"):
        # Years in jobs that fit what the JD asks for; similar work counts in part.
        asked = max(minimum, int(jd.get("relevant_years_asked") or 0))
        value = experience_score(relevant / 12, asked, requisition.max_experience_years)
        found = ("Not stated" if years is None else f"{years:g} years in all") + (
            f" · {length_text(relevant) if relevant else 'none'} counted towards {jd['relevant_subject']}"
            if jd["relevant_subject"] else "")
        if relevant and jd.get("relevant_months") is not None and jd["relevant_months"] < relevant:
            found += " (similar work counted in part)"
        components["experience"] = {"share": value, "asked": f"{asked}+ years" if asked else "Any", "found": found}
    elif minimum or track == "experienced":
        value = experience_score(years or 0, minimum, requisition.max_experience_years)
        # Years count in full only when the background is relevant: the skills, the course or the work done fit.
        signals = [components[k]["share"] for k in ("skills", "course", "relevance") if k in components]
        if not signals and "tools" in components:
            signals = [components["tools"]["share"]]
        fit_share = max(signals) if signals else 1.0
        factor = max(0.3, min(1.0, fit_share / 0.5))
        found = "Not stated" if years is None else f"{years:g} years"
        if factor < 1:
            found += f" · counted at {round(factor * 100)}% as the background barely fits the role"
            notes.append("Experience counted in part: the skills, course and past work barely fit the role")
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
    score = weighted  # never zeroed: the hiring manager judges the gaps
    cap = (jd or {}).get("cap")
    if cap and score > cap["limit"]:
        # Generic experience cannot make a strong match for a job that asks for something specific.
        cap = dict(cap, applied=True, before=score)
        score = float(cap["limit"])
        notes.append(f"Score capped at {cap['limit']}: {cap['reason']}")
    grade, label = grade_for(score)
    flags = [f"{s['label']}: {s['has']} (needs {s['needed']})" for s in failed]
    flags += [f"{s['label']}: not stated in the CV, confirm with the candidate" for s in screening if s["unknown"]]
    flags += notes
    return {
        # "eligible": meets every key requirement (True), or misses one for the hiring manager to judge (False).
        "version": VERSION, "score": score, "weighted_score": weighted, "eligible": meets_all, "grade": grade,
        "cap": cap or None,
        "unmet": [s["label"] for s in failed],
        "grade_label": label, "track": track, "track_label": TRACK_LABELS[track],
        "weights": {k: weights[k] for k in keys}, "screening": screening,
        "components": {k: components[k] for k in keys}, "flags": flags,
    }


def score_application(application, save: bool = True) -> dict:
    from .ai_assess import current

    result = compute_match(application.requisition, application.candidate, assessment=current(application))
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
