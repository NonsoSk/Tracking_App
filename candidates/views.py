import logging
import mimetypes
import os
import re

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Count, Exists, OuterRef, Q
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.clickjacking import xframe_options_sameorigin
from django.views.decorators.http import require_POST

from core.choices import EducationLevel
from core.models import Employee
from core.permissions import can_view_candidate, ensure, hr_required, safe_next
from core.text import day_text, split_list
from core.views import read_table
from pipeline.matching import rescore_candidate
from pipeline.models import Activity
from pipeline.services import create_application, log, review_document

from .forms import (AddToRequisitionForm, CandidateForm, DocumentUploadForm, IntakeForm, ReferralForm,
                    SpreadsheetImportForm)
from .intake import find_existing, ingest_cv, parse_document, save_document
from . import people
from .models import Candidate, CandidateDocument, CommunityStatus
from .regions import REGION_CHOICES, ZONES

logger = logging.getLogger(__name__)


@hr_required
def candidate_list(request):
    resumes = CandidateDocument.objects.filter(candidate=OuterRef("pk"), doc_type=CandidateDocument.DocType.CV)
    qs = Candidate.objects.annotate(n_apps=Count("applications", distinct=True), has_resume=Exists(resumes),
                                    is_hired=people.hired()).select_related("staff_record")
    if request.GET.get("resume") in {"yes", "no"}:
        qs = qs.filter(has_resume=request.GET["resume"] == "yes")
    q = request.GET.get("q", "").strip()
    if q:
        for word in q.split()[:6]:
            qs = qs.filter(Q(first_name__icontains=word) | Q(last_name__icontains=word) | Q(email__icontains=word) |
                           Q(phone__icontains=word) | Q(other_contacts__icontains=word) | Q(course__icontains=word) |
                           Q(institution__icontains=word) | Q(cv_text__icontains=word) |
                           Q(current_job_title__icontains=word) | Q(state_of_origin__icontains=word) |
                           Q(lga__icontains=word))
    if request.GET.get("highest_qualification"):
        qs = qs.filter(highest_qualification=request.GET["highest_qualification"])
    channel = request.GET.get("source", "")
    if channel.startswith("portal:"):
        qs = qs.filter(source=channel.split(":", 1)[1])
    elif channel:
        qs = qs.filter(source_detail=channel)
    record = request.GET.get("record", "")
    if record == "cbt":
        qs = qs.filter(cbt_results__isnull=False)
    elif record == "interviewed":
        qs = qs.filter(interview_records__isnull=False)
    elif record == "selected":
        qs = qs.filter(interview_records__result="selected")
    elif record == "hired":
        qs = qs.filter(applications__status="hired")
    if request.GET.get("community"):
        qs = qs.filter(community_status=request.GET["community"])
    if request.GET.get("min_exp"):
        try:
            qs = qs.filter(years_experience__gte=float(request.GET["min_exp"]))
        except ValueError:
            pass
    skill = request.GET.get("skill", "").strip()
    if skill:
        qs = qs.filter(Q(skills__icontains=skill) | Q(tools__icontains=skill) | Q(certifications__icontains=skill))
    country = request.GET.get("country", "")
    if country:
        qs = qs.filter(country=country)
    state = request.GET.get("state", "")
    if state:
        qs = qs.filter(state_of_origin=state)
    zone = request.GET.get("zone", "")
    if zone in ZONES:
        qs = qs.filter(state_of_origin__in=ZONES[zone])
    # From the summary page: the people who applied (to a department), between two dates.
    scope_note = summary_scope(request.GET)
    if scope_note:
        qs = qs.filter(scope_note.pop("q"))
    if record:
        qs = qs.distinct()
    # Who they are (applicants, staff, former staff) and where they are from. Each set of counts follows every
    # other filter, so the numbers always add up to what clicking them lists.
    who = request.GET.get("who", "")
    who = who if who in dict(people.WHO_CHOICES) else ""
    region = request.GET.get("region", "")
    in_region = qs.filter(region="" if region == "none" else region) if region else qs
    in_who = qs.filter(people.who_filter(who)) if who else qs

    def found(subset):
        return Candidate.objects.filter(pk__in=subset.order_by().values("pk"))

    by_group = dict(found(in_who).order_by().values_list("region").annotate(n=Count("id")))
    groups = [{"value": v, "label": label, "n": by_group.get(v, 0)} for v, label in REGION_CHOICES]
    groups.append({"value": "none", "label": "Not recorded", "n": by_group.get("", 0)})
    by_who = found(in_region).annotate(is_hired=people.hired()).aggregate(
        everyone=Count("id"), **{value: Count("id", filter=people.who_filter(value)) for value, _ in people.WHO_CHOICES})
    whos = [{"value": "", "label": "Everyone", "n": by_who["everyone"]}] + [
        {"value": value, "label": label, "n": by_who[value]} for value, label in people.WHO_CHOICES]
    qs = in_region.filter(people.who_filter(who)) if who else in_region
    page = Paginator(qs.order_by("-created_at", "-id"), 100).get_page(request.GET.get("page"))
    channels = sorted(set(Candidate.objects.exclude(source_detail="").values_list("source_detail", flat=True)))
    params = request.GET.copy()
    params.pop("page", None)
    without_region = params.copy()
    without_region.pop("region", None)
    without_who = params.copy()
    without_who.pop("who", None)
    return render(request, "candidates/list.html", {
        "to_check": Candidate.objects.filter(needs_check=True).count(),
        "candidates": page, "page": page, "q": q, "levels": EducationLevel.choices, "filters": request.GET,
        "total": page.paginator.count, "channels": channels, "portal_sources": Candidate.Source.choices,
        "communities": CommunityStatus.choices, "query": params.urlencode(),
        "groups": groups, "group_total": sum(g["n"] for g in groups), "zones": list(ZONES),
        "group_query": without_region.urlencode(),
        "searching": any(v for k, v in without_region.items()),
        "whos": whos, "who": who, "who_query": without_who.urlencode(), "scope_note": scope_note,
        "scope_params": [(k, request.GET[k]) for k in ("applied", "department", "since", "until") if request.GET.get(k)],
        "countries": sorted(set(Candidate.objects.exclude(country="").values_list("country", flat=True))),
        "states": sorted(set(Candidate.objects.exclude(state_of_origin="").values_list("state_of_origin", flat=True))),
        "filtered": any(request.GET.get(k) for k in ("q", "skill", "highest_qualification", "source", "min_exp",
                                                     "record", "community", "resume", "region", "country", "state",
                                                     "zone", "who", "applied", "department", "since",
                                                     "until")),
    })


