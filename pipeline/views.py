import mimetypes
import os
from decimal import Decimal

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_POST

from core import ai
from core.permissions import applications_for, can_view_application, ensure, hr_required, role_required

from . import services
from .forms import (DecisionForm, EvaluationForm, InterviewForm, ManagementReviewForm, MedicalForm, MedicalResultForm,
                    MoveStageForm, OfferForm, OnboardingForm, OnboardingTaskForm, StatusForm)
from .ics import interview_ics
from .matching import score_application
from .models import (STAGE_ICONS, Application, Evaluation, EvaluationCriterion, EvaluationScore, Interview,
                     MedicalCheck, Offer, Onboarding, OnboardingTask, Stage)
from .services import WorkflowError


def _get_application(request, pk):
    application = get_object_or_404(
        Application.objects.select_related("candidate", "requisition", "requisition__department", "decided_by"), pk=pk)
    ensure(can_view_application(request.user, application))
    return application


@login_required
def application_list(request):
    qs = applications_for(request.user).select_related("candidate", "requisition", "requisition__department")
    filters = {k: request.GET.get(k, "") for k in ("q", "stage", "status", "requisition", "grade")}
    if filters["q"]:
        q = filters["q"]
        qs = qs.filter(Q(candidate__first_name__icontains=q) | Q(candidate__last_name__icontains=q) |
                       Q(reference__icontains=q) | Q(candidate__email__icontains=q))
    if filters["stage"]:
        qs = qs.filter(stage=filters["stage"])
    if filters["status"]:
        qs = qs.filter(status=filters["status"])
    else:
        qs = qs.filter(status__in=[Application.Status.ACTIVE, Application.Status.ON_HOLD])
    if filters["requisition"]:
        qs = qs.filter(requisition_id=filters["requisition"])
    if filters["grade"]:
        qs = qs.filter(match_grade=filters["grade"])
    from core.permissions import requisitions_for

    return render(request, "pipeline/application_list.html", {
        "applications": qs.order_by("requisition_id", "-match_score")[:400], "filters": filters,
        "stages": Stage.choices, "statuses": Application.Status.choices,
        "requisitions": requisitions_for(request.user).exclude(status__in=["draft", "cancelled"]),
    })


@login_required
def application_detail(request, pk):
    application = _get_application(request, pk)
    user = request.user
    stages = application.pipeline_stages()
    current = application.stage_index()
    progress = [{"value": s, "label": Stage(s).label, "icon": STAGE_ICONS[s],
                 "state": "done" if i < current else ("current" if i == current else "todo")} for i, s in enumerate(stages)]
    interviews = application.interviews.prefetch_related("panel", "evaluations")
    evaluations = application.evaluations.select_related("evaluator", "interview").prefetch_related("scores__criterion")
    my_interviews = [i for i in interviews if user in i.panel.all()]
    checklist = services.document_checklist(application) if application.stage in {Stage.DOCUMENTS, Stage.OFFER,
                                                                                    Stage.MEDICAL, Stage.ONBOARDING,
                                                                                    Stage.HIRED} else None
    offers = application.offers.all()
    context = {
        "app": application, "c": application.candidate, "req": application.requisition, "progress": progress,
        "interviews": interviews, "evaluations": evaluations, "summary": application.evaluation_summary(),
        "my_interviews": my_interviews, "checklist": checklist, "offers": offers,
        "active_offer": offers.filter(status__in=[Offer.Status.DRAFT, Offer.Status.SENT, Offer.Status.REVIEW_REQUESTED]).first(),
        "medicals": application.medicals.all(), "onboarding": getattr(application, "onboarding", None),
        "documents": application.candidate.documents.all(),
        "activity": application.activities.select_related("actor")[:50],
        "breakdown": application.match_breakdown or {},
        "interview_form": InterviewForm(application=application, initial={"round": _next_round(application)}),
        "decision_form": DecisionForm(), "status_form": StatusForm(), "move_form": MoveStageForm(initial={"stage": application.stage}),
        "offer_form": OfferForm(initial={"job_title": application.requisition.title, "grade": application.requisition.grade,
                                         "start_date": application.requisition.target_start_date}),
        "medical_form": MedicalForm(initial={"facility": "Company clinic"}), "medical_result_form": MedicalResultForm(),
        "next_candidates": services.next_best_candidates(application.requisition) if application.status in {
            Application.Status.WITHDRAWN, Application.Status.REJECTED} or (offers and offers[0].status == Offer.Status.DECLINED) else [],
        "can_manage": user.is_hr,
        "Stage": Stage,
    }
    return render(request, "pipeline/application_detail.html", context)


