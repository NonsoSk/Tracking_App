"""Skill / tool suggestions and job-advert drafting for requisitions."""

from __future__ import annotations

import re

from django.conf import settings

from core import ai
from core.choices import EducationLevel
from core.text import clean_list

from .knowledge_base import JOB_FAMILIES, match_families
from .models import JobRole, SkillTag

SUGGESTION_SCHEMA = {
    "type": "object",
    "properties": {
        "skills": {"type": "array", "items": {"type": "string"}},
        "tools": {"type": "array", "items": {"type": "string"}},
        "certifications": {"type": "array", "items": {"type": "string"}},
        "courses": {"type": "array", "items": {"type": "string"}},
        "min_experience_years": {"type": "integer"},
        "education_level": {"type": "string", "enum": [c.value for c in EducationLevel]},
    },
    "required": ["skills", "tools", "certifications", "courses", "min_experience_years", "education_level"],
    "additionalProperties": False,
}

SUGGESTION_SYSTEM = (
    "You help a hiring team at {company}, an ammonia and urea fertilizer manufacturer in {location}, "
    "define requirements for job requisitions. Suggest concise, specific requirement tags that a "
    "department head would pick from: technical and soft skills, named tools/software/equipment, "
    "certifications or licences recognised in Nigeria, and accepted university courses. Keep each tag "
    "to a few words. Return 8-14 skills, 5-10 tools, 3-6 certifications and 3-6 courses."
)


def knowledge_base_suggestions(title: str, department: str = "") -> dict:
    families = match_families(f"{title} {department}") or match_families(department)
    result = {"skills": [], "tools": [], "certifications": [], "courses": [], "families": []}
    for key in families:
        family = JOB_FAMILIES[key]
        result["families"].append(family["label"])
        for field in ("skills", "tools", "certifications", "courses"):
            result[field].extend(family[field])
        # Admin-maintained catalogue entries for the same family.
        for tag in SkillTag.objects.filter(job_family=key):
            field = {"skill": "skills", "tool": "tools", "certification": "certifications", "course": "courses"}[tag.kind]
            result[field].append(tag.name)
    for field in ("skills", "tools", "certifications", "courses"):
        result[field] = clean_list(result[field])
    return result


def suggest_requirements(title: str, department: str = "", employment_type: str = "", description: str = "") -> dict:
    """Merge the saved job-role defaults, the knowledge base and (optionally) Claude."""
    title = (title or "").strip()
    result = knowledge_base_suggestions(title, department)
    result["source"] = "knowledge base"
    result["min_experience_years"] = None
    result["education_level"] = ""

    role = JobRole.objects.filter(title__iexact=title).first() if title else None
    if role:
        for field, attr in (("skills", "default_skills"), ("tools", "default_tools"),
                            ("certifications", "default_certifications"), ("courses", "default_courses")):
            result[field] = clean_list(list(getattr(role, attr) or []) + result[field])
        result["min_experience_years"] = role.default_min_experience
        result["education_level"] = role.default_education

    if title and ai.ai_enabled():
        prompt = (
            f"Role title: {title}\nDepartment: {department or 'not specified'}\n"
            f"Hiring type: {employment_type or 'not specified'}\n"
            f"Extra context from the department: {description or 'none'}"
        )
        data = ai.structured_request(
            system=SUGGESTION_SYSTEM.format(company=settings.COMPANY_NAME, location=settings.COMPANY_LOCATION),
            content=prompt,
            schema=SUGGESTION_SCHEMA,
            max_tokens=4000,
        )
        if data:
            for field in ("skills", "tools", "certifications", "courses"):
                result[field] = clean_list(list(data.get(field) or []) + result[field])
            if result["min_experience_years"] is None:
                result["min_experience_years"] = data.get("min_experience_years")
            result["education_level"] = result["education_level"] or data.get("education_level", "")
            result["source"] = "AI + knowledge base"

    for field in ("skills", "tools", "certifications", "courses"):
        result[field] = result[field][:25]
    return result


JD_HEADINGS = ["Job summary", "Key responsibilities", "Qualifications and experience", "Required skills",
               "Tools, software and equipment", "Certifications and licences", "Desirable", "Other requirements",
               "How to apply"]

JD_SYSTEM = (
    "You write job descriptions for {company}, an ammonia and urea fertilizer manufacturer in {location}. "
    "Write a polished, inclusive job description in a standard format from the requisition below.\n\n"
    "Format: plain text only, no markdown (no #, no **). Start with these lines, one per line, exactly as given: "
    "Job title, Department, Location, Employment type, Number of positions, Reference. Then a blank line and these "
    "sections, each heading on its own line followed by its content: " + ", ".join(JD_HEADINGS) + ". "
    "Use bullets that start with \"• \". Leave out a section when the requisition gives nothing for it.\n\n"
    "Rules: Job summary is 2-4 sentences on the purpose of the role. Key responsibilities has 6-10 clear bullets "
    "that start with a verb, built from the department's description of the duties. Every requirement must come "
    "from the requisition: do not add qualifications, years, skills, tools or certifications it does not list, "
    "because candidates are scored against exactly these. Put the nice-to-have skills under Desirable. "
    "The internal context explains why the hire is needed: use it only to understand the role and never quote it, "
    "never name any employee, and never mention replacements, resignations, retirements or internal reasons. "
    "Do not invent salary, benefits, reporting lines or closing dates. How to apply: apply online through the "
    "{company_short} careers portal and upload a CV."
)