def summary_scope(params) -> dict:
    """The summary page's scope (applied=1, department, since, until) as a filter and a sentence, or {}."""
    from datetime import date

    from core.models import Department
    from pipeline.models import Application

    def day(key):
        try:
            return date.fromisoformat(params.get(key, ""))
        except ValueError:
            return None

    since, until = day("since"), day("until")
    department = Department.objects.filter(pk=params["department"]).first() \
        if params.get("department", "").isdigit() else None
    if not (params.get("applied") or department or since or until):
        return {}
    q = ~Q(source_detail=people.STAFF_LIST)
    if department:  # candidates on the department's requisitions raised in those days (tracker Requisition Date)
        apps = Application.objects.filter(requisition__department=department)
        if since:
            apps = apps.filter(requisition__submitted_at__date__gte=since)
        if until:
            apps = apps.filter(requisition__submitted_at__date__lte=until)
        q = Q(pk__in=apps.values("candidate_id"))
    else:  # by the date they applied, as the records give it
        if since:
            q &= Q(applied_on__gte=since)
        if until:
            q &= Q(applied_on__lte=until)
    when = ""
    if since and until:
        when = f" on {day_text(since)}" if since == until else f" between {day_text(since)} and {day_text(until)}"
    elif since:
        when = f" since {day_text(since)}"
    elif until:
        when = f" until {day_text(until)}"
    text = (f"Candidates on {department.name}'s requisitions raised{when}" if department
            else f"People who applied{when}")
    return {"q": q, "text": text}


@login_required
def candidate_detail(request, pk):
    candidate = get_object_or_404(Candidate, pk=pk)
    ensure(can_view_candidate(request.user, candidate))
    applications = candidate.applications.select_related("requisition", "requisition__department")
    interview_records = list(candidate.interview_records.select_related("requisition"))
    staff = people.staff_record(candidate)
    from pipeline import presentation, timeline

    until = request.GET.get("until", "")
    until = until if until in dict(timeline.ENDPOINTS) else timeline.DEFAULT_ENDPOINT
    timelines = [(t, t.measure(until)) for t in timeline.for_candidate(candidate)]

    return render(request, "candidates/detail.html", {
        "cv_fields": presentation.cv_fields(candidate), "cv_terms": presentation.cv_terms(candidate),
        "term_groups": presentation.term_groups(candidate, {}),
        "c": candidate, "applications": applications, "cbts": list(candidate.cbt_results.all()),
        "timelines": timelines, "until": until, "endpoints": timeline.ENDPOINTS,
        "staff": staff, "staff_only": bool(staff) and people.is_empty_staff_profile(candidate),
        "maybe_same": people.possible_profiles(staff) if staff and request.user.is_hr
        and people.is_empty_staff_profile(candidate) else [],
        "interview_records": interview_records, "interview_records_count": len(interview_records),
        "documents": candidate.documents.select_related("uploaded_by", "reviewed_by"),
        "resume": candidate.latest_cv,
        "resume_waiting": bool(candidate.resume_url) and not candidate.documents.filter(
            source_url=candidate.resume_url).exists(),
        "upload_form": DocumentUploadForm(), "add_form": AddToRequisitionForm(),
        "activity": Activity.objects.filter(Q(candidate=candidate) | Q(application__candidate=candidate))
        .select_related("actor", "application__requisition").distinct()[:40],
    })



