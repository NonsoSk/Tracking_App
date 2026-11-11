"""'Portal updates.xlsx': the portal's latest data, kept beside the linked workbooks so the Excel side stays in step.

The team's own workbooks are never written to. Instead the portal keeps one workbook of its own, rewritten whenever
something changes in the portal (new CVs, stages, scores, decisions, interviews, offers):

- Applicants: every application, with its score, key requirements not met, the hiring manager's call, stage, status
  and interview dates;
- CVs received: every profile that came in through the portal (careers page, CV intake, the CV folder, the mailbox,
  referrals), checked or still to check, and the vacancies it went to;
- Vacancies: every requisition with how many are at each stage;
- Interviews: every interview scheduled in the portal.

It is written next to the linked workbook that holds the requisition tracker (or PORTAL_UPDATES_PATH). The new
version replaces the old one in one step; while the file is open in Excel it cannot be replaced, so it is written
again at the next check after it is closed. HR can also download it from the Excel link page.
"""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path

from django.conf import settings
from django.db.models import Count, Max, Sum
from django.utils import timezone

from .models import LinkedWorkbook, PortalUpdatesFile

logger = logging.getLogger(__name__)

FILE_NAME = "Portal updates.xlsx"


def target_path() -> Path:
    """Where the file goes: PORTAL_UPDATES_PATH, else beside the linked workbook with the requisition tracker (or
    the first linked one), else the portal's own excel-updates folder."""
    configured = (getattr(settings, "PORTAL_UPDATES_PATH", "") or "").strip()
    if configured:
        path = Path(configured).expanduser()
        return path / FILE_NAME if path.is_dir() or not path.suffix else path
    workbooks = sorted(LinkedWorkbook.objects.all(), key=lambda w: "requisition tracker" not in w.sheets.lower())
    for workbook in workbooks:
        folder = Path(workbook.path).parent
        if folder.is_dir():
            return folder / FILE_NAME
    return Path(settings.BASE_DIR) / "excel-updates" / FILE_NAME


def is_updates_file(path) -> bool:
    """The portal's own file (so it is never linked and read back in as a recruitment workbook)."""
    path = Path(str(path))
    return path.name.lower() == FILE_NAME.lower() or path.resolve() == target_path().resolve()


def signature() -> str:
    """A fingerprint of everything the file shows: when it changes, the file is written again."""
    from candidates.models import Candidate
    from pipeline.models import Application, Interview, Offer
    from requisitions.models import Requisition

    parts = [
        Application.objects.aggregate(n=Count("id"), t=Max("updated_at")),
        Candidate.objects.exclude(source=Candidate.Source.IMPORT).aggregate(n=Count("id"), t=Max("updated_at")),
        Requisition.objects.aggregate(n=Count("id"), t=Max("updated_at")),
        Interview.objects.aggregate(n=Count("id"), t=Max("created_at"), s=Sum("sequence")),
        list(Interview.objects.order_by().values_list("status").annotate(n=Count("id"))),
        Offer.objects.aggregate(n=Count("id"), t=Max("created_at"), r=Max("responded_at"), m=Max("management_at")),
        list(Offer.objects.order_by().values_list("status").annotate(n=Count("id"))),
    ]
    return hashlib.sha256(repr(parts).encode()).hexdigest()


# --------------------------------------------------------------------------- the sheets
def _local(value):
    """Excel has no time zones: dates and times in local time, without the zone."""
    if value is None:
        return None
    if hasattr(value, "tzinfo") and value.tzinfo is not None:
        return timezone.localtime(value).replace(tzinfo=None)
    return value


def applicants_rows():
    from pipeline.models import Application

    header = ["Application no.", "Candidate", "Email", "Phone", "Vacancy", "Requisition", "Department", "Channel",
              "Date applied", "Score", "Grade", "Match", "Key requirements not met", "Hiring manager's call",
              "Stage", "Status", "Reason", "Last interview", "Next interview", "Department review", "Last change"]
    rows = []
    now = timezone.now()
    applications = (Application.objects.select_related("candidate", "requisition", "requisition__department")
                    .prefetch_related("interviews").order_by("requisition__reference", "-match_score", "applied_at"))
    for a in applications:
        c, r = a.candidate, a.requisition
        times = sorted(i.scheduled_at for i in a.interviews.all() if i.status != "cancelled")
        past = [t for t in times if t <= now]
        future = [t for t in times if t > now]
        breakdown = a.match_breakdown or {}
        rows.append([
            a.pk, c.full_name, c.email, c.phone, r.title, r.reference, str(r.department), c.source_short,
            c.applied_on or _local(a.applied_at), float(a.match_score) if a.matched_at else None,
            a.match_grade or None, breakdown.get("grade_label", "") if a.matched_at else "Not scored",
            ", ".join(a.unmet_requirements), a.get_eligibility_display() if a.eligibility else "",
            a.get_stage_display(), a.get_status_display(), a.status_reason,
            _local(past[-1]) if past else None, _local(future[0]) if future else None,
            a.get_department_review_display() if a.current_department_review else "", _local(a.updated_at),
        ])
    return header, rows


