"""Application packages: one folder per job under applications/.

Each folder holds the job post, the tailored resume (Markdown, HTML and PDF),
the cover letter, outreach.md (a formal email) and deal.md (a casual
"I'll make you a deal" message). One of them goes out once you approve.
"""

import os
import re

from . import documents
from .outreach import find_contacts


def slug(item):
    text = f"{item['company']}-{item['title']}".lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")[:70] or item["id"].replace(":", "-")


def write(path, text):
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text.rstrip() + "\n")


def render(folder, name, markdown, title):
    html_path = os.path.join(folder, f"{name}.html")
    write(html_path, documents.resume_html(markdown, title))
    try:
        documents.html_to_pdf(html_path, os.path.join(folder, f"{name}.pdf"))
    except Exception as error:  # a PDF failure should not lose the drafts
        print(f"  ! PDF for {folder}/{name} failed: {error}")


def with_links(markdown, links):
    """Make sure the resume header carries the LinkedIn (and other) links."""
    missing = [f"{name}: {url}" for name, url in links.items() if url and url.rstrip("/") not in markdown]
    if not missing:
        return markdown
    lines = markdown.splitlines()
    at = next((i + 1 for i, line in enumerate(lines) if line.startswith("# ")), 0)
    lines.insert(at, " | ".join(missing))
    return "\n".join(lines)


def build(root, item, docs, links=None):
    """Write the package for one job. Returns (folder relative to root, contact email)."""
    docs = dict(docs, resume_markdown=with_links(docs["resume_markdown"], links or {}))
    relative = os.path.join("applications", slug(item))
    folder = os.path.join(root, relative)
    os.makedirs(folder, exist_ok=True)
    contacts = find_contacts(item.get("raw_description") or item.get("description"))
    contact = contacts[0] if contacts else ""

    write(os.path.join(folder, "job.md"),
          f"# {item['title']} at {item['company']}\n\n"
          f"- Link: {item['url']}\n- Location: {item['location'] or 'Remote'}\n"
          f"- Pay: {item.get('salary_text') or ''} (about ${item.get('monthly_usd_max') or '?'} a month at the top)\n"
          f"- Contacts found in the post: {', '.join(contacts) or 'none'}\n"
          f"- Fit score: {docs['fit_score']}/10\n"
          f"- Gaps: {'; '.join(docs['gaps']) or 'none'}\n\n"
          f"## Job post\n\n{item.get('description') or ''}")
    write(os.path.join(folder, "resume.md"), docs["resume_markdown"])
    render(folder, "resume", docs["resume_markdown"], f"Resume: {item['title']}")
    write(os.path.join(folder, "cover_letter.md"), docs["cover_letter"])
    render(folder, "cover_letter", docs["cover_letter"], f"Cover letter: {item['title']}")
    write(os.path.join(folder, "outreach.md"),
          f"To: {contact}\nSubject: {docs['email_subject']}\n\n{docs['email_body']}")
    write(os.path.join(folder, "deal.md"),
          f"To: {contact}\nSubject: {docs['deal_subject']}\n\n{docs['deal_message']}")
    write(os.path.join(folder, "deal_notes.md"),
          f"# Deal message notes\n\n- Problem: {docs['deal_problem']}\n- Source: {docs['deal_source']}\n\n"
          "deal.md is a casual alternative to outreach.md. It also works as a LinkedIn message.\n"
          "Check the problem and source above before sending.")
    return relative, contact


def attachments(folder):
    names = ("resume.pdf", "cover_letter.pdf")
    return [os.path.join(folder, name) for name in names if os.path.exists(os.path.join(folder, name))]