@hr_required
@require_POST
def link_staff(request, pk):
    """Join a staff record (by staff number) to this profile, so the staff member's page shows their resume,
    applications and records. A profile the staff list made just for them, with nothing else on it, is removed."""
    candidate = get_object_or_404(Candidate, pk=pk)
    back = redirect(candidate.get_absolute_url() + "#profile")
    staff_id = request.POST.get("staff_id", "").strip()
    employee = Employee.objects.filter(staff_id__iexact=staff_id).select_related("candidate").first() if staff_id else None
    if not employee:
        messages.error(request, f"No one on the staff list has staff number “{staff_id}”.")
        return back
    current = people.staff_record(candidate)
    if current and current.pk == employee.pk:
        messages.info(request, f"Staff number {employee.staff_id} is already joined to this profile.")
        return back
    if current:
        messages.error(request, f"This profile is already joined to staff number {current.staff_id}. "
                                "Unlink that first if it is wrong.")
        return back
    old = employee.candidate
    if old and not people.is_empty_staff_profile(old):
        messages.error(request, f"Staff number {employee.staff_id} is joined to another profile ({old.full_name}, "
                                f"#{old.pk}) that holds applications, records or documents. Open that profile and "
                                "unlink it first.")
        return back
    with transaction.atomic():
        employee.candidate, employee.link_fixed = candidate, True
        employee.link_note = f"Joined by {request.user.display_name}"[:120]
        employee.save(update_fields=["candidate", "link_fixed", "link_note"])
        if old:
            old.delete()
    log(f"Joined to staff record {employee.staff_id} ({employee.full_name}).", verb="profile", candidate=candidate,
        actor=request.user)
    messages.success(request, f"{employee.full_name} ({employee.staff_id}) is now joined to this profile.")
    return back


@hr_required
@require_POST
def unlink_staff(request, pk):
    """Undo a wrong join: the staff record gets a profile of its own again, and stays off automatic joining."""
    candidate = get_object_or_404(Candidate, pk=pk)
    employee = people.staff_record(candidate)
    if not employee or people.is_empty_staff_profile(candidate):
        messages.info(request, "There is nothing to unlink on this profile.")
        return redirect(candidate.get_absolute_url() + "#profile")
    with transaction.atomic():
        own = people.own_profile(employee)
        own.save()
        employee.candidate, employee.link_fixed = own, True
        employee.link_note = f"Unlinked by {request.user.display_name}"[:120]
        employee.save(update_fields=["candidate", "link_fixed", "link_note"])
    log(f"Staff record {employee.staff_id} ({employee.full_name}) unlinked from this profile.", verb="profile",
        candidate=candidate, actor=request.user)
    messages.success(request, f"Staff number {employee.staff_id} is no longer joined to {candidate.full_name}. "
                              "It now has a profile of its own.")
    return redirect(candidate.get_absolute_url() + "#profile")

@hr_required
def candidate_edit(request, pk):
    candidate = get_object_or_404(Candidate, pk=pk)
    form = CandidateForm(request.POST or None, instance=candidate)
    if request.method == "POST" and form.is_valid():
        form.save()
        rescore_candidate(candidate)
        log("Profile edited; applications re-scored.", verb="profile", candidate=candidate, actor=request.user)
        messages.success(request, "Profile saved and match scores refreshed.")
        return redirect(candidate)
    return render(request, "candidates/form.html", {"form": form, "c": candidate})


@hr_required
def candidate_create(request):
    form = CandidateForm(request.POST or None, initial={"source": Candidate.Source.HARD_COPY})
    if request.method == "POST" and form.is_valid():
        candidate = form.save(commit=False)
        candidate.created_by = request.user
        candidate.parse_method = Candidate.ParseMethod.FORM
        candidate.save()
        messages.success(request, "Candidate created.")
        return redirect(candidate)
    return render(request, "candidates/form.html", {"form": form})


@login_required
@require_POST
def upload_document(request, pk):
    candidate = get_object_or_404(Candidate, pk=pk)
    ensure(request.user.is_hr or request.user.is_onboarding)
    form = DocumentUploadForm(request.POST, request.FILES)
    if not form.is_valid():
        for errors in form.errors.values():
            messages.error(request, " ".join(errors))
        return redirect(candidate)
    uploaded = form.cleaned_data["file"]
    document = save_document(candidate, content=uploaded.read(), filename=uploaded.name,
                             doc_type=form.cleaned_data["doc_type"], user=request.user,
                             application=candidate.applications.filter(status__in=["active", "on_hold"]).first())
    log(f"Uploaded {document.get_doc_type_display()}.", verb="documents", candidate=candidate, actor=request.user)
    if document.doc_type == CandidateDocument.DocType.CV and form.cleaned_data.get("read_cv"):
        parsed = parse_document(document)
        messages.success(request, f"CV uploaded and read ({parsed.get('method') or 'no text found'}).")
        for note in parsed.get("notes", []):
            messages.warning(request, note)
    else:
        messages.success(request, "Document added to the candidate's folder.")
    anchor = "#resume" if document.doc_type == CandidateDocument.DocType.CV else "#documents"
    return redirect(candidate.get_absolute_url() + anchor)


@hr_required
@require_POST
def fetch_resume(request, pk):
    """Save this candidate's resume from the website now, instead of waiting for load-resumes."""
    from .resumes import Fetcher, acquire_lock, release_lock

    candidate = get_object_or_404(Candidate, pk=pk)
    if not candidate.resume_url:
        raise Http404
    if not acquire_lock():
        messages.info(request, "Resumes are being saved in another window right now. Try again in a minute.")
        return redirect(candidate)
    try:
        stats = Fetcher(log=lambda msg: None).run([candidate])
    finally:
        release_lock()
    candidate.refresh_from_db()
    if stats["saved"] or stats["already there"]:
        log("Resume saved from the website.", verb="documents", candidate=candidate, actor=request.user)
        messages.success(request, "Resume saved as a PDF.")
    else:
        messages.error(request, f"The resume could not be saved: {candidate.resume_error}")
    return redirect(candidate)


