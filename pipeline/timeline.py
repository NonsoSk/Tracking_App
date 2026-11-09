"""Each application's hiring timeline: when the person applied, sat a CBT, was shortlisted, first interviewed,
selected, given an offer, onboarded and started work, with the days between, and from applying to a chosen step.

Every date is a real one, never the day records were loaded:
- for applications loaded from Excel: the application date (the moment in the website resume link, or an
  application-date column), the CBT results' Date, the interview records' Date (and those marked Selected), and
  their Join Date;
- for steps taken in the portal: when the application was made, the stage moves in its activity log, the
  interviews booked, the decision, the accepted offer, onboarding and the start date.
A step with no date is shown as not dated, and is left out of the day counts.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime

from django.utils import timezone

from candidates.dates import application_dates

from .models import Application, Interview, InterviewRecord, Offer, Stage

STEPS = [
    ("applied", "Applied"), ("cbt", "CBT"), ("shortlisted", "Shortlisted"), ("interview", "First interview"),
    ("selected", "Selected"), ("offer", "Offer accepted"), ("onboarding", "Onboarding"), ("started", "Started work"),
]
# Applied to …: the steps HR can measure to.
ENDPOINTS = [("interview", "First interview"), ("selected", "Selected"), ("onboarding", "Onboarding"),
             ("started", "Started work")]
DEFAULT_ENDPOINT = "started"
MOVED = re.compile(r"^Moved from .+? to (?P<stage>.+?)\.(?:\s|$)")
STAGE_BY_LABEL = {s.label: s.value for s in Stage}


def day_of(moment) -> date | None:
    if moment is None:
        return None
    if isinstance(moment, datetime):
        return timezone.localtime(moment).date() if timezone.is_aware(moment) else moment.date()
    return moment


@dataclass
class Step:
    key: str
    label: str
    day: date | None = None
    source: str = ""
    note: str = ""
    gap: int | None = None  # days since the previous dated step
    late: bool = False  # its date is out of order with the other steps (left out of the gaps)


@dataclass
class Timeline:
    application: Application
    steps: list[Step] = field(default_factory=list)

    def day(self, key: str) -> date | None:
        return next((s.day for s in self.steps if s.key == key), None)

    def days_to(self, endpoint: str) -> int | None:
        start, end = self.day("applied"), self.day(endpoint)
        return (end - start).days if start and end and end >= start else None

    @property
    def dated(self) -> list[Step]:
        return [s for s in self.steps if s.day]

    def measure(self, endpoint: str) -> dict:
        """Days from applying to ``endpoint``, the steps in between, and why there is no figure when there is none."""
        keys = [k for k, _ in STEPS]
        end = next(s for s in self.steps if s.key == endpoint)
        days = self.days_to(endpoint)
        reason = ""
        if days is None:
            if not self.day("applied"):
                reason = next(s.note for s in self.steps if s.key == "applied") or "No application date"
            else:
                reason = end.note or "No date recorded"
        return {"days": days, "span": keys[: keys.index(endpoint) + 1], "label": end.label, "reason": reason}


def stage_entries(application) -> dict:
    """{stage: the day the application first moved into it}, from the activity log (portal moves only)."""
    entered = {}
    for message, created in (application.activities.filter(verb="stage").order_by("created_at")
                             .values_list("message", "created_at")):
        found = MOVED.match(message or "")
        stage = STAGE_BY_LABEL.get(found.group("stage")) if found else None
        if stage and stage not in entered:
            entered[stage] = day_of(created)
    return entered


def build(application, *, cbt_days=None, apply_days=None) -> Timeline:
    """The application's steps in order, each with its date and where the date comes from."""
    candidate = application.candidate
    from_excel = application.source == "import"
    records = list(InterviewRecord.objects.filter(application=application).order_by("interview_date"))
    interview_days = sorted(r.interview_date for r in records if r.interview_date)
    interview_days += sorted(day_of(i.scheduled_at) for i in application.interviews.exclude(
        status=Interview.Status.CANCELLED).order_by("scheduled_at"))
    entered = stage_entries(application)
    steps = {key: Step(key, label) for key, label in STEPS}

    # First interview, selected and started: interview records (Excel) or the portal.
    if interview_days:
        steps["interview"].day = min(interview_days)
        steps["interview"].source = "Excel: interview records, Date" if records and min(interview_days) in {
            r.interview_date for r in records} else "Portal: interview booked"
    elif Stage.INTERVIEW in entered:
        steps["interview"].day, steps["interview"].source = entered[Stage.INTERVIEW], "Portal: moved to Interviews"
    selected = [r.interview_date for r in records if r.result == InterviewRecord.Result.SELECTED and r.interview_date]
    if selected:
        steps["selected"].day, steps["selected"].source = min(selected), "Excel: interview records, Remarks_Query Selected"
    elif application.decision == Application.Decision.SELECT and application.decided_at and not from_excel:
        steps["selected"].day, steps["selected"].source = day_of(application.decided_at), "Portal: decision recorded"
    joined = [r.join_date for r in records if r.join_date]
    onboarding = getattr(application, "onboarding", None)
    if joined:
        steps["started"].day, steps["started"].source = max(joined), "Excel: interview records, Join Date"
    elif onboarding and onboarding.start_date and onboarding.status == onboarding.Status.COMPLETED:
        steps["started"].day, steps["started"].source = onboarding.start_date, "Portal: date of joining"
    elif application.status == Application.Status.HIRED and application.hired_at and not from_excel:
        steps["started"].day, steps["started"].source = day_of(application.hired_at), "Portal: marked as hired"
    if Stage.SHORTLISTED in entered:
        steps["shortlisted"].day, steps["shortlisted"].source = entered[Stage.SHORTLISTED], "Portal: shortlisted"
    if Stage.ONBOARDING in entered:
        steps["onboarding"].day, steps["onboarding"].source = entered[Stage.ONBOARDING], "Portal: moved to Onboarding"
    elif onboarding and not from_excel:
        steps["onboarding"].day, steps["onboarding"].source = day_of(onboarding.created_at), "Portal: onboarding started"
    elif onboarding:  # made by the Excel load: Excel says "In progress" but gives no date
        steps["onboarding"].note = "In progress (no date in Excel)"
    accepted = (application.offers.filter(status=Offer.Status.ACCEPTED).exclude(responded_at=None)
                .order_by("responded_at").values_list("responded_at", flat=True).first())
    if accepted:
        steps["offer"].day, steps["offer"].source = day_of(accepted), "Portal: offer accepted"

    # Applied: the portal's own record, or the person's application date in Excel before the first later step.
    later = [s.day for k, s in steps.items() if k not in {"applied", "cbt"} and s.day]
    if not from_excel:
        steps["applied"].day, steps["applied"].source = day_of(application.applied_at), "Portal: application made"
    else:
        days = apply_days if apply_days is not None else application_dates(candidate.source_records)
        limit = min(later) if later else None
        usable = [d for d in days if not limit or d <= limit]
        if usable:
            steps["applied"].day = max(usable) if limit else min(usable)
            steps["applied"].source = "Excel: date applied (website resume link or application date)"
        else:
            steps["applied"].note = "No application date in Excel"
    # CBT: the last one sat between applying and the first interview.
    cbt = cbt_days if cbt_days is not None else sorted(
        d for d in candidate.cbt_results.values_list("test_date", flat=True) if d)
    start, limit = steps["applied"].day, steps["interview"].day or (min(later) if later else None)
    usable = [d for d in cbt if (not start or d >= start) and (not limit or d <= limit)]
    if usable and (start or limit):
        steps["cbt"].day, steps["cbt"].source = max(usable), "Excel: CBT results, Date"

    ordered = [steps[key] for key, _ in STEPS]
    dated = [s for s in ordered if s.day]
    keep = in_order(dated)
    for step in dated:
        step.late = step not in keep
    previous = None
    for step in ordered:
        if step.day and not step.late:
            if previous:
                step.gap = (step.day - previous).days
            previous = step.day
        elif not step.note:
            step.note = "Not reached" if _not_reached(application, step.key) else "No date recorded"
    return Timeline(application, ordered)


