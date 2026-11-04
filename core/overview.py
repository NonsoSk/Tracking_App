"""The summary page: what the linked Excel workbooks say, at a glance, for the company or one department.

Every figure is a value from Excel, dated by the date Excel gives it, never by the day it was loaded:
- requisitions, their status, positions, days to fill and the recruitment figures (participants, shortlisted for
  interview, selected, onboarded, in progress): the requisition tracker, row by row, as written there, dated by the
  Requisition Date (days to fill: Requisition Date to Closing Date);
- interviews: the interview records, by their Date; CBTs: the CBT results, by their Date;
- applicants: people (one per person, however many rows), by their application date (see candidates/dates.py),
  with the group (host, pipeline, jetty...) and the channel their rows give;
- staff: the staff list (Release Date and its own Years to Retirement).
Requisitions, applications and interviews created in the portal itself are added with their own dates. A record
with no date in Excel is counted under "All time" only, and the page says how many there are.
"""

from __future__ import annotations

import calendar
import math
import os
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

from django.db.models import Count, Q
from django.utils import timezone

from candidates.models import SOURCE_SHORT, CBTResult, Candidate
from candidates.people import STAFF_LIST
from candidates.regions import REGION_CHOICES
from pipeline.models import Application, Interview, InterviewRecord, Stage
from requisitions.models import Requisition

from .models import Department, Employee, LinkedWorkbook
from .text import day_text
from .workbook_import import clean, header_key, to_date, to_number

PERIODS = [("today", "Today"), ("7d", "Last 7 days"), ("30d", "Last 30 days"), ("month", "This month"),
           ("year", "This year"), ("all", "All time")]
REGION_LABELS = dict(REGION_CHOICES) | {"none": "Not recorded"}
LOCAL_GROUPS = [("host", "Host"), ("pipeline", "Pipeline"), ("jetty", "Jetty")]
PAST_APPLIED = [s.value for s in Stage if s != Stage.APPLIED]
# The tracker's own columns: (key, the headings it may have).
TRACKER = [
    ("positions", ("manpower required",)),
    ("participants", ("participants",)),
    ("shortlisted", ("shortlisted for interview",)),
    ("selected", ("selected",)),
    ("onboarded", ("onboarded #", "onboarded")),
    ("rejected", ("rejected",)),
    ("on_hold", ("on-hold", "on hold")),
    ("in_progress", ("in progres", "in progress")),
]
MONTHLY = [("participants", "Participants"), ("shortlisted", "Shortlisted"), ("onboarded", "Onboarded")]
# Requisitions raised in the portal (not in the tracker), in the tracker's words where they exist.
PORTAL_STATUS = {"submitted": "Awaiting approval", "returned": "Awaiting approval", "pending_management":
                 "Awaiting approval", "approved": "Open", "open": "Open", "on_hold": "On hold", "filled": "Filled",
                 "closed": "Closed", "cancelled": "Closed"}
STATUS_ORDER = ["Pending", "In progress", "Awaiting approval", "Open", "On hold", "Closed", "Filled"]
DONE = {"Closed", "Filled"}


def midnight(day: date) -> datetime:
    return timezone.make_aware(datetime.combine(day, time.min))


def same_day(day: date, year: int, month: int) -> date:
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


@dataclass
class Period:
    """The days [first, end); None for all time. ``step`` is how the chart groups them."""
    key: str
    label: str
    first: date | None = None
    end: date | None = None
    prev_first: date | None = None
    prev_end: date | None = None
    step: str = "day"
    chart_first: date | None = None
    chart_end: date | None = None
    prev_label: str = ""

    def __post_init__(self):
        if self.chart_first is None:
            self.chart_first, self.chart_end = self.first, self.end

    def dates(self, field_name: str) -> Q:
        if self.first is None:
            return Q()
        return Q(**{f"{field_name}__gte": self.first, f"{field_name}__lt": self.end})

    def moments(self, field_name: str) -> Q:
        if self.first is None:
            return Q()
        return Q(**{f"{field_name}__gte": midnight(self.first), f"{field_name}__lt": midnight(self.end)})