def _next_round(application):
    done = set(application.interviews.exclude(status=Interview.Status.CANCELLED).values_list("round", flat=True))
    for value, _ in Interview.Round.choices:
        if value not in done:
            return value
    return Interview.Round.HOD


def _back(application, anchor=""):
    return redirect(application.get_absolute_url() + (f"#{anchor}" if anchor else ""))


@hr_required
@require_POST
def move_stage(request, pk):
    application = _get_application(request, pk)
    form = MoveStageForm(request.POST)
    wants_json = request.headers.get("x-requested-with") == "XMLHttpRequest"
    if form.is_valid():
        try:
            stage = form.cleaned_data["stage"]
            if stage == Stage.ONBOARDING and application.stage != Stage.ONBOARDING:
                services.start_onboarding(application, actor=request.user)
            else:
                services.move_to_stage(application, stage, actor=request.user)
            if wants_json:
                return JsonResponse({"ok": True, "stage": application.get_stage_display()})
            messages.success(request, f"Moved to {application.get_stage_display()}.")
        except WorkflowError as exc:
            if wants_json:
                return JsonResponse({"ok": False, "error": str(exc)}, status=400)
            messages.error(request, str(exc))
    return _back(application)


@hr_required
@require_POST
def shortlist(request, pk):
    application = _get_application(request, pk)
    try:
        services.shortlist(application, actor=request.user)
        messages.success(request, f"{application.candidate.full_name} shortlisted.")
    except WorkflowError as exc:
        messages.error(request, str(exc))
    return _back(application)


@hr_required
@require_POST
def change_status(request, pk):
    application = _get_application(request, pk)
    form = StatusForm(request.POST)
    if form.is_valid():
        services.set_status(application, form.cleaned_data["status"], actor=request.user,
                            reason=form.cleaned_data["reason"], email_candidate=form.cleaned_data["email_candidate"])
        messages.success(request, f"Status set to {application.get_status_display()}.")
    return _back(application)


@hr_required
@require_POST
def rescore(request, pk):
    application = _get_application(request, pk)
    score_application(application)
    messages.success(request, f"Re-scored: {application.match_score}% (grade {application.match_grade}).")
    return _back(application, "match")


@hr_required
@require_POST
def ai_summary(request, pk):
    application = _get_application(request, pk)
    if not ai.ai_enabled():
        messages.warning(request, "AI is not configured. Add ANTHROPIC_API_KEY to enable fit summaries.")
        return _back(application, "match")
    c, req = application.candidate, application.requisition
    prompt = (
        f"Role: {req.title} ({req.get_employment_type_display()}), {req.department}.\n"
        f"Requirements: min {req.get_education_level_display()} in {', '.join(req.courses) or 'any course'}; "
        f"{req.min_experience_years}+ years; skills {', '.join(req.required_skills)}; tools {', '.join(req.tools)}; "
        f"certifications {', '.join(req.certifications)}.\n\n"
        f"Candidate: {c.get_highest_qualification_display()} {c.course}, {c.institution}; {c.years_experience} years; "
        f"current role {c.current_job_title} at {c.current_employer}.\nSkills: {', '.join(c.skills)}\n"
        f"Tools: {', '.join(c.tools)}\nCertifications: {', '.join(c.certifications)}\n\nCV text:\n{c.cv_text[:12000]}"
    )
    text = ai.text_request(
        system="You help a hiring manager screen candidates. In at most 120 words give: overall fit, 2-3 strengths, "
               "2-3 gaps or questions to probe at interview. Be factual and neutral; base it only on the CV provided; "
               "ignore age, gender, religion, ethnicity and other protected characteristics.",
        prompt=prompt, max_tokens=2000,
    )
    if text:
        application.ai_summary = text
        application.save(update_fields=["ai_summary"])
        messages.success(request, "AI fit summary added.")
    else:
        messages.error(request, "The AI service did not return a summary. Try again later.")
    return _back(application, "match")


