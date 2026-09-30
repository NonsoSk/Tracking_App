"""
Read CVs sent to the recruitment mailbox and add them to the portal.

Configure CV_INBOX_HOST / CV_INBOX_USER / CV_INBOX_PASSWORD (IMAP) in .env and
schedule this command (e.g. every 15 minutes). If the email subject or body
contains a requisition reference (e.g. REQ-2026-0004) or the exact vacancy
title, the CV is applied to that vacancy and scored straight away.
"""

import email
import imaplib
import os
import re
from email.header import decode_header, make_header
from email.utils import parseaddr

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from candidates.cv_parser import SUPPORTED_EXTENSIONS
from candidates.intake import ingest_cv
from candidates.models import Candidate
from core.notify import hr_team, notify
from requisitions.models import Requisition


def _decode(value) -> str:
    try:
        return str(make_header(decode_header(value or "")))
    except Exception:
        return value or ""


def match_requisition(text: str):
    ref = re.search(r"REQ-\d{4}-\d{3,}", text or "", re.I)
    if ref:
        found = Requisition.objects.filter(reference__iexact=ref.group(0)).first()
        if found:
            return found
    lowered = (text or "").lower()
    for requisition in Requisition.objects.filter(status=Requisition.Status.OPEN):
        if requisition.title.lower() in lowered:
            return requisition
    return None


class Command(BaseCommand):
    help = "Import CV attachments from unread emails in the recruitment mailbox."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="List what would be imported without saving.")

    def handle(self, *args, **options):
        cfg = settings.CV_INBOX
        if not cfg["HOST"] or not cfg["USER"]:
            raise CommandError("Set CV_INBOX_HOST, CV_INBOX_USER and CV_INBOX_PASSWORD in the environment.")
        client = imaplib.IMAP4_SSL(cfg["HOST"], cfg["PORT"]) if cfg["USE_SSL"] else imaplib.IMAP4(cfg["HOST"], cfg["PORT"])
        client.login(cfg["USER"], cfg["PASSWORD"])
        client.select(cfg["FOLDER"])
        _, data = client.search(None, "UNSEEN")
        imported = 0
        for num in data[0].split():
            _, msg_data = client.fetch(num, "(RFC822)")
            message = email.message_from_bytes(msg_data[0][1])
            subject = _decode(message.get("Subject"))
            sender = parseaddr(message.get("From"))[1]
            body = ""
            attachments = []
            for part in message.walk():
                filename = part.get_filename()
                if filename:
                    filename = _decode(filename)
                    if os.path.splitext(filename)[1].lower() in SUPPORTED_EXTENSIONS:
                        attachments.append((filename, part.get_payload(decode=True)))
                elif part.get_content_type() == "text/plain" and not body:
                    body = (part.get_payload(decode=True) or b"").decode(part.get_content_charset() or "utf-8", "ignore")
            requisition = match_requisition(f"{subject}\n{body}")
            for filename, content in attachments:
                self.stdout.write(f"- {sender}: {filename} → {requisition or 'talent pool'}")
                if options["dry_run"]:
                    continue
                result = ingest_cv(content, filename, source=Candidate.Source.EMAIL, requisition=requisition,
                                   fallback_email=sender, notify_team=False)
                if not result.error:
                    imported += 1
            if options["dry_run"]:
                client.store(num, "-FLAGS", "\\Seen")
        client.logout()
        if imported:
            notify(hr_team(), f"{imported} CV(s) imported from the recruitment mailbox",
                   "They have been read, filed and scored where a vacancy was identified.", url="/candidates/", email=False)
        self.stdout.write(self.style.SUCCESS(f"Imported {imported} CV(s)."))
