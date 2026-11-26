"""Read CVs from a folder on their own: every new file dropped into a linked folder becomes a profile.

Link a folder once (CV intake page, or the Excel link page). The background worker (intake/worker.py) then notices
each new or changed file, keeps a private copy with a receipt, and reads it like an upload: only a CV becomes a
profile (and, if the folder has a vacancy, is applied to it and scored at once). Every file gets a visible outcome
on its receipt: added, brought up to date, already in the portal, not a CV, could not be read, or "same person?".
Files are never moved, renamed or deleted, and each version of a file is read once.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from django.db.models import Count
from django.utils import timezone

from .models import FolderFile, WatchedFolder

logger = logging.getLogger(__name__)

HELD = "Already in the portal"      # receipts' wording, kept for the summaries
UNREAD = "Could not be read"


class FolderError(Exception):
    pass


def link(path: str, *, source: str = "email", requisition=None, user=None, read_existing: bool = True,
         region: str = "", label: str = "", subfolders: bool = True) -> WatchedFolder:
    """Watch this folder. It shows as waiting until the worker has opened it. With ``read_existing`` False, the files
    already in it are left alone and only files added from now on are read."""
    folder_path = Path(str(path).strip().strip('"')).expanduser()
    if not str(path).strip() or not folder_path.is_dir():
        raise FolderError(f"Folder not found: {folder_path}. Copy its full path from the File Explorer address bar "
                          "(on the server: a path the portal's worker can open).")
    folder_path = folder_path.resolve()
    existing = WatchedFolder.objects.filter(path=str(folder_path)).first()
    created = existing is None
    folder, _ = WatchedFolder.objects.update_or_create(path=str(folder_path), defaults={
        "source": source, "requisition": requisition, "region": region, "linked_by": user,
        "label": label[:120] or (existing.label if existing else ""), "include_subfolders": subfolders,
        "location": WatchedFolder.Location.SERVER, "check_requested": True,
        **({"state": WatchedFolder.State.PENDING, "message": "", "import_existing": read_existing,
            "baseline_done": False} if created else {})})
    if created and not read_existing:
        from intake.watch import folder_files

        for name, full in folder_files(folder_path, subfolders=subfolders):
            stat = full.stat()
            FolderFile.objects.update_or_create(folder=folder, name=name, defaults={
                "size": stat.st_size, "modified": stat.st_mtime, "skipped": "Already in the folder when it was linked"})
        WatchedFolder.objects.filter(pk=folder.pk).update(baseline_done=True)
        folder.baseline_done = True
    return folder


def check(*, log=logger.info, limit: int | None = None) -> list:
    """Look in every linked folder now and read the new files (in this process). Returns the profiles created or
    updated. The worker does the same on its own; this is for the scheduler's run and the tests."""
    from intake import sync

    return sync.folders(log=log)


def tell_hr(people):
    from .notify import hr_team, notify

    count = len({p.pk for p in people})
    notify(hr_team(), f"{count} new CV{'s' if count != 1 else ''} read from the CV folder",
           "They are in the talent database, ready to match to vacancies.", url="/candidates/match/", email=False)


def summary(folder: WatchedFolder) -> dict:
    """Counts of what came of the folder's files, from their receipts."""
    from intake.models import Receipt

    receipts = Receipt.objects.filter(folder=folder)
    outcomes = dict(receipts.values_list("outcome").annotate(n=Count("pk")).order_by())
    not_cvs = receipts.filter(outcome=Receipt.Outcome.NOT_CV)
    return {"read": outcomes.get("added", 0) + outcomes.get("updated", 0), "held": outcomes.get("duplicate", 0),
            "skipped": outcomes.get("not_cv", 0), "unread": outcomes.get("unreadable", 0),
            "review": outcomes.get("identity", 0),
            "waiting": receipts.filter(status__in=[Receipt.Status.RECEIVED, Receipt.Status.PROCESSING]).count(),
            "failed": receipts.filter(status=Receipt.Status.FAILED).count(),
            "examples": [f"{r.source_path}: {r.message}" for r in not_cvs[:6]],
            "recent": [r.candidate for r in receipts.filter(outcome__in=["added", "updated"])
                       .select_related("candidate")[:5] if r.candidate]}


def retry_unread(folder: WatchedFolder) -> int:
    """Read again the files that could not be read (after OCR or AI was set up)."""
    from intake.models import Receipt
    from intake.receive import requeue

    count = 0
    for receipt in Receipt.objects.filter(folder=folder, outcome=Receipt.Outcome.UNREADABLE).exclude(stored=""):
        requeue(receipt)
        count += 1
    if count:
        WatchedFolder.objects.filter(pk=folder.pk).update(check_requested=True)
    return count


def file_kind(name: str) -> str:
    return os.path.splitext(name)[1].lower()


def stamp():
    return timezone.now()