@hr_required
@require_POST
def reparse_document(request, pk):
    document = get_object_or_404(CandidateDocument, pk=pk)
    parsed = parse_document(document, overwrite="overwrite" in request.POST)
    log("CV re-read" + (" (profile overwritten)." if "overwrite" in request.POST else "."), verb="cv",
        candidate=document.candidate, actor=request.user)
    messages.success(request, f"CV read again ({parsed.get('method') or 'no text found'}); scores refreshed.")
    for note in parsed.get("notes", []):
        messages.warning(request, note)
    return redirect(document.candidate)


@login_required
@require_POST
def review_document_view(request, pk):
    document = get_object_or_404(CandidateDocument, pk=pk)
    ensure(request.user.is_hr)
    status = request.POST.get("status")
    if status in CandidateDocument.Status.values:
        review_document(document, status, note=request.POST.get("note", ""), actor=request.user)
        messages.success(request, f"{document.get_doc_type_display()} marked {document.get_status_display().lower()}.")
    return redirect(safe_next(request, document.candidate.get_absolute_url()))


@login_required
@xframe_options_sameorigin
def download_document(request, pk):
    """Documents are personal data: they are only served to authorised staff. PDFs open in the page
    (the resume viewer on the candidate's page shows them in a frame); ?original=1 gives the file as received."""
    document = get_object_or_404(CandidateDocument, pk=pk)
    ensure(can_view_candidate(request.user, document.candidate))
    stored = document.original_file if request.GET.get("original") and document.original_file else document.file
    if not stored or not os.path.exists(stored.path):
        raise Http404("File missing")
    content_type = mimetypes.guess_type(stored.name)[0] or "application/octet-stream"
    inline = content_type in {"application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp", "text/plain"}
    name = document.original_name or os.path.basename(stored.name)
    if stored == document.file and document.original_file:
        name = os.path.splitext(name)[0] + ".pdf"
    return FileResponse(stored.open("rb"), content_type=content_type, as_attachment=not inline, filename=name)


@hr_required
@require_POST
def delete_document(request, pk):
    document = get_object_or_404(CandidateDocument, pk=pk)
    candidate = document.candidate
    log(f"Deleted {document.get_doc_type_display()} ({document.original_name}).", verb="documents",
        candidate=candidate, actor=request.user)
    document.file.delete(save=False)
    if document.original_file:
        document.original_file.delete(save=False)
    document.delete()
    messages.info(request, "Document deleted.")
    return redirect(candidate)


def _check_queue(request):
    """The profiles still to check: those named in ?c= (an upload's CVs), else all of them, oldest first."""
    ids = [int(c) for c in request.GET.getlist("c") if c.isdigit()]
    queue = Candidate.objects.filter(needs_check=True)
    if ids:
        queue = queue.filter(pk__in=ids)
    return ids, queue.order_by("created_at", "pk")


def _with_ids(url, ids):
    from urllib.parse import urlencode

    return url + ("?" + urlencode([("c", i) for i in ids]) if ids else "")


@hr_required
def check_queue(request):
    """Start (or carry on) checking new profiles; when none are left, say so and offer the next step."""
    ids, queue = _check_queue(request)
    first = queue.first()
    if first:
        return redirect(_with_ids(reverse("candidates:check_profile", args=[first.pk]), ids))
    return render(request, "candidates/check_done.html", {
        "ids": ids, "match_url": _with_ids(reverse("candidates:match"), ids) if ids else "",
        "checked": Candidate.objects.filter(pk__in=ids, needs_check=False).count() if ids else 0,
    })


