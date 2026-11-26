"""Receive a file: keep the original privately and queue its reading, in one transaction, before anything else.

Whatever happens next (the file is not a CV, the worker stops, the database is busy), the receipt says the file
arrived, what it was and where it came from, and keeps the bytes, so it can be retried or checked later.
"""

from __future__ import annotations

import hashlib
import os
import threading
from datetime import timedelta

from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.utils import timezone

from . import queue
from .models import Job, Receipt

# Set when this process queues work, so its own worker threads start at once instead of at their next look.
WAKE = threading.Event()


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def receive(content: bytes, name: str, *, channel: str, kind: str = Receipt.Kind.CV, folder=None, workbook=None,
            connector=None, requisition=None, user=None, options: dict | None = None, source_path: str = "",
            modified: float | None = None, delay: float = 0, store: bool = True) -> tuple[Receipt, bool]:
    """The receipt for this file, and whether it is new. The same content from the same place in a linked folder is
    received once, however often it is seen or sent (renames, a second scan, a duplicate notification)."""
    sha = digest(content)
    if folder is not None:
        known = Receipt.objects.filter(folder=folder, source_path=source_path, sha256=sha).first()
        if known:
            return known, False
    receipt = Receipt(kind=kind, channel=channel, folder=folder, workbook=workbook, connector=connector,
                      requisition=requisition, original_name=os.path.basename(name)[:255] or "file",
                      source_path=source_path[:700], size=len(content), modified=modified, sha256=sha,
                      received_by=user if getattr(user, "is_authenticated", False) else None, options=options or {})
    if store:
        receipt.stored.save(receipt.original_name, ContentFile(content), save=False)
    try:
        with transaction.atomic():
            receipt.save()
            _queue_for(receipt, delay)
    except IntegrityError:  # seen by another process at the same moment
        if receipt.stored:
            receipt.stored.delete(save=False)
        return Receipt.objects.get(folder=folder, source_path=source_path, sha256=sha), False
    WAKE.set()
    return receipt, True


def _queue_for(receipt: Receipt, delay: float = 0):
    run_after = timezone.now() + timedelta(seconds=delay) if delay else None
    if receipt.kind == Receipt.Kind.WORKBOOK:
        # Saves of one workbook are imported one at a time, newest content last: a save made while an earlier one
        # waits replaces it in the queue (the earlier receipt is marked as replaced when its job runs).
        return queue.enqueue(Job.Kind.WORKBOOK, receipt=receipt, payload={"receipt": receipt.pk},
                             key=f"workbook:{receipt.workbook_id}", run_after=run_after)
    return queue.enqueue(Job.Kind.CV, receipt=receipt, payload={"receipt": receipt.pk}, key=f"receipt:{receipt.pk}",
                         run_after=run_after)


def requeue(receipt: Receipt, *, options: dict | None = None, user=None) -> Job:
    """Read this receipt again (after OCR was set up, or with HR's answer to an identity question)."""
    with transaction.atomic():
        if options:
            receipt.options = {**(receipt.options or {}), **options}
        receipt.status, receipt.outcome, receipt.message = Receipt.Status.RECEIVED, Receipt.Outcome.PENDING, ""
        receipt.resolved_by = user if getattr(user, "is_authenticated", False) else None
        receipt.save(update_fields=["options", "status", "outcome", "message", "resolved_by"])
        job = queue.enqueue(Job.Kind.CV, receipt=receipt, payload={"receipt": receipt.pk, "again": True},
                            key=f"receipt:{receipt.pk}")
    WAKE.set()
    return job
