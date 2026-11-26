"""Keep the portal in step with the recruitment workbooks while the team still works in Excel.

Link the files once (Excel link page, link-excel.bat, or ``python manage.py sync_workbooks --link FILE ...``). The
background worker (intake/worker.py, started by start-portal.bat and the pilot's "worker" service) notices each save
within a second, keeps a copy with a receipt, and imports only the rows that changed: new rows are added, rows edited
in Excel update their records, nothing is duplicated, and what the hiring team did in the portal is kept (see
core/workbook_import.py). Rows deleted from Excel stay in the portal. Open screens refresh themselves.

When the server cannot reach the file, HR uploads the latest copy on the Excel link page instead.
"""

from __future__ import annotations

import hashlib
import logging
import tempfile
from pathlib import Path

from django.conf import settings
from django.utils import timezone

from .models import LinkedWorkbook
from .workbook_import import SHEET_LABELS, WorkbookError, read_sheets

logger = logging.getLogger(__name__)

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
        from .excel_updates import is_updates_file

        if is_updates_file(path):
            raise WorkbookError(f"{path.name} is the file the portal writes its updates to, not a recruitment "
                                "workbook: link your own workbooks instead.")
        sheets = read_sheets([str(path)], require_all=False)
        workbook, _ = LinkedWorkbook.objects.update_or_create(path=str(path), pattern="", defaults={
            "sheets": ", ".join(SHEET_LABELS[k] for k in SHEET_LABELS if k in sheets), "linked_by": user,
            "expected_sheets": ",".join(k for k in SHEET_LABELS if k in sheets), "current_file": str(path),
            "state": LinkedWorkbook.State.WAITING, "message": "", "fingerprint": "", "row_hashes": {},
            "refresh_requested": True,
        })
        linked.append(workbook)
    return linked


def link_pattern(folder, pattern, *, user=None) -> LinkedWorkbook:
    """Follow the newest file in a folder whose name fits the pattern (a new dated workbook each week, say). The
    newest file now must hold recruitment sheets; each later file must hold the same kinds of sheet, or it is not
    loaded and the last good data stays."""
    from intake.watch import current_path

    folder_path = Path(str(folder).strip().strip('"')).expanduser()
    pattern = (pattern or "").strip() or "*.xlsx"
    if not folder_path.is_dir():
        raise WorkbookError(f"Folder not found: {folder_path}")
    if not pattern.lower().endswith((".xlsx", "*")):
        raise WorkbookError("The pattern should end in .xlsx, e.g. Recruitment Master Weekly Report*.xlsx")
    probe = LinkedWorkbook(path=str(folder_path.resolve()), pattern=pattern, mode=LinkedWorkbook.Mode.LATEST)
    newest = current_path(probe)
    if newest is None:
        raise WorkbookError(f"No workbook in {folder_path} has a name like '{pattern}'.")
    sheets = read_sheets([str(newest)], require_all=False)
    workbook, _ = LinkedWorkbook.objects.update_or_create(path=str(folder_path.resolve()), pattern=pattern, defaults={
        "mode": LinkedWorkbook.Mode.LATEST, "linked_by": user, "current_file": str(newest),
        "sheets": ", ".join(SHEET_LABELS[k] for k in SHEET_LABELS if k in sheets),
        "expected_sheets": ",".join(k for k in SHEET_LABELS if k in sheets),
        "state": LinkedWorkbook.State.WAITING, "message": "", "fingerprint": "", "row_hashes": {},
        "refresh_requested": True})
    return workbook


def watcher_running() -> bool:
    """Whether the background worker is running (or the scheduler looked at the links recently)."""
    from intake.models import Worker

    from .models import WatchedFolder

    if any(w.online for w in Worker.objects.all()):
        return True
    stamps = [model.objects.exclude(checked_at=None).order_by("-checked_at").values_list("checked_at", flat=True).first()
              for model in (LinkedWorkbook, WatchedFolder)]
    latest = max((s for s in stamps if s), default=None)
    return bool(latest) and (timezone.now() - latest).total_seconds() < 60 * max(3 * settings.EXCEL_SYNC_MINUTES, 20)


def describe(counts: dict) -> str:
    changes = [f"{n:,} {what}" for what, n in counts.items() if n and "repeated" not in what]
    return ("Refreshed: " + "; ".join(changes) + ".") if changes else "Checked: nothing new since the last refresh."


def check(*, force: bool = False, log=logger.info) -> dict:
    """Look at every linked workbook now and import the saves found (in this process: the scheduler's run, the
    tests). The worker does the same on its own within a second of each save. Returns {workbook: counts}."""
    from intake import sync

    return sync.workbooks(force=force, log=log)


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
