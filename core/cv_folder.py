"""Read CVs from a folder on their own: every new file dropped into a watched folder becomes a profile.

Link the folder once on the Excel link page. From then on the watcher that keeps the portal in step with Excel
(start-portal.bat on this PC, the scheduler on the server) looks in it every CV_FOLDER_SECONDS: each new file, or a
file whose content changed, is read like an upload on the CV intake page. The profile then waits for HR's check
(and, if the folder has a vacancy, is applied to it once checked). Files are never moved, renamed or deleted, and
each is read once: a copy of a file already read (same content under another name) is not read again.
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from pathlib import Path

from django.conf import settings
from django.utils import timezone

from .models import FolderFile, WatchedFolder

logger = logging.getLogger(__name__)

SETTLE_SECONDS = 20  # a file changed more recently than this may still be being copied or saved
PER_CHECK = 50       # at most this many files are read per check, so a big folder is worked through in turns
IGNORED_NAMES = {"thumbs.db", "desktop.ini", ".ds_store"}
PARTIAL_SUFFIXES = (".tmp", ".crdownload", ".part", ".partial", ".download")


class FolderError(Exception):
    pass


def link(path: str, *, source: str = "email", requisition=None, user=None, read_existing: bool = True) -> WatchedFolder:
    """Watch this folder. With ``read_existing`` False, the files already in it are marked as seen and only files
    added from now on are read."""
    folder_path = Path(str(path).strip().strip('"')).expanduser()
    if not folder_path.is_dir():
        raise FolderError(f"Folder not found: {folder_path}. Copy its full path from the File Explorer address bar.")
    folder_path = folder_path.resolve()
    folder, created = WatchedFolder.objects.update_or_create(path=str(folder_path), defaults={
        "source": source, "requisition": requisition, "linked_by": user, "state": WatchedFolder.State.OK,
        "message": "", "check_requested": True})
    if not read_existing:
        for name, full in _files(folder_path):
            stat = full.stat()
            FolderFile.objects.update_or_create(folder=folder, name=name, defaults={
                "size": stat.st_size, "modified": stat.st_mtime, "skipped": "Already in the folder when it was linked"})
    return folder


def _files(root: Path):
    """(name inside the folder, full path) for every file in it, subfolders included, skipping system and
    half-written files."""
    for directory, subdirs, names in os.walk(root):
        subdirs[:] = [d for d in subdirs if not d.startswith(".")]
        for name in names:
            lower = name.lower()
            if lower in IGNORED_NAMES or name.startswith((".", "~$")) or lower.endswith(PARTIAL_SUFFIXES):
                continue
            full = Path(directory) / name
            yield str(full.relative_to(root)).replace("\\", "/"), full


def check(*, log=logger.info, limit: int = PER_CHECK) -> list:
    """Look in every watched folder and read the new files. Returns the profiles created or updated."""
    from candidates.cv_parser import SUPPORTED_EXTENSIONS
    from candidates.intake import ingest_cv
    from requisitions.models import Requisition

    read, budget, now = [], limit, timezone.now()
    for folder in WatchedFolder.objects.select_related("requisition"):
        root = Path(folder.path)
        folder.checked_at, folder.check_requested = now, False
        if not root.is_dir():
            folder.state = WatchedFolder.State.MISSING
            folder.message = "The folder is not there (or this computer cannot reach it). Link it again if it moved."
            folder.save(update_fields=["checked_at", "check_requested", "state", "message"])
            continue
        known = {f.name: f for f in folder.files.all()}
        digests = set(folder.files.exclude(digest="").values_list("digest", flat=True))
        vacancy = folder.requisition
        if vacancy and vacancy.status not in {Requisition.Status.OPEN, Requisition.Status.APPROVED}:
            vacancy = None  # closed since: the CVs still come in, for the talent database
        new_here, waiting = 0, 0
        try:
            entries = list(_files(root))
        except OSError as exc:
            folder.state, folder.message = WatchedFolder.State.ERROR, f"Could not list the folder: {exc}"
            folder.save(update_fields=["checked_at", "check_requested", "state", "message"])
            continue
        for name, full in sorted(entries, key=lambda e: e[1].stat().st_mtime if e[1].exists() else 0):
            try:
                stat = full.stat()
            except OSError:
                continue
            seen = known.get(name)
            if seen and seen.size == stat.st_size and abs(seen.modified - stat.st_mtime) < 1:
                continue  # unchanged since it was read (or skipped)
            if time.time() - stat.st_mtime < SETTLE_SECONDS:
                waiting += 1
                continue  # still being copied or saved: next check
            if budget <= 0:
                waiting += 1
                continue
            record = seen or FolderFile(folder=folder, name=name)
            record.size, record.modified = stat.st_size, stat.st_mtime
            extension = os.path.splitext(name)[1].lower()
            if extension not in SUPPORTED_EXTENSIONS:
                record.skipped = f"Not a CV file type ({extension or 'no extension'})"
                record.save()
                continue
            if stat.st_size > settings.MAX_UPLOAD_MB * 1024 * 1024:
                record.skipped = f"Larger than {settings.MAX_UPLOAD_MB} MB"
                record.save()
                continue
            try:
                content = full.read_bytes()
            except OSError as exc:  # open elsewhere and locked: try again next time
                logger.info("Could not read %s yet: %s", full, exc)
                waiting += 1
                continue
            digest = hashlib.sha256(content).hexdigest()
            if digest in digests and (not seen or seen.digest != digest):
                record.digest, record.skipped = digest, "A copy of a CV already read from this folder"
                record.save()
                continue
            budget -= 1
            try:
                result = ingest_cv(content, os.path.basename(name), source=folder.source, requisition=vacancy,
                                   notify_team=False, needs_check=True)
            except Exception as exc:  # noqa: BLE001 - one bad file never stops the folder
                logger.exception("Could not read %s", full)
                record.digest, record.skipped = digest, f"Could not be read: {exc}"[:255]
                record.save()
                continue
            record.digest, record.read_at = digest, timezone.now()
            record.candidate = result.candidate
            record.skipped = result.error[:255] if result.error else ""
            record.save()
            digests.add(digest)
            if result.candidate:
                read.append(result.candidate)
                new_here += 1
                log(f"CV folder {folder.name}: read {name} → {result.candidate.full_name}")
        folder.state = WatchedFolder.State.OK
        folder.message = (f"{waiting} file{'s' if waiting != 1 else ''} waiting for the next check."
                          if waiting else "")
        if new_here:
            folder.files_read += new_here
            folder.last_read_at = timezone.now()
        folder.save()
    if read:
        _tell_hr(read)
    return read


def _tell_hr(people):
    from .notify import hr_team, notify

    count = len({p.pk for p in people})
    notify(hr_team(), f"{count} new CV{'s' if count != 1 else ''} read from the CV folder",
           "Check each new profile against its CV; it can then be matched and put forward.",
           url="/candidates/check/", email=False)


def summary(folder: WatchedFolder) -> dict:
    files = folder.files.all()
    return {"read": files.filter(read_at__isnull=False, skipped="").count(),
            "skipped": files.exclude(skipped="").exclude(skipped__startswith="Already in the folder").count(),
            "recent": list(files.filter(read_at__isnull=False).select_related("candidate")[:5])}
