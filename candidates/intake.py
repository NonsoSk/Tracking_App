"""
One entry point for every way a CV reaches HR: the careers page, employee
referrals, bulk uploads of emailed / scanned CVs, and the email inbox reader.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from decimal import Decimal

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from core.text import merge_unique

from .cv_parser import SUPPORTED_EXTENSIONS, parse_cv
from .models import Candidate, CandidateDocument

logger = logging.getLogger(__name__)

SCALAR_FIELDS = [
    "first_name", "last_name", "email", "phone", "gender", "date_of_birth", "location", "linkedin_url",
    "highest_qualification", "course", "institution", "graduation_year", "degree_class", "nysc_status",
    "current_employer", "current_job_title", "summary",
]
LIST_FIELDS = ["skills", "tools", "certifications"]
HISTORY_FIELDS = ["education_history", "work_history"]


def normalize_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("234") and len(digits) >= 13:
        digits = "0" + digits[3:]
    return digits


def find_existing(email: str = "", phone: str = "") -> Candidate | None:
    if email:
        match = Candidate.objects.filter(email__iexact=email.strip()).first()
        if match:
            return match
    phone = normalize_phone(phone)
    if len(phone) >= 10:
        for candidate in Candidate.objects.exclude(phone="").only("id", "phone"):
            if normalize_phone(candidate.phone)[-10:] == phone[-10:]:
                return Candidate.objects.get(pk=candidate.pk)
    return None


def apply_parsed(candidate: Candidate, parsed: dict, *, overwrite: bool = False) -> list[str]:
    """Copy parsed CV data onto the candidate. By default only empty fields are filled,
    so details the candidate typed into the application form are never replaced."""
    changed = []
    for name in SCALAR_FIELDS:
        value = parsed.get(name)
        if value in (None, "", 0):
            continue
        if overwrite or not getattr(candidate, name):
            if name in {"first_name", "last_name", "course", "institution", "current_employer", "current_job_title"}:
                value = str(value)[:150]
            setattr(candidate, name, value)
            changed.append(name)
    years = parsed.get("years_experience")
    if years and (overwrite or not candidate.years_experience):
        candidate.years_experience = Decimal(str(round(float(years), 1)))
        changed.append("years_experience")
    for name in LIST_FIELDS:
        merged = merge_unique(list(getattr(candidate, name) or []), list(parsed.get(name) or []))
        if merged != list(getattr(candidate, name) or []):
            setattr(candidate, name, merged)
            changed.append(name)
    for name in HISTORY_FIELDS:
        if parsed.get(name) and (overwrite or not getattr(candidate, name)):
            setattr(candidate, name, parsed[name])
            changed.append(name)
    if parsed.get("text"):
        candidate.cv_text = parsed["text"]
    candidate.parse_method = parsed.get("method") or candidate.parse_method
    candidate.parse_notes = "\n".join(parsed.get("notes") or [])
    candidate.parsed_at = timezone.now()
    return changed


def save_document(candidate, *, content: bytes, filename: str, doc_type=CandidateDocument.DocType.CV, user=None,
                  application=None) -> CandidateDocument:
    document = CandidateDocument(
        candidate=candidate, doc_type=doc_type, original_name=os.path.basename(filename)[:255],
        uploaded_by=user if getattr(user, "is_authenticated", False) else None, application=application,
    )
    document.file.save(os.path.basename(filename), ContentFile(content), save=False)
    document.save()
    return document


def parse_document(document: CandidateDocument, *, overwrite: bool = False) -> dict:
    """(Re-)read a stored CV and update the candidate profile and scores."""
    from pipeline.matching import rescore_candidate

    document.file.open("rb")
    try:
        data = document.file.read()
    finally:
        document.file.close()
    parsed = parse_cv(data, document.original_name or document.file.name)
    candidate = document.candidate
    apply_parsed(candidate, parsed, overwrite=overwrite)
    candidate.save()
    document.is_parsed = True
    document.save(update_fields=["is_parsed"])
    rescore_candidate(candidate)
    return parsed


@dataclass
class IntakeResult:
    candidate: Candidate | None = None
    created: bool = False
    application: object = None
    document: CandidateDocument | None = None
    parsed: dict = field(default_factory=dict)
    error: str = ""


@transaction.atomic
def ingest_cv(content: bytes, filename: str, *, source: str, requisition=None, user=None, referred_by=None,
              referral_note: str = "", fallback_email: str = "", notify_team: bool = True) -> IntakeResult:
    """Read a CV file, create or update the candidate, file the CV in their folder
    and (when a requisition is given) create and score the application."""
    from pipeline.services import create_application, log

    ext = os.path.splitext(filename)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        return IntakeResult(error=f"{filename}: unsupported file type")

    parsed = parse_cv(content, filename)
    email = parsed.get("email") or fallback_email
    candidate = find_existing(email, parsed.get("phone", ""))
    created = candidate is None
    if created:
        candidate = Candidate(source=source, created_by=user if getattr(user, "is_authenticated", False) else None,
                              referred_by=referred_by, referral_note=referral_note)
        if not parsed.get("email") and fallback_email:
            candidate.email = fallback_email
    elif referred_by and not candidate.referred_by_id:
        candidate.referred_by = referred_by
        candidate.referral_note = referral_note
    apply_parsed(candidate, parsed)
    if not candidate.first_name and not candidate.last_name:
        stem = re.sub(r"(?i)\b(cv|resume|curriculum vitae)\b|[_\-.\d]+", " ", os.path.splitext(filename)[0]).split()
        if stem:
            candidate.first_name = stem[0].title()[:80]
            candidate.last_name = " ".join(stem[1:]).title()[:80]
    candidate.save()
    document = save_document(candidate, content=content, filename=filename, user=user)
    document.is_parsed = True
    document.save(update_fields=["is_parsed"])

    log(
        f"CV received via {candidate.get_source_display() if created else dict(Candidate.Source.choices).get(source, source)}"
        f" and read automatically ({parsed.get('method') or 'no text found'}).",
        verb="cv", candidate=candidate, actor=user,
    )
    application = None
    if requisition is not None:
        application, _ = create_application(candidate, requisition, source=source, actor=user, notify_team=notify_team)
        document.application = application
        document.save(update_fields=["application"])
    return IntakeResult(candidate=candidate, created=created, application=application, document=document, parsed=parsed)
