"""
The hiring workflow. Every state change goes through a function here so the
timeline, notifications and emails are always consistent, whichever screen
(or the candidate portal) triggered it.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.urls import reverse
from django.utils import timezone

from candidates.models import CandidateDocument
from core.models import Employee
from core.notify import hr_team, management_team, notify, notify_department, onboarding_team, send_email

from .ics import interview_ics
from .matching import score_application
from .models import (
    DEFAULT_ONBOARDING_TASKS,
    Activity,
    Application,
    DocumentRequirement,
    Interview,
    MedicalCheck,
    Offer,
    Onboarding,
    OnboardingTask,
    Stage,
)


class WorkflowError(Exception):
    """Raised when an action is not allowed in the application's current state."""


def log(message: str, *, verb: str = "update", application=None, requisition=None, candidate=None, actor=None):
    if application is not None:
        requisition = requisition or application.requisition
        candidate = candidate or application.candidate
    return Activity.objects.create(
        application=application, requisition=requisition, candidate=candidate,
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        verb=verb, message=message[:500],
    )


def _app_url(application) -> str:
    return reverse("pipeline:application", args=[application.pk])


def _candidate_email(application, subject: str, body: str, *, attachments=None, action_label="Open my application"):
    candidate = application.candidate
    greeting = f"Dear {candidate.first_name or candidate.full_name},\n\n"
    return send_email(
        [candidate.email], subject, greeting + body, attachments=attachments,
        action_url=application.get_portal_url(), action_label=action_label,
    )


def _require_open(application):
    if application.status in {Application.Status.REJECTED, Application.Status.WITHDRAWN, Application.Status.HIRED}:
        raise WorkflowError(f"This application is {application.get_status_display().lower()}.")


# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------
def create_application(candidate, requisition, *, source: str = "", actor=None, notify_team: bool = True):
    application, created = Application.objects.get_or_create(
        candidate=candidate, requisition=requisition, defaults={"source": source or candidate.source},
    )
    score_application(application)
    if created:
        log(f"{candidate.full_name} applied for {requisition.title} "
            f"(match {application.match_score}% · grade {application.match_grade}).",
            verb="applied", application=application, actor=actor)
        if notify_team:
            recipients = [requisition.hr_owner] if requisition.hr_owner else hr_team()
            notify(recipients, f"New application: {candidate.full_name} → {requisition.title}",
                   f"Match score {application.match_score}% (grade {application.match_grade}).",
                   url=_app_url(application), email=False)
    return application, created


def move_to_stage(application, stage: str, *, actor=None, note: str = "", quiet: bool = False):
    _require_open(application)
    if stage not in application.pipeline_stages():
        raise WorkflowError(f"'{Stage(stage).label}' is not part of this hiring track.")
    if stage == application.stage:
        return application
    old = application.get_stage_display()
    application.stage = stage
    application.stage_changed_at = timezone.now()
    if stage == Stage.HIRED:
        application.status = Application.Status.HIRED
        application.hired_at = timezone.now()
    application.save()
    log(f"Moved from {old} to {application.get_stage_display()}." + (f" {note}" if note else ""),
        verb="stage", application=application, actor=actor)
    if not quiet and stage in {Stage.SHORTLISTED, Stage.DECISION, Stage.OFFER, Stage.ONBOARDING, Stage.HIRED}:
        notify_department(
            application.requisition.department,
            f"{application.candidate.full_name}: {application.get_stage_display()} ({application.requisition.title})",
            note or f"The candidate moved to '{application.get_stage_display()}'.",
            url=_app_url(application), email=False,
        )
    return application


def shortlist(application, *, actor=None):
    if application.stage != Stage.APPLIED:
        raise WorkflowError("Only new applications can be shortlisted.")
    return move_to_stage(application, Stage.SHORTLISTED, actor=actor)