def period_for(key: str, today: date | None = None) -> Period:
    today = today or timezone.localdate()
    tomorrow = today + timedelta(days=1)
    if key == "today":
        return Period(key, "Today", today, tomorrow, today - timedelta(days=1), today,
                      chart_first=today - timedelta(days=13), chart_end=tomorrow, prev_label="yesterday")
    if key == "7d":
        first = today - timedelta(days=6)
        return Period(key, "Last 7 days", first, tomorrow, first - timedelta(days=7), first,
                      prev_label="the 7 days before")
    if key == "30d":
        first = today - timedelta(days=29)
        return Period(key, "Last 30 days", first, tomorrow, first - timedelta(days=30), first, step="week",
                      prev_label="the 30 days before")
    if key == "month":
        last = today.replace(day=1) - timedelta(days=1)
        return Period(key, "This month", today.replace(day=1), tomorrow, last.replace(day=1),
                      same_day(today, last.year, last.month) + timedelta(days=1), step="week",
                      prev_label="last month")
    if key.isdigit() and len(key) == 4 and 2000 <= int(key) < today.year:
        year = int(key)
        return Period(key, key, date(year, 1, 1), date(year + 1, 1, 1), date(year - 1, 1, 1), date(year, 1, 1),
                      step="month", prev_label=str(year - 1))
    if key == "all":
        return Period("all", "All time", step="year")
    return Period("year", "This year", today.replace(month=1, day=1), tomorrow, date(today.year - 1, 1, 1),
                  same_day(today, today.year - 1, today.month) + timedelta(days=1), step="month",
                  prev_label="last year")


ALL_TIME = Period("all", "All time", step="year")


def channel_of(source_detail: str, source: str) -> tuple[str, str]:
    """(filter value, label) of how someone applied, as the talent database filters it."""
    if source_detail:
        return source_detail, source_detail
    return f"portal:{source}", SOURCE_SHORT.get(source, source or "Not recorded")


def excel_values(record) -> dict:
    return {header_key(k): v for k, v in ((record or {}).get("values") or {}).items()}


def tracker_row(requisition) -> dict | None:
    """The requisition's figures exactly as its tracker row gives them, or None if it was raised in the portal."""
    values = excel_values(requisition.source_record)
    if not values:
        return None
    row = {}
    for key, headings in TRACKER:
        number = to_number(next((values[h] for h in headings if h in values), None))
        row[key] = int(number) if number is not None else 0
    status = clean(values.get("status"))
    row["status"] = status[:1].upper() + status[1:].lower() if status else "Not recorded"
    raised, closed = to_date(values.get("requisition date")), to_date(values.get("closing date"))
    row["days_to_fill"] = (closed - raised).days if raised and closed and closed >= raised else None
    return row


def nice_scale(top: int, steps: int = 4) -> tuple[int, list[int]]:
    """A round axis maximum and its ticks (top first), e.g. 37 -> 40, [40, 30, 20, 10, 0]."""
    if top <= 0:
        return 1, [1, 0]
    raw = top / steps
    magnitude = 10 ** math.floor(math.log10(raw)) if raw >= 1 else 1
    step = next(m * magnitude for m in (1, 2, 2.5, 5, 10) if m * magnitude >= raw)
    step = max(1, int(math.ceil(step)))
    ceiling = step * math.ceil(top / step)
    return ceiling, list(range(ceiling, -1, -step))


def tick_marks(ticks: list[int]) -> list[dict]:
    """Each tick with its distance from the top of the plot, in percent (top tick 0, zero 100)."""
    last = max(len(ticks) - 1, 1)
    return [{"value": t, "pos": round(i / last * 100, 3)} for i, t in enumerate(ticks)]


@dataclass
class Scope:
    department: Department | None = None
    region: str = ""
    channel: str = ""
    fixed_department: bool = False

    def person(self, prefix: str = "") -> Q:
        q = Q()
        if self.region:
            q &= Q(**{f"{prefix}region": "" if self.region == "none" else self.region})
        if self.channel.startswith("portal:"):
            q &= Q(**{f"{prefix}source": self.channel.split(":", 1)[1], f"{prefix}source_detail": ""})
        elif self.channel:
            q &= Q(**{f"{prefix}source_detail": self.channel})
        return q

    def dept(self, lookup: str) -> Q:
        return Q(**{lookup: self.department}) if self.department else Q()


