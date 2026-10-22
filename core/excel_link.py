"""Keep the portal in step with the recruitment workbooks while the team still works in Excel.

Link the files once (link-excel.bat, or ``python manage.py sync_workbooks --link FILE ...``). From then on
``sync_workbooks`` checks them: on this PC every few minutes while start-portal.bat is open, on the server
from the scheduler. When a file was saved with changes, a copy of it is loaded as a refresh: new rows are
added, rows edited in Excel update their records, nothing is duplicated, and what the hiring team did in
the portal is kept (see core/workbook_import.py). Rows deleted from Excel stay in the portal.

When the server cannot reach the file, HR uploads the latest copy on the Excel link page instead.
"""

from __future__ import annotations

import hashlib
import logging
import shutil
import tempfile
from datetime import datetime, timezone as dt_timezone
from pathlib import Path

from django.conf import settings
from django.utils import timezone

from .models import LinkedWorkbook
from .workbook_import import SHEET_LABELS, WorkbookError, WorkbookImporter, read_sheets

logger = logging.getLogger(__name__)

SETTLE_SECONDS = 20  # a file saved more recently than this may still be being written
UPLOAD_DIR = "excel-link"


def report_dir() -> Path:
    return Path(settings.BASE_DIR) / "import-reports"


def fingerprint(path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def link(paths, *, user=None) -> list[LinkedWorkbook]:
    """Remember these workbooks. Each must hold at least one of the recruitment sheets."""
    linked = []
    for raw in paths:
        path = Path(str(raw).strip().strip('"')).expanduser().resolve()
        if not path.is_file():
            raise WorkbookError(f"File not found: {path}")
        if path.suffix.lower() != ".xlsx":
            raise WorkbookError(f"{path.name} is not an .xlsx workbook. In Excel, use File > Save As > Excel Workbook.")
        sheets = read_sheets([str(path)], require_all=False)
        workbook, _ = LinkedWorkbook.objects.update_or_create(path=str(path), defaults={
            "sheets": ", ".join(SHEET_LABELS[k] for k in SHEET_LABELS if k in sheets), "linked_by": user,
            "state": LinkedWorkbook.State.WAITING, "message": "", "fingerprint": "", "refresh_requested": True,
        })
        linked.append(workbook)
    return linked


def watcher_running() -> bool:
    """Whether something has checked the links recently (the watcher window or the scheduler)."""
    latest = LinkedWorkbook.objects.exclude(checked_at=None).order_by("-checked_at").values_list("checked_at", flat=True).first()
    return bool(latest) and (timezone.now() - latest).total_seconds() < 60 * max(3 * settings.EXCEL_SYNC_MINUTES, 20)


def describe(counts: dict) -> str:
    changes = [f"{n:,} {what}" for what, n in counts.items() if n and "repeated" not in what]
    return ("Refreshed: " + "; ".join(changes) + ".") if changes else "Checked: nothing new since the last refresh."


def check(*, force: bool = False, log=logger.info):
    """Look at every linked workbook and load the ones saved with changes. Returns the import result, or None."""
    now = timezone.now()
    due = []
    for workbook in LinkedWorkbook.objects.all():
        path = Path(workbook.path)
        workbook.checked_at = now
        if not path.is_file():
            workbook.state = LinkedWorkbook.State.MISSING
            workbook.message = "The file is not there any more. If it was moved or renamed, link it again."
            workbook.refresh_requested = False
            workbook.save(update_fields=["checked_at", "state", "message", "refresh_requested"])
            continue
        modified = datetime.fromtimestamp(path.stat().st_mtime, tz=dt_timezone.utc)
        if (now - modified).total_seconds() < SETTLE_SECONDS and not force:
            workbook.save(update_fields=["checked_at"])  # Excel may still be saving; look again next time
            continue
        try:
            digest = fingerprint(path)
        except OSError as exc:
            workbook.state, workbook.message = LinkedWorkbook.State.ERROR, f"Could not open the file: {exc}"
            workbook.save(update_fields=["checked_at", "state", "message"])
            continue
        if force or workbook.refresh_requested or digest != workbook.fingerprint:
            due.append((workbook, modified))
        elif workbook.state == LinkedWorkbook.State.MISSING:
            workbook.state, workbook.message = LinkedWorkbook.State.OK, "The file is back and unchanged."
        workbook.save(update_fields=["checked_at", "state", "message"])
    if not due:
        return None

    names = ", ".join(w.name for w, _ in due)
    log(f"Refreshing from {names}...")
    with tempfile.TemporaryDirectory() as tmp:
        # Load copies, so Excel can keep the files open and save them while the refresh runs.
        copies = []
        for n, (workbook, _) in enumerate(due):
            folder = Path(tmp) / str(n)
            folder.mkdir()
            copies.append(Path(shutil.copy2(workbook.path, folder / workbook.name)))
        try:
            result = WorkbookImporter([str(c) for c in copies], replace=False, report_dir=str(report_dir()),
                                      log=log, require_all=False).run()
        except Exception as exc:  # noqa: BLE001 - a bad file must not stop the next check
            if isinstance(exc, WorkbookError):
                message = str(exc)
            else:
                logger.exception("Excel refresh failed")
                message = f"The refresh failed: {exc}"
            for workbook, _ in due:
                workbook.state, workbook.message, workbook.refresh_requested = LinkedWorkbook.State.ERROR, message, False
                workbook.save(update_fields=["state", "message", "refresh_requested"])
            log(message)
            return None
        digests = [fingerprint(c) for c in copies]
    counts = {k: v for k, v in sorted(result.counts.items()) if v}
    for (workbook, modified), digest in zip(due, digests):
        workbook.fingerprint, workbook.file_modified_at, workbook.synced_at = digest, modified, timezone.now()
        workbook.state, workbook.message, workbook.counts = LinkedWorkbook.State.OK, describe(counts), counts
        workbook.report_path, workbook.refresh_requested = result.report_path, False
        workbook.save()
    log(describe(counts))
    return result


def save_upload(uploaded, *, user=None) -> LinkedWorkbook:
    """Keep an uploaded copy under media/excel-link and link it; the next check loads it."""
    folder = Path(settings.MEDIA_ROOT) / UPLOAD_DIR
    folder.mkdir(parents=True, exist_ok=True)
    name = Path(uploaded.name).name
    target = folder / name
    with tempfile.NamedTemporaryFile(dir=folder, suffix=".xlsx", delete=False) as handle:
        for chunk in uploaded.chunks():
            handle.write(chunk)
        temp = Path(handle.name)
    try:
        read_sheets([str(temp)], require_all=False)  # refuse files that are not the recruitment workbooks
    except WorkbookError as exc:
        temp.unlink(missing_ok=True)
        raise WorkbookError(str(exc).replace(temp.name, name)) from exc
    temp.replace(target)
    return link([target], user=user)[0]