def auto_shortlist(requisition, *, actor=None, threshold: float | None = None, top_n: int | None = None) -> list:
    threshold = settings.RECRUITMENT["AUTO_SHORTLIST_THRESHOLD"] if threshold is None else threshold
    qs = requisition.applications.filter(stage=Stage.APPLIED, status=Application.Status.ACTIVE,
                                         match_score__gte=threshold).order_by("-match_score")
    if top_n:
        qs = qs[:top_n]
    picked = []
    for application in qs:
        move_to_stage(application, Stage.SHORTLISTED, actor=actor, quiet=True)
        picked.append(application)
    if picked:
        log(f"Auto-shortlisted {len(picked)} candidate(s) scoring {threshold}%+.", verb="shortlist",
            requisition=requisition, actor=actor)
        notify_department(requisition.department, f"{len(picked)} candidate(s) shortlisted for {requisition.title}",
                          "Open the requisition to review the shortlist.", url=requisition.get_absolute_url())
    return picked


def set_status(application, status: str, *, actor=None, reason: str = "", email_candidate: bool = False):
    previous = application.get_status_display()
    application.status = status
    application.status_reason = reason
    application.save()
    log(f"Status changed from {previous} to {application.get_status_display()}." + (f" Reason: {reason}" if reason else ""),
        verb="status", application=application, actor=actor)
    if email_candidate and status == Application.Status.REJECTED:
        _candidate_email(
            application, f"Your application for {application.requisition.title}",
            f"Thank you for your interest in the {application.requisition.title} role at {settings.COMPANY_NAME}. "
            "After careful consideration we will not be moving forward with your application at this time. "
            "We will keep your profile on file for future opportunities.\n\nKind regards,\nHR & A Department",
        )
    return application


# ---------------------------------------------------------------------------
# Interviews
# ---------------------------------------------------------------------------
def _meeting_room() -> str:
    base = settings.RECRUITMENT["MEETING_ROOM_BASE_URL"].rstrip("/")
    return f"{base}/{settings.COMPANY_SHORT_NAME}-Interview-{uuid.uuid4().hex[:10]}"


def send_interview_invites(interview, *, cancel: bool = False, actor=None):
    app = interview.application
    ics = interview_ics(interview, cancel=cancel)
    attachment = [("interview.ics", ics, f"text/calendar; method={'CANCEL' if cancel else 'REQUEST'}")]
    when = timezone.localtime(interview.scheduled_at).strftime("%A %d %B %Y at %I:%M %p")
    if cancel:
        body = (f"Your {interview.get_round_display()} for the {app.requisition.title} role scheduled for {when} "
                "has been cancelled. We will contact you with a new date.")
        _candidate_email(app, f"Interview cancelled — {app.requisition.title}", body, attachments=attachment)
        notify(interview.panel.all(), f"Interview cancelled: {app.candidate.full_name}", body,
               url=_app_url(app), attachments=attachment)
        return
    where = interview.where
    body = (
        f"You are invited to the {interview.get_round_display()} for the {app.requisition.title} role "
        f"({app.requisition.department}).\n\nDate & time: {when}\nDuration: {interview.duration_minutes} minutes\n"
        f"Format: {interview.get_mode_display()}\nWhere: {where}\n"
        + (f"\n{interview.instructions}\n" if interview.instructions else "")
        + "\nPlease confirm your attendance using the button below. The attached calendar invite adds the "
          "interview to your calendar.\n\nKind regards,\nHR & A Department"
    )
    _candidate_email(app, f"Interview invitation — {app.requisition.title}", body, attachments=attachment,
                     action_label="Confirm attendance")
    notify(
        interview.panel.all(),
        f"Interview panel: {app.candidate.full_name} — {when}",
        f"{interview.get_round_display()} for {app.requisition.title}. {interview.get_mode_display()}: {where}. "
        "Your evaluation form will be available in the portal.",
        url=_app_url(app), attachments=attachment,
    )
    interview.invite_sent_at = timezone.now()
    interview.save(update_fields=["invite_sent_at"])


