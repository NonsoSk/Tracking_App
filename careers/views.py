from django.conf import settings
from django.contrib import messages
from django.core.cache import cache
from django.db import transaction
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from candidates.cv_parser import SUPPORTED_EXTENSIONS, parse_cv
from candidates.intake import apply_parsed, find_existing, save_document
from candidates.models import Candidate, CandidateDocument
from core.forms import validate_upload
from core.notify import send_email
from pipeline.models import Application, Interview, Offer, Stage
from pipeline.services import (WorkflowError, candidate_interview_response, candidate_offer_response,
                               create_application, document_checklist, log)
from requisitions.models import Requisition

from .forms import (ApplicationForm, CandidateDocumentForm, InterviewResponseForm, OfferResponseForm,
                    StatusLookupForm, form_to_candidate)

# What candidates see for each internal stage (keeps internal steps private).
PUBLIC_STAGE = {
    Stage.APPLIED: ("Application received", "We are reviewing applications for this role."),
    Stage.SHORTLISTED: ("Shortlisted", "You have been shortlisted. We will contact you about interviews."),
    Stage.INTERVIEW: ("Interviews", "You are in the interview process."),
    Stage.DECISION: ("Under review", "Your interviews are complete and the panel is reviewing the results."),
    Stage.DOCUMENTS: ("Document verification", "Please upload the requested documents below."),
    Stage.OFFER: ("Offer", "An offer is being prepared or awaits your response."),
    Stage.MEDICAL: ("Pre-employment medicals", "Please attend your medical examination."),
    Stage.ONBOARDING: ("Onboarding", "Welcome! Our onboarding team will contact you."),
    Stage.HIRED: ("Hired", "Welcome to the team!"),
}


def open_jobs():
    today = timezone.localdate()
    return Requisition.objects.filter(status=Requisition.Status.OPEN).exclude(closing_date__lt=today).select_related("department")


def job_list(request):
    jobs = open_jobs()
    q = request.GET.get("q", "").strip()
    if q:
        jobs = jobs.filter(title__icontains=q) | jobs.filter(department__name__icontains=q)
    kind = request.GET.get("type", "")
    if kind:
        jobs = jobs.filter(employment_type=kind)
    from core.choices import EmploymentType

    return render(request, "careers/job_list.html", {"jobs": jobs.order_by("-published_at"), "q": q, "type": kind,
                                                     "types": EmploymentType.choices})


def job_detail(request, reference):
    job = get_object_or_404(Requisition.objects.select_related("department"), reference=reference)
    if job.status != Requisition.Status.OPEN:
        raise Http404
    return render(request, "careers/job_detail.html", {"job": job})


def apply(request, reference):
    job = get_object_or_404(Requisition.objects.select_related("department"), reference=reference)
    if not job.is_accepting_applications:
        messages.error(request, "This vacancy is no longer accepting applications.")
        return redirect("careers:jobs")
    form = ApplicationForm(request.POST or None, request.FILES or None)
    if request.method == "POST" and form.is_valid():
        data = form.cleaned_data
        cv = data["cv"]
        content = cv.read()
        with transaction.atomic():
            candidate = find_existing(data["email"], data["phone"]) or Candidate(source=Candidate.Source.PORTAL)
            if candidate.pk and Application.objects.filter(candidate=candidate, requisition=job).exists():
                existing = Application.objects.get(candidate=candidate, requisition=job)
                messages.info(request, "You have already applied for this role. Here is your application page.")
                return redirect("careers:hub", token=existing.token)
            form_to_candidate(form, candidate)
            candidate.consent_given = True
            parsed = parse_cv(content, cv.name)
            apply_parsed(candidate, parsed)  # fills only what the form left empty
            if candidate.parse_method in ("", None):
                candidate.parse_method = Candidate.ParseMethod.FORM
            candidate.save()
            application, _ = create_application(candidate, job, source=Candidate.Source.PORTAL)
            save_document(candidate, content=content, filename=cv.name, application=application)
            if data.get("other_documents"):
                other = data["other_documents"]
                save_document(candidate, content=other.read(), filename=other.name,
                              doc_type=CandidateDocument.DocType.OTHER, application=application)
            if data.get("cover_letter"):
                candidate.summary = candidate.summary or data["cover_letter"][:800]
                candidate.save(update_fields=["summary"])
                log(f"Cover note: {data['cover_letter'][:400]}", verb="candidate", application=application)
        send_email(
            [candidate.email], f"Application received — {job.title}",
            f"Dear {candidate.first_name},\n\nThank you for applying for the {job.title} role at "
            f"{settings.COMPANY_NAME}. Your application reference is {application.reference}.\n\n"
            "You can follow your application, confirm interviews, upload documents and respond to offers "
            "from your personal application page.\n\nKind regards,\nHR & A Department",
            action_url=application.get_portal_url(), action_label="Track my application",
        )
        messages.success(request, f"Application submitted. Your reference is {application.reference}.")
        return redirect("careers:hub", token=application.token)
    return render(request, "careers/apply.html", {"job": job, "form": form})


