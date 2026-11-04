"""The summary page: recruitment and staff at a glance, for the whole company or for one department.

Every figure follows the same filters: the period, the department (fixed to their own for a head of department),
the candidate group (host, pipeline, jetty...) and the channel people applied through. "Applicants" are people:
for the whole company, everyone who joined the talent database in the period (the date the records give); for a
department, everyone who applied to one of its vacancies in the period. Staff-list profiles are not applicants.
"""

from __future__ import annotations

import calendar
import math
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

from django.db.models import Count, Q
from django.db.models.functions import TruncDate, TruncMonth, TruncYear
from django.urls import reverse
from django.utils import timezone
from django.utils.html import format_html

from candidates.models import SOURCE_SHORT, Candidate
from candidates.people import STAFF_LIST
from candidates.regions import REGION_CHOICES
from pipeline.models import Application, Interview, InterviewRecord, Stage
from requisitions.models import Requisition

from .models import Department, Employee

PERIODS = [("today", "Today"), ("7d", "Last 7 days"), ("30d", "Last 30 days"), ("month", "This month"),
           ("year", "This year"), ("all", "All time")]
REGION_LABELS = dict(REGION_CHOICES) | {"none": "Not recorded"}
AWAITING_APPROVAL = [Requisition.Status.SUBMITTED, Requisition.Status.PENDING_MANAGEMENT, Requisition.Status.RETURNED]
PAST_APPLIED = [s.value for s in Stage if s != Stage.APPLIED]  # shortlisted or further
REQUISITION_BUCKETS = [
    ("pending", "Awaiting approval", AWAITING_APPROVAL),
    ("active", "Approved or open", [Requisition.Status.APPROVED, Requisition.Status.OPEN]),
    ("on_hold", "On hold", [Requisition.Status.ON_HOLD]),
    ("filled", "Filled", [Requisition.Status.FILLED]),
    ("closed", "Closed or cancelled", [Requisition.Status.CLOSED, Requisition.Status.CANCELLED]),
]


def midnight(day: date) -> datetime:
    return timezone.make_aware(datetime.combine(day, time.min))


def same_day(day: date, year: int, month: int) -> date:
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


@dataclass
class Period:
    key: str
    label: str
    start: datetime | None = None  # inclusive
    end: datetime | None = None  # exclusive
    prev_start: datetime | None = None
    prev_end: datetime | None = None
    step: str = "day"  # chart bars: day, month or year
    chart_start: datetime | None = None
    chart_end: datetime | None = None
    chart_label: str = ""
    prev_label: str = ""

    def __post_init__(self):
        if self.chart_start is None:
            self.chart_start, self.chart_end = self.start, self.end


def period_for(key: str, today: date | None = None) -> Period:
    today = today or timezone.localdate()
    tomorrow = midnight(today + timedelta(days=1))
    if key == "today":
        return Period(key, "Today", midnight(today), tomorrow, midnight(today - timedelta(days=1)), midnight(today),
                      chart_start=midnight(today - timedelta(days=13)), chart_end=tomorrow,
                      chart_label="Last 14 days", prev_label="yesterday")
    if key in {"7d", "30d"}:
        days = 7 if key == "7d" else 30
        start = midnight(today - timedelta(days=days - 1))
        return Period(key, dict(PERIODS)[key], start, tomorrow, start - timedelta(days=days), start,
                      prev_label=f"the {days} days before")
    if key == "month":
        last = today.replace(day=1) - timedelta(days=1)
        return Period(key, "This month", midnight(today.replace(day=1)), tomorrow, midnight(last.replace(day=1)),
                      midnight(same_day(today, last.year, last.month) + timedelta(days=1)),
                      prev_label="the same days last month")
    if key.isdigit() and len(key) == 4 and 2000 <= int(key) < today.year:
        year = int(key)
        return Period(key, key, midnight(date(year, 1, 1)), midnight(date(year + 1, 1, 1)),
                      midnight(date(year - 1, 1, 1)), midnight(date(year, 1, 1)), step="month",
                      prev_label=str(year - 1))
    if key == "all":
        return Period("all", "All time", step="year")
    start = midnight(today.replace(month=1, day=1))
    return Period("year", "This year", start, tomorrow, midnight(date(today.year - 1, 1, 1)),
                  midnight(same_day(today, today.year - 1, today.month) + timedelta(days=1)), step="month",
                  prev_label="the same time last year")


