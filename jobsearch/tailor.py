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
6. deal_problem, deal_source, deal_subject and deal_message: a casual
   "I'll make you a deal" message for a founder, hiring manager or recruiter
   (fits a LinkedIn message or a short email, under 120 words). Pick ONE real,
   specific problem the company is facing that a data analyst could help with,
   then offer: share the problem (or let me pick it up from what is public),
   I'll spend {turnaround} digging in and send back a working analysis or
   dashboard, and if it's useful, that's my interview. Keep it friendly, warm
   and very polite, never pushy, and make it easy to say no.
   deal_problem names the problem in one sentence and deal_source says where
   it comes from (the job post, or the URL of a public page you found).

Rules for the deal message:
- Use only public information: the job post, the company's own website, blog,
  docs, public product pages, press and news. Never use or ask for private,
  personal or confidential data (customer data, internal metrics, anyone's
  personal details), and never ask them to share anything they shouldn't.
- Do not claim to know anything that is not public, and do not guess.
- If you find no clear public problem, use one the job post itself describes.
- Mention individuals only by the name and title they publish themselves.

Never invent experience, employers, dates, degrees, certifications, tools or
numbers that are not in the base resume. Reword and reorder only. If the post
asks for something the candidate lacks, leave it out of the resume and list it
in gaps. Keep the candidate's LinkedIn link in the resume header."""

SCHEMA = {
    "type": "object",
    "properties": {
        "resume_markdown": {"type": "string"},
        "cover_letter": {"type": "string"},
        "email_subject": {"type": "string"},
        "email_body": {"type": "string"},
        "fit_score": {"type": "integer"},
        "gaps": {"type": "array", "items": {"type": "string"}},
        "deal_problem": {"type": "string"},
        "deal_source": {"type": "string"},
        "deal_subject": {"type": "string"},
        "deal_message": {"type": "string"},
    },
    "required": ["resume_markdown", "cover_letter", "email_subject", "email_body", "fit_score", "gaps",
                 "deal_problem", "deal_source", "deal_subject", "deal_message"],
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


WEB_SEARCH = {"type": "web_search_20260209", "name": "web_search", "max_uses": 3}


def request(client, system, messages, research):
    extra = {"tools": [WEB_SEARCH]} if research else {}
    return client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        system=system,
        messages=messages,
        **extra,
    )


def tailor(client, resume, item, research=False, turnaround="48 hours"):
    """Return the tailored documents as a dict, or None if Claude declined.

    With research on, Claude may run a few web searches for public
    information about the company before writing the deal message.
    """
    system = [{"type": "text", "cache_control": {"type": "ephemeral"},
               "text": f"{SYSTEM.format(turnaround=turnaround)}\n\nBase resume:\n{resume}"}]
    messages = [{"role": "user", "content": job_prompt(item)}]
    try:
        response = request(client, system, messages, research)
    except Exception as error:
        if not research:
            raise
        print(f"  ! company research unavailable ({error}); drafting from the post only")
        research = False
        response = request(client, system, messages, research)
    for _ in range(3):  # a long web search can pause the turn; continue it
        if response.stop_reason != "pause_turn":
            break
        messages = messages + [{"role": "assistant", "content": response.content}]
        response = request(client, system, messages, research)
    if response.stop_reason != "end_turn":
        return None
    texts = [block.text for block in response.content if block.type == "text"]
    return json.loads(texts[-1]) if texts else None


def make_client():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    import anthropic  # only needed when tailoring runs
    return anthropic.Anthropic()