@dataclass
class Summary:
    scope: Scope
    period: Period
    today: date = field(default_factory=timezone.localdate)
    _rows: dict = field(default_factory=dict, repr=False)

    # ------------------------------------------------------------------ requisitions (the tracker)
    def requisitions(self):
        return (Requisition.objects.filter(self.scope.dept("department")).exclude(status=Requisition.Status.DRAFT)
                .select_related("department"))

    def rows(self, period: Period | None = None) -> list[dict]:
        """One row per requisition raised in the period: its tracker figures, or the portal's for its own."""
        period = period or self.period
        cache_key = (period.first, period.end)
        if cache_key in self._rows:
            return self._rows[cache_key]
        reqs = list(self.requisitions().filter(period.moments("submitted_at")))
        portal = [r.pk for r in reqs if not excel_values(r.source_record)]
        counts = {}
        if portal:
            for c in (Application.objects.filter(requisition__in=portal).values("requisition").annotate(
                    participants=Count("id"), shortlisted=Count("id", filter=Q(stage__in=PAST_APPLIED)),
                    selected=Count("id", filter=Q(decision=Application.Decision.SELECT)),
                    onboarded=Count("id", filter=Q(status=Application.Status.HIRED)),
                    rejected=Count("id", filter=Q(status=Application.Status.REJECTED)),
                    on_hold=Count("id", filter=Q(status=Application.Status.ON_HOLD)),
                    in_progress=Count("id", filter=Q(status=Application.Status.ACTIVE))).order_by()):
                counts[c.pop("requisition")] = c
        out = []
        for r in reqs:
            row = tracker_row(r)
            if row is None:
                row = {key: counts.get(r.pk, {}).get(key, 0) for key, _ in TRACKER}
                row["positions"] = r.positions
                row["status"] = PORTAL_STATUS.get(r.status, r.get_status_display())
                row["days_to_fill"] = ((r.closed_at - r.submitted_at).days if r.closed_at and r.submitted_at
                                       and r.closed_at >= r.submitted_at else None)
            row["req"] = r
            out.append(row)
        self._rows[cache_key] = out
        return out

    @staticmethod
    def totals(rows) -> dict:
        return {key: sum(r[key] for r in rows) for key, _ in TRACKER}

    def undated_requisitions(self) -> int:
        return self.requisitions().filter(submitted_at__isnull=True).count() if self.period.first else 0

    # ------------------------------------------------------------------ applicants (people)
    def applicants(self, period: Period | None = None):
        period = period or self.period
        if self.scope.department:
            ids = [r["req"].pk for r in self.rows(period)]
            return Candidate.objects.filter(self.scope.person(),
                                            pk__in=Application.objects.filter(requisition__in=ids).values("candidate"))
        return Candidate.objects.exclude(source_detail=STAFF_LIST).filter(self.scope.person(),
                                                                          period.dates("applied_on"))

    def undated_applicants(self) -> int:
        """Applicants with no application date in Excel: in All time, never on a day, month or year."""
        if self.scope.department:
            return 0
        return Candidate.objects.exclude(source_detail=STAFF_LIST).filter(self.scope.person(),
                                                                          applied_on__isnull=True).count()

    # ------------------------------------------------------------------ interviews, CBTs, staff
    def interview_records(self, period: Period):
        return InterviewRecord.objects.filter(self.scope.dept("requisition__department"),
                                              self.scope.person("candidate__"), period.dates("interview_date"))

    def portal_interviews(self, period: Period):
        return (Interview.objects.filter(self.scope.dept("application__requisition__department"),
                                         self.scope.person("application__candidate__"), period.moments("scheduled_at"))
                .exclude(status=Interview.Status.CANCELLED))

    def cbts(self, period: Period):
        return CBTResult.objects.filter(self.scope.person("candidate__"), period.dates("test_date"))

    def staff(self):
        return Employee.objects.filter(self.scope.dept("department"))

    def retiring(self):
        return self.staff().filter(status=Employee.Status.ACTIVE, retirement_date__gte=self.today,
                                   retirement_date__lte=self.today + timedelta(days=365))

    # ------------------------------------------------------------------ the two columns of large figures
    def requisition_figures(self) -> list[dict]:
        rows = self.rows()
        t = self.totals(rows)
        found = Counter(r["status"] for r in rows)
        order = {s: i for i, s in enumerate(STATUS_ORDER)}
        statuses = " · ".join(f"{n:,} {s.lower()}" for s, n in sorted(found.items(),
                                                                      key=lambda kv: (order.get(kv[0], 99), -kv[1])))
        days = [r["days_to_fill"] for r in rows if r["days_to_fill"] is not None]
        filled = round(t["onboarded"] / t["positions"] * 100) if t["positions"] else None
        return [
            {"key": "requisitions", "value": len(rows), "label": "Requisitions", "sub": statuses},
            {"key": "positions", "value": t["positions"], "label": "Positions",
             "sub": f"{t['in_progress']:,} in progress"},
            {"key": "days", "value": round(sum(days) / len(days)) if days else None, "label": "Days to fill",
             "sub": (f"Average of {len(days):,} closed requisition{'s' if len(days) != 1 else ''}" if days
                     else "No closed requisitions with both dates")},
            {"key": "filled", "value": filled, "unit": "%", "label": "Positions filled",
             "sub": f"{t['onboarded']:,} onboarded of {t['positions']:,}"},
        ]

    def applicant_figures(self) -> list[dict]:
        p = self.period
        t = self.totals(self.rows())
        applicants = self.applicants().count()
        sub = "On these requisitions" if self.scope.department else "Each person counted once"
        if p.prev_first:
            before = self.applicants(Period("prev", "", p.prev_first, p.prev_end)).count()
            if before:
                pct = round((applicants - before) / before * 100)
                sub = f"{'+' if pct > 0 else ''}{pct}% vs {p.prev_label}"
        records = self.interview_records(p)
        selected = records.filter(result=InterviewRecord.Result.SELECTED).count()
        return [
            {"key": "applicants", "value": applicants, "label": "Applicants", "sub": sub},
            {"key": "shortlisted", "value": t["shortlisted"], "label": "Shortlisted for interview",
             "sub": f"of {t['participants']:,} participants"},
            {"key": "interviews", "value": records.count() + self.portal_interviews(p).count(), "label": "Interviews",
             "sub": f"{selected:,} selected"},
            {"key": "onboarded", "value": t["onboarded"], "label": "Onboarded",
             "sub": f"{round(t['onboarded'] / t['selected'] * 100)}% of the {t['selected']:,} selected"
             if t["selected"] else "None selected yet"},
        ]

    # ------------------------------------------------------------------ month by month (grouped columns)
    def _bucket(self, day: date, step: str):
        if step == "day":
            return day
        if step == "week":
            return day - timedelta(days=day.weekday())
        if step == "month":
            return (day.year, day.month)
        return day.year

    def monthly(self) -> dict:
        """Participants, shortlisted and onboarded by when their requisition was raised (tracker figures)."""
        p = self.period
        step = p.step
        window = Period("chart", "", p.chart_first, p.chart_end)
        sums = {}
        for r in self.rows(window):
            if not r["req"].submitted_at:
                continue
            b = self._bucket(timezone.localtime(r["req"].submitted_at).date(), step)
            for key, _ in MONTHLY:
                sums.setdefault(b, Counter())[key] += r[key]
        groups = []
        if step in {"day", "week"}:
            day = self._bucket(p.chart_first, step)
            while day < p.chart_end:
                label = str(day.day) if step == "day" else f"{day.day} {day:%b}"
                full = day_text(day, weekday=True) if step == "day" else f"Week of {day_text(day)}"
                groups.append((day, label, full))
                day += timedelta(days=1 if step == "day" else 7)
        elif step == "month":
            year, month = p.chart_first.year, p.chart_first.month
            while date(year, month, 1) < p.chart_end:
                groups.append(((year, month), calendar.month_abbr[month], f"{calendar.month_name[month]} {year}"))
                year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        else:
            years = sorted(sums) or [self.today.year]
            for year in range(max(years[0], self.today.year - 9), self.today.year + 1):
                groups.append((year, str(year), str(year)))
        top = max([v for c in sums.values() for v in c.values()] + [0])
        ceiling, ticks = nice_scale(top)
        out = []
        for key, label, full in groups:
            values = [{"label": name, "n": sums.get(key, Counter())[k],
                       "pct": round(sums.get(key, Counter())[k] / ceiling * 100, 1)} for k, name in MONTHLY]
            out.append({"label": label, "full": full, "values": values})
        every = max(1, math.ceil(len(out) / 12))
        for i, g in enumerate(out):
            g["show"] = i % every == 0 or i == len(out) - 1
        title = {"day": "Day by day", "week": "Week by week", "month": "Month by month", "year": "Year by year"}[step]
        return {"title": title, "groups": out, "series": [name for _, name in MONTHLY], "ticks": tick_marks(ticks),
                "empty": top == 0, "span": "Last 14 days" if p.key == "today" else p.label}

    # ------------------------------------------------------------------ open requisitions (the table)
    def pipeline(self, limit: int = 6) -> dict:
        open_rows = [r for r in self.rows(ALL_TIME) if r["status"] not in DONE]
        open_rows.sort(key=lambda r: (-r["participants"], -(r["req"].submitted_at or midnight(date(2000, 1, 1)))
                                      .timestamp()))
        return {"rows": open_rows[:limit], "more": max(0, len(open_rows) - limit),
                "total": self.totals(open_rows), "count": len(open_rows)}

    # ------------------------------------------------------------------ sources by community (grouped columns)
    def sources(self, limit: int = 6) -> dict:
        """How host, pipeline and jetty applicants applied (channel), with each group's total."""
        applicants = self.applicants()
        by_group = dict(applicants.values_list("region").annotate(n=Count("id")).order_by())
        found = {}
        for detail, source, region, n in (applicants.filter(region__in=[g for g, _ in LOCAL_GROUPS])
                                          .values_list("source_detail", "source", "region")
                                          .annotate(n=Count("id")).order_by()):
            value, label = channel_of(detail, source)
            found.setdefault(value, {"label": label, "counts": Counter()})["counts"][region] += n
        channels = sorted(found.values(), key=lambda c: -sum(c["counts"].values()))[:limit]
        top = max([n for c in channels for n in c["counts"].values()] + [0])
        ceiling, ticks = nice_scale(top)
        groups = [{"label": c["label"], "values": [{"label": name, "n": c["counts"][g],
                                                    "pct": round(c["counts"][g] / ceiling * 100, 1)}
                                                   for g, name in LOCAL_GROUPS]} for c in channels]
        others = [(label, by_group.get(value, 0)) for value, label in REGION_CHOICES if value not in dict(LOCAL_GROUPS)]
        others.append(("Not recorded", by_group.get("", 0)))
        return {"groups": groups, "ticks": tick_marks(ticks), "empty": top == 0,
                "series": [{"value": g, "label": name, "n": by_group.get(g, 0)} for g, name in LOCAL_GROUPS],
                "others": [(label, n) for label, n in others if n], "others_total": sum(n for _, n in others)}

    # ------------------------------------------------------------------ the bar along the bottom
    def today_figures(self) -> list[dict]:
        day = Period("today", "Today", self.today, self.today + timedelta(days=1))
        items = []
        if not self.scope.department:
            items.append({"label": "applied", "value": self.applicants(day).count()})
        items.append({"label": "interviews", "value": self.interview_records(day).count()
                      + self.portal_interviews(day).count()})
        if not self.scope.department:
            items.append({"label": "CBTs", "value": self.cbts(day).count()})
        items.append({"label": "requisitions received", "value": len(self.rows(day))})
        return items

    def staff_figures(self) -> list[dict]:
        return [{"label": "current staff", "value": self.staff().filter(status=Employee.Status.ACTIVE).count()},
                {"label": "retire within 12 months", "value": self.retiring().count()}]