def window(prefix: str, start, end) -> Q:
    if start is None:
        return Q()
    return Q(**{f"{prefix}__gte": start, f"{prefix}__lt": end})


def day_window(prefix: str, start, end) -> Q:
    if start is None:
        return Q()
    return Q(**{f"{prefix}__gte": timezone.localtime(start).date(), f"{prefix}__lt": timezone.localtime(end).date()})


def channel_of(source_detail: str, source: str) -> tuple[str, str]:
    """(filter value, label) of the channel someone applied through, as the talent database filters it."""
    if source_detail:
        return source_detail, source_detail
    return f"portal:{source}", SOURCE_SHORT.get(source, source or "Not recorded")


def change(now: int, before: int) -> tuple[str, str]:
    """('+12% on the 7 days before', tone)."""
    if not before:
        return ("", "") if not now else ("New this period", "up")
    pct = round((now - before) / before * 100)
    if pct == 0:
        return "Same as before", ""
    return f"{'+' if pct > 0 else ''}{pct}%", "up" if pct > 0 else "down"


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

    def dept(self, prefix: str) -> Q:
        return Q(**{prefix: self.department}) if self.department else Q()


@dataclass
class Summary:
    scope: Scope
    period: Period
    now: datetime = field(default_factory=timezone.now)

    # --------------------------------------------------------------- the people and records in scope
    def applicants(self):
        """(queryset, date field, person id field, person prefix): who applied, for counting and grouping."""
        if self.scope.department:
            qs = Application.objects.filter(self.scope.dept("requisition__department"), self.scope.person("candidate__"))
            return qs.exclude(candidate__source_detail=STAFF_LIST), "applied_at", "candidate_id", "candidate__"
        qs = Candidate.objects.filter(self.scope.person()).exclude(source_detail=STAFF_LIST)
        return qs, "created_at", "id", ""

    def count_applicants(self, start, end) -> int:
        qs, when, who, _ = self.applicants()
        return qs.filter(window(when, start, end)).aggregate(n=Count(who, distinct=True))["n"]

    def applications(self):
        return Application.objects.filter(self.scope.dept("requisition__department"), self.scope.person("candidate__"))

    def requisitions(self):
        return Requisition.objects.filter(self.scope.dept("department")).exclude(status=Requisition.Status.DRAFT)

    def interviews(self):
        return Interview.objects.filter(self.scope.dept("application__requisition__department"),
                                        self.scope.person("application__candidate__"))

    def interview_records(self):
        return InterviewRecord.objects.filter(self.scope.dept("requisition__department"),
                                              self.scope.person("candidate__"))

    def staff(self):
        return Employee.objects.filter(self.scope.dept("department"))

    # --------------------------------------------------------------- sections
    def today(self) -> dict:
        today = timezone.localdate()
        start, end = midnight(today), midnight(today + timedelta(days=1))
        qs, when, who, prefix = self.applicants()
        applied = qs.filter(window(when, start, end))
        by_channel = self.channels(applied, who, prefix, limit=3)
        interviews = list(self.interviews().filter(scheduled_at__gte=start, scheduled_at__lt=end)
                          .exclude(status=Interview.Status.CANCELLED)
                          .select_related("application__candidate", "application__requisition")
                          .order_by("scheduled_at"))
        records = list(self.interview_records().filter(interview_date=today).select_related("candidate", "requisition"))
        shortlisted = self.applications().filter(stage=Stage.SHORTLISTED, stage_changed_at__gte=start,
                                                 stage_changed_at__lt=end).count()
        return {
            "date": today, "applied": applied.aggregate(n=Count(who, distinct=True))["n"], "channels": by_channel,
            "interviews": interviews, "records": records, "interview_count": len(interviews) + len(records),
            "confirmed": sum(1 for i in interviews if i.candidate_response == "confirmed"),
            "shortlisted": shortlisted,
        }

    def kpis(self) -> list[dict]:
        p = self.period
        applicants_now = self.count_applicants(p.start, p.end)
        applicants_before = self.count_applicants(p.prev_start, p.prev_end) if p.prev_start else 0
        delta, tone = change(applicants_now, applicants_before) if p.prev_start else ("", "")
        reqs = self.requisitions()
        raised = reqs.filter(Q(submitted_at__isnull=False, **_range("submitted_at", p))
                             | Q(submitted_at__isnull=True, **_range("created_at", p))).count()
        open_now = reqs.filter(status__in=Requisition.ACTIVE_STATUSES).count()
        waiting = reqs.filter(status__in=AWAITING_APPROVAL).count()
        apps = self.applications().filter(window("applied_at", p.start, p.end))
        n_apps = apps.count()
        shortlisted = apps.exclude(stage=Stage.APPLIED).count()
        in_progress = apps.filter(status__in=[Application.Status.ACTIVE, Application.Status.ON_HOLD]).count()
        records = self.interview_records().filter(day_window("interview_date", p.start, p.end))
        held = self.interviews().filter(window("scheduled_at", p.start, p.end), status=Interview.Status.COMPLETED)
        interviewed = records.count() + held.values("application").distinct().count()
        selected = records.filter(result="selected").count() + self.applications().filter(
            window("decided_at", p.start, p.end), decision=Application.Decision.SELECT).count()
        hired = self.applications().filter(window("hired_at", p.start, p.end), status=Application.Status.HIRED)
        n_hired = hired.count()
        days = [(a.hired_at - a.applied_at).days for a in hired.exclude(hired_at=None).only("hired_at", "applied_at")]
        pipe = reverse("pipeline:applications")
        return [
            {"key": "requisitions", "label": "Requisitions raised", "value": raised, "icon": "clipboard-list",
             "note": f"{open_now:,} open now · {waiting:,} awaiting approval", "url": reverse("requisitions:list")},
            {"key": "applicants", "label": "People who applied", "value": applicants_now, "icon": "users",
             "note": f"{delta} on {p.prev_label}" if delta and delta[0] in "+-" else delta, "tone": tone},
            {"key": "applications", "label": "Vacancy applications", "value": n_apps, "icon": "inbox",
             "note": f"{in_progress:,} still in progress", "url": pipe},
            {"key": "shortlisted", "label": "Shortlisted", "value": shortlisted, "icon": "star",
             "note": f"{round(shortlisted / n_apps * 100)}% of applications" if n_apps else "No applications yet",
             "url": f"{pipe}?stage=shortlisted"},
            {"key": "interviewed", "label": "Interviewed", "value": interviewed, "icon": "messages-square",
             "note": f"{selected:,} selected", "url": reverse("pipeline:interviews") + "?scope=past"},
            {"key": "hired", "label": "Hired", "value": n_hired, "icon": "user-check",
             "note": f"{round(sum(days) / len(days))} days from application, on average" if days else "None yet"},
        ]

    def trend(self) -> dict:
        p = self.period
        qs, when, who, _ = self.applicants()
        qs = qs.filter(window(when, p.chart_start, p.chart_end))
        trunc = {"day": TruncDate, "month": TruncMonth, "year": TruncYear}[p.step]
        counts = {}
        for row in qs.annotate(bucket=trunc(when)).values("bucket").annotate(n=Count(who, distinct=True)).order_by():
            bucket = row["bucket"]
            if isinstance(bucket, datetime):
                bucket = timezone.localtime(bucket).date() if timezone.is_aware(bucket) else bucket.date()
            key = bucket if p.step == "day" else (bucket.year, bucket.month) if p.step == "month" else bucket.year
            counts[key] = counts.get(key, 0) + row["n"]
        bars = []
        if p.step == "day":
            day, last = timezone.localtime(p.chart_start).date(), timezone.localtime(p.chart_end).date()
            while day < last:
                bars.append({"label": str(day.day), "full": day.strftime("%a %-d %b"), "n": counts.get(day, 0),
                             "first": day.day == 1})
                day += timedelta(days=1)
        elif p.step == "month":
            first, last = timezone.localtime(p.chart_start).date(), timezone.localtime(p.chart_end).date()
            year, month = first.year, first.month
            while date(year, month, 1) < last:
                bars.append({"label": calendar.month_abbr[month], "full": f"{calendar.month_name[month]} {year}",
                             "n": counts.get((year, month), 0)})
                year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        else:
            years = sorted(counts) or [timezone.localdate().year]
            for year in range(max(years[0], timezone.localdate().year - 9), timezone.localdate().year + 1):
                bars.append({"label": str(year), "full": str(year), "n": counts.get(year, 0)})
        top = max([b["n"] for b in bars] + [0])
        every = max(1, math.ceil(len(bars) / 12))
        for i, bar in enumerate(bars):
            bar["pct"] = round(bar["n"] / top * 100, 1) if top else 0
            bar["show"] = i % every == 0 or i == len(bars) - 1
        return {"bars": bars, "top": top, "total": sum(b["n"] for b in bars),
                "label": p.chart_label or {"day": "By day", "month": "By month", "year": "By year"}[p.step],
                "busiest": max(bars, key=lambda b: b["n"]) if top else None}

    def regions(self) -> list[dict]:
        qs, when, who, prefix = self.applicants()
        qs = qs.filter(window(when, self.period.start, self.period.end))
        found = dict(qs.values_list(f"{prefix}region").annotate(n=Count(who, distinct=True)).order_by())
        rows = [{"value": v, "label": label, "n": found.get(v, 0)} for v, label in REGION_CHOICES]
        rows.append({"value": "none", "label": "Not recorded", "n": found.get("", 0)})
        return _shares(rows)

    def channels(self, qs=None, who=None, prefix=None, limit=6) -> list[dict]:
        if qs is None:
            qs, when, who, prefix = self.applicants()
            qs = qs.filter(window(when, self.period.start, self.period.end))
        found = {}
        for detail, source, n in (qs.values_list(f"{prefix}source_detail", f"{prefix}source")
                                  .annotate(n=Count(who, distinct=True)).order_by()):
            value, label = channel_of(detail, source)
            row = found.setdefault(value, {"value": value, "label": label, "n": 0})
            row["n"] += n
        rows = sorted(found.values(), key=lambda r: -r["n"])
        if len(rows) > limit:
            rest = rows[limit - 1:]
            rows = rows[:limit - 1] + [{"value": "", "label": "Other channels", "n": sum(r["n"] for r in rest),
                                        "detail": ", ".join(r["label"] for r in rest)}]
        return _shares(rows)

    def pipeline(self) -> list[dict]:
        active = self.applications().filter(status__in=[Application.Status.ACTIVE, Application.Status.ON_HOLD])
        counts = dict(active.values_list("stage").annotate(n=Count("id")).order_by())
        return _shares([{"value": s.value, "label": s.label, "n": counts.get(s.value, 0)}
                        for s in Stage if s != Stage.HIRED])

    def requisition_summary(self) -> dict:
        p = self.period
        reqs = self.requisitions().filter(Q(submitted_at__isnull=False, **_range("submitted_at", p))
                                          | Q(submitted_at__isnull=True, **_range("created_at", p)))
        counts = dict(reqs.values_list("status").annotate(n=Count("id")).order_by())
        buckets = [{"key": key, "label": label, "n": sum(counts.get(s, 0) for s in statuses)}
                   for key, label, statuses in REQUISITION_BUCKETS]
        busiest = (self.requisitions().filter(status__in=Requisition.ACTIVE_STATUSES)
                   .annotate(n_apps=Count("applications", filter=self.scope.person("applications__candidate__"),
                                          distinct=True),
                             n_short=Count("applications", filter=self.scope.person("applications__candidate__")
                                           & Q(applications__stage__in=PAST_APPLIED), distinct=True))
                   .select_related("department").order_by("-n_apps", "-published_at")[:5])
        return {"buckets": _shares(buckets), "total": sum(b["n"] for b in buckets), "busiest": list(busiest)}

    def departments(self) -> list[dict]:
        """One row per department (company view only)."""
        p = self.period
        rows = Department.objects.annotate(open_roles=Count(
            "requisitions", filter=Q(requisitions__status__in=Requisition.ACTIVE_STATUSES), distinct=True))
        apps = {r["requisition__department"]: r for r in (
            self.applications().filter(window("applied_at", p.start, p.end)).values("requisition__department")
            .annotate(applicants=Count("candidate", distinct=True),
                      shortlisted=Count("id", filter=Q(stage__in=PAST_APPLIED))).order_by())}
        hired = dict(self.applications().filter(window("hired_at", p.start, p.end), status=Application.Status.HIRED)
                     .values_list("requisition__department").annotate(n=Count("id")).order_by())
        staff = dict(Employee.objects.filter(status=Employee.Status.ACTIVE).values_list("department")
                     .annotate(n=Count("id")).order_by())
        result = []
        for d in rows:
            found = apps.get(d.pk, {})
            row = {"department": d, "open_roles": d.open_roles, "applicants": found.get("applicants", 0),
                   "shortlisted": found.get("shortlisted", 0), "hired": hired.get(d.pk, 0), "staff": staff.get(d.pk, 0)}
            if any(row[k] for k in ("open_roles", "applicants", "shortlisted", "hired", "staff")):
                result.append(row)
        result.sort(key=lambda r: (-r["applicants"], -r["open_roles"], r["department"].name))
        return result

    def staff_summary(self, search: str = "", limit: int = 10) -> dict:
        staff = self.staff()
        today = timezone.localdate()
        current = staff.filter(status=Employee.Status.ACTIVE)
        horizon = today + timedelta(days=365)
        retiring = current.filter(retirement_date__gte=today, retirement_date__lte=horizon)
        exits = staff.exclude(status=Employee.Status.ACTIVE).filter(day_window("exit_date", self.period.start,
                                                                               self.period.end))
        people = current.select_related("department").order_by("last_name", "first_name")
        if search:
            for word in search.split()[:4]:
                people = people.filter(Q(first_name__icontains=word) | Q(last_name__icontains=word)
                                       | Q(staff_id__icontains=word) | Q(job_title__icontains=word))
        return {"current": current.count(), "retiring": retiring.count(), "exits": exits.count(),
                "joined": current.filter(day_window("date_of_employment", self.period.start, self.period.end)).count(),
                "people": list(people[:limit]), "found": people.count(), "search": search}

    def insights(self) -> list[dict]:
        """A few plain sentences about what stands out, most useful first."""
        out = []
        now, today = self.now, timezone.localdate()
        backlog = self.applications().filter(stage=Stage.APPLIED, status=Application.Status.ACTIVE,
                                             applied_at__lt=now - timedelta(days=14))
        n = backlog.count()
        if n:
            top = (backlog.values("requisition", "requisition__title").annotate(k=Count("id")).order_by("-k").first())
            out.append({"icon": "hourglass", "tone": "amber", "url": reverse("pipeline:applications") + "?stage=applied",
                        "text": format_html("<b>{}</b> applicant{} waited more than two weeks to be screened{}.", f"{n:,}",
                                            "s have" if n != 1 else " has",
                                            format_html(", most for <b>{}</b>", top["requisition__title"])
                                            if top and top["k"] > 1 else "")})
        slow = self.requisitions().filter(status__in=AWAITING_APPROVAL, submitted_at__lt=now - timedelta(days=7)).count()
        if slow:
            out.append({"icon": "clipboard-list", "tone": "amber", "url": reverse("requisitions:list") + "?status=pending",
                        "text": format_html("<b>{}</b> requisition{} waited more than a week for approval.", slow,
                                            "s have" if slow != 1 else " has")})
        week = self.count_applicants(midnight(today - timedelta(days=6)), midnight(today + timedelta(days=1)))
        before = self.count_applicants(midnight(today - timedelta(days=13)), midnight(today - timedelta(days=6)))
        if week or before:
            if before:
                pct = round((week - before) / before * 100)
                how = "the same as" if pct == 0 else f"{abs(pct)}% {'more' if pct > 0 else 'fewer'} than"
                tail = format_html(", {} the week before", how)
            else:
                tail = format_html(", and none the week before")
            out.append({"icon": "trending-up" if week >= before else "trending-down", "tone": "",
                        "text": format_html("<b>{}</b> {} applied in the last 7 days{}.", f"{week:,}",
                                            "person" if week == 1 else "people", tail)})
        regions = {r["value"]: r for r in self.regions()}
        total = sum(r["n"] for r in regions.values())
        local = sum(regions[g]["n"] for g in ("host", "pipeline", "jetty"))
        if total and local:
            parts = ", ".join(f"{regions[g]['label'].split()[0].lower()} {regions[g]['pct']}%"
                              for g in ("host", "pipeline", "jetty") if regions[g]["n"])
            out.append({"icon": "map-pin", "tone": "",
                        "text": format_html("Host, pipeline and jetty communities: <b>{}%</b> of applicants ({}), {}.",
                                            round(local / total * 100), parts, self.period.label.lower())})
        if total and regions["none"]["n"] / total >= 0.3:
            out.append({"icon": "circle-help", "tone": "",
                        "text": format_html("<b>{}%</b> of applicants have no state or community recorded, so "
                                            "their group is unknown.", regions["none"]["pct"])})
        retiring = self.staff().filter(status=Employee.Status.ACTIVE, retirement_date__gte=today,
                                       retirement_date__lte=today + timedelta(days=365))
        n_ret = retiring.count()
        if n_ret:
            uncovered = retiring.filter(replacement_requisitions__isnull=True).count()
            out.append({"icon": "hourglass", "tone": "", "url": reverse("core:employees"),
                        "text": format_html("<b>{}</b> {} in the next 12 months{}.", n_ret,
                                            "staff members retire" if n_ret != 1 else "staff member retires",
                                            format_html("; <b>{}</b> {} no replacement requisition yet", uncovered,
                                                        "have" if uncovered != 1 else "has")
                                            if uncovered else "")})
        soon = self.interviews().filter(status=Interview.Status.SCHEDULED, scheduled_at__gte=now,
                                        scheduled_at__lt=now + timedelta(days=3)).exclude(candidate_response="confirmed")
        n_soon = soon.count()
        if n_soon:
            out.append({"icon": "calendar-clock", "tone": "amber", "url": reverse("pipeline:interviews"),
                        "text": format_html("<b>{}</b> interview{} in the next 3 days {} not been confirmed by the "
                                            "candidate.", n_soon, "s" if n_soon != 1 else "",
                                            "have" if n_soon != 1 else "has")})
        return out[:4]


def _range(field: str, period: Period) -> dict:
    if period.start is None:
        return {}
    return {f"{field}__gte": period.start, f"{field}__lt": period.end}


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
    years = {d.year for d in Candidate.objects.dates("created_at", "year")}
    years |= {d.year for d in Application.objects.dates("applied_at", "year")}
    return [str(y) for y in sorted(years, reverse=True) if 2000 <= y < this][:8]

