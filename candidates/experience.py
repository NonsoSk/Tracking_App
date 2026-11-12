"""Years of work experience, worked out from the dates of the jobs in a CV.

- Each job's dates are read ("Jan 2019 – Mar 2021", "03/2019 - present", "2016 to date", "Since May 2022", "2023 -
  2024"). Months count when the CV gives them, the end month included (Jan–Mar is three months); a year alone runs
  from the start of one year to the start of the other, so 2023–2024 is one year and 2023–2026 three.
- Jobs that overlap or follow on are joined, so 2023–2024 then 2024–2026 is 2023 to 2026: three years. A gap between
  jobs is not counted: 2023–2024 then May 2026 – present (in November 2026) is one year and six months.
- Only work counts: dates in the education section, school and degree lines, and student industrial training
  (SIWES, IT, attachments) are left out. NYSC counts unless EXPERIENCE_COUNTS_NYSC is false.
- A statement such as "over 10 years of experience" is used only when the CV gives no dates at all.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta

from django.conf import settings
from django.utils import timezone

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}
MONTH_PAT = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
DATE_PAT = rf"(?:\d{{1,2}}(?:st|nd|rd|th)?\s+)?(?:{MONTH_PAT}\s*,?\s*|\d{{1,2}}\s*[/.-]\s*)?(?:19|20)\d{{2}}"
NOW_PAT = r"present|current(?:ly)?|now|date|till\s+date|to\s+date|ongoing|till\s+now|to\s+present|today"
RANGE_RE = re.compile(rf"({DATE_PAT})\s*(?:-|–|—|~|to|till|until|through)\s*({NOW_PAT}|{DATE_PAT})", re.I)
SINCE_RE = re.compile(rf"\b(?:since|from)\s+({DATE_PAT})(?!\s*(?:-|–|—|~|to|till|until)\s*\w)", re.I)
# Lines that are about study, not work.
STUDY_LINE = re.compile(
    r"\b(b\.?\s?sc|b\.?\s?eng|b\.?\s?tech|b\.?\s?a\b|m\.?\s?sc|m\.?\s?eng|mba|ph\.?\s?d|hnd|ond|nce|pgd|waec|neco|"
    r"ssce|wassce|gce|first school leaving|degree|diploma|graduated|undergraduate|matriculated|secondary school|"
    r"primary school|high school)\b", re.I)
SCHOOL_LINE = re.compile(r"\b(university|polytechnic|college of education|secondary school|grammar school|"
                         r"high school|academy)\b", re.I)
TRAINING_LINE = re.compile(r"\b(siwes|industrial training|industrial attachment|students?\s+(?:industrial|work)|"
                           r"i\.?t\.? (?:student|placement|attachment)|student intern(?:ship)?|attachment)\b", re.I)
NYSC_LINE = re.compile(r"\bnysc\b|national youth service|corps member|youth corper|\bcorper\b|primary assignment",
                       re.I)


@dataclass
class Span:
    start: date
    end: date
    end_is_year: bool    # the end was a year alone ("2024"): it may run on into that year
    label: str           # the dates as written
    line: str            # the line they were on
    start_is_year: bool = False


def _point(token: str):
    """(date, kind) for one end of a range: kind is 'month', 'year' or 'now'."""
    token = token.strip().lower().rstrip(".")
    if re.fullmatch(NOW_PAT, token, re.I):
        return timezone.localdate(), "now"
    year_match = re.search(r"(?:19|20)\d{2}", token)
    if not year_match:
        return None
    year = int(year_match.group(0))
    name = re.search(r"([a-z]{3})[a-z]*\.?\s*,?\s*(?:19|20)\d{2}", token)
    if name and name.group(1) in MONTHS:
        return date(year, MONTHS[name.group(1)], 1), "month"
    number = re.match(r"(\d{1,2})\s*[/.-]\s*(?:19|20)\d{2}", token)
    if number and 1 <= int(number.group(1)) <= 12:
        return date(year, int(number.group(1)), 1), "month"
    return date(year, 1, 1), "year"


def _month_after(day: date) -> date:
    return date(day.year + (day.month == 12), day.month % 12 + 1, 1)


def make_span(start_token: str, end_token: str, line: str = "") -> Span | None:
    start, end = _point(start_token), _point(end_token)
    if not start or not end:
        return None
    today = timezone.localdate()
    start_day = start[0]
    end_day, kind = end
    if kind == "month":
        end_day = _month_after(end_day)  # the end month counts: Jan–Mar is three months
    end_day = min(end_day, today)        # a date in the future counts up to today
    if start_day >= end_day or start_day > today or (end_day - start_day).days > 50 * 366:
        return None
    return Span(start_day, end_day, kind == "year", f"{start_token.strip()} – {end_token.strip()}", line.strip(),
                start[1] == "year")


def _is_work(line: str, before: str, *, in_experience_section: bool) -> bool:
    context = f"{before}\n{line}"
    if TRAINING_LINE.search(context):
        return False
    if not getattr(settings, "EXPERIENCE_COUNTS_NYSC", True) and NYSC_LINE.search(context):
        return False
    if STUDY_LINE.search(line):
        return False
    if not in_experience_section and SCHOOL_LINE.search(line):
        return False  # without an experience heading, a line naming a school is about study
    return True


def spans_in(text: str, *, in_experience_section: bool = True) -> list[Span]:
    """Every dated job in the text, study and student training left out."""
    lines = text.splitlines()
    found = []
    for index, line in enumerate(lines):
        before = next((lines[j] for j in range(index - 1, max(index - 3, -1), -1) if lines[j].strip()), "")
        if RANGE_RE.search(before) or SINCE_RE.search(before):
            before = ""  # the line above is a job of its own, not this job's title
        if not _is_work(line, before, in_experience_section=in_experience_section):
            continue
        for match in RANGE_RE.finditer(line):
            span = make_span(match.group(1), match.group(2), line)
            if span:
                found.append(span)
        for match in SINCE_RE.finditer(line):
            span = make_span(match.group(1), "present", line)
            if span:
                found.append(span)
    return found


def merge(spans: list[Span]) -> list[list]:
    """Join jobs that overlap or follow on. A job whose end is a year alone ('– 2024') runs on to a job that starts
    later in that same year, as the CV does not say which month it ended."""
    merged: list[list] = []  # [start, end, end is a year alone, start is a year alone]
    for span in sorted(spans, key=lambda s: (s.start, s.end)):
        if merged:
            last = merged[-1]
            touches = span.start <= last[1] or (last[2] and span.start.year == last[1].year)
            if touches:
                if span.end > last[1]:
                    last[1], last[2] = span.end, span.end_is_year
                continue
        merged.append([span.start, span.end, span.end_is_year, span.start_is_year])
    return merged


def months_between(start: date, end: date) -> int:
    return round((end - start).days / 30.4375)


def length_text(months: int) -> str:
    years, rest = divmod(months, 12)
    parts = ([f"{years} yr{'s' if years != 1 else ''}"] if years else []) + (
        [f"{rest} mo{'s' if rest != 1 else ''}"] if rest else [])
    return " ".join(parts) or "under a month"


def month_text(day: date, *, end=False, year_only=False) -> str:
    if end and day >= timezone.localdate() - timedelta(days=1):
        return "now"
    if year_only:
        return str(day.year)
    if end:
        day = day - timedelta(days=1)  # back to the last month worked
    return day.strftime("%b %Y")


@dataclass
class Experience:
    years: float | None
    months: int
    periods: list
    gaps: int          # months between jobs that are not counted
    note: str


def from_spans(spans: list[Span]) -> Experience:
    if not spans:
        return Experience(None, 0, [], 0, "")
    periods = merge(spans)
    months = sum(months_between(p[0], p[1]) for p in periods)
    gaps = sum(months_between(periods[i][1], periods[i + 1][0]) for i in range(len(periods) - 1))
    shown = ", ".join(f"{month_text(s, year_only=sy)} – {month_text(e, end=True, year_only=ey)}"
                      for s, e, ey, sy in periods)
    note = (f"Experience: {length_text(months)}, from the job dates ({shown})"
            + (f"; {length_text(gaps)} between jobs not counted" if gaps > 0 else "") + ".")
    return Experience(round(months / 12, 1), months, periods, gaps, note)


def from_text(experience_text: str, *, in_experience_section: bool = True) -> Experience:
    return from_spans(spans_in(experience_text, in_experience_section=in_experience_section))


def from_history(history) -> Experience:
    """The same calculation from a list of jobs with 'start' and 'end' (as the AI reader returns them)."""
    spans = []
    for job in history or []:
        start, end = str((job or {}).get("start") or "").strip(), str((job or {}).get("end") or "").strip()
        if not start:
            continue
        line = f"{(job or {}).get('job_title', '')} {(job or {}).get('company', '')}"
        if TRAINING_LINE.search(line) or (not getattr(settings, "EXPERIENCE_COUNTS_NYSC", True)
                                          and NYSC_LINE.search(line)):
            continue
        span = make_span(start, end or "present", line)
        if span:
            spans.append(span)
    return from_spans(spans)


STATED_RE = re.compile(r"(\d{1,2})\+?\s*(?:years|yrs)\.?\s*(?:of\s+)?(?:[a-z-]+\s+){0,4}?experience", re.I)


def stated_years(text: str) -> float | None:
    """'Over 10 years of experience': used only when the CV gives no job dates."""
    numbers = [int(n) for n in STATED_RE.findall(text or "") if 0 < int(n) <= 45]
    return float(max(numbers)) if numbers else None


def recalculate(candidate, *, save: bool = True):
    """Work the years out again from the CV text the profile holds. Returns (old, new, note), or None when there is
    nothing to work it out from. The note on how it was counted replaces the previous one on the profile."""
    from decimal import Decimal

    from .cv_parser import heuristic_extract

    if not (candidate.cv_text or "").strip():
        return None
    found = heuristic_extract(candidate.cv_text)
    note = found.get("experience_note", "")
    if not note:
        return None
    old = candidate.years_experience
    new = Decimal(str(round(float(found.get("years_experience") or 0), 1)))
    lines = [line for line in (candidate.parse_notes or "").splitlines() if not line.startswith("Experience:")]
    candidate.years_experience, candidate.parse_notes = new, "\n".join(lines + [note])
    if save:
        type(candidate).objects.filter(pk=candidate.pk).update(years_experience=new,
                                                               parse_notes=candidate.parse_notes)
    return old, new, note


def recalculable(queryset, *, include_checked: bool = False, include_excel: bool = False):
    """Profiles whose years were read from a CV: not those loaded from the Excel workbooks (their years come from
    the workbook) and, unless asked, not those HR has checked (HR may have corrected the years)."""
    queryset = queryset.exclude(cv_text="").exclude(parse_method="")
    if not include_excel:
        queryset = queryset.exclude(source="import")
    if not include_checked:
        queryset = queryset.filter(checked_at__isnull=True)
    return [c for c in queryset.iterator() if include_excel or not c.source_records]


# --------------------------------------------------------------------------- the jobs themselves
@dataclass
class Job:
    """One job in a CV: the lines that name it (title, employer), what the CV says under it, and how long it lasted
    (None when the CV gives no dates for it). Used to judge a job description's requirements job by job."""
    title: str
    body: str
    months: int | None
    label: str = ""          # its dates as written, "Jan 2019 – now"
    is_work: bool = True     # False for student industrial training (SIWES) and, if switched off, NYSC
    source: str = "cv"       # "cv", "summary" or "profile"