@transaction.atomic
def schedule_interview(application, *, round, scheduled_at, duration_minutes=45, mode=Interview.Mode.IN_PERSON,
                       location="", meeting_link="", panel=(), instructions="", actor=None, send=True):
    _require_open(application)
    if Stage(application.stage) not in {Stage.SHORTLISTED, Stage.INTERVIEW, Stage.APPLIED}:
        raise WorkflowError("Interviews can be scheduled for shortlisted candidates.")
    if mode == Interview.Mode.VIDEO and not meeting_link:
        meeting_link = _meeting_room()
    interview = Interview.objects.create(
        application=application, round=round, scheduled_at=scheduled_at, duration_minutes=duration_minutes,
        mode=mode, location=location, meeting_link=meeting_link, instructions=instructions, organizer=actor,
    )
    interview.panel.set(panel)
    if application.stage != Stage.INTERVIEW:
        move_to_stage(application, Stage.INTERVIEW, actor=actor, quiet=True)
    log(f"Scheduled {interview.get_round_display()} for "
        f"{timezone.localtime(scheduled_at):%d %b %Y %H:%M}.", verb="interview", application=application, actor=actor)
    if send:
        send_interview_invites(interview, actor=actor)
    return interview


def reschedule_interview(interview, *, scheduled_at, actor=None, **changes):
    interview.scheduled_at = scheduled_at
    for key, value in changes.items():
        if key == "panel":
            interview.panel.set(value)
        else:
            setattr(interview, key, value)
    if interview.mode == Interview.Mode.VIDEO and not interview.meeting_link:
        interview.meeting_link = _meeting_room()
    interview.sequence += 1
    interview.status = Interview.Status.SCHEDULED
    interview.candidate_response = ""
    interview.save()
    log(f"Rescheduled {interview.get_round_display()} to {timezone.localtime(scheduled_at):%d %b %Y %H:%M}.",
        verb="interview", application=interview.application, actor=actor)
    send_interview_invites(interview, actor=actor)
    return interview


def cancel_interview(interview, *, actor=None):
    interview.status = Interview.Status.CANCELLED
    interview.sequence += 1
    interview.save()
    log(f"Cancelled {interview.get_round_display()}.", verb="interview", application=interview.application, actor=actor)
    send_interview_invites(interview, cancel=True, actor=actor)


def complete_interview(interview, *, status=Interview.Status.COMPLETED, actor=None):
    interview.status = status
    interview.save(update_fields=["status"])
    app = interview.application
    log(f"{interview.get_round_display()} marked {interview.get_status_display().lower()}.",
        verb="interview", application=app, actor=actor)
    if status == Interview.Status.COMPLETED:
        # Remind panel members who have not filled the selection report.
        missing = [u for u in interview.panel.all()
                   if not app.evaluations.filter(evaluator=u, submitted_at__isnull=False).exists()]
        notify(missing, f"Please score {app.candidate.full_name}",
               f"Complete the selection report for the {interview.get_round_display()}.",
               url=reverse("pipeline:evaluate", args=[app.pk]) + f"?interview={interview.pk}", level="warning")
        completed_rounds = set(app.interviews.filter(status=Interview.Status.COMPLETED).values_list("round", flat=True))
        if Interview.Round.HOD in completed_rounds and app.stage == Stage.INTERVIEW:
            move_to_stage(app, Stage.DECISION, actor=actor,
                          note="All interview phases are complete — ready for a decision.")
            notify(hr_team(), f"Decision needed: {app.candidate.full_name}",
                   f"Interviews for {app.requisition.title} are complete.", url=_app_url(app), email=False)


def candidate_interview_response(interview, response: str, note: str = ""):
    interview.candidate_response = response
    interview.candidate_note = note[:500]
    interview.save(update_fields=["candidate_response", "candidate_note"])
    app = interview.application
    label = "confirmed attendance" if response == "confirmed" else "asked to reschedule"
    log(f"Candidate {label} for {interview.get_round_display()}." + (f" Note: {note}" if note else ""),
        verb="candidate", application=app)
    recipients = [interview.organizer] if interview.organizer else hr_team()
    notify(recipients, f"{app.candidate.full_name} {label}", note or interview.get_round_display(),
           url=_app_url(app), level="success" if response == "confirmed" else "warning", email=response != "confirmed")