def cvs_rows():
    from candidates.models import Candidate

    header = ["Candidate", "Email", "Phone", "Channel", "Received", "Profile", "Checked by", "Qualification",
              "Course", "Years of experience", "Current role", "Current employer", "State", "Vacancies applied to",
              "CV file"]
    rows = []
    people = (Candidate.objects.exclude(source=Candidate.Source.IMPORT)
              .select_related("checked_by").prefetch_related("applications__requisition", "documents")
              .order_by("-created_at"))
    for c in people:
        cv = next((d for d in sorted(c.documents.all(), key=lambda d: d.uploaded_at, reverse=True)
                   if d.doc_type == "cv"), None)
        rows.append([
            c.full_name, c.email, c.phone, c.source_short, _local(c.created_at),
            "To check" if c.needs_check else "Checked",
            getattr(c.checked_by, "display_name", "") if c.checked_by else "",
            c.get_highest_qualification_display() if c.highest_qualification else "", c.course,
            float(c.years_experience) if c.years_experience is not None else None, c.current_job_title,
            c.current_employer, c.state_of_origin,
            ", ".join(sorted({a.requisition.title for a in c.applications.all()})),
            cv.original_name if cv else "",
        ])
    return header, rows


def vacancies_rows():
    from pipeline.models import Application, Stage
    from requisitions.models import Requisition

    stages = [s for s in Stage]
    header = (["Requisition", "Title", "Department", "Status", "Positions", "Requisition date", "Closing date",
               "Applicants", "Meeting every key requirement"] + [s.label for s in stages]
              + ["On hold", "Rejected / not eligible", "Withdrawn", "HR owner", "Last change"])
    by_stage, by_status, totals = {}, {}, {}
    for row in Application.objects.order_by().values("requisition_id", "stage", "status").annotate(n=Count("id")):
        totals[row["requisition_id"]] = totals.get(row["requisition_id"], 0) + row["n"]
        if row["status"] in {Application.Status.ACTIVE, Application.Status.HIRED}:
            key = (row["requisition_id"], row["stage"])
            by_stage[key] = by_stage.get(key, 0) + row["n"]
        key = (row["requisition_id"], row["status"])
        by_status[key] = by_status.get(key, 0) + row["n"]
    meets = {}
    for a in Application.objects.exclude(matched_at=None).only("requisition_id", "match_breakdown"):
        if not a.unmet_requirements:
            meets[a.requisition_id] = meets.get(a.requisition_id, 0) + 1
    rows = []
    for r in Requisition.objects.select_related("department", "hr_owner").order_by("-created_at"):
        rows.append(
            [r.reference, r.title, str(r.department), r.get_status_display(), r.positions,
             _local(r.submitted_at), r.closing_date, totals.get(r.pk, 0), meets.get(r.pk, 0)]
            + [by_stage.get((r.pk, s.value), 0) for s in stages]
            + [by_status.get((r.pk, "on_hold"), 0), by_status.get((r.pk, "rejected"), 0),
               by_status.get((r.pk, "withdrawn"), 0), getattr(r.hr_owner, "display_name", "") if r.hr_owner else "",
               _local(r.updated_at)])
    return header, rows


def interviews_rows():
    from pipeline.models import Interview

    header = ["Candidate", "Vacancy", "Requisition", "Round", "Date and time", "Minutes", "Mode", "Location",
              "Panel", "Status", "Candidate's response"]
    rows = []
    for i in (Interview.objects.select_related("application__candidate", "application__requisition")
              .prefetch_related("panel").order_by("-scheduled_at")):
        rows.append([
            i.application.candidate.full_name, i.application.requisition.title, i.application.requisition.reference,
            i.get_round_display(), _local(i.scheduled_at), i.duration_minutes, i.get_mode_display(), i.location,
            ", ".join(p.display_name for p in i.panel.all()), i.get_status_display(),
            i.get_candidate_response_display() if i.candidate_response else "",
        ])
    return header, rows


