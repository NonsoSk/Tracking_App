"""Display helpers for the candidate profile. They only decide what to show; actions post to the existing views."""

from __future__ import annotations

from django.urls import reverse


def next_action(app, user, *, can_manage, can_decide, active_offer, my_interviews, medicals, onboarding):
    """The one next step pinned top-right as the primary button (or None when nothing is due from this user)."""
    if not app.is_open:
        return None
    stage = app.stage
    if stage == "applied" and can_manage:
        return {"label": "Shortlist", "icon": "star", "post": reverse("pipeline:shortlist", args=[app.pk])}
    if stage in ("shortlisted", "interview"):
        if can_manage:
            label = "Schedule next phase" if app.interviews.exclude(status="cancelled").exists() else "Schedule interview"
            return {"label": label, "icon": "calendar-plus", "href": reverse("pipeline:schedule_interview", args=[app.pk])}
        for interview in my_interviews:
            if interview.status != "cancelled":
                return {"label": f"Score {interview.round_short}", "icon": "clipboard-pen",
                        "href": reverse("pipeline:evaluate", args=[app.pk]) + f"?interview={interview.pk}"}
    if stage == "decision" and can_decide:
        return {"label": "Record decision", "icon": "scale", "href": "#decide", "tab": "overview"}
    if stage == "documents" and can_manage:
        return {"label": "Review documents", "icon": "folder-check", "href": "#documents", "tab": "cv"}
    if stage == "offer":
        if active_offer and active_offer.status == "review_requested" and (user.is_management or user.is_hr):
            return {"label": "Respond to offer review", "icon": "banknote", "href": reverse("pipeline:offer_review", args=[active_offer.pk])}
        if active_offer and active_offer.status == "draft" and can_manage:
            return {"label": "Send offer", "icon": "send", "post": reverse("pipeline:send_offer", args=[active_offer.pk])}
        if not active_offer and can_manage:
            return {"label": "Prepare offer", "icon": "file-text", "href": "#prepare-offer", "tab": "overview"}
    if stage == "medical" and can_manage:
        latest = medicals[0] if medicals else None
        label = "Record medical result" if latest and latest.result == "scheduled" else "Schedule medicals"
        return {"label": label, "icon": "stethoscope", "href": "#next-step", "tab": "overview"}
    if stage == "onboarding" and onboarding and user.is_onboarding:
        return {"label": "Open onboarding", "icon": "id-card", "href": reverse("pipeline:onboarding", args=[onboarding.pk])}
    return None


def cv_fields(c):
    """Fields read from the CV, in reading order. Empty ones are flagged so HR can add them."""
    qualification = c.qualification_short if c.highest_qualification else ""
    if qualification and c.degree_class_short:
        qualification = f"{qualification} · {c.degree_class_short}"
    role = " at ".join(x for x in (c.current_job_title, c.current_employer) if x)
    rows = [
        ("email", "Email", c.email),
        ("phone", "Phone", c.phone),
        ("location", "Location", c.location),
        ("qualification", "Qualification", qualification),
        ("course", "Course", c.course),
        ("institution", "Institution", f"{c.institution} ({c.graduation_year})" if c.institution and c.graduation_year else c.institution),
        ("nysc", "NYSC", c.get_nysc_status_display() if c.nysc_status else ""),
        ("experience", "Experience", f"{float(c.years_experience):g} years" if c.years_experience else ""),
        ("role", "Current role", role),
        ("dob", "Date of birth", c.date_of_birth.strftime("%d %b %Y") if c.date_of_birth else ""),
    ]
    return [{"key": k, "label": label, "value": value, "missing": not value} for k, label, value in rows]


def cv_terms(c):
    """Values to light up in the CV text, keyed like the fields above."""
    return {
        "email": c.email, "phone": c.phone, "location": c.location, "course": c.course, "institution": c.institution,
        "role": [c.current_job_title, c.current_employer],
        "skills": list(c.skills or []) + list(c.tools or []) + list(c.certifications or []),
    }


def term_groups(c, breakdown):
    """Skills, tools and certifications: what matched the role, what is missing, and what else the person has."""
    components = (breakdown or {}).get("components", {})
    groups = []
    for key, title, values in (("skills", "Skills", c.skills), ("tools", "Tools and software", c.tools),
                               ("certifications", "Certifications", c.certifications)):
        comp = components.get(key, {})
        matched = [m.get("term", "") for m in comp.get("matched", [])]
        seen = {m.lower() for m in matched}
        items = [{"term": t, "state": "met"} for t in matched]
        items += [{"term": t, "state": "missing"} for t in comp.get("missing", [])]
        items += [{"term": t, "state": "extra"} for t in (values or []) if t and t.lower() not in seen]
        items += [{"term": t, "state": "nice"} for t in comp.get("missing_preferred", [])]
        if items:
            groups.append({"title": title, "items": items})
    return groups


PANEL_STAGES = {"decision", "documents", "offer", "medical", "onboarding", "hired"}


def decorate_cards(applications):
    """Per-card display data for the pipeline: days in stage, two key skills and the panel score where one exists."""
    from django.utils import timezone

    now = timezone.now()
    for a in applications:
        days = max(0, (now - a.stage_changed_at).days) if a.stage_changed_at else 0
        a.days_in_stage = days
        a.days_tone = "red" if days >= 10 else "amber" if days >= 5 else ""
        terms = []
        for key in ("skills", "tools", "certifications"):
            for m in ((a.match_breakdown or {}).get("components", {}).get(key, {}).get("matched", [])):
                if m.get("term") and len(terms) < 2:
                    terms.append(m["term"])
        a.key_tags = terms
        summary = a.evaluation_summary() if a.stage in PANEL_STAGES else None
        a.panel = summary
    return applications


def board_columns(applications, stage_choices, *, show_hired=False):
    """Stage columns in pipeline order, each with its cards (best match first)."""
    columns = []
    for value, label in stage_choices:
        if value == "hired" and not show_hired:
            continue
        cards = sorted((a for a in applications if a.stage == value), key=lambda a: -(a.match_score or 0))
        columns.append({"stage": value, "label": label, "cards": cards})
    return columns
