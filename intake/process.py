"""What the worker does with each job: read a CV, read a scan (OCR), import a workbook save, re-assess.

Every handler starts by looking at its receipt: a receipt already finished (the job ran, then the worker stopped
before marking the job done) is not read twice. Reading a CV and recording its outcome happen in one transaction, so
a worker that stops half-way leaves nothing half-done; the job is picked up again once.
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
import time
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import Job, Receipt

logger = logging.getLogger(__name__)

FINISHED = {Receipt.Status.DONE, Receipt.Status.NEEDS_REVIEW, Receipt.Status.SUPERSEDED}
OUTCOME = {  # IntakeResult.status -> (receipt status, outcome)
    "added": (Receipt.Status.DONE, Receipt.Outcome.ADDED),
    "updated": (Receipt.Status.DONE, Receipt.Outcome.UPDATED),
    "duplicate": (Receipt.Status.DONE, Receipt.Outcome.DUPLICATE),
    "not_cv": (Receipt.Status.DONE, Receipt.Outcome.NOT_CV),
    "unreadable": (Receipt.Status.DONE, Receipt.Outcome.UNREADABLE),
    "identity": (Receipt.Status.NEEDS_REVIEW, Receipt.Outcome.IDENTITY),
    "error": (Receipt.Status.FAILED, Receipt.Outcome.ERROR),
}


class Retry(Exception):
    """Try this job again later (a file still locked, a database busy)."""


def run(job: Job, *, slow_lane_running: bool = True):
    """Do one job. Raises to have the queue try it again later."""
    if job.kind == Job.Kind.CV:
        return read_cv(_receipt(job), defer_ocr=slow_lane_running, again=bool(job.payload.get("again")))
    if job.kind == Job.Kind.OCR:
        return read_cv(_receipt(job), defer_ocr=False, again=True)
    if job.kind == Job.Kind.WORKBOOK:
        return import_workbook(_receipt(job))
    if job.kind == Job.Kind.RESCORE_VACANCY:
        from pipeline.matching import rescore_requisition
        from requisitions.models import Requisition

        requisition = Requisition.objects.filter(pk=job.payload.get("requisition")).first()
        return rescore_requisition(requisition) if requisition else 0
    if job.kind == Job.Kind.RESCORE_CANDIDATE and job.payload.get("application"):
        from pipeline.matching import is_stale, score_application
        from pipeline.models import Application

        application = Application.objects.select_related("candidate", "requisition").filter(
            pk=job.payload["application"]).first()
        if application and is_stale(application):
            score_application(application)
        return 1
    if job.kind == Job.Kind.RESCORE_CANDIDATE:
        from candidates.models import Candidate
        from pipeline.matching import rescore_candidate

        candidate = Candidate.objects.filter(pk=job.payload.get("candidate")).first()
        return rescore_candidate(candidate) if candidate else 0
    if job.kind == Job.Kind.AI_ASSESS:
        from pipeline import ai_assess
        from pipeline.models import Application

        application = Application.objects.select_related("candidate", "requisition").filter(
            pk=job.payload.get("application")).first()
        return ai_assess.run(application) if application and ai_assess.can_assess(application) else None
    raise ValueError(f"Unknown job kind {job.kind}")


def _receipt(job: Job) -> Receipt:
    pk = job.payload.get("receipt") or job.receipt_id
    return Receipt.objects.select_related("folder", "workbook", "requisition", "received_by").get(pk=pk)


def _content(receipt: Receipt) -> bytes:
    if not receipt.stored:
        raise ValueError("The file was not kept, so it cannot be read again.")
    with receipt.stored.open("rb") as handle:
        return handle.read()


# --------------------------------------------------------------------------- CVs
def _vacancy(receipt: Receipt):
    """The vacancy to apply the CV to: none once it has closed (the CV still joins the talent pool)."""
    from requisitions.models import Requisition

    vacancy = receipt.requisition
    if vacancy and vacancy.status not in {Requisition.Status.OPEN, Requisition.Status.APPROVED}:
        return None
    return vacancy


def read_cv(receipt: Receipt, *, defer_ocr: bool = True, again: bool = False):
    """Read one received CV: text, OCR when needed (in the slow lane), filter, duplicates, profile, application."""
    from candidates.intake import ingest_cv
    from candidates.models import Candidate

    if receipt.status in FINISHED and not again:
        return None  # done before the worker stopped
    options = receipt.options or {}
    Receipt.objects.filter(pk=receipt.pk).update(status=Receipt.Status.PROCESSING, started_at=timezone.now(),
                                                 attempts=receipt.attempts + 1)
    content = _content(receipt)
    same_as = Candidate.objects.filter(pk=options.get("same_as")).first() if options.get("same_as") else None
    referred_by = None
    if options.get("referred_by"):
        from accounts.models import User

        referred_by = User.objects.filter(pk=options["referred_by"]).first()
    with transaction.atomic():
        result = ingest_cv(
            content, receipt.original_name, source=options.get("source") or _default_source(receipt),
            requisition=_vacancy(receipt), user=receipt.received_by, referred_by=referred_by,
            referral_note=options.get("note", ""), notify_team=False, only_cvs=not options.get("every_file"),
            region=options.get("region", ""), defer_ocr=defer_ocr, review_identity=not options.get("trust_contact"),
            same_as=same_as, new_person=bool(options.get("new_person")))
        record(receipt, result)
    if result.status == "deferred":
        from . import queue

        queue.enqueue(Job.Kind.OCR, receipt=receipt, payload={"receipt": receipt.pk}, key=f"ocr:{receipt.pk}")
    return result


def _default_source(receipt: Receipt) -> str:
    if receipt.folder_id and receipt.folder:
        return receipt.folder.source
    return {"mailbox": "email", "upload": "upload"}.get(receipt.channel, "upload")


def record(receipt: Receipt, result):
    """Write the outcome of reading a CV on its receipt (and its folder's counts)."""
    status = result.status
    receipt.details = dict(receipt.details or {})
    parsed = result.parsed or {}
    receipt.details.update(method=parsed.get("method", ""), notes=[str(n) for n in parsed.get("notes") or []][:5])
    if status == "deferred":
        receipt.status, receipt.outcome = Receipt.Status.RECEIVED, Receipt.Outcome.PENDING
        receipt.message = "A scan or photo: waiting for its text to be read (OCR)."
        receipt.save(update_fields=["status", "outcome", "message", "details"])
        return
    receipt.status, receipt.outcome = OUTCOME[status]
    receipt.candidate = result.candidate or result.identity
    receipt.application = result.application if hasattr(result.application, "pk") else None
    receipt.finished_at = timezone.now()
    if status == "identity":
        person = result.identity
        name = f"{parsed.get('first_name', '')} {parsed.get('last_name', '')}".strip() or "no name found"
        receipt.message = (f"The email or phone on this CV belongs to {person.full_name}, but the name on it is "
                           f"{name}. Same person, or someone else?")
        receipt.details.update(name=name, email=parsed.get("email", ""), phone=parsed.get("phone", ""))
    elif status == "duplicate":
        receipt.message = f"Already in the portal: {result.candidate.full_name}."
    elif status in {"added", "updated"}:
        receipt.message = ("New profile: " if status == "added" else "Profile brought up to date: ") + \
            result.candidate.full_name
    else:
        receipt.message = result.error or "Could not be read."
    receipt.save(update_fields=["status", "outcome", "candidate", "application", "finished_at", "message", "details"])
    if receipt.folder_id and status in {"added", "updated"}:
        from core.models import WatchedFolder
        from django.db.models import F

        WatchedFolder.objects.filter(pk=receipt.folder_id).update(files_read=F("files_read") + 1,
                                                                 last_read_at=timezone.now())


# --------------------------------------------------------------------------- workbooks
def import_workbook(receipt: Receipt):
    """Import one save of a linked workbook: only the rows that changed since the last load, unless a full refresh
    was asked for. A file that cannot be read, or lacks the sheets it had before, changes nothing in the portal: the
    last good data stays, and the workbook shows why."""
    from core import excel_link
    from core.models import LinkedWorkbook
    from core.workbook_import import SHEET_LABELS, WorkbookError, WorkbookImporter, changed_rows, read_sheets

    workbook = receipt.workbook
    if workbook is None:
        _finish(receipt, Receipt.Status.FAILED, Receipt.Outcome.ERROR, "The workbook link was removed.")
        return None
    if receipt.status in FINISHED:
        return None
    newer = (Receipt.objects.filter(workbook=workbook, kind=Receipt.Kind.WORKBOOK, pk__gt=receipt.pk)
             .exclude(status__in=[Receipt.Status.FAILED, Receipt.Status.SUPERSEDED]).exists())
    if newer:  # a later save is already in: importing this one would only go back in time
        _finish(receipt, Receipt.Status.SUPERSEDED, Receipt.Outcome.PENDING, "A newer save replaced this one.")
        return None
    started = time.time()
    Receipt.objects.filter(pk=receipt.pk).update(status=Receipt.Status.PROCESSING, started_at=timezone.now(),
                                                 attempts=receipt.attempts + 1)
    # Older saves still waiting are covered by this one.
    Receipt.objects.filter(workbook=workbook, kind=Receipt.Kind.WORKBOOK, pk__lt=receipt.pk,
                           status=Receipt.Status.RECEIVED).update(
        status=Receipt.Status.SUPERSEDED, message="A newer save replaced this one.", finished_at=timezone.now())
    force = bool((receipt.options or {}).get("full"))
    name = Path(receipt.source_path or receipt.original_name).name or "workbook.xlsx"
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / name
        with receipt.stored.open("rb") as source, open(copy, "wb") as target:
            shutil.copyfileobj(source, target)
        skipped = []
        try:
            sheets = read_sheets([str(copy)], require_all=False, skipped=skipped)
        except WorkbookError as exc:
            _workbook_failed(workbook, receipt, LinkedWorkbook.State.ERROR, str(exc))
            return None
        expected = [k for k in (workbook.expected_sheets or "").split(",") if k.strip()]
        missing = [SHEET_LABELS.get(k.strip(), k) for k in expected if k.strip() not in sheets]
        if missing:
            _workbook_failed(workbook, receipt, LinkedWorkbook.State.INVALID,
                             f"This save has no {', '.join(missing)} sheet (or its column headings changed), so "
                             "nothing was loaded from it and the portal keeps the last good data. Check the headings "
                             "in the first row, or link the workbook again if its layout changed on purpose.")
            return None
        full = force or not workbook.row_hashes
        subset, hashes, changed = changed_rows(sheets, None if full else workbook.row_hashes)
        counts = {}
        report = ""
        with transaction.atomic():
            if subset:
                importer = WorkbookImporter([str(copy)], replace=False, log=lambda message: None, require_all=False,
                                            sheets=subset, incremental=not full, skipped=skipped if full else None)
                importer.report_dir = str(excel_link.report_dir()) if full else None
                result = importer.run()
                counts = {k: v for k, v in sorted(result.counts.items()) if v}
                report = result.report_path
                receipt.details = {"rows_changed": changed, "full": full, "counts": counts,
                                   **_review_items(result, skipped)}
            else:
                receipt.details = {"rows_changed": 0, "full": full, "counts": {}, **_review_items(None, skipped)}
            now = timezone.now()
            workbook.fingerprint, workbook.row_hashes = receipt.sha256, hashes
            workbook.sheets = ", ".join(SHEET_LABELS[k] for k in SHEET_LABELS if k in sheets)
            if not workbook.expected_sheets:
                workbook.expected_sheets = ",".join(k for k in SHEET_LABELS if k in sheets)
            if receipt.source_path:
                workbook.current_file = receipt.source_path
            if receipt.modified:
                from datetime import datetime, timezone as dt_timezone

                workbook.file_modified_at = datetime.fromtimestamp(receipt.modified, tz=dt_timezone.utc)
                workbook.last_latency = round(time.time() - receipt.modified, 2)
            workbook.synced_at = workbook.checked_at = now
            workbook.state = LinkedWorkbook.State.OK
            workbook.message = excel_link.describe(counts) if subset else "Checked: no records changed in this save."
            workbook.counts = counts or workbook.counts
            if report:
                workbook.report_path = report
            workbook.refresh_requested = False
            workbook.save()
            receipt.status = Receipt.Status.DONE
            receipt.outcome = Receipt.Outcome.IMPORTED if subset else Receipt.Outcome.UNCHANGED
            receipt.message = workbook.message
            receipt.finished_at = timezone.now()
            receipt.details["seconds"] = round(time.time() - started, 3)
            receipt.save(update_fields=["status", "outcome", "message", "finished_at", "details"])
    return counts


def _review_items(result, skipped) -> dict:
    """What HR should look at from this import: rows held as uncertain identities, unreadable values, sheets not read."""
    items = {"sheets_not_read": [f"{title} ({file})" for file, title, _kind, _used in skipped]}
    if result is None:
        return items
    items["held"] = [{"rows": rows, "name": name, "email": email, "reason": reason}
                     for rows, name, email, _phone, _link, reason in result.applications_held[:50]]
    items["held_count"] = len(result.applications_held)
    items["issues"] = [{"sheet": sheet, "row": row, "column": column, "value": str(value)[:80], "note": note}
                       for _file, sheet, row, column, value, note in result.issues[:50]]
    items["issue_count"] = len(result.issues)
    items["shared_contacts"] = [list(map(str, item)) for item in result.shared_contacts[:20]]
    return items


def _workbook_failed(workbook, receipt, state, message):
    workbook.state, workbook.message, workbook.checked_at = state, message, timezone.now()
    workbook.refresh_requested = False
    workbook.save(update_fields=["state", "message", "checked_at", "refresh_requested"])
    _finish(receipt, Receipt.Status.FAILED, Receipt.Outcome.INVALID if state == "invalid" else Receipt.Outcome.ERROR,
            message)


def _finish(receipt, status, outcome, message):
    receipt.status, receipt.outcome, receipt.message = status, outcome, message[:2000]
    receipt.finished_at = timezone.now()
    receipt.save(update_fields=["status", "outcome", "message", "finished_at"])


# --------------------------------------------------------------------------- from a web request
def read_now(receipt: Receipt, owner: str = "web"):
    """Read an upload inside the request (the page shows the outcome at once). The receipt and its job are already
    saved, so if the request dies part-way, the worker reads the file later."""
    from . import queue

    job = receipt.jobs.filter(status=Job.Status.QUEUED).order_by("pk").first()
    if job is None or not queue.claim_job(job, owner, lease_seconds=600):
        return None
    try:
        result = read_cv(receipt, defer_ocr=False)
    except Exception as exc:  # noqa: BLE001 - one bad file never stops the others
        from candidates.intake import IntakeResult

        logger.exception("Could not read %s", receipt.original_name)
        queue.finish(job, error=str(exc), retry_in=60)
        message = (f"Could not be read ({exc}). The file is kept and the portal tries once more in the background; "
                   "if that fails too, open it to check it is a CV.")
        Receipt.objects.filter(pk=receipt.pk, status=Receipt.Status.PROCESSING).update(
            status=Receipt.Status.RECEIVED, message=message)
        return IntakeResult(error=message, receipt=receipt)
    queue.finish(job)
    return result


def cleanup_stored(keep_days: int | None = None, keep_workbook_saves: int = 10) -> int:
    """Remove stored copies no longer needed: CVs that became (or matched) a profile, whose CV is filed with the
    profile anyway, and workbook saves beyond the last few. Receipts themselves stay, with their fingerprint; a file
    that failed, needs review or could not be read keeps its copy as evidence."""
    keep_days = settings.RECEIPT_KEEP_DAYS if keep_days is None else keep_days
    cutoff = timezone.now() - timedelta(days=keep_days)
    removed = 0
    done = (Receipt.objects.filter(kind=Receipt.Kind.CV, finished_at__lt=cutoff, status=Receipt.Status.DONE,
                                   outcome__in=[Receipt.Outcome.ADDED, Receipt.Outcome.UPDATED,
                                                Receipt.Outcome.DUPLICATE, Receipt.Outcome.NOT_CV])
            .exclude(stored=""))
    for receipt in done.iterator():
        receipt.stored.delete(save=True)
        removed += 1
    from core.models import LinkedWorkbook

    for workbook in LinkedWorkbook.objects.all():
        old = (Receipt.objects.filter(workbook=workbook, kind=Receipt.Kind.WORKBOOK).exclude(stored="")
               .exclude(status__in=[Receipt.Status.RECEIVED, Receipt.Status.PROCESSING])
               .order_by("-pk")[keep_workbook_saves:])
        for receipt in old:
            receipt.stored.delete(save=True)
            removed += 1
    return removed


def file_ext(name: str) -> str:
    return os.path.splitext(name)[1].lower()
