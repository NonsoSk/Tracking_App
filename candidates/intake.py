"""
One entry point for every way a CV reaches HR: the careers page, employee
referrals, bulk uploads of emailed / scanned CVs, the CV folder and the email inbox reader.

Nobody checks these by hand, so the portal filters them itself:
- a file that is not a CV (a cover letter, a certificate, a job description, a scan that cannot be read) is set
  aside with the reason and nothing is saved from it (candidates/cv_filter.py);
- a CV the portal already holds is not added again: the same file, or the same CV saved under another name or in
  another format. Uploading the same folder twice adds nothing the second time;
- a different CV from someone already in the portal (same email or phone) is filed under their existing profile,
  which is brought up to date.
"""

from __future__ import annotations

import hashlib
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
from .pdf import ConversionError, to_pdf

logger = logging.getLogger(__name__)

SCALAR_FIELDS = [
    "first_name", "last_name", "email", "phone", "gender", "date_of_birth", "location", "linkedin_url",
    "highest_qualification", "course", "institution", "graduation_year", "degree_class", "nysc_status",
    "current_employer", "current_job_title", "summary", "state_of_origin", "lga",
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


# What a newer CV from the same person brings up to date (their name, contacts and qualification stay as they are).
REFRESH_FIELDS = {"current_employer", "current_job_title", "summary"}


def apply_parsed(candidate: Candidate, parsed: dict, *, overwrite: bool = False, refresh: bool = False) -> list[str]:
    """Copy parsed CV data onto the candidate. By default only empty fields are filled,
    so details the candidate typed into the application form are never replaced. With ``refresh`` (a newer CV
    from the same person), the current job, summary, work history and years of experience follow the new CV."""
    from .cv_filter import text_key

    changed = []
    for name in SCALAR_FIELDS:
        value = parsed.get(name)
        if value in (None, "", 0):
            continue
        if overwrite or (refresh and name in REFRESH_FIELDS) or not getattr(candidate, name):
            if name in {"first_name", "last_name", "course", "institution", "current_employer", "current_job_title"}:
                value = str(value)[:150]
            setattr(candidate, name, value)
            changed.append(name)
    years = parsed.get("years_experience")
    if years and (overwrite or refresh or not candidate.years_experience):
        candidate.years_experience = Decimal(str(round(float(years), 1)))
        changed.append("years_experience")
    for name in LIST_FIELDS:
        merged = merge_unique(list(getattr(candidate, name) or []), list(parsed.get(name) or []))
        if merged != list(getattr(candidate, name) or []):
            setattr(candidate, name, merged)
            changed.append(name)
    for name in HISTORY_FIELDS:
        if parsed.get(name) and (overwrite or (refresh and name == "work_history") or not getattr(candidate, name)):
            setattr(candidate, name, parsed[name])
            changed.append(name)
    if parsed.get("text"):
        candidate.cv_text = parsed["text"]
        candidate.cv_digest = text_key(parsed["text"])
    candidate.parse_method = parsed.get("method") or candidate.parse_method
    candidate.parse_notes = "\n".join(parsed.get("notes") or [])
    candidate.parsed_at = timezone.now()
    return changed


def save_document(candidate, *, content: bytes, filename: str, doc_type=CandidateDocument.DocType.CV, user=None,
                  application=None, source_url: str = "", pdf: bytes | None = None) -> CandidateDocument:
    """File a document in the candidate's folder. A CV is stored as a PDF, so it opens inside the portal;
    when it had to be converted, the file as received is kept too."""
    name = os.path.basename(filename) or "document"
    document = CandidateDocument(
        candidate=candidate, doc_type=doc_type, original_name=name[:255], source_url=source_url[:500],
        uploaded_by=user if getattr(user, "is_authenticated", False) else None, application=application,
        sha256=hashlib.sha256(content).hexdigest(),
    )
    if pdf is None and doc_type == CandidateDocument.DocType.CV:
        try:
            converted, changed = to_pdf(content)
            pdf = converted if changed else None
        except ConversionError as exc:
            logger.info("CV for candidate %s kept as received: %s", candidate.pk, exc)
    if pdf is not None:
        document.original_file.save(name, ContentFile(content), save=False)
        document.file.save(os.path.splitext(name)[0] + ".pdf", ContentFile(pdf), save=False)
    else:
        document.file.save(name, ContentFile(content), save=False)
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
    duplicate: bool = False   # a CV the portal already holds: nothing was added
    set_aside: str = ""       # what the file is when it is not a CV ("a cover letter", "unreadable"…)

    @property
    def status(self) -> str:
        """added, updated, duplicate, not_cv, unreadable or error."""
        if self.set_aside:
            return "unreadable" if self.set_aside == "unreadable" else "not_cv"
        if self.error:
            return "error"
        if self.duplicate:
            return "duplicate"
        return "added" if self.created else "updated"


def find_duplicate(content: bytes) -> CandidateDocument | None:
    """The CV already on file with exactly this content, whatever it was called."""
    digest = hashlib.sha256(content).hexdigest()
    return (CandidateDocument.objects.filter(sha256=digest, doc_type=CandidateDocument.DocType.CV)
            .select_related("candidate").order_by("pk").first())


@transaction.atomic
def ingest_cv(content: bytes, filename: str, *, source: str, requisition=None, user=None, referred_by=None,
              referral_note: str = "", fallback_email: str = "", notify_team: bool = True,
              only_cvs: bool = False, region: str = "") -> IntakeResult:
    """Read a CV file, create or update the candidate, file the CV in their folder
    and (when a requisition is given) create and score the application.

    A CV the portal already holds is not added again (``duplicate``). With ``only_cvs`` (CV intake, the CV folder,
    the mailbox), a file that is not a CV is set aside and nothing is saved from it (``set_aside``). ``region`` is
    the community category HR chose for the whole upload or folder (host, pipeline, jetty, indirect…)."""
    from pipeline.services import create_application, log

    from . import regions
    from .cv_filter import judge, same_cv, text_key

    ext = os.path.splitext(filename)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        return IntakeResult(error=f"{filename}: unsupported file type")

    def already_held(candidate, document=None):
        """The CV is on file: add nothing, but still apply to the vacancy if one was chosen."""
        application = None
        if referred_by and not candidate.referred_by_id:
            candidate.referred_by, candidate.referral_note = referred_by, referral_note
            candidate.save(update_fields=["referred_by", "referral_note"])
        if regions.tag(candidate, region, "Set for the upload it came in"):
            candidate.save(update_fields=["region", "region_note", "region_fixed"])
        if requisition is not None:
            application, _ = create_application(candidate, requisition, source=source, actor=user,
                                                notify_team=notify_team)
        return IntakeResult(candidate=candidate, duplicate=True, application=application,
                            document=document or candidate.latest_cv)

    held = find_duplicate(content)
    if held:  # the very same file, whatever it is called now
        return already_held(held.candidate, held)

    parsed = parse_cv(content, filename)
    if only_cvs:
        verdict = judge(parsed, filename)
        if not verdict.is_cv:
            return IntakeResult(error=verdict.reason, set_aside=verdict.kind, parsed=parsed)
    key = text_key(parsed.get("text", ""))
    twin = Candidate.objects.filter(cv_digest=key).first() if key else None
    if twin:  # the same CV saved under another name or in another format
        return already_held(twin)
    email = parsed.get("email") or fallback_email
    candidate = find_existing(email, parsed.get("phone", ""))
    created = candidate is None
    if not created and candidate.cv_text and same_cv(candidate.cv_text, parsed.get("text", "")):
        return already_held(candidate)  # their CV again, read slightly differently (saved as Word and as PDF)
    if created:
        candidate = Candidate(source=source, created_by=user if getattr(user, "is_authenticated", False) else None,
                              referred_by=referred_by, referral_note=referral_note)
        if not parsed.get("email") and fallback_email:
            candidate.email = fallback_email
    elif referred_by and not candidate.referred_by_id:
        candidate.referred_by = referred_by
        candidate.referral_note = referral_note
    # A different CV from someone already here brings their profile up to date, unless HR corrected it by hand
    # or it came from the Excel workbooks.
    newer = not created and bool(candidate.cv_text) and not candidate.checked_at and not candidate.source_records
    apply_parsed(candidate, parsed, refresh=newer)
    if not candidate.first_name and not candidate.last_name:
        from .cv_details import name_from_filename

        candidate.first_name, candidate.last_name = (part[:80] for part in name_from_filename(filename))
    regions.tag(candidate, region, "Set for the upload it came in")
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
    if not created:
        from pipeline.matching import rescore_candidate

        rescore_candidate(candidate)  # their other applications follow the newer CV
    return IntakeResult(candidate=candidate, created=created, application=application, document=document, parsed=parsed)