@hr_required
def check_profile(request, pk):
    """Check one profile against its CV: correct what the reader got wrong, then confirm. Only then can it be
    matched or put forward; the vacancy chosen at upload, if any, is applied to on confirming."""
    from requisitions.models import Requisition

    from .forms import ProfileCheckForm

    candidate = get_object_or_404(Candidate, pk=pk)
    ids, queue = _check_queue(request)
    if not candidate.needs_check and request.method == "GET":
        messages.info(request, f"{candidate.full_name}'s profile is already checked.")
        return redirect(_with_ids(reverse("candidates:check"), ids) if ids else candidate.get_absolute_url())
    if request.method == "POST" and "delete" in request.POST:
        if not candidate.needs_check:
            messages.error(request, "Only a profile that has not been checked can be deleted here.")
            return redirect(candidate)
        name = candidate.full_name
        for document in candidate.documents.all():
            document.file.delete(save=False)
            if document.original_file:
                document.original_file.delete(save=False)
        candidate.delete()
        messages.success(request, f"Deleted {name}'s profile and its CV.")
        return redirect(_with_ids(reverse("candidates:check"), ids))
    if request.method == "POST" and "skip" in request.POST:
        later = queue.exclude(pk=candidate.pk).filter(Q(created_at__gt=candidate.created_at)
                                                      | Q(created_at=candidate.created_at, pk__gt=candidate.pk)).first()
        nxt = later or queue.exclude(pk=candidate.pk).first()
        if nxt:
            return redirect(_with_ids(reverse("candidates:check_profile", args=[nxt.pk]), ids))
        messages.info(request, "That was the only profile left to check.")
        return redirect(_with_ids(reverse("candidates:check_profile", args=[candidate.pk]), ids))
    form = ProfileCheckForm(request.POST or None, instance=candidate)
    if request.method == "POST" and form.is_valid():
        from django.utils import timezone

        candidate = form.save(commit=False)
        candidate.needs_check = False
        candidate.checked_by = request.user
        candidate.checked_at = timezone.now()
        vacancy = candidate.pending_requisition
        candidate.pending_requisition = None
        candidate.save()
        form.save_m2m()
        rescore_candidate(candidate)
        log(f"Profile checked against the CV by {request.user.display_name}.", verb="profile", candidate=candidate,
            actor=request.user)
        if vacancy and vacancy.status in {Requisition.Status.OPEN, Requisition.Status.APPROVED}:
            application, _ = create_application(candidate, vacancy, source=candidate.source, actor=request.user,
                                                notify_team=False)
            messages.success(request, f"{candidate.full_name} checked and added to {vacancy.title}: "
                                      f"match {application.match_score}% ({application.grade_text.lower()}).")
        elif vacancy:
            messages.warning(request, f"{candidate.full_name} checked. {vacancy.title} is no longer open, so the CV "
                                      "was not added to it.")
        else:
            messages.success(request, f"{candidate.full_name} checked.")
        return redirect(_with_ids(reverse("candidates:check"), ids))
    from pipeline import presentation

    position = list(queue.values_list("pk", flat=True))
    resume = candidate.latest_cv
    return render(request, "candidates/check.html", {
        "c": candidate, "form": form, "resume": resume, "ids": ids, "left": len(position),
        "cv_terms": presentation.cv_terms(candidate),
        "place": position.index(candidate.pk) + 1 if candidate.pk in position else 1,
        "notes": [n for n in (candidate.parse_notes or "").splitlines() if n.strip()],
        "query": request.GET.urlencode(),
    })


@hr_required
@require_POST
def add_to_requisition(request, pk):
    candidate = get_object_or_404(Candidate, pk=pk)
    if candidate.needs_check:
        messages.error(request, "Check this profile against the CV first; it can then be put forward.")
        return redirect("candidates:check_profile", pk=candidate.pk)
    form = AddToRequisitionForm(request.POST)
    if form.is_valid():
        application, created = create_application(candidate, form.cleaned_data["requisition"], source=candidate.source,
                                                  actor=request.user, notify_team=False)
        if created:
            messages.success(request, f"Added to {application.requisition.title} — match {application.match_score}%.")
        else:
            messages.info(request, "The candidate already applied for this vacancy.")
        return redirect(application)
    return redirect(candidate)


RUN_TOKEN = re.compile(r"^[A-Za-z0-9]{8,40}$")
INTAKE_RUNS_KEPT = 3


def _ingest_upload(uploaded, data, user):
    """Read one uploaded CV. A file that is not a CV, is too large or cannot be read is reported, and the other
    files carry on."""
    from django.conf import settings

    from .cv_parser import SUPPORTED_EXTENSIONS
    from .intake import IntakeResult

    ext = os.path.splitext(uploaded.name)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        return IntakeResult(error=f"Skipped: not a file type the portal reads ({ext or 'no extension'}). "
                                  "CVs can be PDF, Word, text or photos.")
    if uploaded.size > settings.MAX_UPLOAD_MB * 1024 * 1024:
        return IntakeResult(error=f"Skipped: larger than {settings.MAX_UPLOAD_MB} MB.")
    try:
        return ingest_cv(
            uploaded.read(), uploaded.name, source=data["source"], requisition=data.get("requisition"), user=user,
            referred_by=data.get("referred_by"), referral_note=data.get("note", ""), notify_team=False,
            needs_check=True,
        )
    except Exception:
        logger.exception("CV intake could not read %s", uploaded.name)
        return IntakeResult(error="Could not be read. Open it to check it is a CV, then add it again on its own.")


def _remember_run(request, token, results):
    """Keep a batched upload's results in the session, so the page can show them all once the last batch is in."""
    runs = request.session.get("intake_runs", {})
    entries = runs.pop(token, [])
    for name, r in results:
        parsed = r.parsed or {}
        entries.append({"name": name, "candidate": r.candidate.pk if r.candidate else None, "created": r.created,
                        "application": getattr(r.application, "pk", None), "method": parsed.get("method", ""),
                        "notes": [str(n) for n in (parsed.get("notes") or [])][:5], "error": r.error})
    runs[token] = entries
    while len(runs) > INTAKE_RUNS_KEPT:
        runs.pop(next(iter(runs)))
    request.session["intake_runs"] = runs