BULLET_RE = re.compile(r"^\s*[•*\-–▪●◦■□➢➤>·o]\s+")
LINK_WORDS = {"of", "and", "&", "the", "in", "at", "for", "to", "|", "-", "–", "/"}


def looks_like_job_header(line: str) -> bool:
    """A short line naming a job or an employer ("Sales Executive", "NOTORE CHEMICAL INDUSTRIES PLC, Onne"), not a
    duty written under the job before it ("Managed key accounts in the chemical industry")."""
    stripped = line.strip()
    if not stripped or BULLET_RE.match(line) or stripped.endswith((".", ";")) or len(stripped) > 90:
        return False
    words = re.findall(r"[A-Za-z][A-Za-z'.&-]*", stripped)
    if not words or len(words) > 12:
        return False
    capitalised = sum(1 for w in words if w[0].isupper() or w.lower() in LINK_WORDS)
    return capitalised / len(words) >= 0.6 or "|" in stripped


def _dated_lines(lines: list[str]):
    for index, line in enumerate(lines):
        spans = [make_span(m.group(1), m.group(2), line) for m in RANGE_RE.finditer(line)]
        spans += [make_span(m.group(1), "present", line) for m in SINCE_RE.finditer(line)]
        spans = [s for s in spans if s]
        if spans:
            yield index, spans


