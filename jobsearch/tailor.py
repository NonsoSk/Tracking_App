"""Write a one-page resume, cover letter and outreach email for one job.

Uses the Claude API. Needs ANTHROPIC_API_KEY and a base resume, read from
the RESUME_TEXT environment variable (a GitHub secret) or profile/resume.md.
"""

import json
import os

MODEL = "claude-opus-5-5"

SYSTEM = """You tailor job applications for one candidate.

You get the candidate's base resume and one job post. Produce:
1. resume_markdown: the candidate's resume rewritten for this job, in Markdown,
   short enough to fit on ONE printed page (about 450 words at most). Lead with
   the experience and skills the post asks for, use the post's own terms where
   the candidate genuinely has that skill, and cut what is irrelevant.
2. cover_letter: a cover letter of 180 to 250 words, addressed to the hiring
   team at the company, plain text paragraphs, signed with the candidate's name.
3. email_subject and email_body: a short outreach email (under 140 words) to
   the recruiter or hiring manager, saying which role, why the candidate fits
   in two concrete points, and that the resume is attached.
4. fit_score: 1 to 10, how well the candidate matches the post.
5. gaps: requirements in the post the candidate does not show, as a short list.

Never invent experience, employers, dates, degrees, certifications, tools or
numbers that are not in the base resume. Reword and reorder only. If the post
asks for something the candidate lacks, leave it out of the resume and list it
in gaps."""

SCHEMA = {
    "type": "object",
    "properties": {
        "resume_markdown": {"type": "string"},
        "cover_letter": {"type": "string"},
        "email_subject": {"type": "string"},
        "email_body": {"type": "string"},
        "fit_score": {"type": "integer"},
        "gaps": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["resume_markdown", "cover_letter", "email_subject", "email_body", "fit_score", "gaps"],
    "additionalProperties": False,
}

PLACEHOLDER = "REPLACE THIS FILE WITH YOUR RESUME"


def load_resume(root):
    text = os.environ.get("RESUME_TEXT", "").strip()
    if not text:
        path = os.path.join(root, "profile", "resume.md")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as handle:
                text = handle.read().strip()
    if not text or PLACEHOLDER in text:
        return None
    return text


def job_prompt(item):
    return (
        f"Role: {item['title']}\nCompany: {item['company']}\n"
        f"Location: {item['location'] or 'Remote'}\nLink: {item['url']}\n\n"
        f"Job post:\n{item['description'] or '(no description provided)'}"
    )


def tailor(client, resume, item):
    """Return the tailored documents as a dict, or None if Claude declined."""
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        system=[{"type": "text", "text": f"{SYSTEM}\n\nBase resume:\n{resume}",
                 "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": job_prompt(item)}],
    )
    if response.stop_reason != "end_turn":
        return None
    text = "".join(block.text for block in response.content if block.type == "text")
    return json.loads(text)


def make_client():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    import anthropic  # only needed when tailoring runs
    return anthropic.Anthropic()
