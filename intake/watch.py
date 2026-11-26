"""Notice saves of the linked workbooks and new files in the linked CV folders, and receive them.

Workbooks are looked at every WORKBOOK_POLL_SECONDS (a file's size and time only, so this costs next to nothing).
A changed file is read once it is complete: Excel saves to a temporary file and renames it, so the workbook either is
the old one or the new one; another program copying the file in may leave it half-written for a moment, which the
check of the .xlsx (a zip) catches. Every WORKBOOK_RECHECK_SECONDS each file's content is compared as well, for saves
a network share did not report.

CV folders are walked every CV_FOLDER_SECONDS, and at once when the system reports a change (watchdog, where
installed). A new or changed file is received once it has not changed for CV_STABLE_SECONDS. Files are never moved,
renamed or deleted.
"""

from __future__ import annotations

import fnmatch
import io
import logging
import os
import threading
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path

from django.conf import settings
from django.utils import timezone

from .models import Receipt
from .receive import receive

logger = logging.getLogger(__name__)

IGNORED_NAMES = {"thumbs.db", "desktop.ini", ".ds_store"}
PARTIAL_SUFFIXES = (".tmp", ".crdownload", ".part", ".partial", ".download")
LOCKED_GIVE_UP = 60  # seconds a workbook may stay unreadable before it is shown as such


def is_temporary(name: str) -> bool:
    lower = name.lower()
    return (lower in IGNORED_NAMES or name.startswith((".", "~$")) or lower.endswith(PARTIAL_SUFFIXES))


def complete_xlsx(content: bytes) -> bool:
    """Whether these bytes are a whole .xlsx (a zip whose directory and entries are intact)."""
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            return archive.testzip() is None and any(n.startswith("xl/") for n in archive.namelist())
    except (zipfile.BadZipFile, OSError, ValueError, EOFError):
        return False


# --------------------------------------------------------------------------- workbooks
def current_path(workbook) -> Path | None:
    """The file a workbook link points at now: the file itself, or the newest file in the folder that fits the
    pattern (temporary files and the portal's own "Portal updates.xlsx" never count)."""
    from core.excel_updates import is_updates_file
    from core.models import LinkedWorkbook

    if workbook.mode != LinkedWorkbook.Mode.LATEST:
        return Path(workbook.path)
    folder = Path(workbook.path)
    best, best_time = None, -1.0
    try:
        entries = list(os.scandir(folder))
    except OSError:
        return None
    for entry in entries:
        if not entry.is_file() or is_temporary(entry.name) or not entry.name.lower().endswith(".xlsx"):
            continue
        if workbook.pattern and not fnmatch.fnmatch(entry.name.lower(), workbook.pattern.lower()):
            continue
        if is_updates_file(Path(entry.path)):
            continue
        stamp = entry.stat().st_mtime
        if stamp > best_time:
            best, best_time = Path(entry.path), stamp
    return best


@dataclass
class Seen:
    path: str = ""
    size: int = -1
    mtime_ns: int = -1
    since: float = 0.0       # when this size/time was first seen
    failing_since: float = 0.0