def _as_bullets(text: str) -> list[str]:
    """The department's free text as separate points: one per line, or per sentence when it is one paragraph."""
    lines = [ln.strip(" \t•-*–·").strip() for ln in (text or "").splitlines()]
    lines = [ln for ln in lines if ln]
    if len(lines) == 1:
        lines = [p.strip() for p in re.split(r"(?<=[.;])\s+(?=[A-Z])|;\s*", lines[0]) if p.strip()]
    return [ln[0].upper() + ln[1:].rstrip(".;") for ln in lines]


def _qualification_line(req) -> str:
    if not (req.education_level or req.courses):
        return ""
    if req.education_level:
        line = f"Minimum of {req.get_education_level_display()}"
        if req.courses:
            line += " in " + _or_list(req.courses)
    else:
        line = "A qualification in " + _or_list(req.courses)
    if req.min_degree_class:
        line += f", with {req.get_min_degree_class_display()} or better"
    return line


def _or_list(items) -> str:
    items = list(items)
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " or " + items[-1]


def requisition_facts(req) -> list[str]:
    """Everything the department and the hiring team recorded, as lines for the AI prompt."""
    facts = [
        f"Job title: {req.title}",
        f"Department: {req.department}",
        f"Location: {req.location or settings.COMPANY_LOCATION}",
        f"Employment type: {req.get_employment_type_display()}",
        f"Number of positions: {req.positions}",
        f"Reference: {req.reference}",
    ]
    qualification = _qualification_line(req)
    if qualification:
        facts.append("Minimum qualification: " + qualification)
    if req.min_experience_years:
        span = f"{req.min_experience_years}-{req.max_experience_years}" if req.max_experience_years else f"{req.min_experience_years}+"
        facts.append(f"Experience: {span} years")
    else:
        facts.append("Experience: entry level accepted")
    if req.requires_nysc:
        facts.append("NYSC: completed or exempted")
    for label, items in (("Required skills", req.required_skills), ("Nice-to-have skills", req.preferred_skills),
                         ("Tools / software / equipment", req.tools),
                         ("Certifications / licences", req.certifications)):
        if items:
            facts.append(f"{label}: " + "; ".join(items))
    if req.other_requirements.strip():
        facts.append("Other requirements: " + req.other_requirements.strip())
    if req.job_description.strip():
        facts.append("Duties as described by the department:\n" + req.job_description.strip())
    if req.justification.strip():
        facts.append("Internal context (do not quote): " + req.justification.strip())
    return facts


def clean_ai_text(text: str) -> str:
    """Remove markdown the model may add anyway, so the careers page shows clean text."""
    lines = []
    for line in text.replace("\r\n", "\n").split("\n"):
        line = re.sub(r"^\s*#+\s*", "", line).replace("**", "").replace("__", "")
        line = re.sub(r"^(\s*)[-*]\s+", r"\1• ", line)
        lines.append(line.rstrip())
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def draft_job_advert(requisition) -> str:
    """The job description for the careers page, in a standard format.

    Uses Claude when available, otherwise builds the same sections from the requisition.
    """
    req = requisition
    if ai.ai_enabled():
        text = ai.text_request(
            system=JD_SYSTEM.format(company=settings.COMPANY_NAME, location=settings.COMPANY_LOCATION,
                                    company_short=settings.COMPANY_SHORT_NAME),
            prompt="\n".join(requisition_facts(req)),
            max_tokens=4000,
            effort="medium",
        )
        if text:
            return clean_ai_text(text)

    bullet = lambda items: "\n".join(f"• {i}" for i in items)  # noqa: E731
    sections = ["\n".join(requisition_facts(req)[:6])]
    article = "an" if req.title[:1].lower() in "aeiou" else "a"
    summary = (f"{settings.COMPANY_NAME} is recruiting {article} {req.title} for the {req.department} department"
               f" in {req.location or settings.COMPANY_LOCATION}.")
    if req.positions > 1:
        summary += f" There are {req.positions} openings."
    sections.append("Job summary\n" + summary)
    duties = _as_bullets(req.job_description)
    if duties:
        sections.append("Key responsibilities\n" + bullet(duties))
    background = [line for line in [_qualification_line(req)] if line]
    if req.min_experience_years:
        background.append(f"At least {req.min_experience_years} years of relevant experience")
    if req.requires_nysc:
        background.append("NYSC completed or exempted")
    if background:
        sections.append("Qualifications and experience\n" + bullet(background))
    for heading, items in (("Required skills", req.required_skills), ("Tools, software and equipment", req.tools),
                           ("Certifications and licences", req.certifications), ("Desirable", req.preferred_skills)):
        if items:
            sections.append(f"{heading}\n" + bullet(items))
    other = [o for o in _as_bullets(req.other_requirements) if o.lower().rstrip(".") not in {"none", "nil", "n/a"}]
    if other:
        sections.append("Other requirements\n" + bullet(other))
    sections.append(f"How to apply\nApply online through the {settings.COMPANY_SHORT_NAME} careers portal and upload "
                    "your CV. The form fills itself from your CV; check it and submit.")
    return "\n\n".join(sections)
