"""Send the approved outreach email, with the tailored resume attached.

Needs SMTP_USER and SMTP_PASSWORD (for Gmail, an app password), and
optionally SMTP_HOST (default smtp.gmail.com) and SMTP_PORT (default 465).
"""

import os
import re
import smtplib
import ssl
from email.message import EmailMessage

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
IGNORED = ("noreply", "no-reply", "donotreply", "example.com", "privacy", "unsubscribe",
           "support@", "abuse@", "remotive.com", "remoteok.com", "himalayas.app", "jobicy.com")


def find_contacts(text):
    """Email addresses written in the job post itself, most likely first."""
    found = []
    for address in EMAIL.findall(text or ""):
        address = address.strip(".").lower()
        if address not in found and not any(word in address for word in IGNORED):
            found.append(address)
    preferred = ("jobs@", "careers@", "hiring@", "recruit", "talent@", "hr@", "people@")
    return sorted(found, key=lambda a: not any(word in a for word in preferred))


def read_email_draft(path):
    """outreach.md holds 'To:', 'Subject:', a blank line, then the body."""
    with open(path, encoding="utf-8") as handle:
        header, _, body = handle.read().partition("\n\n")
    fields = dict(line.split(":", 1) for line in header.splitlines() if ":" in line)
    return fields.get("To", "").strip(), fields.get("Subject", "").strip(), body.strip()


def smtp_settings():
    user, password = os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASSWORD")
    if not user or not password:
        return None
    return {
        "host": os.environ.get("SMTP_HOST", "smtp.gmail.com"),
        "port": int(os.environ.get("SMTP_PORT", "465")),
        "user": user,
        "password": password,
    }


def send(settings, to, subject, body, attachments):
    message = EmailMessage()
    message["From"], message["To"], message["Subject"] = settings["user"], to, subject
    message.set_content(body)
    for path in attachments:
        with open(path, "rb") as handle:
            subtype = "pdf" if path.endswith(".pdf") else "octet-stream"
            message.add_attachment(handle.read(), maintype="application", subtype=subtype,
                                   filename=os.path.basename(path))
    with smtplib.SMTP_SSL(settings["host"], settings["port"], context=ssl.create_default_context()) as server:
        server.login(settings["user"], settings["password"])
        server.send_message(message)
