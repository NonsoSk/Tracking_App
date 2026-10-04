"""Application packages: one folder per job under applications/.

Each folder holds the job post, the tailored resume (Markdown, HTML and PDF),
the cover letter, and outreach.md, the email that goes out once you approve.
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


def build(root, item, docs):
    """Write the package for one job. Returns (folder relative to root, contact email)."""
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
    return relative, contact


def attachments(folder):
    names = ("resume.pdf", "cover_letter.pdf")
    return [os.path.join(folder, name) for name in names if os.path.exists(os.path.join(folder, name))]