SHEETS = [("Applicants", applicants_rows), ("CVs received", cvs_rows), ("Vacancies", vacancies_rows),
          ("Interviews", interviews_rows)]


def build(path: Path) -> dict:
    """Write the workbook to ``path``. Returns {sheet: number of rows}."""
    from datetime import date, datetime

    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    workbook = Workbook()
    workbook.remove(workbook.active)
    counts = {}
    head_font, head_fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="1F3A93")
    for title, rows_of in SHEETS:
        header, rows = rows_of()
        sheet = workbook.create_sheet(title)
        sheet.append(header)
        for row in rows:
            sheet.append(row)
        for cell in sheet[1]:
            cell.font, cell.fill = head_font, head_fill
            cell.alignment = Alignment(vertical="center", wrap_text=True)
        widths = [len(str(h)) for h in header]
        for row_cells in sheet.iter_rows(min_row=2):
            for i, cell in enumerate(row_cells):
                value = cell.value
                if isinstance(value, datetime):
                    cell.number_format = "dd mmm yyyy hh:mm" if (value.hour or value.minute) else "dd mmm yyyy"
                    widths[i] = max(widths[i], 17)
                elif isinstance(value, date):
                    cell.number_format = "dd mmm yyyy"
                    widths[i] = max(widths[i], 12)
                elif value is not None:
                    widths[i] = max(widths[i], min(len(str(value)), 60))
        for i, width in enumerate(widths, start=1):
            sheet.column_dimensions[get_column_letter(i)].width = min(max(width + 2, 9), 62)
        sheet.freeze_panes = "B2" if title in {"Applicants", "CVs received"} else "A2"
        if rows:
            sheet.auto_filter.ref = sheet.dimensions
        counts[title] = len(rows)
    about = workbook.create_sheet("Read me")
    stamp = timezone.localtime().strftime("%d %b %Y, %H:%M")
    for line in [
        ["Portal updates", f"Written by the {settings.COMPANY_SHORT_NAME} Recruitment Portal on {stamp}."],
        ["", "The portal rewrites this file whenever something changes in the portal, so do not edit it here: "
             "changes made in this file are not kept. Work in your own workbooks (the portal reads them) or in the "
             "portal itself."],
        ["Applicants", "Every application: score, key requirements not met, the hiring manager's call, stage, "
                       "status and interviews."],
        ["CVs received", "Every profile that came in through the portal (careers page, CV intake, the CV folder, "
                         "the mailbox, referrals), whether it has been checked, and the vacancies it went to."],
        ["Vacancies", "Every requisition with how many candidates are at each stage."],
        ["Interviews", "Every interview scheduled in the portal."],
    ]:
        about.append(line)
    about.column_dimensions["A"].width = 16
    about.column_dimensions["B"].width = 110
    about["A1"].font = Font(bold=True, size=14)
    for row in about.iter_rows(min_row=2):
        row[0].font = Font(bold=True)
        row[1].alignment = Alignment(wrap_text=True, vertical="top")
    path.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(path)
    return counts


def write(*, force: bool = False, log=logger.info) -> PortalUpdatesFile:
    """Write the file when the portal's data changed since the last write (or when asked to)."""
    state = PortalUpdatesFile.current()
    path = target_path()
    current = signature()
    if not force and not state.write_requested and state.signature == current and state.path == str(path) \
            and path.is_file():
        return state
    temp = path.with_name(f".~{path.stem}.writing{path.suffix}")
    try:
        counts = build(temp)
        os.replace(temp, path)
    except PermissionError:
        state.message = f"{path.name} is open in Excel, so it could not be replaced. It is written as soon as it is closed."
        state.save(update_fields=["message"])
        _remove(temp)
        return state
    except OSError as exc:
        state.message = f"Could not write {path}: {exc}"
        state.save(update_fields=["message"])
        _remove(temp)
        logger.warning("Portal updates not written: %s", exc)
        return state
    state.path, state.signature, state.written_at, state.rows = str(path), current, timezone.now(), counts
    state.message, state.write_requested = "", False
    state.save()
    log(f"Portal updates written: {path} ({', '.join(f'{n} {k.lower()}' for k, n in counts.items())})")
    return state


def _remove(path: Path):
    try:
        path.unlink()
    except OSError:
        pass