def data_status() -> dict | None:
    """Whether the portal is in step with the linked workbooks."""
    books = list(LinkedWorkbook.objects.order_by("path"))
    if not books:
        return None
    for b in books:
        b.short = os.path.basename(b.path.replace("\\", "/"))
    problems = [b for b in books if b.state in {LinkedWorkbook.State.ERROR, LinkedWorkbook.State.MISSING}]
    waiting = [b for b in books if b.state == LinkedWorkbook.State.WAITING or (
        b.file_modified_at and b.synced_at and b.file_modified_at > b.synced_at)]
    if problems:
        tone, text = "danger", f"{problems[0].short} could not be read"
    elif waiting:
        tone, text = "warning", "Excel has changes waiting to load"
    else:
        tone, text = "success", "In step with Excel"
    return {"tone": tone, "text": text, "books": books,
            "loaded": max((b.synced_at for b in books if b.synced_at), default=None)}


def year_options() -> list[str]:
    this = timezone.localdate().year
    years = {d.year for d in Candidate.objects.exclude(applied_on=None).dates("applied_on", "year")}
    years |= {d.year for d in Requisition.objects.exclude(submitted_at=None).datetimes("submitted_at", "year")}
    years |= {d.year for d in InterviewRecord.objects.exclude(interview_date=None).dates("interview_date", "year")}
    return [str(y) for y in sorted(years, reverse=True) if 2000 <= y < this][:10]
