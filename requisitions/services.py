"""Requisition approval workflow and department ↔ HR messaging."""

from django.conf import settings
from django.utils import timezone

from core.notify import hr_team, management_team, notify, notify_department
from pipeline.matching import rescore_requisition
from pipeline.services import WorkflowError, log

from .models import Requisition, RequisitionNote


def submit(requisition, *, actor):
    if requisition.status not in {Requisition.Status.DRAFT, Requisition.Status.RETURNED}:
        raise WorkflowError("Only draft or returned requisitions can be submitted.")
    requisition.status = Requisition.Status.SUBMITTED
    requisition.submitted_at = timezone.now()
    requisition.save()
    log(f"Requisition submitted by {actor.display_name}.", verb="requisition", requisition=requisition, actor=actor)
    notify(hr_team(), f"New requisition: {requisition.title} ({requisition.department})",
           f"{requisition.positions} position(s) — {requisition.get_reason_display()}.",
           url=requisition.get_absolute_url(), level="warning")


def approve(requisition, *, actor, hr_owner=None):
    if requisition.status == Requisition.Status.PENDING_MANAGEMENT:
        if not (actor.is_management or actor.is_superuser):
            raise WorkflowError("Waiting for management approval.")
    elif requisition.status != Requisition.Status.SUBMITTED:
        raise WorkflowError("This requisition is not awaiting approval.")
    if hr_owner:
        requisition.hr_owner = hr_owner
    elif not requisition.hr_owner and actor.is_hr:
        requisition.hr_owner = actor
    needs_management = settings.RECRUITMENT["REQUISITION_NEEDS_MANAGEMENT_APPROVAL"]
    if requisition.status == Requisition.Status.SUBMITTED and needs_management and not actor.is_management:
        requisition.status = Requisition.Status.PENDING_MANAGEMENT
        requisition.save()
        log("HR reviewed the requisition and sent it for management approval.", verb="requisition",
            requisition=requisition, actor=actor)
        notify(management_team(), f"Approval needed: {requisition.title} ({requisition.department})",
               requisition.justification[:300], url=requisition.get_absolute_url(), level="warning")
        return
    requisition.status = Requisition.Status.APPROVED
    requisition.approved_by = actor
    requisition.approved_at = timezone.now()
    requisition.save()
    log(f"Requisition approved by {actor.display_name}.", verb="requisition", requisition=requisition, actor=actor)
    notify_department(requisition.department, f"Requisition approved: {requisition.title}",
                      "The hiring team will now advertise the role.", url=requisition.get_absolute_url())
    if requisition.raised_by and requisition.raised_by not in requisition.department.contacts():
        notify([requisition.raised_by], f"Requisition approved: {requisition.title}", url=requisition.get_absolute_url())


def return_for_changes(requisition, *, actor, reason: str):
    requisition.status = Requisition.Status.RETURNED
    requisition.save()
    RequisitionNote.objects.create(requisition=requisition, author=actor, message=f"Returned for changes: {reason}")
    log(f"Returned for changes: {reason}", verb="requisition", requisition=requisition, actor=actor)
    recipients = requisition.department.contacts() + ([requisition.raised_by] if requisition.raised_by else [])
    notify(recipients, f"Requisition returned: {requisition.title}", reason, url=requisition.get_absolute_url(),
           level="danger")


def publish(requisition, *, actor, closing_date=None):
    if requisition.status not in {Requisition.Status.APPROVED, Requisition.Status.ON_HOLD, Requisition.Status.CLOSED}:
        raise WorkflowError("Approve the requisition before opening it for applications.")
    requisition.status = Requisition.Status.OPEN
    requisition.published_at = requisition.published_at or timezone.now()
    if closing_date:
        requisition.closing_date = closing_date
    requisition.save()
    log("Opened for applications on the careers page.", verb="requisition", requisition=requisition, actor=actor)
    notify_department(requisition.department, f"Now recruiting: {requisition.title}",
                      "Applications are open. You can follow candidates in the portal.",
                      url=requisition.get_absolute_url(), email=False)


def set_status(requisition, status: str, *, actor, note: str = ""):
    requisition.status = status
    if status in {Requisition.Status.CLOSED, Requisition.Status.CANCELLED, Requisition.Status.FILLED}:
        requisition.closed_at = timezone.now()
    requisition.save()
    log(f"Status set to {requisition.get_status_display()}." + (f" {note}" if note else ""), verb="requisition",
        requisition=requisition, actor=actor)


def add_note(requisition, *, author, message: str) -> RequisitionNote:
    note = RequisitionNote.objects.create(requisition=requisition, author=author, message=message)
    if author.is_hr:
        recipients = requisition.department.contacts() + ([requisition.raised_by] if requisition.raised_by else [])
    else:
        recipients = [requisition.hr_owner] if requisition.hr_owner else hr_team()
    notify(recipients, f"Message on {requisition.reference}: {requisition.title}",
           f"{author.display_name}: {message}", url=requisition.get_absolute_url() + "#messages", exclude=author)
    return note


def requirements_changed(requisition):
    count = rescore_requisition(requisition)
    if count:
        log(f"Requirements updated — re-scored {count} application(s).", verb="requisition", requisition=requisition)