def in_order(dated: list[Step]) -> list[Step]:
    """The longest run of steps whose dates go forward (or stay the same) in the order of the process. The steps
    left out have a date that does not fit: probably recorded late or typed wrongly."""
    best = [[s] for s in dated]
    for i, step in enumerate(dated):
        for j in range(i):
            if dated[j].day <= step.day and len(best[j]) + 1 > len(best[i]):
                best[i] = best[j] + [step]
    return max(best, key=len) if best else []


def _not_reached(application, key: str) -> bool:
    """Whether the application has simply not got to this step (as opposed to reaching it without a date)."""
    order = [s.value for s in Stage]
    reached = order.index(application.stage) if application.stage in order else 0
    needs = {"shortlisted": Stage.SHORTLISTED, "interview": Stage.INTERVIEW, "selected": Stage.DOCUMENTS,
             "offer": Stage.OFFER, "onboarding": Stage.ONBOARDING, "started": Stage.HIRED}.get(key)
    if key == "selected" and application.decision == Application.Decision.SELECT:
        return False
    if not needs:
        return False
    return reached < order.index(needs) and application.status != Application.Status.HIRED


def for_candidate(candidate) -> list[Timeline]:
    apps = (candidate.applications.select_related("requisition", "requisition__department", "onboarding")
            .prefetch_related("interviews", "offers").order_by("-applied_at"))
    cbt_days = sorted(d for d in candidate.cbt_results.values_list("test_date", flat=True) if d)
    apply_days = application_dates(candidate.source_records)
    return [build(app, cbt_days=cbt_days, apply_days=apply_days) for app in apps]