# ---------------------------------------------------------------------------
# Evaluation & decision
# ---------------------------------------------------------------------------
def evaluation_submitted(evaluation, *, actor=None):
    app = evaluation.application
    log(f"{evaluation.evaluator.display_name} submitted a selection report: {evaluation.total} / "
        f"{evaluation.max_total} ({evaluation.get_recommendation_display()}).",
        verb="evaluation", application=app, actor=actor)
    recipients = [app.requisition.hr_owner] if app.requisition.hr_owner else hr_team()
    notify(recipients, f"Selection report submitted for {app.candidate.full_name}",
           f"{evaluation.evaluator.display_name}: {evaluation.total}/{evaluation.max_total} — "
           f"{evaluation.get_recommendation_display()}", url=_app_url(app), email=False)


def required_documents(application) -> list[DocumentRequirement]:
    return list(DocumentRequirement.objects.filter(applies_to__in=["", application.requisition.employment_type]))


def document_checklist(application) -> dict:
    docs = list(application.candidate.documents.all())
    rows = []
    for requirement in required_documents(application):
        matching = [d for d in docs if d.doc_type == requirement.doc_type]
        latest = max(matching, key=lambda d: d.uploaded_at) if matching else None
        rows.append({"requirement": requirement, "document": latest})
    mandatory = [r for r in rows if r["requirement"].is_mandatory]
    return {
        "rows": rows,
        "ready": all(r["document"] and r["document"].status == CandidateDocument.Status.VERIFIED for r in mandatory),
        "outstanding": [r["requirement"] for r in mandatory if not r["document"]],
        "pending_review": [r for r in rows if r["document"] and r["document"].status == CandidateDocument.Status.PENDING],
    }


def request_documents(application, *, actor=None):
    checklist = document_checklist(application)
    missing = checklist["outstanding"] or [r["requirement"] for r in checklist["rows"]]
    items = "\n".join(f"• {r.get_doc_type_display()}" + (f" — {r.note}" if r.note else "") for r in missing)
    _candidate_email(
        application, f"Documents required — {application.requisition.title}",
        f"Congratulations! You have been selected to proceed for the {application.requisition.title} role. "
        f"Please upload clear copies of the following documents through your application page:\n\n{items}\n\n"
        "Kind regards,\nHR & A Department",
        action_label="Upload documents",
    )
    log("Requested documents from the candidate.", verb="documents", application=application, actor=actor)


@transaction.atomic
def record_decision(application, decision: str, *, notes: str = "", actor=None, email_candidate: bool = True):
    _require_open(application)
    application.decision = decision
    application.decision_notes = notes
    application.decided_by = actor
    application.decided_at = timezone.now()
    application.save()
    summary = application.evaluation_summary()
    score = f" Panel score {summary['total']}/{summary['max_total']} ({summary['percentage']}%)." if summary else ""
    log(f"Decision: {application.get_decision_display()}.{score}" + (f" {notes}" if notes else ""),
        verb="decision", application=application, actor=actor)
    if decision == Application.Decision.SELECT:
        if application.status == Application.Status.ON_HOLD:
            application.status = Application.Status.ACTIVE
            application.save(update_fields=["status"])
        move_to_stage(application, Stage.DOCUMENTS, actor=actor, quiet=True)
        notify_department(application.requisition.department,
                          f"{application.candidate.full_name} selected for {application.requisition.title}",
                          "The candidate has moved to document review.", url=_app_url(application))
        if email_candidate:
            request_documents(application, actor=actor)
    elif decision == Application.Decision.ON_HOLD:
        set_status(application, Application.Status.ON_HOLD, actor=actor, reason=notes or "Placed on hold after interview")
    else:
        set_status(application, Application.Status.REJECTED, actor=actor, reason=notes or "Not selected after interview",
                   email_candidate=email_candidate)
    return application


def review_document(document, status: str, *, note: str = "", actor=None):
    document.status = status
    document.review_note = note
    document.reviewed_by = actor
    document.reviewed_at = timezone.now()
    document.save()
    log(f"{document.get_doc_type_display()} marked {document.get_status_display().lower()}." + (f" {note}" if note else ""),
        verb="documents", application=document.application, candidate=document.candidate, actor=actor)