def jobs_in(text: str, *, in_experience_section: bool = True) -> list[Job]:
    """Every dated job in the text, with the lines that name it and the duties written under it. A job runs from
    the lines naming it (up to two short lines above its dates) to the line before the next job."""
    lines = (text or "").splitlines()
    dated = list(_dated_lines(lines))
    starts = []
    for n, (index, _) in enumerate(dated):
        floor = dated[n - 1][0] + 1 if n else 0
        start, j, taken = index, index - 1, 0
        while j >= floor and taken < 2:
            if not lines[j].strip():
                if taken:
                    break
                j -= 1
                continue
            if not looks_like_job_header(lines[j]):
                break
            start, taken, j = j, taken + 1, j - 1
        starts.append(start)
    jobs = []
    for n, (index, spans) in enumerate(dated):
        stop = starts[n + 1] if n + 1 < len(dated) else len(lines)
        header = [line.strip() for line in lines[starts[n]:index + 1] if line.strip()]
        body = lines[index + 1:stop]
        first = next((i for i, line in enumerate(body) if line.strip()), None)
        if first is not None and looks_like_job_header(body[first]) and len(header) < 3:
            header.append(body[first].strip())  # the title written under the dates
            body = body[first + 1:]
        periods = merge(spans)
        context = "\n".join(h for h in header if h != lines[index].strip())
        jobs.append(Job(
            title="\n".join(header), body="\n".join(line for line in body if line.strip()),
            months=sum(months_between(p[0], p[1]) for p in periods),
            label=", ".join(f"{month_text(s, year_only=sy)} – {month_text(e, end=True, year_only=ey)}"
                            for s, e, ey, sy in periods),
            is_work=_is_work(lines[index], context, in_experience_section=in_experience_section)))
    return jobs


