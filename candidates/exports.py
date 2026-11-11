"""Take matched candidates out of the portal: their CVs (one, or many as a .zip) and a basic list (Excel or CSV) with
Name, Email address, Phone No., Course of Study, Degree Obtained, Age and Position applied for.

Used from the match grid and from a vacancy's ranked candidates: the ticked candidates, or everyone shown when none
is ticked. Files are downloaded, shared from the browser, or emailed from the portal (HR only)."""

from __future__ import annotations

import csv
import io
import os
import re
import tempfile
import zipfile
from datetime import date

from django.utils import timezone

FIELDS = ["Name", "Email address", "Phone No.", "Course of Study", "Degree Obtained", "Age", "Position applied for"]
FORMATS = {
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"),
    "csv": ("text/csv", ".csv"),
    "zip": ("application/zip", ".zip"),
}
EMAIL_LIMIT_MB = 20  # bigger than this is too big for most mailboxes: download it and share it another way


def age_on(born, today: date | None = None):
    if not born:
        return None
    today = today or timezone.localdate()
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def degree_obtained(candidate) -> str:
    if not candidate.highest_qualification:
        return ""
    text = candidate.qualification_short
    if candidate.degree_class_short:
        text += f" ({candidate.degree_class_short})"
    return text


def rows(pairs) -> list[list]:
    """One row per (candidate, vacancy): the seven export fields."""
    return [[c.full_name, c.email, c.phone, c.course, degree_obtained(c), age_on(c.date_of_birth),
             vacancy.title if vacancy else ""] for c, vacancy in pairs]


def to_csv(data: list[list]) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(FIELDS)
    writer.writerows(["" if v is None else v for v in row] for row in data)
    return out.getvalue().encode("utf-8-sig")  # the BOM makes Excel read names with accents correctly


def to_xlsx(data: list[list], title: str = "Candidates") -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = re.sub(r"[\[\]:*?/\\]", " ", title)[:31] or "Candidates"
    sheet.append(FIELDS)
    for row in data:
        sheet.append(row)
    for cell in sheet[1]:
        cell.font, cell.fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="1F3A93")
    for i, field in enumerate(FIELDS, start=1):
        longest = max([len(field)] + [len(str(r[i - 1])) for r in data if r[i - 1] is not None])
        sheet.column_dimensions[get_column_letter(i)].width = min(longest + 3, 50)
    sheet.freeze_panes = "A2"
    if data:
        sheet.auto_filter.ref = sheet.dimensions
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


def safe_name(text: str) -> str:
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", text or "").strip().rstrip(".") or "Candidate"


def latest_cvs(candidates) -> dict:
    """{candidate id: their latest CV document} in one query."""
    from .models import CandidateDocument

    found = {}
    for document in (CandidateDocument.objects.filter(candidate__in=candidates, doc_type=CandidateDocument.DocType.CV)
                     .exclude(file="").order_by("candidate_id", "-uploaded_at")):
        found.setdefault(document.candidate_id, document)
    return found


def cv_file_name(candidate, document) -> str:
    ext = os.path.splitext(document.file.name)[1].lower() or ".pdf"
    return f"{safe_name(candidate.full_name)} - CV{ext}"


def cv_zip(candidates):
    """A .zip of the candidates' latest CVs: (an open temporary file, removed when closed; CVs in it; names without
    a CV on file)."""
    documents = latest_cvs(candidates)
    handle = tempfile.TemporaryFile(suffix=".zip")
    used, missing, added = set(), [], 0
    with zipfile.ZipFile(handle, "w", zipfile.ZIP_DEFLATED) as archive:
        for candidate in candidates:
            document = documents.get(candidate.pk)
            if not document or not document.file or not os.path.exists(document.file.path):
                missing.append(candidate.full_name)
                continue
            name = cv_file_name(candidate, document)
            stem, ext = os.path.splitext(name)
            n = 2
            while name.lower() in used:
                name, n = f"{stem} ({n}){ext}", n + 1
            used.add(name.lower())
            archive.write(document.file.path, name)
            added += 1
        if missing:
            archive.writestr("No CV on file.txt", "These candidates have no CV in the portal:\r\n"
                             + "\r\n".join(missing) + "\r\n")
    handle.seek(0)
    return handle, added, missing


def selection(data) -> tuple[list, str]:
    """The (candidate, vacancy) pairs to take out, and a title for the file. The ticked ones ('pick' on the match
    grid, 'selected' applications on a ranked list); when none is ticked, everyone shown ('shown')."""
    from pipeline.models import Application
    from requisitions.models import Requisition

    from .models import Candidate

    def pairs_from(values):
        wanted = []
        for value in values:
            person, _, vacancy = str(value).partition(":")
            if person.isdigit():
                wanted.append((int(person), int(vacancy) if vacancy.isdigit() else None))
        people = Candidate.objects.in_bulk([p for p, _ in wanted])
        vacancies = Requisition.objects.in_bulk([v for _, v in wanted if v])
        return [(people[p], vacancies.get(v)) for p, v in wanted if p in people]

    def from_applications(ids):
        apps = Application.objects.select_related("candidate", "requisition").in_bulk(
            [int(i) for i in ids if str(i).isdigit()])
        ordered = [apps[int(i)] for i in ids if str(i).isdigit() and int(i) in apps]
        return [(a.candidate, a.requisition) for a in ordered]

    pairs = pairs_from(data.getlist("pick")) or from_applications(data.getlist("selected"))
    if not pairs:
        pairs = pairs_from(data.getlist("shown")) or from_applications(data.getlist("shown_app"))
    seen, unique = set(), []
    for candidate, vacancy in pairs:
        key = (candidate.pk, getattr(vacancy, "pk", None))
        if key not in seen:
            seen.add(key)
            unique.append((candidate, vacancy))
    titles = sorted({v.title for _, v in unique if v})
    title = titles[0] if len(titles) == 1 else "Candidates"
    return unique, title


def build(fmt: str, pairs, title: str):
    """(content: bytes, or an open temporary file for a .zip; file name; content type; notes)."""
    stamp = timezone.localdate().strftime("%d %b %Y")
    content_type, ext = FORMATS[fmt]
    name = f"{safe_name(title)} - {'CVs' if fmt == 'zip' else 'candidates'} - {stamp}{ext}"
    if fmt == "zip":
        people = list(dict.fromkeys(c for c, _ in pairs))
        handle, added, missing = cv_zip(people)
        return handle, name, content_type, {"cvs": added, "missing": missing}
    data = rows(pairs)
    return (to_xlsx(data, title) if fmt == "xlsx" else to_csv(data)), name, content_type, {"rows": len(data)}