def clear_documents(application, *, actor=None, force: bool = False):
    if application.stage != Stage.DOCUMENTS:
        raise WorkflowError("The application is not in document review.")
    if not force and not document_checklist(application)["ready"]:
        raise WorkflowError("Some mandatory documents are missing or not yet verified.")
    nxt = application.next_stage()
    if nxt == Stage.ONBOARDING:
        return start_onboarding(application, actor=actor)
    if nxt == Stage.MEDICAL:
        return move_to_stage(application, Stage.MEDICAL, actor=actor, note="Documents verified.")
    return move_to_stage(application, Stage.OFFER, actor=actor, note="Documents verified — ready for an offer.")


# ---------------------------------------------------------------------------
# Offers
# ---------------------------------------------------------------------------
def create_offer(application, *, job_title, annual_salary, grade="", benefits="", start_date=None,
                 negotiation_notes="", letter=None, actor=None) -> Offer:
    _require_open(application)
    if application.stage != Stage.OFFER:
        raise WorkflowError("Offers are prepared in the Offer stage.")
    latest = application.offers.first()
    offer = Offer.objects.create(
        application=application, version=(latest.version + 1) if latest else 1, job_title=job_title,
        grade=grade, annual_salary=annual_salary, benefits=benefits, start_date=start_date,
        negotiation_notes=negotiation_notes, created_by=actor,
        **({"letter": letter} if letter else {}),
    )
    log(f"Prepared offer v{offer.version}: ₦{offer.annual_salary:,.0f} per annum.", verb="offer",
        application=application, actor=actor)
    return offer


def send_offer(offer, *, actor=None):
    if offer.status not in {Offer.Status.DRAFT, Offer.Status.REVIEW_REQUESTED}:
        raise WorkflowError("Only draft offers can be sent.")
    app = offer.application
    app.offers.exclude(pk=offer.pk).filter(
        status__in=[Offer.Status.DRAFT, Offer.Status.SENT, Offer.Status.REVIEW_REQUESTED]
    ).update(status=Offer.Status.SUPERSEDED)
    offer.status = Offer.Status.SENT
    offer.sent_at = timezone.now()
    offer.expires_on = offer.expires_on or (timezone.localdate() + timedelta(days=settings.RECRUITMENT["OFFER_VALIDITY_DAYS"]))
    offer.save()
    _candidate_email(
        app, f"Offer of employment — {offer.job_title}",
        f"We are pleased to offer you the position of {offer.job_title} at {settings.COMPANY_NAME}.\n\n"
        f"Annual gross salary: ₦{offer.annual_salary:,.2f}\n"
        + (f"Proposed date of joining: {offer.start_date:%d %B %Y}\n" if offer.start_date else "")
        + (f"Benefits: {offer.benefits}\n" if offer.benefits else "")
        + f"\nPlease review and respond (accept, decline or request a review) by {offer.expires_on:%d %B %Y} "
          "using the button below.\n\nKind regards,\nHR & A Department",
        action_label="Review my offer",
    )
    log(f"Sent offer v{offer.version} to the candidate.", verb="offer", application=app, actor=actor)
    return offer