# ---------------------------------------------------------------------------
# Interviews
# ---------------------------------------------------------------------------
@hr_required
def schedule_interview(request, pk):
    application = _get_application(request, pk)
    form = InterviewForm(request.POST or None, application=application, initial={"round": _next_round(application)})
    if request.method == "POST" and form.is_valid():
        data = form.cleaned_data
        try:
            services.schedule_interview(
                application, round=data["round"], scheduled_at=data["scheduled_at"],
                duration_minutes=data["duration_minutes"], mode=data["mode"], location=data["location"],
                meeting_link=data["meeting_link"], panel=data["panel"], instructions=data["instructions"],
                actor=request.user,
            )
            messages.success(request, "Interview scheduled. Invitations with calendar invites were sent to the "
                                      "candidate and panel.")
            return _back(application, "interviews")
        except WorkflowError as exc:
            messages.error(request, str(exc))
    return render(request, "pipeline/interview_form.html", {"form": form, "app": application})


@hr_required
def edit_interview(request, pk):
    interview = get_object_or_404(Interview, pk=pk)
    application = interview.application
    form = InterviewForm(request.POST or None, instance=interview, application=application)
    if request.method == "POST" and form.is_valid():
        data = form.cleaned_data
        services.reschedule_interview(
            interview, scheduled_at=data["scheduled_at"], actor=request.user, round=data["round"],
            duration_minutes=data["duration_minutes"], mode=data["mode"], location=data["location"],
            meeting_link=data["meeting_link"], panel=data["panel"], instructions=data["instructions"],
        )
        messages.success(request, "Interview updated and new invitations sent.")
        return _back(application, "interviews")
    return render(request, "pipeline/interview_form.html", {"form": form, "app": application, "interview": interview})


@hr_required
@require_POST
def cancel_interview(request, pk):
    interview = get_object_or_404(Interview, pk=pk)
    services.cancel_interview(interview, actor=request.user)
    messages.info(request, "Interview cancelled; the candidate and panel were notified.")
    return _back(interview.application, "interviews")


@login_required
@require_POST
def complete_interview(request, pk):
    interview = get_object_or_404(Interview, pk=pk)
    ensure(request.user.is_hr or request.user in interview.panel.all())
    status = request.POST.get("status", Interview.Status.COMPLETED)
    if status in {Interview.Status.COMPLETED, Interview.Status.NO_SHOW}:
        services.complete_interview(interview, status=status, actor=request.user)
        messages.success(request, f"Interview marked {interview.get_status_display().lower()}.")
    if status == Interview.Status.COMPLETED and request.user in interview.panel.all():
        return redirect(reverse("pipeline:evaluate", args=[interview.application_id]) + f"?interview={interview.pk}")
    return _back(interview.application, "interviews")


@login_required
def download_ics(request, pk):
    interview = get_object_or_404(Interview, pk=pk)
    ensure(can_view_application(request.user, interview.application))
    response = HttpResponse(interview_ics(interview), content_type="text/calendar")
    response["Content-Disposition"] = f'attachment; filename="interview-{interview.pk}.ics"'
    return response