def _results_of_run(request, token):
    from types import SimpleNamespace

    from pipeline.models import Application

    entries = request.session.get("intake_runs", {}).get(token)
    if entries is None:
        return None
    people_by_id = Candidate.objects.in_bulk([e["candidate"] for e in entries if e["candidate"]])
    apps = Application.objects.select_related("requisition").in_bulk(
        [e["application"] for e in entries if e["application"]])
    results = []
    for e in entries:
        person = people_by_id.get(e["candidate"])
        error = e["error"] or ("" if person else "This profile has since been deleted.")
        results.append((e["name"], SimpleNamespace(
            candidate=person, created=e["created"], application=apps.get(e["application"]), error=error,
            parsed={"method": e["method"], "notes": e["notes"]})))
    return results


def _intake_page(request, form, results, lost=()):
    from urllib.parse import urlencode

    ok = [r for _, r in results if not r.error]
    context = {"form": form, "results": results, "lost": lost, "read_count": len(ok),
               "problem_count": len(results) - len(ok)}
    to_check = list(dict.fromkeys(r.candidate.pk for r in ok if r.candidate.needs_check))
    if to_check:
        context.update(check_url=_with_ids(reverse("candidates:check"), to_check), check_count=len(to_check))
    elif ok and not any(r.application for r in ok):
        # No vacancy was chosen: offer to match them to the vacancies.
        ids = list(dict.fromkeys(r.candidate.pk for r in ok))
        context.update(match_url=reverse("candidates:match") + "?" + urlencode([("c", pk) for pk in ids]),
                       match_count=len(ids))
    return render(request, "candidates/intake.html", context)


@hr_required
def intake(request):
    """Upload many CVs at once (emailed CVs, scanned hard copies, referrals). The page sends a big selection a few
    files at a time (header X-Intake-Batch names the run) and then shows all the results (?run=)."""
    token = request.headers.get("X-Intake-Batch", "")
    batch = request.method == "POST" and bool(RUN_TOKEN.match(token))
    form = IntakeForm(request.POST or None, request.FILES or None)
    if request.method == "POST":
        if not form.is_valid():
            if batch:
                problems = [str(e) for errors in form.errors.values() for e in errors]
                return JsonResponse({"error": " ".join(problems) or "Check the form."}, status=400)
            return _intake_page(request, form, [])
        data = form.cleaned_data
        results = [(uploaded.name, _ingest_upload(uploaded, data, request.user)) for uploaded in data["files"]]
        if batch:
            _remember_run(request, token, results)
            return JsonResponse({"results": [{"name": name, "ok": not r.error, "error": r.error}
                                             for name, r in results]})
        ok = [r for _, r in results if not r.error]
        messages.success(request, f"Processed {len(ok)} of {len(results)} CV(s). Review the extracted details below.")
        form = IntakeForm(initial={"source": data["source"], "requisition": data.get("requisition")})
        return _intake_page(request, form, results)
    run = request.GET.get("run", "")
    results = _results_of_run(request, run) if RUN_TOKEN.match(run) else None
    if results is not None:
        return _intake_page(request, form, results, lost=request.GET.getlist("lost")[:30])
    return _intake_page(request, form, [])



MATCH_LIMIT = 400


