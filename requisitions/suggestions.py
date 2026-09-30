"""Skill / tool suggestions and job-advert drafting for requisitions."""

from __future__ import annotations

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


def draft_job_advert(requisition) -> str:
    """Candidate-facing advert text. Uses Claude when available, otherwise a template."""
    req = requisition
    bullet = lambda items: "\n".join(f"• {i}" for i in items)  # noqa: E731
    facts = [
        f"Position: {req.title}",
        f"Department: {req.department}",
        f"Type: {req.get_employment_type_display()}",
        f"Location: {req.location}",
        f"Minimum qualification: {req.get_education_level_display()}",
        f"Experience: {req.min_experience_years}+ years" if req.min_experience_years else "Experience: entry level",
    ]
    if req.courses:
        facts.append("Courses: " + ", ".join(req.courses))
    if req.required_skills:
        facts.append("Required skills: " + ", ".join(req.required_skills))
    if req.tools:
        facts.append("Tools: " + ", ".join(req.tools))
    if req.certifications:
        facts.append("Certifications: " + ", ".join(req.certifications))
    if req.other_requirements:
        facts.append("Other: " + req.other_requirements)
    if req.job_description:
        facts.append("Department notes on the role: " + req.job_description)

    if ai.ai_enabled():
        text = ai.text_request(
            system=(
                f"You write clear, inclusive job adverts for {settings.COMPANY_NAME}. Plain text only, no markdown "
                "headings with #. Use short sections: About the role, Key responsibilities (5-8 bullets using •), "
                "Requirements (bullets), and How to apply (apply through the careers portal). Do not invent salary "
                "figures or benefits."
            ),
            prompt="\n".join(facts),
            max_tokens=3000,
        )
        if text:
            return text

    sections = [
        f"{settings.COMPANY_NAME} is recruiting a {req.title} for the {req.department} department in {req.location}.",
    ]
    if req.job_description:
        sections.append("About the role\n" + req.job_description.strip())
    reqs = [f"Minimum of {req.get_education_level_display()}"
            + (f" in {', '.join(req.courses)}" if req.courses else "")]
    if req.min_experience_years:
        reqs.append(f"At least {req.min_experience_years} years of relevant experience")
    reqs += req.required_skills
    if req.tools:
        reqs.append("Working knowledge of " + ", ".join(req.tools))
    if req.certifications:
        reqs.append("Certifications: " + ", ".join(req.certifications))
    if req.other_requirements:
        reqs.append(req.other_requirements)
    sections.append("Requirements\n" + bullet(reqs))
    if req.preferred_skills:
        sections.append("Nice to have\n" + bullet(req.preferred_skills))
    sections.append("How to apply\nApply online through our careers portal and upload your CV.")
    return "\n\n".join(sections)