@login_required
def my_interviews(request):
    user = request.user
    qs = Interview.objects.select_related("application__candidate", "application__requisition").prefetch_related("panel")
    if not user.is_hr:
        qs = qs.filter(panel=user)
    scope = request.GET.get("scope", "upcoming")
    now = timezone.now()
    if scope == "upcoming":
        qs = qs.filter(scheduled_at__gte=now - timezone.timedelta(hours=3), status=Interview.Status.SCHEDULED).order_by("scheduled_at")
    else:
        qs = qs.filter(Q(scheduled_at__lt=now) | ~Q(status=Interview.Status.SCHEDULED)).order_by("-scheduled_at")
    days = {}
    for interview in qs[:200]:
        days.setdefault(timezone.localtime(interview.scheduled_at).date(), []).append(interview)
    submitted = set(Evaluation.objects.filter(evaluator=user, submitted_at__isnull=False).values_list("application_id", "interview_id"))
    return render(request, "pipeline/interviews.html", {"days": days, "scope": scope, "submitted": submitted})


# ---------------------------------------------------------------------------
# Selection report
# ---------------------------------------------------------------------------
@login_required
def evaluate(request, pk):
    application = _get_application(request, pk)
    user = request.user
    interview = None
    if request.GET.get("interview") or request.POST.get("interview"):
        interview = get_object_or_404(Interview, pk=request.GET.get("interview") or request.POST.get("interview"),
                                      application=application)
    ensure(user.is_hr or application.interviews.filter(panel=user).exists())
    criteria = EvaluationCriterion.objects.filter(is_active=True)
    evaluation = Evaluation.objects.filter(application=application, evaluator=user, interview=interview).first()
    form = EvaluationForm(request.POST or None, criteria=criteria, evaluation=evaluation)
    if request.method == "POST" and form.is_valid():
        with transaction.atomic():
            evaluation = evaluation or Evaluation(application=application, evaluator=user, interview=interview)
            evaluation.remarks = form.cleaned_data["remarks"]
            evaluation.recommendation = form.cleaned_data["recommendation"]
            evaluation.save()
            total = Decimal("0")
            for criterion in criteria:
                marks = form.cleaned_data[f"c_{criterion.pk}"]
                EvaluationScore.objects.update_or_create(evaluation=evaluation, criterion=criterion,
                                                         defaults={"marks": marks})
                total += marks
            evaluation.total = total
            first_submission = evaluation.submitted_at is None
            evaluation.submitted_at = timezone.now()
            evaluation.save()
        if first_submission:
            services.evaluation_submitted(evaluation, actor=user)
        messages.success(request, "Selection report submitted. Thank you.")
        return redirect("pipeline:application", pk=application.pk)
    return render(request, "pipeline/evaluate.html", {
        "app": application, "form": form, "interview": interview, "evaluation": evaluation,
        "max_total": sum(c.max_marks for c in criteria),
    })


@login_required
def selection_report(request, pk):
    application = _get_application(request, pk)
    return render(request, "pipeline/selection_report.html", {
        "app": application, "summary": application.evaluation_summary(),
        "offer": application.offers.filter(status=Offer.Status.ACCEPTED).first() or application.offers.first(),
        "onboarding": getattr(application, "onboarding", None),
        "criteria": EvaluationCriterion.objects.filter(is_active=True),
        "bands": ["E", "VG", "G", "S", "P"],
    })


@login_required
@require_POST
def record_decision(request, pk):
    application = _get_application(request, pk)
    ensure(request.user.is_hr or (request.user.is_department_user and request.user.department_id ==
                                  application.requisition.department_id))
    form = DecisionForm(request.POST)
    if form.is_valid():
        try:
            services.record_decision(application, form.cleaned_data["decision"], notes=form.cleaned_data["notes"],
                                     actor=request.user, email_candidate=form.cleaned_data["email_candidate"])
            messages.success(request, f"Decision recorded: {application.get_decision_display()}.")
        except WorkflowError as exc:
            messages.error(request, str(exc))
    return _back(application)


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------
@hr_required
@require_POST
def request_documents(request, pk):
    application = _get_application(request, pk)
    services.request_documents(application, actor=request.user)
    messages.success(request, "Document request emailed to the candidate.")
    return _back(application, "documents")


@hr_required
@require_POST
def clear_documents(request, pk):
    application = _get_application(request, pk)
    try:
        services.clear_documents(application, actor=request.user, force="force" in request.POST)
        messages.success(request, f"Documents cleared. Next: {application.get_stage_display()}.")
    except WorkflowError as exc:
        messages.error(request, str(exc))
    return _back(application)


