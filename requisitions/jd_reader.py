"""Read a job description (Word, PDF or text) and fill in a requisition's requirements, for HR to check.

Only what the document says is taken, and only terms the portal knows (the knowledge base and the skill tags HR
adds in the admin): skills, tools, certifications, accepted courses, the minimum qualification and class of degree,
years of experience and NYSC. A skill written next to "desirable", "an added advantage", "nice to have" and the like
is a nice-to-have; the rest are required. Nothing is sent anywhere and nothing is saved until HR saves the form.
"""

from __future__ import annotations

import os
import re

from candidates.cv_parser import DEGREE_CLASS_PATTERNS, EDUCATION_PATTERNS, _known_terms, detect_terms, extract_text
from core.choices import DEGREE_CLASS_RANK, EDUCATION_RANK

PREFERRED = re.compile(r"desirable|added advantage|an advantage|nice[- ]to[- ]have|preferred|preferably|is a plus|"
                       r"would be a plus|will be an advantage|optional", re.I)
YEARS = re.compile(r"(?:minimum of |at least |min\.? )?(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*)?"
                   r"years?['’]?\s*(?:of\s+)?(?:\w+\s+){0,4}?(?:experience|work|working|post[- ]qualification)", re.I)


SMALL_WORDS = {"of", "and", "for", "the", "in", "to", "a", "an", "&"}


def tidy_title(value: str) -> str:
    """'ACCOUNTS PAYABLE OFFICER' -> 'Accounts Payable Officer'; 'hr officer' -> 'Hr Officer' is avoided by keeping
    any word that already has capitals (HR, ICT, SAP) as written."""
    words = " ".join(value.split()).strip(" .:-").split(" ")
    shouting = value.isupper()
    out = []
    for i, word in enumerate(words):
        if shouting and len(word) <= 3 and word.isalpha() and word.lower() not in SMALL_WORDS:
            out.append(word)  # HR, ICT, HSE
        elif shouting or word.islower():
            out.append(word.lower() if i and word.lower() in SMALL_WORDS else word.capitalize())
        else:
            out.append(word)
    return " ".join(out)[:150]


def title_from(text: str, filename: str) -> str:
    """The job title: a 'Job title:' line; else a heading near the top that names the file's job; else the file
    name without words like 'JD'."""
    found = re.search(r"(?:job title|position|role)[ \t]*[:\-][ \t]*(\S.{2,79})", text, re.I)
    if found:
        return tidy_title(found.group(1))
    stem = os.path.splitext(os.path.basename(filename))[0]
    stem = re.sub(r"[_\-.()]+", " ", stem)
    stem = " ".join(re.sub(r"(?i)\b(jd|job description|job desc|description|job posting|job post|job advert|advert|vacancy|final|draft|v\d+)\b", " ", stem).split())
    wanted = {w for w in stem.lower().split() if not w.isdigit()}
    for line in [line.strip() for line in text.splitlines() if line.strip()][:8]:
        words = set(re.sub(r"[^a-z0-9 ]+", " ", line.lower()).split())
        if wanted and wanted <= words and len(line.split()) <= 8:
            return tidy_title(line)
    return tidy_title(stem) if wanted else ""


def most_specific(terms: list[str]) -> list[str]:
    """Drop a general term when a more specific one was found too ('Reconciliations' beside 'Vendor reconciliation')."""
    from core.text import contains_phrase, normalize, variants

    keep = []
    for term in terms:
        others = [normalize(o) for o in terms if o != term]
        if not any(contains_phrase(o, v) and o != v for o in others for v in variants(term) if len(v) >= 3):
            keep.append(term)
    return keep


def split_by_preference(text: str, terms: list[str]) -> tuple[list[str], list[str]]:
    """(required, nice to have): a term is nice to have when every line that names it says so."""
    from core.text import find_in_text, normalize

    lines = [line for line in re.split(r"[\n•;]", text) if line.strip()]
    required, preferred = [], []
    for term in terms:
        where = [line for line in lines if find_in_text(term, normalize(line))]
        (preferred if where and all(PREFERRED.search(line) for line in where) else required).append(term)
    return required, preferred


def read_jd(data: bytes, filename: str) -> dict:
    """{"text", "values" (form initial values), "found" (a short summary), "warning"}."""
    extracted = extract_text(data, filename)
    text = (extracted.text or "").strip()
    if not text:
        return {"text": "", "values": {}, "found": [], "warning": "No text could be read from this file. "
                "If it is a scan, save it as Word or a searchable PDF and try again."}
    catalogue = _known_terms()
    skills = most_specific(detect_terms(text, "skill", catalogue))
    required, preferred = split_by_preference(text, skills)
    lower = text.lower()
    levels = [level for level, pattern in EDUCATION_PATTERNS if re.search(pattern, lower)]
    classes = [cls for cls, pattern in DEGREE_CLASS_PATTERNS if re.search(pattern, lower)]
    years = [(int(a), int(b) if b else None) for a, b in YEARS.findall(text) if 0 < int(a) <= 40]
    values = {
        "title": title_from(text, filename),
        "job_description": text[:6000],
        "required_skills": required,
        "preferred_skills": preferred,
        "tools": detect_terms(text, "tool", catalogue),
        "certifications": detect_terms(text, "certification", catalogue),
        "courses": detect_terms(text, "course", catalogue),
        # The lowest qualification and class of degree the JD accepts ("B.Sc/HND" -> HND).
        "education_level": min(levels, key=lambda lvl: EDUCATION_RANK[lvl]) if levels else "",
        "min_degree_class": min(classes, key=lambda c: DEGREE_CLASS_RANK.get(c, 99)) if classes else "",
        "requires_nysc": bool(re.search(r"\bnysc\b|national youth service", lower)),
        "min_experience_years": min(a for a, _ in years) if years else 0,
        "max_experience_years": max((b for _, b in years if b), default=None),
    }
    found = []
    for key, label in (("required_skills", "required skills"), ("preferred_skills", "nice-to-have skills"),
                       ("tools", "tools"), ("certifications", "certifications"), ("courses", "courses")):
        if values[key]:
            found.append(f"{len(values[key])} {label}")
    if values["education_level"]:
        found.append("minimum qualification")
    if values["min_experience_years"]:
        found.append(f"{values['min_experience_years']}+ years of experience")
    if values["requires_nysc"]:
        found.append("NYSC")
    return {"text": text, "values": values, "found": found, "warning": ""}