@hr_required
def match_vacancies(request):
    """Score a set of CVs against several vacancies at once, ranked for each vacancy, with filters (top 10/20/50, a
    score range, only those meeting every key requirement). Nothing is saved: HR ticks the matches to keep and adds
    them as applications (match_add)."""
    from datetime import date

    from django.utils import timezone

    from core.text import db_aliases
    from pipeline.matching import compute_match
    from pipeline.models import Application

    from requisitions.models import Requisition

    # Vacancies not yet approved can be scored too (to see who fits before approving); only approved or open
    # ones take applications.
    status = Requisition.Status
    can_add = {status.APPROVED, status.OPEN}
    vacancies_all = sorted(
        Requisition.objects.filter(status__in=[*can_add, status.DRAFT, status.SUBMITTED, status.RETURNED,
                                               status.PENDING_MANAGEMENT, status.ON_HOLD]).select_related("department"),
        key=lambda v: (v.status not in can_add, v.title.lower()))
    for v in vacancies_all:
        v.can_add = v.status in can_add
    chosen = {int(v) for v in request.GET.getlist("r") if v.isdigit()}
    vacancies = [v for v in vacancies_all if v.pk in chosen]
    ids = [int(c) for c in request.GET.getlist("c") if c.isdigit()]
    uploaded = Candidate.objects.exclude(source__in=["import", "internal"])
    try:
        added = date.fromisoformat(request.GET.get("added", ""))
    except ValueError:
        latest = uploaded.order_by("-created_at").values_list("created_at", flat=True).first()
        added = timezone.localdate(latest) if latest else timezone.localdate()
    if ids:
        people = Candidate.objects.filter(pk__in=ids)
        scope = f"the {len(ids)} CV{'s' if len(ids) != 1 else ''} you uploaded"
    else:
        people = uploaded.filter(created_at__date=added)
        scope = f"CVs added on {added:%d %b %Y}"
    unchecked = list(people.filter(needs_check=True).values_list("pk", flat=True))
    people = people.filter(needs_check=False)
    total = people.count()
    people = list(people.order_by("last_name", "first_name")[:MATCH_LIMIT])
    from pipeline import ranking
    from pipeline.matching import grade_for

    filters = ranking.read_filters(request.GET)
    rank_by = request.GET.get("rank", "")
    if not (rank_by.isdigit() and int(rank_by) in chosen):
        rank_by = str(vacancies[0].pk) if len(vacancies) == 1 else "any"
    rows, columns, shown_total = [], [], 0
    if vacancies and people:
        aliases = db_aliases()
        applied = set(Application.objects.filter(candidate__in=people, requisition__in=vacancies)
                      .values_list("candidate_id", "requisition_id"))
        for person in people:
            cells = []
            for vacancy in vacancies:
                result = compute_match(vacancy, person, aliases)
                cells.append({
                    "vacancy": vacancy, "score": result["score"], "grade": result["grade"],
                    "label": grade_for(result["score"])[1] if not result.get("unscored") else "",
                    "eligible": result.get("eligible"), "unscored": result.get("unscored"),
                    "weighted": result["weighted_score"], "applied": (person.pk, vacancy.pk) in applied,
                    "can_add": vacancy.can_add,
                    "failed": [f"{s['label']}: {s['has']}" for s in result["screening"] if not s["passed"]],
                })
            scored = sorted((c for c in cells if not c["unscored"]), key=lambda c: -c["score"])
            # Only when the person is clearly better suited to one of the chosen roles is it called out.
            if len(scored) >= 2 and scored[0]["score"] >= ranking.GOOD_ENOUGH \
                    and scored[0]["score"] - scored[1]["score"] >= 5:
                scored[0]["strongest"] = True
            rows.append({"candidate": person, "cells": cells})
        # Rank every CV within each vacancy.
        for i, vacancy in enumerate(vacancies):
            column = sorted((r["cells"][i] for r in rows if not r["cells"][i]["unscored"]), key=lambda c: -c["score"])
            for place, cell in enumerate(column, start=1):
                cell["rank"], cell["of"] = place, len(column)
            grades = {g: sum(1 for c in column if c["grade"] == g) for g in "ABCD"}
            columns.append({"vacancy": vacancy, "scored": len(column), "grades": grades,
                            "meets_all": sum(1 for c in column if not c["failed"]),
                            "unscored": any(r["cells"][i]["unscored"] for r in rows)})
        # The cell each row is ranked and filtered by: the chosen vacancy, or the person's strongest one.
        for row in rows:
            if rank_by == "any":
                options = [c for c in row["cells"] if not c["unscored"]]
                row["key"] = max(options, key=lambda c: c["score"]) if options else None
            else:
                row["key"] = next(c for c in row["cells"] if str(c["vacancy"].pk) == rank_by)
                row["key"] = None if row["key"]["unscored"] else row["key"]
        rows = [r for r in rows if r["key"] is None or (
            ranking.in_range(r["key"]["score"], filters) and not (filters["keyreq"] and r["key"]["failed"]))]
        if filters["keyreq"] or filters["min"] is not None or filters["max"] is not None:
            rows = [r for r in rows if r["key"] is not None]
        rows.sort(key=lambda r: (-(r["key"]["score"] if r["key"] else -1), r["candidate"].full_name.lower()))
        shown_total = len(rows)
        if filters["top"]:
            rows = rows[:filters["top"]]
        # Ready to add: the ranked cell of each row shown, when it is a possible match or better (or in the chosen
        # score range).
        floor = filters["min"] if filters["min"] is not None else ranking.GOOD_ENOUGH
        for row in rows:
            key = row["key"]
            if key:
                key["is_key"] = len(vacancies) > 1
            if key and key["can_add"] and not key["applied"] and key["score"] >= floor:
                key["tick"] = True
    return render(request, "candidates/match.html", {
        "vacancies_all": vacancies_all, "chosen": chosen, "vacancies": vacancies, "columns": columns, "rows": rows,
        "ids": ids, "added": added, "scope": scope, "total": total, "limit": MATCH_LIMIT,
        "addable": any(v.can_add for v in vacancies),
        "unchecked": len(unchecked), "check_url": _with_ids(reverse("candidates:check"), unchecked),
        "query": request.GET.urlencode(), "filters": filters, "filtered": ranking.active(filters),
        "filter_text": ranking.describe(filters), "top_choices": ranking.TOP_CHOICES, "rank_by": rank_by,
        "shown_total": shown_total,
    })


@hr_required
@require_POST
def match_add(request):
    """Add the ticked CV-vacancy pairs from the match grid as applications (each scored and saved)."""
    from requisitions.models import Requisition

    from .forms import open_requisitions

    added = 0
    open_ids = set(open_requisitions().values_list("pk", flat=True))
    for pair in request.POST.getlist("pair"):
        person_id, _, vacancy_id = pair.partition(":")
        if not (person_id.isdigit() and vacancy_id.isdigit() and int(vacancy_id) in open_ids):
            continue
        person = Candidate.objects.filter(pk=person_id, needs_check=False).first()
        vacancy = Requisition.objects.filter(pk=vacancy_id).first()
        if person and vacancy:
            _, created = create_application(person, vacancy, actor=request.user, notify_team=False)
            added += created
    messages.success(request, f"Added {added} application{'s' if added != 1 else ''}, each scored against its "
                              "vacancy." if added else "Nothing new to add.")
    query = request.POST.get("query", "")
    return redirect(reverse("candidates:match") + (f"?{query}" if query else ""))