@transaction.atomic
def candidate_offer_response(offer, response: str, *, comment: str = "", counter_salary=None):
    if offer.status != Offer.Status.SENT:
        raise WorkflowError("This offer is no longer awaiting a response.")
    app = offer.application
    offer.candidate_comment = comment
    offer.responded_at = timezone.now()
    offer.counter_salary = counter_salary
    if response == "accept":
        offer.status = Offer.Status.ACCEPTED
        offer.save()
        log(f"Candidate accepted offer v{offer.version}.", verb="offer", application=app)
        nxt = app.next_stage()
        move_to_stage(app, nxt, note="Offer accepted.")
        notify(hr_team(), f"Offer accepted: {app.candidate.full_name}",
               f"{offer.job_title} — next step: {Stage(nxt).label}.", url=_app_url(app), level="success")
    elif response == "review":
        offer.status = Offer.Status.REVIEW_REQUESTED
        offer.save()
        extra = f" Counter proposal: ₦{Decimal(counter_salary):,.0f}." if counter_salary else ""
        log(f"Candidate requested a review of offer v{offer.version}.{extra} {comment}", verb="offer", application=app)
        notify(management_team() + hr_team(), f"Offer review requested: {app.candidate.full_name}",
               f"{offer.job_title} — current offer ₦{offer.annual_salary:,.0f}.{extra} Comment: {comment or '—'}",
               url=reverse("pipeline:offer_review", args=[offer.pk]), level="warning")
    else:
        offer.status = Offer.Status.DECLINED
        offer.save()
        log(f"Candidate declined offer v{offer.version}. {comment}", verb="offer", application=app)
        notify(hr_team(), f"Offer declined: {app.candidate.full_name}",
               f"{offer.job_title}. Reason: {comment or '—'}. Review the next best candidates for this requisition.",
               url=_app_url(app), level="danger")
    return offer


@transaction.atomic
def management_offer_decision(offer, decision: str, *, comment: str = "", actor=None, new_salary=None,
                              new_benefits=None):
    if offer.status != Offer.Status.REVIEW_REQUESTED:
        raise WorkflowError("This offer is not awaiting a management review.")
    app = offer.application
    offer.management_decision = decision
    offer.management_comment = comment
    offer.management_by = actor
    offer.management_at = timezone.now()
    offer.save()
    log(f"Management decision on offer review: {offer.get_management_decision_display()}. {comment}",
        verb="offer", application=app, actor=actor)
    if decision == Offer.ManagementDecision.REVISE:
        if not new_salary:
            raise WorkflowError("Enter the revised salary.")
        revised = create_offer(
            app, job_title=offer.job_title, annual_salary=new_salary, grade=offer.grade,
            benefits=new_benefits if new_benefits is not None else offer.benefits, start_date=offer.start_date,
            negotiation_notes=f"Revised after review (was ₦{offer.annual_salary:,.0f}). {comment}".strip(), actor=actor,
        )
        offer.status = Offer.Status.SUPERSEDED
        offer.save(update_fields=["status"])
        send_offer(revised, actor=actor)
        return revised
    if decision == Offer.ManagementDecision.MAINTAIN:
        offer.status = Offer.Status.SENT
        offer.save(update_fields=["status"])
        _candidate_email(
            app, f"Update on your offer — {offer.job_title}",
            "We have reviewed your request. Management has decided to maintain the current offer terms. "
            "Please let us know whether you accept or decline the offer using the button below."
            + (f"\n\nNote: {comment}" if comment else ""),
            action_label="Respond to offer",
        )
        return offer
    offer.status = Offer.Status.WITHDRAWN
    offer.save(update_fields=["status"])
    set_status(app, Application.Status.WITHDRAWN, actor=actor, reason="Offer withdrawn after review")
    notify(hr_team(), f"Offer withdrawn: {app.candidate.full_name}",
           "Management withdrew the offer. Consider the next best candidate for this requisition.",
           url=reverse("requisitions:detail", args=[app.requisition_id]), level="warning")
    return offer


def next_best_candidates(requisition, limit: int = 5):
    """Candidates to fall back on when an offer fails: selected/on-hold after interview, best first."""
    qs = requisition.applications.filter(
        status__in=[Application.Status.ACTIVE, Application.Status.ON_HOLD],
        stage__in=[Stage.DECISION, Stage.INTERVIEW, Stage.SHORTLISTED, Stage.DOCUMENTS],
    ).select_related("candidate")
    ranked = []
    for application in qs:
        summary = application.evaluation_summary()
        ranked.append((summary["percentage"] if summary else Decimal("-1"), application.match_score, application))
    ranked.sort(key=lambda row: (row[0], row[1]), reverse=True)
    return [row[2] for row in ranked[:limit]]