# ---------------------------------------------------------------------------
# Offers
# ---------------------------------------------------------------------------
@hr_required
@require_POST
def create_offer(request, pk):
    application = _get_application(request, pk)
    form = OfferForm(request.POST, request.FILES)
    if form.is_valid():
        data = form.cleaned_data
        try:
            offer = services.create_offer(
                application, job_title=data["job_title"], annual_salary=data["annual_salary"], grade=data["grade"],
                benefits=data["benefits"], start_date=data["start_date"], negotiation_notes=data["negotiation_notes"],
                letter=data.get("letter"), actor=request.user,
            )
            if data.get("expires_on"):
                offer.expires_on = data["expires_on"]
                offer.save(update_fields=["expires_on"])
            if "send" in request.POST:
                services.send_offer(offer, actor=request.user)
                messages.success(request, "Offer sent to the candidate.")
            else:
                messages.success(request, "Offer saved as draft.")
        except WorkflowError as exc:
            messages.error(request, str(exc))
    else:
        messages.error(request, "Please correct the offer details: " + "; ".join(
            f"{k}: {' '.join(v)}" for k, v in form.errors.items()))
    return _back(application, "offer")


@hr_required
@require_POST
def send_offer(request, pk):
    offer = get_object_or_404(Offer, pk=pk)
    try:
        services.send_offer(offer, actor=request.user)
        messages.success(request, "Offer sent to the candidate.")
    except WorkflowError as exc:
        messages.error(request, str(exc))
    return _back(offer.application, "offer")


@hr_required
@require_POST
def offer_declined_close(request, pk):
    """After a final decline: close this application and look at the next candidates."""
    offer = get_object_or_404(Offer, pk=pk)
    application = offer.application
    services.set_status(application, Application.Status.WITHDRAWN, actor=request.user,
                        reason=f"Offer declined: {offer.candidate_comment or 'no reason given'}")
    messages.info(request, "Application closed. Pick the next candidate below or re-open the vacancy.")
    return redirect(application.requisition.get_absolute_url() + "?stage=decision&status=open")


@role_required("is_management", "is_hr")
def offer_reviews(request):
    offers = Offer.objects.filter(status=Offer.Status.REVIEW_REQUESTED).select_related(
        "application__candidate", "application__requisition", "application__requisition__department")
    history = Offer.objects.exclude(management_decision="").select_related(
        "application__candidate", "application__requisition", "management_by").order_by("-management_at")[:20]
    return render(request, "pipeline/offer_reviews.html", {"offers": offers, "history": history})


@role_required("is_management", "is_hr")
def offer_review(request, pk):
    offer = get_object_or_404(Offer.objects.select_related("application__candidate", "application__requisition"), pk=pk)
    form = ManagementReviewForm(request.POST or None)
    if request.method == "POST":
        ensure(request.user.is_management or request.user.is_superuser or request.user.role == "hr_admin")
        if form.is_valid():
            data = form.cleaned_data
            try:
                services.management_offer_decision(offer, data["decision"], comment=data["comment"], actor=request.user,
                                                   new_salary=data.get("new_salary"),
                                                   new_benefits=data.get("new_benefits") or None)
                messages.success(request, "Decision recorded and the candidate/HR notified.")
                return redirect("pipeline:offer_reviews")
            except WorkflowError as exc:
                messages.error(request, str(exc))
    application = offer.application
    return render(request, "pipeline/offer_review.html", {
        "offer": offer, "app": application, "form": form, "summary": application.evaluation_summary(),
        "history": application.offers.exclude(pk=offer.pk),
    })


@login_required
def offer_letter(request, pk):
    offer = get_object_or_404(Offer, pk=pk)
    ensure(can_view_application(request.user, offer.application))
    if not offer.letter or not os.path.exists(offer.letter.path):
        raise Http404
    return FileResponse(offer.letter.open("rb"), filename=os.path.basename(offer.letter.name))


