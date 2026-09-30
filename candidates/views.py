import mimetypes
import os

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import Count, Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from core.choices import EducationLevel
from core.permissions import can_view_candidate, ensure, hr_required, safe_next
from core.text import split_list
from core.views import read_table
from pipeline.matching import rescore_candidate
from pipeline.models import Activity
from pipeline.services import create_application, log, review_document

from .forms import (AddToRequisitionForm, CandidateForm, DocumentUploadForm, IntakeForm, ReferralForm,
                    SpreadsheetImportForm)
from .intake import find_existing, ingest_cv, parse_document, save_document
from .models import Candidate, CandidateDocument


@hr_required
def candidate_list(request):
    qs = Candidate.objects.annotate(n_apps=Count("applications"))
    q = request.GET.get("q", "").strip()
    if q:
        qs = qs.filter(Q(first_name__icontains=q) | Q(last_name__icontains=q) | Q(email__icontains=q) |
                       Q(phone__icontains=q) | Q(course__icontains=q) | Q(cv_text__icontains=q) |
                       Q(current_job_title__icontains=q))
    for key in ("source", "highest_qualification"):
        if request.GET.get(key):
            qs = qs.filter(**{key: request.GET[key]})
    if request.GET.get("min_exp"):
        try:
            qs = qs.filter(years_experience__gte=float(request.GET["min_exp"]))
        except ValueError:
            pass
    skill = request.GET.get("skill", "").strip()
    if skill:
        qs = qs.filter(Q(skills__icontains=skill) | Q(tools__icontains=skill) | Q(certifications__icontains=skill))
    return render(request, "candidates/list.html", {
        "candidates": qs[:300], "q": q, "sources": Candidate.Source.choices, "levels": EducationLevel.choices,
        "filters": request.GET, "total": qs.count(),
    })


@login_required
def candidate_detail(request, pk):
    candidate = get_object_or_404(Candidate, pk=pk)
    ensure(can_view_candidate(request.user, candidate))
    applications = candidate.applications.select_related("requisition", "requisition__department")
    return render(request, "candidates/detail.html", {
        "c": candidate, "applications": applications,
        "documents": candidate.documents.select_related("uploaded_by", "reviewed_by"),
        "upload_form": DocumentUploadForm(), "add_form": AddToRequisitionForm(),
        "activity": Activity.objects.filter(Q(candidate=candidate) | Q(application__candidate=candidate))
        .select_related("actor", "application__requisition").distinct()[:40],
    })


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
    return redirect(candidate.get_absolute_url() + "#documents")


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
def download_document(request, pk):
    """Documents are personal data: they are only served to authorised staff."""
    document = get_object_or_404(CandidateDocument, pk=pk)
    ensure(can_view_candidate(request.user, document.candidate))
    if not document.file or not os.path.exists(document.file.path):
        raise Http404("File missing")
    content_type = mimetypes.guess_type(document.original_name or document.file.name)[0] or "application/octet-stream"
    inline = content_type in {"application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp", "text/plain"}
    return FileResponse(document.file.open("rb"), content_type=content_type, as_attachment=not inline,
                        filename=document.original_name or os.path.basename(document.file.name))


@hr_required
@require_POST
def delete_document(request, pk):
    document = get_object_or_404(CandidateDocument, pk=pk)
    candidate = document.candidate
    log(f"Deleted {document.get_doc_type_display()} ({document.original_name}).", verb="documents",
        candidate=candidate, actor=request.user)
    document.file.delete(save=False)
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
