"""The summary page: what the linked Excel workbooks say, at a glance, for the company or one department.

Every figure is a value from Excel, dated by the date Excel gives it, never by the day it was loaded:
- requisitions, their status, positions and the recruitment funnel (participants, shortlisted for interview,
  selected, onboarded, rejected, on hold, in progress): the requisition tracker, row by row, as written there,
  dated by the Requisition Date;
- interviews: the interview records, by their Date; CBTs: the CBT results, by their Date;
- applicants: people (one per person, however many rows), by their application date (see candidates/dates.py),
  with the group (host, pipeline...) and the channel their rows give;
- staff: the staff list (Join Date, Release Date and its own Years to Retirement).
Requisitions, applications and interviews created in the portal itself are added with their own dates. A record
with no date in Excel is counted under "All time" only, and the page says how many there are.
"""

from __future__ import annotations

import calendar
import math
import os
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

from django.db.models import Count, Q
from django.db.models.functions import TruncMonth, TruncYear
from django.utils import timezone
from django.utils.html import format_html

from candidates.models import SOURCE_SHORT, CBTResult, Candidate
from candidates.people import STAFF_LIST
from candidates.regions import REGION_CHOICES
from pipeline.models import Application, Interview, InterviewRecord, Stage
from requisitions.models import Requisition

from .models import Department, Employee, LinkedWorkbook
from .workbook_import import clean, header_key, to_number

PERIODS = [("today", "Today"), ("7d", "Last 7 days"), ("30d", "Last 30 days"), ("month", "This month"),
           ("year", "This year"), ("all", "All time")]
REGION_LABELS = dict(REGION_CHOICES) | {"none": "Not recorded"}
PAST_APPLIED = [s.value for s in Stage if s != Stage.APPLIED]
# The tracker's own columns: (key, the headings it may have, label).
TRACKER = [
    ("positions", ("manpower required",), "Positions"),
    ("participants", ("participants",), "Participants"),
    ("shortlisted", ("shortlisted for interview",), "Shortlisted"),
    ("selected", ("selected",), "Selected"),
    ("onboarded", ("onboarded #", "onboarded"), "Onboarded"),
    ("rejected", ("rejected",), "Rejected"),
    ("on_hold", ("on-hold", "on hold"), "On hold"),
    ("in_progress", ("in progres", "in progress"), "In progress"),
]
FUNNEL = ["participants", "shortlisted", "selected", "onboarded"]
# Requisitions raised in the portal (not in the tracker), in the tracker's words where they exist.
PORTAL_STATUS = {"submitted": "Awaiting approval", "returned": "Awaiting approval", "pending_management":
                 "Awaiting approval", "approved": "Open", "open": "Open", "on_hold": "On hold", "filled": "Filled",
                 "closed": "Closed", "cancelled": "Closed"}
STATUS_ORDER = ["Pending", "In progress", "Awaiting approval", "Open", "On hold", "Closed", "Filled"]


def midnight(day: date) -> datetime:
    return timezone.make_aware(datetime.combine(day, time.min))


def same_day(day: date, year: int, month: int) -> date:
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