# ---------------------------------------------------------------------------
# Medicals & onboarding
# ---------------------------------------------------------------------------
@hr_required
@require_POST
def schedule_medical(request, pk):
    application = _get_application(request, pk)
    form = MedicalForm(request.POST)
    if form.is_valid():
        try:
            services.schedule_medical(application, actor=request.user, **form.cleaned_data)
            messages.success(request, "Medical scheduled and the candidate informed.")
        except WorkflowError as exc:
            messages.error(request, str(exc))
    return _back(application, "medical")


@hr_required
@require_POST
def medical_result(request, pk):
    medical = get_object_or_404(MedicalCheck, pk=pk)
    form = MedicalResultForm(request.POST, request.FILES)
    if form.is_valid():
        services.record_medical_result(medical, form.cleaned_data["result"], notes=form.cleaned_data["notes"],
                                       report=form.cleaned_data.get("report"), actor=request.user)
        messages.success(request, f"Medical result recorded: {medical.get_result_display()}.")
    return _back(medical.application, "medical")


@login_required
def medical_report(request, pk):
    medical = get_object_or_404(MedicalCheck, pk=pk)
    ensure(request.user.is_hr or request.user.is_onboarding)
    if not medical.report:
        raise Http404
    content_type = mimetypes.guess_type(medical.report.name)[0] or "application/octet-stream"
    return FileResponse(medical.report.open("rb"), content_type=content_type)


@role_required("is_onboarding")
def onboarding_list(request):
    items = Onboarding.objects.select_related("application__candidate", "application__requisition",
                                              "application__requisition__department", "officer")
    show = request.GET.get("show", "open")
    if show == "open":
        items = items.exclude(status=Onboarding.Status.COMPLETED)
    return render(request, "pipeline/onboarding_list.html", {"items": items, "show": show})


@role_required("is_onboarding")
def onboarding_detail(request, pk):
    onboarding = get_object_or_404(Onboarding.objects.select_related("application__candidate",
                                                                     "application__requisition"), pk=pk)
    form = OnboardingForm(request.POST or None, instance=onboarding)
    if request.method == "POST" and "save" in request.POST and form.is_valid():
        form.save()
        if onboarding.status == Onboarding.Status.PENDING:
            onboarding.status = Onboarding.Status.IN_PROGRESS
            onboarding.save(update_fields=["status"])
        messages.success(request, "Onboarding details saved.")
        return redirect("pipeline:onboarding", pk=pk)
    return render(request, "pipeline/onboarding_detail.html", {
        "ob": onboarding, "app": onboarding.application, "form": form, "task_form": OnboardingTaskForm(),
        "tasks": onboarding.tasks.select_related("done_by"),
        "documents": onboarding.application.candidate.documents.all(),
    })


@role_required("is_onboarding")
@require_POST
def onboarding_task(request, pk, task_id=None):
    onboarding = get_object_or_404(Onboarding, pk=pk)
    if task_id:
        task = get_object_or_404(OnboardingTask, pk=task_id, onboarding=onboarding)
        task.done = not task.done
        task.done_by = request.user if task.done else None
        task.done_at = timezone.now() if task.done else None
        task.save()
    else:
        form = OnboardingTaskForm(request.POST)
        if form.is_valid():
            OnboardingTask.objects.create(onboarding=onboarding, title=form.cleaned_data["title"],
                                          order=onboarding.tasks.count())
    if onboarding.status == Onboarding.Status.PENDING:
        onboarding.status = Onboarding.Status.IN_PROGRESS
        onboarding.save(update_fields=["status"])
    return redirect("pipeline:onboarding", pk=pk)


@role_required("is_onboarding")
@require_POST
def complete_onboarding(request, pk):
    onboarding = get_object_or_404(Onboarding, pk=pk)
    services.complete_onboarding(onboarding, actor=request.user)
    messages.success(request, f"{onboarding.application.candidate.full_name} is now recorded as hired. Welcome aboard!")
    return redirect("pipeline:onboarding_list")