class WorkbookWatch:
    """Looks at the linked workbooks; receives each completed save whose content differs from the last one loaded."""

    def __init__(self, log=logger.info):
        self.log = log
        self.seen: dict[int, Seen] = {}
        self.next_recheck = 0.0
        self.links = []
        self.links_loaded = 0.0

    def _links(self):
        from core.models import LinkedWorkbook

        if time.monotonic() - self.links_loaded > 2:  # pick up new links and refresh requests every 2 seconds
            # Files with the requisition tracker first, so interviews in another file can find their requisitions.
            self.links = sorted(LinkedWorkbook.objects.filter(connector__isnull=True),
                                key=lambda w: "requisition tracker" not in (w.sheets or "").lower())
            self.links_loaded = time.monotonic()
        return self.links

    def poll(self) -> int:
        """One look at every linked workbook. Returns how many saves were received."""
        recheck = time.monotonic() >= self.next_recheck
        if recheck:
            self.next_recheck = time.monotonic() + settings.WORKBOOK_RECHECK_SECONDS
            self.links_loaded = 0
        received = 0
        for workbook in self._links():
            try:
                received += self.look(workbook, recheck=recheck)
            except Exception:  # noqa: BLE001 - one link failing never stops the others
                logger.exception("Looking at %s failed", workbook.path)
        return received

    def look(self, workbook, *, recheck: bool = False) -> int:
        from core.models import LinkedWorkbook

        path = current_path(workbook)
        state = self.seen.setdefault(workbook.pk, Seen())
        if path is None or not path.is_file():
            if recheck or state.size != -2:
                state.size = -2
                self._mark(workbook, LinkedWorkbook.State.MISSING,
                           "The file is not there (or the worker cannot reach it). The portal keeps the last data "
                           "loaded from it." if workbook.mode == "file" else
                           f"No file named like '{workbook.pattern}' in the folder (or the worker cannot reach it).")
            return 0
        try:
            stat = path.stat()
        except OSError:
            return 0
        changed = (str(path), stat.st_size, stat.st_mtime_ns) != (state.path, state.size, state.mtime_ns)
        if changed:
            state.path, state.size, state.mtime_ns, state.since = str(path), stat.st_size, stat.st_mtime_ns, time.time()
        if not (changed or recheck or workbook.refresh_requested or not workbook.fingerprint or state.failing_since):
            return 0
        try:
            content = path.read_bytes()
        except OSError as exc:  # open in a program that locks it: try again at the next look
            return self._failing(workbook, state, f"The file could not be opened ({exc.strerror or exc}).")
        try:
            after = path.stat()
        except OSError:
            return 0
        if (after.st_size, after.st_mtime_ns) != (stat.st_size, stat.st_mtime_ns) or len(content) != stat.st_size:
            return 0  # still being written: next look
        settled = time.time() - stat.st_mtime >= settings.WORKBOOK_STABLE_SECONDS
        if not complete_xlsx(content):
            if not settled:
                return 0
            return self._failing(workbook, state, "The file is not a complete .xlsx workbook (still being copied, "
                                                  "or saved in another format).")
        state.failing_since = 0.0
        from .receive import digest

        sha = digest(content)
        if sha == workbook.fingerprint and not workbook.refresh_requested:
            if recheck:
                self._checked(workbook)
            return 0
        if Receipt.objects.filter(workbook=workbook, sha256=sha, status__in=[Receipt.Status.RECEIVED,
                                                                              Receipt.Status.PROCESSING]).exists():
            return 0  # this save is already waiting to be imported
        receipt, new = receive(content, path.name, kind=Receipt.Kind.WORKBOOK, channel=Receipt.Channel.WORKBOOK,
                               workbook=workbook, source_path=str(path), modified=stat.st_mtime,
                               options={"full": bool(workbook.refresh_requested)})
        if new:
            from core.models import LinkedWorkbook

            LinkedWorkbook.objects.filter(pk=workbook.pk).update(received_at=timezone.now(), checked_at=timezone.now(),
                                                                 refresh_requested=False)
            workbook.refresh_requested = False
            self.log(f"{workbook.name}: save received ({len(content) // 1024:,} KB)")
        return int(new)

    def _failing(self, workbook, state, message) -> int:
        from core.models import LinkedWorkbook

        if not state.failing_since:
            state.failing_since = time.time()
        elif time.time() - state.failing_since > LOCKED_GIVE_UP:
            self._mark(workbook, LinkedWorkbook.State.ERROR, message + " The portal keeps the last data loaded.")
        return 0

    def _mark(self, workbook, state, message):
        """Show the link as missing or unreadable. The records already loaded stay as they are."""
        from core.models import LinkedWorkbook

        workbook.state, workbook.message, workbook.checked_at = state, message, timezone.now()
        LinkedWorkbook.objects.filter(pk=workbook.pk).update(state=state, message=message, checked_at=workbook.checked_at,
                                                             refresh_requested=False)

    def _checked(self, workbook):
        """An unchanged file: 'last checked' moves on, 'last loaded' does not."""
        from core.models import LinkedWorkbook

        now = timezone.now()
        fields = {"checked_at": now}
        if workbook.state in {LinkedWorkbook.State.MISSING, LinkedWorkbook.State.OFFLINE, LinkedWorkbook.State.ERROR}:
            fields.update(state=LinkedWorkbook.State.OK, message="The file is back and unchanged.")
        LinkedWorkbook.objects.filter(pk=workbook.pk).update(**fields)


