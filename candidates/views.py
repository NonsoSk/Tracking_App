import mimetypes
import os

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Count, Exists, OuterRef, Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.clickjacking import xframe_options_sameorigin
from django.views.decorators.http import require_POST

from core.choices import EducationLevel
from core.models import Employee
from core.permissions import can_view_candidate, ensure, hr_required, safe_next
from core.text import split_list
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
        when = f" on {since:%-d %b %Y}" if since == until else f" between {since:%-d %b %Y} and {until:%-d %b %Y}"
    elif since:
        when = f" since {since:%-d %b %Y}"
    elif until:
        when = f" until {until:%-d %b %Y}"
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
    from pipeline import presentation

    return render(request, "candidates/detail.html", {
        "cv_fields": presentation.cv_fields(candidate), "cv_terms": presentation.cv_terms(candidate),
        "term_groups": presentation.term_groups(candidate, {}),
        "c": candidate, "applications": applications, "cbts": list(candidate.cbt_results.all()),
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


@hr_required
@require_POST
def add_to_requisition(request, pk):
    candidate = get_object_or_404(Candidate, pk=pk)
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


@hr_required
def intake(request):
    """Upload many CVs at once (emailed CVs, scanned hard copies, referrals)."""
    form = IntakeForm(request.POST or None, request.FILES or None)
    results = []
    if request.method == "POST" and form.is_valid():
        data = form.cleaned_data
        for uploaded in data["files"]:
            result = ingest_cv(
                uploaded.read(), uploaded.name, source=data["source"], requisition=data.get("requisition"),
                user=request.user, referred_by=data.get("referred_by"), referral_note=data.get("note", ""),
                notify_team=False,
            )
            results.append((uploaded.name, result))
        ok = [r for _, r in results if not r.error]
        messages.success(request, f"Processed {len(ok)} of {len(results)} CV(s). Review the extracted details below.")
        form = IntakeForm(initial={"source": data["source"], "requisition": data.get("requisition")})
    return render(request, "candidates/intake.html", {"form": form, "results": results})


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
