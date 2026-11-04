"""When each person applied, taken from the records themselves, never from the day they were loaded into the portal.

From Excel, the application date is:
- on the website applications dump: the moment in the resume link (the website names each uploaded resume
  ``<unix time>-<name>``, so ``.../1700000000-ada.pdf`` was uploaded on 14 Nov 2023);
- on any sheet with an application-date column (Date Applied, Application Date, Submission Date, Timestamp...).
A person with several dated rows applied on the earliest. Someone with no dated row has no application date: they
count under "All time" on the summary, never under a day, month or year. People who applied through the portal itself
(careers page, referral, emailed CV, walk-in, agency) applied on the day their profile was created.
"""

from __future__ import annotations

from datetime import date

from django.utils import timezone

APPLICATION_DATE_HEADINGS = {"date applied", "applied date", "applied on", "application date", "date of application",
                             "submission date", "date submitted", "timestamp", "date received"}
PORTAL_CHANNELS = {"portal", "referral", "email", "hard_copy", "agency"}


def applied_on_from(records) -> date | None:
    """The earliest application date written in the Excel rows kept on a profile (``source_records``)."""
    from core.workbook_import import header_key, resume_stamp, to_date

    today = timezone.localdate()
    found = []
    for record in records or []:
        for heading, value in (record.get("values") or {}).items():
            if value in (None, ""):
                continue
            key = header_key(heading)
            if key == "profile_link":
                stamp = resume_stamp(str(value).strip())
                if stamp:
                    found.append(timezone.localtime(stamp).date())
            elif key in APPLICATION_DATE_HEADINGS:
                day = to_date(value)
                if day and date(2000, 1, 1) <= day <= today:
                    found.append(day)
    return min(found) if found else None


def applied_on(candidate) -> date | None:
    from_excel = applied_on_from(candidate.source_records)
    if candidate.source in PORTAL_CHANNELS and candidate.created_at:
        joined = timezone.localtime(candidate.created_at).date()
        return min(from_excel, joined) if from_excel else joined
    return from_excel


def assign_all(*, log=None, Candidate=None) -> int:
    """Work out every person's application date again (after each Excel load). Returns how many changed."""
    if Candidate is None:
        from .models import Candidate
    changed = []
    for candidate in Candidate.objects.only("id", "source", "source_records", "created_at", "applied_on") \
            .iterator(chunk_size=2000):
        value = applied_on(candidate)
        if value != candidate.applied_on:
            candidate.applied_on = value
            changed.append(candidate)
    Candidate.objects.bulk_update(changed, ["applied_on"], batch_size=1000)
    if log and changed:
        log(f"Application dates taken from the records for {len(changed):,} candidate(s).")
    return len(changed)