@require_POST
def parse_cv_preview(request):
    """Reads an uploaded CV and returns the fields so the form fills itself."""
    # Public endpoint (and may call the AI API): limit per browser session and per IP address.
    ip = (request.META.get("HTTP_X_FORWARDED_FOR") or request.META.get("REMOTE_ADDR") or "").split(",")[0].strip()
    ip_key = f"cv-parse:{ip}"
    count = request.session.get("cv_parse_count", 0)
    if count >= 10 or cache.get(ip_key, 0) >= 30:
        return JsonResponse({"error": "Too many attempts. Please fill the form manually."}, status=429)
    request.session["cv_parse_count"] = count + 1
    cache.add(ip_key, 0, timeout=3600)
    cache.incr(ip_key)
    uploaded = request.FILES.get("cv")
    if not uploaded:
        return JsonResponse({"error": "No file received."}, status=400)
    try:
        validate_upload(uploaded, SUPPORTED_EXTENSIONS)
    except Exception as exc:  # ValidationError
        return JsonResponse({"error": " ".join(getattr(exc, "messages", [str(exc)]))}, status=400)
    parsed = parse_cv(uploaded.read(), uploaded.name)
    fields = {k: parsed.get(k) for k in (
        "first_name", "last_name", "email", "phone", "location", "gender", "highest_qualification", "course",
        "institution", "graduation_year", "degree_class", "nysc_status", "years_experience", "current_employer",
        "current_job_title", "skills", "tools", "certifications", "linkedin_url")}
    if parsed.get("date_of_birth"):
        fields["date_of_birth"] = parsed["date_of_birth"].isoformat()
    filled = [k for k, v in fields.items() if v not in (None, "", [], 0)]
    return JsonResponse({"fields": fields, "filled": filled, "method": parsed.get("method"), "notes": parsed.get("notes")})


def status_lookup(request):
    form = StatusLookupForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        application = Application.objects.filter(
            reference__iexact=form.cleaned_data["reference"].strip(),
            candidate__email__iexact=form.cleaned_data["email"].strip(),
        ).first()
        if application:
            return redirect("careers:hub", token=application.token)
        messages.error(request, "We could not find an application with those details.")
    return render(request, "careers/status_lookup.html", {"form": form})


def _application_by_token(token):
    return get_object_or_404(Application.objects.select_related("candidate", "requisition", "requisition__department"),
                             token=token)


def hub(request, token):
    """The candidate's private page: status, interviews, documents and offer."""
    application = _application_by_token(token)
    stages = application.pipeline_stages()
    current = application.stage_index()
    steps = [{"label": PUBLIC_STAGE[s][0], "state": "done" if i < current else ("current" if i == current else "todo")}
             for i, s in enumerate(stages)]
    headline, explanation = PUBLIC_STAGE[Stage(application.stage)]
    if application.status == Application.Status.REJECTED:
        headline, explanation = "Application closed", "Thank you for your interest. We will keep your profile for future roles."
    elif application.status == Application.Status.WITHDRAWN:
        headline, explanation = "Application closed", "This application is no longer active."
    elif application.status == Application.Status.ON_HOLD:
        headline, explanation = "On hold", "Your application is on hold. We will contact you if the situation changes."
    interviews = application.interviews.exclude(status=Interview.Status.CANCELLED).filter(
        scheduled_at__gte=timezone.now() - timezone.timedelta(hours=6)).order_by("scheduled_at")
    offer = application.offers.filter(status__in=[Offer.Status.SENT, Offer.Status.REVIEW_REQUESTED, Offer.Status.ACCEPTED]).first()
    checklist = document_checklist(application) if application.stage == Stage.DOCUMENTS and application.is_open else None
    return render(request, "careers/hub.html", {
        "app": application, "c": application.candidate, "steps": steps, "headline": headline,
        "explanation": explanation, "interviews": interviews, "offer": offer, "checklist": checklist,
        "doc_form": CandidateDocumentForm(), "offer_form": OfferResponseForm(), "interview_form": InterviewResponseForm(),
        "medical": application.medicals.filter(result="scheduled").first() if application.stage == Stage.MEDICAL else None,
    })


@require_POST
def hub_interview(request, token, interview_id):
    application = _application_by_token(token)
    interview = get_object_or_404(Interview, pk=interview_id, application=application)
    form = InterviewResponseForm(request.POST)
    if form.is_valid():
        candidate_interview_response(interview, form.cleaned_data["response"], form.cleaned_data["note"])
        messages.success(request, "Thank you — the hiring team has been notified.")
    return redirect("careers:hub", token=token)


@require_POST
def hub_document(request, token):
    application = _application_by_token(token)
    if not application.is_open:
        raise Http404
    form = CandidateDocumentForm(request.POST, request.FILES)
    if form.is_valid():
        uploaded = form.cleaned_data["file"]
        doc = save_document(application.candidate, content=uploaded.read(), filename=uploaded.name,
                            doc_type=form.cleaned_data["doc_type"], application=application)
        log(f"Candidate uploaded {doc.get_doc_type_display()}.", verb="documents", application=application)
        checklist = document_checklist(application)
        if not checklist["outstanding"]:
            from core.notify import hr_team, notify

            notify(hr_team(), f"Documents ready for review: {application.candidate.full_name}",
                   "All requested documents have been uploaded.", url=application.get_absolute_url() + "#documents",
                   email=False)
        messages.success(request, "Document uploaded. Thank you.")
    else:
        for errors in form.errors.values():
            messages.error(request, " ".join(errors))
    return redirect("careers:hub", token=token)


@require_POST
def hub_offer(request, token, offer_id):
    application = _application_by_token(token)
    offer = get_object_or_404(Offer, pk=offer_id, application=application)
    form = OfferResponseForm(request.POST)
    if form.is_valid():
        try:
            candidate_offer_response(offer, form.cleaned_data["response"], comment=form.cleaned_data["comment"],
                                     counter_salary=form.cleaned_data.get("counter_salary"))
            messages.success(request, {"accept": "Congratulations! Your acceptance has been recorded.",
                                       "review": "Your request has been sent for review. We will get back to you.",
                                       "decline": "Your response has been recorded. Thank you for your time."}[
                form.cleaned_data["response"]])
        except WorkflowError as exc:
            messages.error(request, str(exc))
    return redirect("careers:hub", token=token)