@login_required
def refer(request):
    """Any employee can refer someone; the CV is read and scored automatically."""
    form = ReferralForm(request.POST or None, request.FILES or None)
    if request.method == "POST" and form.is_valid():
        data = form.cleaned_data
        uploaded = data["cv"]
        result = ingest_cv(uploaded.read(), uploaded.name, source=Candidate.Source.REFERRAL,
                           requisition=data["requisition"], user=request.user, referred_by=request.user,
                           referral_note=data.get("note", ""), fallback_email=data.get("candidate_email", ""))
        if result.error:
            messages.error(request, result.error)
        else:
            messages.success(request, f"Thank you! {result.candidate.full_name} has been referred for "
                                      f"{data['requisition'].title}. You can follow progress on your dashboard.")
            return redirect("core:dashboard")
    return render(request, "candidates/refer.html", {"form": form})


HEADER_MAP = {
    "first_name": ["first name", "firstname", "first_name", "given name", "other names"],
    "last_name": ["last name", "lastname", "last_name", "surname", "family name"],
    "full_name": ["name", "full name", "candidate", "candidate name", "applicant", "applicant name"],
    "email": ["email", "e-mail", "email address"],
    "phone": ["phone", "phone number", "mobile", "telephone", "gsm", "contact"],
    "highest_qualification": ["qualification", "highest qualification", "degree", "education"],
    "course": ["course", "course of study", "discipline", "field of study"],
    "institution": ["institution", "university", "school"],
    "degree_class": ["class", "class of degree", "grade"],
    "years_experience": ["experience", "years of experience", "years experience", "yrs exp", "yoe"],
    "skills": ["skills", "key skills"],
    "tools": ["tools", "software"],
    "certifications": ["certifications", "certification", "certificates"],
    "location": ["location", "state", "city", "address"],
    "current_employer": ["employer", "current employer", "company"],
    "current_job_title": ["current role", "job title", "current position", "position"],
}
QUALIFICATION_WORDS = [
    (EducationLevel.PHD, ["phd", "doctor"]), (EducationLevel.MSC, ["msc", "m.sc", "master", "mba", "meng"]),
    (EducationLevel.PGD, ["pgd", "postgraduate diploma"]), (EducationLevel.HND, ["hnd"]),
    (EducationLevel.BSC, ["bsc", "b.sc", "beng", "b.eng", "bachelor", "btech", "llb", "b.a"]),
    (EducationLevel.OND, ["ond", "nd", "national diploma"]), (EducationLevel.NCE, ["nce"]),
    (EducationLevel.SSCE, ["ssce", "waec", "neco"]),
]


def _map_row(row: dict) -> dict:
    mapped = {}
    for field, names in HEADER_MAP.items():
        for name in names:
            if row.get(name) not in (None, ""):
                mapped[field] = row[name]
                break
    if "full_name" in mapped and not mapped.get("first_name"):
        parts = str(mapped.pop("full_name")).split()
        mapped["first_name"], mapped["last_name"] = parts[0], " ".join(parts[1:])
    mapped.pop("full_name", None)
    qual = str(mapped.get("highest_qualification", "")).lower()
    mapped["highest_qualification"] = next((lvl for lvl, words in QUALIFICATION_WORDS if any(w in qual for w in words)), "")
    for key in ("skills", "tools", "certifications"):
        mapped[key] = split_list(str(mapped.get(key, "")))
    try:
        mapped["years_experience"] = float(str(mapped.get("years_experience", 0)).split()[0] or 0)
    except (ValueError, IndexError):
        mapped["years_experience"] = 0
    return mapped


@hr_required
def import_spreadsheet(request):
    """Bring the existing Excel candidate database into the portal."""
    form = SpreadsheetImportForm(request.POST or None, request.FILES or None)
    if request.method == "POST" and form.is_valid():
        created = updated = applied = 0
        requisition = form.cleaned_data.get("requisition")
        for row in read_table(form.cleaned_data["file"]):
            data = _map_row(row)
            if not (data.get("email") or data.get("phone") or data.get("first_name")):
                continue
            candidate = find_existing(str(data.get("email", "")), str(data.get("phone", "")))
            is_new = candidate is None
            candidate = candidate or Candidate(source=Candidate.Source.IMPORT, created_by=request.user)
            for key, value in data.items():
                if value not in (None, "", []) and (is_new or not getattr(candidate, key)):
                    setattr(candidate, key, str(value)[:150] if isinstance(value, str) else value)
            candidate.cv_text = candidate.cv_text or " ".join(str(v) for v in row.values() if v)
            candidate.save()
            created += is_new
            updated += not is_new
            if requisition:
                _, was_created = create_application(candidate, requisition, source=Candidate.Source.IMPORT,
                                                    actor=request.user, notify_team=False)
                applied += was_created
        messages.success(request, f"Import finished: {created} new, {updated} updated"
                                  + (f", {applied} applied to {requisition.title}." if requisition else "."))
        return redirect("candidates:list")
    return render(request, "candidates/import.html", {"form": form, "header_map": HEADER_MAP})
