"""Display helpers for the My tasks screen. Read-only: they only arrange data the dashboard already loads."""

from __future__ import annotations

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from django.utils.html import format_html

from core.templatetags.portal import naira

TASK_KINDS = {
    "approvals": "Approvals",
    "decisions": "Decisions",
    "scoring": "Scoring",
    "documents": "Documents",
    "onboarding": "Onboarding",
}


def _days_since(moment):
    if not moment:
        return None
    return max(0, (timezone.now() - moment).days)


def age_label(days):
    if days is None:
        return "", ""
    text = "Today" if days == 0 else ("1 day" if days == 1 else f"{days} days")
    tone = "red" if days >= 5 else "amber" if days >= 2 else ""
    return text, tone


def build_tasks(user, *, action_requisitions, pending_evaluations, offer_reviews, decisions_needed, documents_due, onboardings):
    """One list of "Needs you today" rows, most important first. Only the first urgent row gets the red edge."""
    tasks = []

    for offer in offer_reviews:
        a = offer.application
        meta = f"Offered {naira(offer.annual_salary)}"
        if offer.counter_salary:
            meta = f"Asks {naira(offer.counter_salary)} · offered {naira(offer.annual_salary)}"
        tasks.append({"kind": "decisions", "icon": "banknote", "priority": 0, "age": _days_since(offer.responded_at),
                      "title": format_html("<b>{}</b> asked for an offer review", a.candidate.full_name),
                      "meta": meta, "context": offer.job_title, "action": "Review",
                      "url": reverse("pipeline:offer_review", args=[offer.pk])})

    for interview in pending_evaluations:
        a = interview.application
        tasks.append({"kind": "scoring", "icon": "clipboard-pen", "priority": 1, "age": _days_since(interview.scheduled_at),
                      "title": format_html("Score <b>{}</b>", a.candidate.full_name),
                      "meta": f"{interview.get_round_display()}", "context": a.requisition.title, "action": "Score",
                      "url": reverse("pipeline:evaluate", args=[a.pk]) + f"?interview={interview.pk}"})

    for req in action_requisitions:
        if req.status in ("draft", "returned"):
            verb = "Finish" if req.status == "draft" else "Update"
            meta = "Draft, not yet sent to HR" if req.status == "draft" else "Returned to you with comments"
        else:
            verb = "Approve"
            meta = f"Raised by {req.raised_by.display_name}" if req.raised_by else req.get_status_display()
        tasks.append({"kind": "approvals", "icon": "clipboard-check", "priority": 2,
                      "age": _days_since(req.submitted_at or req.updated_at),
                      "title": format_html("{} <b>{}</b>", verb, req.title), "meta": meta,
                      "context": str(req.department or ""), "action": "Open" if verb != "Approve" else "Review",
                      "url": req.get_absolute_url()})

    for a in decisions_needed:
        summary = a.evaluation_summary()
        meta = f"Panel {summary['percentage']}% · {summary['rating']['label']}" if summary else "Panel scores in"
        tasks.append({"kind": "decisions", "icon": "scale", "priority": 2, "age": _days_since(a.stage_changed_at),
                      "title": format_html("Decide on <b>{}</b>", a.candidate.full_name), "meta": meta,
                      "context": a.requisition.title, "action": "Decide", "url": a.get_absolute_url()})

    for a in documents_due:
        tasks.append({"kind": "documents", "icon": "folder-check", "priority": 3, "age": _days_since(a.stage_changed_at),
                      "title": format_html("Verify documents · <b>{}</b>", a.candidate.full_name),
                      "meta": "Certificates and references", "context": a.requisition.title, "action": "Verify",
                      "url": a.get_absolute_url()})

    for ob in onboardings:
        a = ob.application
        joins = f" · joins {ob.start_date:%d %b}" if ob.start_date else ""
        tasks.append({"kind": "onboarding", "icon": "id-card", "priority": 4, "age": _days_since(ob.created_at),
                      "title": format_html("Onboard <b>{}</b>", a.candidate.full_name),
                      "meta": f"{ob.progress}% done{joins}", "context": a.requisition.title, "action": "Open",
                      "url": reverse("pipeline:onboarding", args=[ob.pk])})

    tasks.sort(key=lambda t: (t["priority"], -(t["age"] or 0)))
    urgent_given = False
    for t in tasks:
        t["age_text"], t["age_tone"] = age_label(t["age"])
        is_urgent = t["priority"] == 0 or (t["age"] or 0) >= 5
        t["urgent"] = is_urgent and not urgent_given
        urgent_given = urgent_given or t["urgent"]
    kinds = [(k, label) for k, label in TASK_KINDS.items() if any(t["kind"] == k for t in tasks)]
    return tasks, kinds


def weekly(dates, weeks=8, *, ahead=0):
    """Counts per week for a sparkline, oldest first. ``ahead`` adds future weeks (e.g. booked interviews)."""
    today = timezone.localdate()
    start = today - timedelta(days=today.weekday())
    first = start - timedelta(weeks=weeks - 1 - ahead)
    counts = [0] * weeks
    for moment in dates:
        if not moment:
            continue
        day = timezone.localtime(moment).date() if hasattr(moment, "hour") else moment
        index = (day - first).days // 7
        if 0 <= index < weeks:
            counts[index] += 1
    return counts


PHASES = {"technical": (1, "Technical"), "behavioural": (2, "Behavioural"), "hod": (3, "HOD")}


def week_calendar(interviews):
    """Seven day columns starting today, each with its interviews."""
    today = timezone.localdate()
    days = [{"date": today + timedelta(days=i), "events": []} for i in range(7)]
    by_date = {d["date"]: d for d in days}
    for interview in interviews:
        day = by_date.get(timezone.localtime(interview.scheduled_at).date())
        if day is not None:
            interview.cal_phase = PHASES.get(interview.round, (1, ""))[0]
            interview.cal_round = PHASES.get(interview.round, (1, interview.get_round_display()))[1]
            day["events"].append(interview)
    for d in days:
        d["today"] = d["date"] == today
    return days


def greeting(now=None):
    hour = timezone.localtime(now or timezone.now()).hour
    return "Good morning" if hour < 12 else "Good afternoon" if hour < 17 else "Good evening"


NUMBER_WORDS = ["Nothing", "One thing", "Two things", "Three things", "Four things", "Five things", "Six things",
                "Seven things", "Eight things", "Nine things"]


def summary_line(count):
    if count == 0:
        return "Nothing needs you right now. Everything is moving on its own."
    lead = NUMBER_WORDS[count] if count < len(NUMBER_WORDS) else f"{count} things"
    return f"{lead} need{'s' if count == 1 else ''} you today. Everything else is moving on its own."