def blocks_in(text: str, size: int = 8) -> list[Job]:
    """For a CV whose jobs carry no dates: its paragraphs (or runs of a few lines), each judged like a job."""
    blocks, current = [], []
    for line in (text or "").splitlines():
        if line.strip():
            current.append(line.strip())
        elif current:
            blocks.append(current)
            current = []
    if current:
        blocks.append(current)
    jobs = []
    for block in blocks:
        for i in range(0, len(block), size):
            part = block[i:i + size]
            title = part[0] if looks_like_job_header(part[0]) else ""
            jobs.append(Job(title=title, body="\n".join(part[1:] if title else part), months=None))
    return jobs


def job_from_history(entry: dict) -> Job | None:
    """A job as the AI reader returns it (job_title, company, start, end, description)."""
    entry = entry or {}
    title = ", ".join(p for p in [str(entry.get("job_title") or "").strip(), str(entry.get("company") or "").strip()]
                      if p)
    if not title and not entry.get("description"):
        return None
    start, end = str(entry.get("start") or "").strip(), str(entry.get("end") or "").strip()
    span = make_span(start, end or "present", title) if start else None
    is_work = not (TRAINING_LINE.search(title) or (not getattr(settings, "EXPERIENCE_COUNTS_NYSC", True)
                                                   and NYSC_LINE.search(title)))
    return Job(title=title, body=str(entry.get("description") or ""),
               months=months_between(span.start, span.end) if span else None,
               label=(f"{month_text(span.start, year_only=span.start_is_year)} – "
                      f"{month_text(span.end, end=True, year_only=span.end_is_year)}") if span else "",
               is_work=is_work)