# --------------------------------------------------------------------------- CV folders
def folder_files(root: Path, *, subfolders: bool = True):
    """(path inside the folder, full path) of every file in it, skipping system and half-written files."""
    if not subfolders:
        for entry in os.scandir(root):
            if entry.is_file() and not is_temporary(entry.name):
                yield entry.name, Path(entry.path)
        return
    for directory, subdirs, names in os.walk(root):
        subdirs[:] = [d for d in subdirs if not d.startswith(".")]
        for name in names:
            if is_temporary(name):
                continue
            full = Path(directory) / name
            yield str(full.relative_to(root)).replace("\\", "/"), full


def verify(folder) -> bool:
    """Open the folder as the worker; mark it Linked or Unavailable. Returns whether it can be read."""
    from core.models import WatchedFolder

    root = Path(folder.path)
    now = timezone.now()
    try:
        ok = root.is_dir()
        if ok:
            next(iter(os.scandir(root)), None)
    except OSError as exc:
        ok, reason = False, str(exc.strerror or exc)
    else:
        reason = "The folder is not there, or the worker cannot reach it."
    if ok:
        fields = {"verified_at": now, "checked_at": now}
        if folder.state != WatchedFolder.State.OK:
            fields.update(state=WatchedFolder.State.OK, message="")
    else:
        fields = {"state": WatchedFolder.State.MISSING, "checked_at": now,
                  "message": f"{reason} Imported candidates are kept; files are read again once it is back."}
    WatchedFolder.objects.filter(pk=folder.pk).update(**fields)
    for name, value in fields.items():
        setattr(folder, name, value)
    return ok


def scan_folder(folder, *, log=logger.info) -> dict:
    """Receive every new or changed file of one linked folder (on the server). Returns counts."""
    from candidates.cv_parser import SUPPORTED_EXTENSIONS
    from core.models import FolderFile, WatchedFolder

    counts = {"received": 0, "waiting": 0, "seen": 0, "left_out": 0}
    if not verify(folder):
        return counts
    root = Path(folder.path)
    known = {f.name: f for f in FolderFile.objects.filter(folder=folder)}
    first_look = not folder.baseline_done
    errors = 0
    try:
        entries = list(folder_files(root, subfolders=folder.include_subfolders))
    except OSError as exc:
        WatchedFolder.objects.filter(pk=folder.pk).update(state=WatchedFolder.State.ERROR,
                                                          message=f"Could not list the folder: {exc}")
        return counts
    for name, full in entries:
        try:
            stat = full.stat()
        except OSError:
            continue
        seen = known.get(name)
        if seen and seen.size == stat.st_size and abs(seen.modified - stat.st_mtime) < 1:
            counts["seen"] += 1
            continue
        if first_look and not folder.import_existing:
            FolderFile.objects.update_or_create(folder=folder, name=name, defaults={
                "size": stat.st_size, "modified": stat.st_mtime, "skipped": "Already in the folder when it was linked"})
            counts["seen"] += 1
            continue
        if time.time() - stat.st_mtime < settings.CV_STABLE_SECONDS:
            counts["waiting"] += 1
            continue
        extension = os.path.splitext(name)[1].lower()
        options = {"source": folder.source, "region": folder.region}
        if extension not in SUPPORTED_EXTENSIONS or stat.st_size > settings.MAX_UPLOAD_MB * 1024 * 1024:
            why = (f"Not a CV: not a file type the portal reads ({extension or 'no extension'})."
                   if extension not in SUPPORTED_EXTENSIONS else f"Larger than {settings.MAX_UPLOAD_MB} MB.")
            _left_out(folder, name, full, stat, why)
            counts["left_out"] += 1
            continue
        try:
            content = full.read_bytes()
        except OSError:  # open elsewhere and locked: next look
            counts["waiting"] += 1
            errors += 1
            continue
        try:
            receipt, new = receive(content, full.name, channel=Receipt.Channel.FOLDER, folder=folder,
                                   requisition=folder.requisition, source_path=name, modified=stat.st_mtime,
                                   options=options)
        except Exception:  # noqa: BLE001 - one file never stops the folder
            logger.exception("Could not receive %s", full)
            errors += 1
            continue
        FolderFile.objects.update_or_create(folder=folder, name=name, defaults={
            "size": stat.st_size, "modified": stat.st_mtime, "digest": receipt.sha256, "skipped": ""})
        counts["received" if new else "seen"] += 1
        if new:
            log(f"CV folder {folder.name}: received {name}")
    now = timezone.now()
    fields = {"checked_at": now, "check_requested": False, "baseline_done": True}
    if not errors:
        fields["last_success_at"] = now
    waiting = counts["waiting"]
    if folder.state == WatchedFolder.State.OK:
        fields["message"] = f"{waiting} file{'s' if waiting != 1 else ''} still being copied or open elsewhere." \
            if waiting else ""
    WatchedFolder.objects.filter(pk=folder.pk).update(**fields)
    return counts