# ---------------------------------------------------------------------------
# Medicals & onboarding
# ---------------------------------------------------------------------------
def schedule_medical(application, *, scheduled_for, facility, notes="", actor=None):
    if application.stage != Stage.MEDICAL:
        raise WorkflowError("The application is not in the medicals stage.")
    medical = MedicalCheck.objects.create(application=application, scheduled_for=scheduled_for, facility=facility,
                                          notes=notes, recorded_by=actor)
    when = timezone.localtime(scheduled_for).strftime("%A %d %B %Y at %I:%M %p")
    _candidate_email(application, "Pre-employment medical examination",
                     f"Please attend your pre-employment medical examination on {when} at {facility}.\n"
                     + (f"\n{notes}\n" if notes else "") + "\nKind regards,\nHR & A Department")
    log(f"Scheduled medicals for {when} at {facility}.", verb="medical", application=application, actor=actor)
    return medical


def record_medical_result(medical, result: str, *, notes: str = "", report=None, actor=None):
    medical.result = result
    if notes:
        medical.notes = notes
    if report:
        medical.report = report
    medical.recorded_by = actor
    medical.save()
    app = medical.application
    log(f"Medical result: {medical.get_result_display()}.", verb="medical", application=app, actor=actor)
    if result in {MedicalCheck.Result.FIT, MedicalCheck.Result.CONDITIONAL}:
        start_onboarding(app, actor=actor)
    elif result == MedicalCheck.Result.UNFIT:
        notify(hr_team(), f"Medical: {app.candidate.full_name} not fit", "A decision is required.",
               url=_app_url(app), level="danger")


@transaction.atomic
def start_onboarding(application, *, actor=None, start_date=None):
    accepted = application.offers.filter(status=Offer.Status.ACCEPTED).first()
    onboarding, created = Onboarding.objects.get_or_create(
        application=application,
        defaults={"start_date": start_date or (accepted.start_date if accepted else None),
                  "officer": (onboarding_team() or [None])[0]},
    )
    if created:
        OnboardingTask.objects.bulk_create(
            [OnboardingTask(onboarding=onboarding, title=title, order=i) for i, title in enumerate(DEFAULT_ONBOARDING_TASKS)]
        )
    move_to_stage(application, Stage.ONBOARDING, actor=actor, quiet=True)
    notify(onboarding_team(), f"New joiner to onboard: {application.candidate.full_name}",
           f"{application.requisition.title}, {application.requisition.department}.",
           url=reverse("pipeline:onboarding", args=[onboarding.pk]))
    notify_department(application.requisition.department, f"{application.candidate.full_name} is being onboarded",
                      f"{application.requisition.title}.", url=_app_url(application))
    _candidate_email(application, f"Welcome to {settings.COMPANY_NAME}",
                     "Congratulations and welcome! Our onboarding team will contact you with your resumption "
                     "details and what to bring on your first day.\n\nKind regards,\nHR & A Department")
    return onboarding


@transaction.atomic
def complete_onboarding(onboarding, *, actor=None):
    app = onboarding.application
    onboarding.status = Onboarding.Status.COMPLETED
    onboarding.completed_at = timezone.now()
    onboarding.save()
    candidate = app.candidate
    staff_id = onboarding.staff_id or f"NEW-{app.pk:05d}"
    Employee.objects.update_or_create(
        staff_id=staff_id,
        defaults={
            "first_name": candidate.first_name or candidate.full_name, "last_name": candidate.last_name,
            "email": candidate.email, "department": app.requisition.department, "job_title": app.requisition.title,
            "grade": app.requisition.grade, "date_of_birth": candidate.date_of_birth,
            "date_of_employment": onboarding.start_date or timezone.localdate(),
        },
    )
    move_to_stage(app, Stage.HIRED, actor=actor, note="Onboarding complete.")
    requisition = app.requisition
    if requisition.hired_count >= requisition.positions and requisition.status not in {"filled", "closed"}:
        requisition.status = requisition.Status.FILLED
        requisition.closed_at = timezone.now()
        requisition.save(update_fields=["status", "closed_at"])
        log(f"All {requisition.positions} position(s) filled.", verb="requisition", requisition=requisition, actor=actor)
    return onboarding