@dataclass
class Period:
    """The days [first, end); None for all time."""
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
    if key in {"7d", "30d"}:
        days = 7 if key == "7d" else 30
        first = today - timedelta(days=days - 1)
        return Period(key, dict(PERIODS)[key], first, tomorrow, first - timedelta(days=days), first,
                      prev_label=f"the {days} days before")
    if key == "month":
        last = today.replace(day=1) - timedelta(days=1)
        return Period(key, "This month", today.replace(day=1), tomorrow, last.replace(day=1),
                      same_day(today, last.year, last.month) + timedelta(days=1), prev_label="last month")
    if key.isdigit() and len(key) == 4 and 2000 <= int(key) < today.year:
        year = int(key)
        return Period(key, key, date(year, 1, 1), date(year + 1, 1, 1), date(year - 1, 1, 1), date(year, 1, 1),
                      step="month", prev_label=str(year - 1))
    if key == "all":
        return Period("all", "All time", step="year")
    return Period("year", "This year", today.replace(month=1, day=1), tomorrow, date(today.year - 1, 1, 1),
                  same_day(today, today.year - 1, today.month) + timedelta(days=1), step="month",
                  prev_label="last year")


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
    for key, headings, _ in TRACKER:
        number = to_number(next((values[h] for h in headings if h in values), None))
        row[key] = int(number) if number is not None else 0
    status = clean(values.get("status"))
    row["status"] = status[:1].upper() + status[1:].lower() if status else "Not recorded"
    return row


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
                row = {key: counts.get(r.pk, {}).get(key, 0) for key, _, _ in TRACKER}
                row["positions"] = r.positions
                row["status"] = PORTAL_STATUS.get(r.status, r.get_status_display())
            row["req"] = r
            out.append(row)
        self._rows[cache_key] = out
        return out

    @staticmethod
    def totals(rows) -> dict:
        return {key: sum(r[key] for r in rows) for key, _, _ in TRACKER}

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

    # ------------------------------------------------------------------ sections
    def kpis(self) -> list[dict]:
        p = self.period
        t = self.totals(self.rows())
        applicants = self.applicants().count()
        delta, tone = "", ""
        if p.prev_first:
            before = self.applicants(Period("prev", "", p.prev_first, p.prev_end)).count()
            if before:
                pct = round((applicants - before) / before * 100)
                delta = f"{'+' if pct > 0 else ''}{pct}% vs {p.prev_label}"
                tone = "up" if pct > 0 else "down" if pct < 0 else ""
        records = self.interview_records(p)
        interviews = records.count() + self.portal_interviews(p).count()
        selected = records.filter(result=InterviewRecord.Result.SELECTED).count()
        fill = f" ({round(t['onboarded'] / t['positions'] * 100)}%)" if t["positions"] else ""
        return [
            {"label": "Requisitions", "value": len(self.rows()), "icon": "clipboard-list",
             "note": f"{t['positions']:,} position{'s' if t['positions'] != 1 else ''}",
             "source": "Tracker · Requisition Date"},
            {"label": "Applicants", "value": applicants, "icon": "users", "tone": tone,
             "note": delta or ("On these requisitions" if self.scope.department else "Each person counted once"),
             "source": "On its requisitions" if self.scope.department else "CV list, website · date applied"},
            {"label": "Shortlisted for interview", "value": t["shortlisted"], "icon": "star",
             "note": f"of {t['participants']:,} participants", "source": "Tracker"},
            {"label": "Interviews", "value": interviews, "icon": "messages-square",
             "note": f"{selected:,} selected", "source": "Interview records · Date"},
            {"label": "Onboarded", "value": t["onboarded"], "icon": "user-check",
             "note": f"of {t['positions']:,} positions{fill}", "source": "Tracker · Onboarded #"},
            {"label": "Current staff", "value": self.staff().filter(status=Employee.Status.ACTIVE).count(),
             "icon": "id-card", "note": f"{self.retiring().count():,} retire within 12 months", "source": "Staff list"},
        ]

    def today_figures(self) -> list[dict]:
        day = Period("today", "Today", self.today, self.today + timedelta(days=1))
        items = []
        if not self.scope.department:
            items.append({"label": "Applied", "value": self.applicants(day).count()})
        items.append({"label": "Interviews", "value": self.interview_records(day).count()
                      + self.portal_interviews(day).count()})
        if not self.scope.department:
            items.append({"label": "CBTs", "value": self.cbts(day).count()})
        items.append({"label": "Requisitions received", "value": len(self.rows(day))})
        return items

    def funnel(self) -> dict:
        t = self.totals(self.rows())
        top = max([t[k] for k in FUNNEL] + [0])
        steps = [{"label": label, "n": t[key], "bar": round(t[key] / top * 100, 1) if top else 0,
                  "of": round(t[key] / t["participants"] * 100) if t["participants"] and key != "participants" else None}
                 for key, _, label in TRACKER if key in FUNNEL]
        return {"steps": steps, "positions": t["positions"], "rejected": t["rejected"], "on_hold": t["on_hold"],
                "in_progress": t["in_progress"], "total": top}

    def statuses(self) -> list[dict]:
        found = Counter(r["status"] for r in self.rows())
        order = {s: i for i, s in enumerate(STATUS_ORDER)}
        rows = [{"label": s, "n": n} for s, n in sorted(found.items(), key=lambda kv: (order.get(kv[0], 99), -kv[1]))]
        return _shares(rows)

    def departments(self, limit: int = 8) -> dict:
        by = defaultdict(lambda: {"n": 0, "positions": 0, "onboarded": 0})
        for r in self.rows():
            d = by[r["req"].department]
            d["n"] += 1
            d["positions"] += r["positions"]
            d["onboarded"] += r["onboarded"]
        rows = sorted(({"department": k, "label": k.name, **v} for k, v in by.items()),
                      key=lambda x: (-x["n"], x["label"]))
        return {"rows": _shares(rows[:limit]), "more": max(0, len(rows) - limit)}

    def trend(self) -> dict:
        """People who applied (company) or interviews (department), by day, month or year."""
        p = self.period
        window = Period("chart", "", p.chart_first, p.chart_end)
        counts = Counter()
        if self.scope.department:
            title = "Interviews"
            for d in self.interview_records(window).values_list("interview_date", flat=True):
                counts[self._bucket(d)] += 1
            for m in self.portal_interviews(window).values_list("scheduled_at", flat=True):
                counts[self._bucket(timezone.localtime(m).date())] += 1
        else:
            title = "People who applied"
            if p.step == "day":
                found = self.applicants(window).values_list("applied_on").annotate(n=Count("id")).order_by()
            else:
                trunc = TruncMonth if p.step == "month" else TruncYear
                found = (self.applicants(window).exclude(applied_on=None).annotate(b=trunc("applied_on"))
                         .values_list("b").annotate(n=Count("id")).order_by())
            for d, n in found:
                if d:
                    counts[self._bucket(d)] += n
        bars = []
        if p.step == "day":
            day = p.chart_first
            while day < p.chart_end:
                bars.append({"label": str(day.day), "full": day.strftime("%a %-d %b %Y"), "n": counts.get(day, 0)})
                day += timedelta(days=1)
        elif p.step == "month":
            year, month = p.chart_first.year, p.chart_first.month
            while date(year, month, 1) < p.chart_end:
                bars.append({"label": calendar.month_abbr[month], "full": f"{calendar.month_name[month]} {year}",
                             "n": counts.get((year, month), 0)})
                year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        else:
            years = sorted(counts) or [self.today.year]
            for year in range(max(years[0], self.today.year - 9), self.today.year + 1):
                bars.append({"label": str(year), "full": str(year), "n": counts.get(year, 0)})
        top = max([b["n"] for b in bars] + [0])
        every = max(1, math.ceil(len(bars) / 12))
        for i, b in enumerate(bars):
            b["pct"] = round(b["n"] / top * 100, 1) if top else 0
            b["show"] = i % every == 0 or i == len(bars) - 1
        label = "Last 14 days" if p.key == "today" else {"day": "By day", "month": "By month", "year": "By year"}[p.step]
        return {"title": title, "bars": bars, "top": top, "total": sum(b["n"] for b in bars), "label": label,
                "busiest": max(bars, key=lambda b: b["n"]) if top else None}

    def _bucket(self, d):
        if isinstance(d, datetime):
            d = timezone.localtime(d).date() if timezone.is_aware(d) else d.date()
        return d if self.period.step == "day" else (d.year, d.month) if self.period.step == "month" else d.year

    def regions(self) -> list[dict]:
        found = dict(self.applicants().values_list("region").annotate(n=Count("id")).order_by())
        rows = [{"value": v, "label": label, "n": found.get(v, 0)} for v, label in REGION_CHOICES]
        rows.append({"value": "none", "label": "Not recorded", "n": found.get("", 0)})
        return _shares(rows)

    def channels(self, limit: int = 6) -> list[dict]:
        found = {}
        for detail, source, n in (self.applicants().values_list("source_detail", "source").annotate(n=Count("id"))
                                  .order_by()):
            value, label = channel_of(detail, source)
            found.setdefault(value, {"value": value, "label": label, "n": 0})["n"] += n
        rows = sorted(found.values(), key=lambda r: -r["n"])
        if len(rows) > limit:
            rest = rows[limit - 1:]
            rows = rows[:limit - 1] + [{"value": "", "label": f"Other ({len(rest)} channels)",
                                        "n": sum(r["n"] for r in rest)}]
        return _shares(rows)

    def staff_figures(self) -> list[dict]:
        staff, p = self.staff(), self.period
        return [
            {"label": "Current staff", "value": staff.filter(status=Employee.Status.ACTIVE).count()},
            {"label": "Retire within 12 months", "value": self.retiring().count()},
            {"label": "Joined", "value": staff.filter(p.dates("date_of_employment")).exclude(
                date_of_employment=None).count()},
            {"label": "Left", "value": staff.exclude(status=Employee.Status.ACTIVE).filter(p.dates("exit_date"))
             .exclude(exit_date=None).count()},
        ]

    def highlights(self) -> list[dict]:
        out = []
        pending = [r for r in self.rows(Period("all", "All time")) if r["status"] in {"Pending", "Awaiting approval"}]
        if pending:
            oldest = min((r["req"].submitted_at for r in pending if r["req"].submitted_at), default=None)
            out.append({"icon": "clipboard-list", "text": format_html(
                "<b>{}</b> requisition{} pending in the tracker{}.", f"{len(pending):,}",
                "s are" if len(pending) != 1 else " is",
                format_html("; the oldest was raised on {}", timezone.localtime(oldest).strftime("%-d %b %Y"))
                if oldest else "")})
        t = self.totals(self.rows())
        if t["positions"]:
            out.append({"icon": "user-check", "text": format_html(
                "<b>{}</b> of <b>{}</b> positions onboarded ({}%) on requisitions raised {}.", f"{t['onboarded']:,}",
                f"{t['positions']:,}", round(t["onboarded"] / t["positions"] * 100),
                self.period.label.lower() if self.period.first else "so far")})
        regions = {r["value"]: r for r in self.regions()}
        total = sum(r["n"] for r in regions.values())
        local = sum(regions[g]["n"] for g in ("host", "pipeline", "jetty"))
        if total and local:
            out.append({"icon": "map-pin", "text": format_html(
                "Host, pipeline and jetty communities: <b>{}%</b> of applicants.", round(local / total * 100))})
        n = self.retiring().count()
        if n:
            uncovered = self.retiring().filter(replacement_requisitions__isnull=True).count()
            out.append({"icon": "hourglass", "text": format_html(
                "<b>{}</b> {} within 12 months{}.", n, "staff retire" if n != 1 else "staff member retires",
                format_html("; <b>{}</b> without a replacement requisition", uncovered) if uncovered else "")})
        return out[:3]


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


def _shares(rows: list[dict]) -> list[dict]:
    """Each row's share of the total (pct) and its bar length against the largest row (bar)."""
    total = sum(r["n"] for r in rows)
    top = max([r["n"] for r in rows] + [0])
    for r in rows:
        r["pct"] = round(r["n"] / total * 100) if total else 0
        r["bar"] = round(r["n"] / top * 100, 1) if top else 0
    return rows


def year_options() -> list[str]:
    this = timezone.localdate().year
    years = {d.year for d in Candidate.objects.exclude(applied_on=None).dates("applied_on", "year")}
    years |= {d.year for d in Requisition.objects.exclude(submitted_at=None).datetimes("submitted_at", "year")}
    years |= {d.year for d in InterviewRecord.objects.exclude(interview_date=None).dates("interview_date", "year")}
    return [str(y) for y in sorted(years, reverse=True) if 2000 <= y < this][:10]