def _left_out(folder, name, full, stat, why):
    """A file the portal does not read still gets a receipt, with the reason (nothing is stored)."""
    from core.models import FolderFile

    from .receive import digest

    sha = digest(f"{name}|{stat.st_size}|{stat.st_mtime}".encode())
    if not Receipt.objects.filter(folder=folder, source_path=name, sha256=sha).exists():
        Receipt.objects.create(kind=Receipt.Kind.CV, channel=Receipt.Channel.FOLDER, folder=folder,
                               original_name=full.name[:255], source_path=name[:700], size=stat.st_size,
                               modified=stat.st_mtime, sha256=sha, status=Receipt.Status.DONE,
                               outcome=Receipt.Outcome.NOT_CV, message=why, finished_at=timezone.now())
    FolderFile.objects.update_or_create(folder=folder, name=name, defaults={
        "size": stat.st_size, "modified": stat.st_mtime, "skipped": why[:255]})


class FolderWatch:
    """Walks the linked server folders on a timer, and at once on a change event where the system sends them."""

    def __init__(self, log=logger.info):
        self.log = log
        self.event = threading.Event()
        self.observer = None
        self.watched = set()
        self.next_full = 0.0

    def _observe(self, folders):
        try:
            from watchdog.events import FileSystemEventHandler
            from watchdog.observers import Observer
        except ImportError:
            return
        wanted = {(f.path, f.include_subfolders) for f in folders}
        if wanted == self.watched:
            return
        if self.observer is not None:
            self.observer.stop()
        event = self.event

        class Handler(FileSystemEventHandler):
            def on_any_event(self, _event):
                event.set()

        observer = Observer()
        for path, recursive in wanted:
            try:
                observer.schedule(Handler(), path, recursive=recursive)
            except (OSError, RuntimeError):  # a share the system cannot watch: the timer covers it
                pass
        observer.daemon = True
        observer.start()
        self.observer, self.watched = observer, wanted

    def due(self) -> bool:
        from core.models import WatchedFolder

        return (time.monotonic() >= self.next_full or self.event.is_set()
                or WatchedFolder.objects.filter(check_requested=True, location="server").exists()
                or WatchedFolder.objects.filter(baseline_done=False, location="server").exists())

    def poll(self) -> int:
        from core.models import WatchedFolder

        if not self.due():
            return 0
        if self.event.is_set():
            time.sleep(settings.CV_STABLE_SECONDS)  # let a copy that just started finish
        self.event.clear()
        self.next_full = time.monotonic() + settings.CV_FOLDER_SECONDS
        folders = list(WatchedFolder.objects.filter(location=WatchedFolder.Location.SERVER).select_related(
            "requisition"))
        self._observe(folders)
        received = 0
        for folder in folders:
            try:
                counts = scan_folder(folder, log=self.log)
            except Exception:  # noqa: BLE001
                logger.exception("Scanning %s failed", folder.path)
                continue
            received += counts["received"]
            if counts["waiting"]:  # files still being copied: look again shortly, not in CV_FOLDER_SECONDS
                self.next_full = min(self.next_full, time.monotonic() + settings.CV_STABLE_SECONDS + 1)
        return received

    def stop(self):
        if self.observer is not None:
            self.observer.stop()
