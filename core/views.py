import csv
import io
from datetime import date, datetime, timedelta

from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import Count, Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_POST

from core.notify import notify_department
from pipeline.models import Activity, Application, Interview, Offer, Onboarding, Stage
from pipeline.services import log
from requisitions.models import Requisition

from .forms import EmployeeImportForm
from .models import Department, Employee, Notification
from .permissions import applications_for, hr_required, requisitions_for, role_required, safe_next


@login_required
def dashboard(request):
    user = request.user
    now = timezone.now()
    today = timezone.localdate()
    requisitions = requisitions_for(user)
    applications = applications_for(user)
    active_apps = applications.filter(status__in=[Application.Status.ACTIVE, Application.Status.ON_HOLD])

    stage_counts = {row["stage"]: row["n"] for row in active_apps.order_by().values("stage").annotate(n=Count("id", distinct=True))}
    funnel = [{"stage": s.value, "label": s.label, "count": stage_counts.get(s.value, 0)} for s in Stage if s != Stage.HIRED]
    source_counts = list(applications.values("source").annotate(n=Count("id", distinct=True)).order_by("-n"))
    from candidates.models import Candidate

    source_labels = dict(Candidate.Source.choices)
    for row in source_counts:
        row["label"] = source_labels.get(row["source"], row["source"] or "Other")

    year_start = today.replace(month=1, day=1)
    hires = applications.filter(stage=Stage.HIRED, hired_at__date__gte=year_start)
    hired_durations = [(a.hired_at - a.applied_at).days for a in hires if a.hired_at]
    kpis = {
        "open_requisitions": requisitions.filter(status__in=[Requisition.Status.OPEN, Requisition.Status.APPROVED]).count(),
        "awaiting_approval": requisitions.filter(status__in=[Requisition.Status.SUBMITTED, Requisition.Status.PENDING_MANAGEMENT]).count(),
        "active_candidates": active_apps.count(),
        "interviews_week": Interview.objects.filter(
            application__in=applications, status=Interview.Status.SCHEDULED,
            scheduled_at__gte=now, scheduled_at__lte=now + timedelta(days=7)).count(),
        "offers_pending": Offer.objects.filter(application__in=applications,
                                               status__in=[Offer.Status.SENT, Offer.Status.REVIEW_REQUESTED]).count(),
        "hires_year": hires.count(),
        "avg_days_to_hire": round(sum(hired_durations) / len(hired_durations)) if hired_durations else None,
    }

    my_interviews = Interview.objects.filter(panel=user, status=Interview.Status.SCHEDULED, scheduled_at__gte=now - timedelta(hours=2)) \
        .select_related("application__candidate", "application__requisition")[:8]
    pending_evaluations = [
        i for i in Interview.objects.filter(panel=user, status=Interview.Status.COMPLETED)
        .select_related("application__candidate", "application__requisition")
        if not i.application.evaluations.filter(evaluator=user, submitted_at__isnull=False).exists()
        and i.application.is_open
    ][:8]
    upcoming_interviews = Interview.objects.filter(
        application__in=applications, status=Interview.Status.SCHEDULED, scheduled_at__gte=now - timedelta(hours=2)
    ).select_related("application__candidate", "application__requisition").order_by("scheduled_at")[:8]

    action_requisitions = requisitions.none()
    if user.is_hr:
        action_requisitions = requisitions.filter(status=Requisition.Status.SUBMITTED)
    elif user.is_management:
        action_requisitions = requisitions.filter(status=Requisition.Status.PENDING_MANAGEMENT)
    elif user.is_department_user:
        action_requisitions = requisitions.filter(status__in=[Requisition.Status.DRAFT, Requisition.Status.RETURNED])

    offer_reviews = Offer.objects.filter(status=Offer.Status.REVIEW_REQUESTED).select_related(
        "application__candidate", "application__requisition") if (user.is_management or user.is_hr) else []
    decisions_needed = active_apps.filter(stage=Stage.DECISION, status=Application.Status.ACTIVE) if user.is_hr else []
    onboardings = Onboarding.objects.exclude(status=Onboarding.Status.COMPLETED).select_related(
        "application__candidate", "application__requisition") if user.is_onboarding else []

    horizon = today + timedelta(days=30 * settings.RECRUITMENT["RETIREMENT_ALERT_MONTHS"])
    retirements = Employee.objects.filter(status=Employee.Status.ACTIVE, retirement_date__lte=horizon,
                                          retirement_date__gte=today - timedelta(days=90)).select_related("department")
    if not user.sees_all_departments:
        retirements = retirements.filter(department_id=user.department_id) if user.department_id else retirements.none()

    dept_requisitions = []
    if user.is_department_user or user.is_management or user.is_hr:
        for req in requisitions.filter(status__in=[Requisition.Status.OPEN, Requisition.Status.APPROVED,
                                                   Requisition.Status.ON_HOLD])[:10]:
            counts = {row["stage"]: row["n"] for row in req.applications.filter(
                status__in=[Application.Status.ACTIVE, Application.Status.ON_HOLD]).order_by().values("stage").annotate(n=Count("id"))}
            dept_requisitions.append({"req": req, "counts": counts, "total": sum(counts.values())})

    my_referrals = Application.objects.filter(candidate__referred_by=user).select_related("candidate", "requisition")[:8]
    recent_activity = Activity.objects.filter(
        Q(application__in=applications) | Q(requisition__in=requisitions)
    ).select_related("actor", "application__candidate", "requisition").distinct()[:12]

    # --- Presentation only: arrange what is loaded above for the My tasks screen -------------------
    from core import home
    from core.templatetags.ds import STAGE_SHORT

    hiring = user.is_hr or user.is_department_user or user.is_management
    documents_due = (active_apps.filter(stage=Stage.DOCUMENTS, status=Application.Status.ACTIVE)
                     .select_related("candidate", "requisition")[:8]) if user.is_hr else []
    tasks, task_kinds = home.build_tasks(
        user, action_requisitions=list(action_requisitions[:8]), pending_evaluations=pending_evaluations,
        offer_reviews=list(offer_reviews), decisions_needed=list(decisions_needed[:8]) if decisions_needed else [],
        documents_due=list(documents_due), onboardings=list(onboardings))
    for row in funnel:
        row["short"] = STAGE_SHORT.get(row["stage"], row["label"])
    trends = {}
    if hiring:
        interviews_scope = Interview.objects.filter(application__in=applications).exclude(status=Interview.Status.CANCELLED)
        trends = {
            "roles": home.weekly(requisitions.filter(published_at__gte=now - timedelta(weeks=8)).values_list("published_at", flat=True)),
            "roles_month": requisitions.filter(published_at__gte=now - timedelta(days=30)).count(),
            "candidates": home.weekly(applications.filter(applied_at__gte=now - timedelta(weeks=8)).values_list("applied_at", flat=True)),
            "candidates_week": applications.filter(applied_at__gte=now - timedelta(days=7)).count(),
            "interviews": home.weekly(interviews_scope.filter(scheduled_at__gte=now - timedelta(weeks=7), scheduled_at__lte=now + timedelta(weeks=2))
                                      .values_list("scheduled_at", flat=True), ahead=1),
            "interviews_today": interviews_scope.filter(scheduled_at__date=today, status=Interview.Status.SCHEDULED).count(),
            "offers": home.weekly(Offer.objects.filter(application__in=applications, sent_at__gte=now - timedelta(weeks=8)).values_list("sent_at", flat=True)),
            "offers_review": Offer.objects.filter(application__in=applications, status=Offer.Status.REVIEW_REQUESTED).count(),
        }
        trends["roles_delta"] = f"+{trends['roles_month']} this month" if trends["roles_month"] else "None new this month"
        trends["candidates_delta"] = f"+{trends['candidates_week']} this week" if trends["candidates_week"] else "None new this week"
        trends["interviews_delta"] = f"{trends['interviews_today']} today" if trends["interviews_today"] else "None today"
        trends["offers_delta"] = f"{trends['offers_review']} in review" if trends["offers_review"] else "Awaiting replies"
    calendar = Interview.objects.filter(status=Interview.Status.SCHEDULED, scheduled_at__date__gte=today,
                                        scheduled_at__date__lt=today + timedelta(days=7))
    calendar = calendar.filter(application__in=applications) if hiring else calendar.filter(panel=user)
    week = home.week_calendar(calendar.select_related("application__candidate", "application__requisition")
                              .prefetch_related("panel").order_by("scheduled_at").distinct())
    sent_today = Interview.objects.filter(application__in=applications)
    automation = {"invites": sent_today.filter(invite_sent_at__date=today).count(),
                  "reminders": sent_today.filter(reminder_sent_at__date=today).count()}

    return render(request, "core/dashboard.html", {
        "tasks": tasks, "task_kinds": task_kinds, "trends": trends, "week": week, "automation": automation,
        "hiring": hiring, "greeting": home.greeting(now), "summary": home.summary_line(len(tasks)),
        "funnel_max": max([f["count"] for f in funnel] + [1]), "week_has_events": any(d["events"] for d in week),
        "kpis": kpis, "funnel": funnel, "source_counts": source_counts, "my_interviews": my_interviews,
        "pending_evaluations": pending_evaluations, "upcoming_interviews": upcoming_interviews,
        "action_requisitions": action_requisitions[:8], "offer_reviews": offer_reviews,
        "decisions_needed": decisions_needed[:8] if decisions_needed else [], "onboardings": onboardings,
        "retirements": retirements[:8], "dept_requisitions": dept_requisitions, "my_referrals": my_referrals,
        "recent_activity": recent_activity, "stages": [s for s in Stage if s != Stage.HIRED],
    })


@login_required
def notifications(request):
    items = request.user.notifications.all()[:100]
    return render(request, "core/notifications.html", {"items": items})


@login_required
def open_notification(request, pk):
    item = get_object_or_404(Notification, pk=pk, recipient=request.user)
    item.is_read = True
    item.save(update_fields=["is_read"])
    return redirect(item.url or "core:notifications")


@login_required
@require_POST
def read_all_notifications(request):
    request.user.notifications.filter(is_read=False).update(is_read=True)
    return redirect(safe_next(request, "core:notifications"))


# ---------------------------------------------------------------------------
# Staff, retirements and replacements
# ---------------------------------------------------------------------------
@role_required("is_hr", "is_department_user", "is_management")
def employees(request):
    user = request.user
    qs = Employee.objects.select_related("department")
    if not user.sees_all_departments:
        qs = qs.filter(department_id=user.department_id)
    view = request.GET.get("view", "retiring")
    months = int(request.GET.get("months") or settings.RECRUITMENT["RETIREMENT_ALERT_MONTHS"])
    today = timezone.localdate()
    if view == "retiring":
        qs = qs.filter(status=Employee.Status.ACTIVE, retirement_date__lte=today + timedelta(days=30 * months))
        qs = qs.order_by("retirement_date")
    elif view == "exits":
        qs = qs.exclude(status=Employee.Status.ACTIVE).order_by("-exit_date")
    department = request.GET.get("department")
    if department and user.sees_all_departments:
        qs = qs.filter(department_id=department)
    q = request.GET.get("q", "").strip()
    if q:
        qs = qs.filter(Q(first_name__icontains=q) | Q(last_name__icontains=q) | Q(staff_id__icontains=q) |
                       Q(job_title__icontains=q))
    open_replacements = set(Requisition.objects.exclude(
        status__in=[Requisition.Status.CANCELLED, Requisition.Status.CLOSED]).values_list("replacing_employee_id", flat=True))
    return render(request, "core/employees.html", {
        "employees": qs[:300], "view": view, "months": months, "q": q,
        "departments": Department.objects.all(), "department": department,
        "open_replacements": open_replacements, "today": today,
    })


@hr_required
@require_POST
def notify_replacement(request, pk):
    employee = get_object_or_404(Employee, pk=pk)
    if not employee.department:
        messages.error(request, "This employee has no department.")
        return redirect("core:employees")
    if employee.status == Employee.Status.ACTIVE and employee.retirement_date:
        headline = f"{employee.full_name} retires on {employee.retirement_date:%d %b %Y}"
        body = (f"{employee.full_name} ({employee.job_title}) is due to retire on {employee.retirement_date:%d %B %Y}. "
                "Do you need a replacement? You can raise a replacement requisition in one click.")
    else:
        headline = f"{employee.full_name} has left ({employee.get_status_display()})"
        body = (f"{employee.full_name} ({employee.job_title}) is recorded as {employee.get_status_display().lower()}. "
                "Do you need a replacement? You can raise a replacement requisition in one click.")
    url = reverse("requisitions:create") + f"?replace={employee.pk}"
    sent = notify_department(employee.department, headline, body, url=url, level="warning")
    employee.replacement_notified_at = timezone.now()
    employee.save(update_fields=["replacement_notified_at"])
    messages.success(request, f"{employee.department} notified ({sent} people).")
    return redirect(safe_next(request, "core:employees"))


def _parse_date(value):
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(str(value).strip(), fmt).date()
        except ValueError:
            continue
    return None


def read_table(uploaded) -> list[dict]:
    """Rows from an .xlsx or .csv upload as dicts keyed by lower-case header."""
    name = uploaded.name.lower()
    if name.endswith(".csv"):
        text = uploaded.read().decode("utf-8-sig", errors="ignore")
        reader = csv.DictReader(io.StringIO(text))
        return [{(k or "").strip().lower(): v for k, v in row.items()} for row in reader]
    from openpyxl import load_workbook

    wb = load_workbook(uploaded, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(h or "").strip().lower() for h in rows[0]]
    return [dict(zip(headers, row)) for row in rows[1:] if any(cell not in (None, "") for cell in row)]


@hr_required
def import_employees(request):
    form = EmployeeImportForm(request.POST or None, request.FILES or None)
    if request.method == "POST" and form.is_valid():
        created = updated = skipped = 0
        departments = {d.name.lower(): d for d in Department.objects.all()}
        departments.update({d.code.lower(): d for d in Department.objects.all()})
        for row in read_table(form.cleaned_data["file"]):
            staff_id = str(row.get("staff_id") or row.get("staff id") or "").strip()
            if not staff_id:
                skipped += 1
                continue
            dept_key = str(row.get("department") or "").strip().lower()
            status = str(row.get("status") or "active").strip().lower()
            defaults = {
                "first_name": str(row.get("first_name") or row.get("first name") or "").strip(),
                "last_name": str(row.get("last_name") or row.get("last name") or row.get("surname") or "").strip(),
                "email": str(row.get("email") or "").strip(),
                "department": departments.get(dept_key),
                "job_title": str(row.get("job_title") or row.get("job title") or "").strip(),
                "grade": str(row.get("grade") or "").strip(),
                "date_of_birth": _parse_date(row.get("date_of_birth") or row.get("date of birth")),
                "date_of_employment": _parse_date(row.get("date_of_employment") or row.get("date of employment")),
                "status": status if status in Employee.Status.values else Employee.Status.ACTIVE,
            }
            _, was_created = Employee.objects.update_or_create(staff_id=staff_id, defaults=defaults)
            created += was_created
            updated += not was_created
        messages.success(request, f"Imported staff list: {created} added, {updated} updated, {skipped} skipped.")
        return redirect("core:employees")
    return render(request, "core/import_employees.html", {"form": form})


@hr_required
@require_POST
def record_exit(request, pk):
    employee = get_object_or_404(Employee, pk=pk)
    status = request.POST.get("status")
    if status in Employee.Status.values and status != Employee.Status.ACTIVE:
        employee.status = status
        employee.exit_date = _parse_date(request.POST.get("exit_date")) or timezone.localdate()
        employee.save()
        log(f"{employee.full_name} recorded as {employee.get_status_display().lower()}.", verb="employee", actor=request.user)
        messages.success(request, f"{employee.full_name} marked as {employee.get_status_display().lower()}.")
    return redirect(safe_next(request, "core:employees"))


@login_required
def styleguide(request):
    """Living style guide: every design token and component, light and dark side by side."""
    from . import styleguide as guide

    return render(request, "ds/styleguide.html", guide.context())


def _terms_filter(query, fields):
    """Every word must match one of the fields, so "chinedu okafor" finds Chinedu Okafor."""
    condition = Q()
    for term in query.split()[:5]:
        any_field = Q()
        for field in fields:
            any_field |= Q(**{f"{field}__icontains": term})
        condition &= any_field
    return condition


@login_required
def palette_search(request):
    """Live results for the command palette. Uses the same access rules as the list pages."""
    from candidates.models import Candidate

    query = request.GET.get("q", "").strip()[:80]
    user = request.user
    groups = []
    if len(query) >= 2:
        apps = (applications_for(user).select_related("candidate", "requisition")
                .filter(_terms_filter(query, ["candidate__first_name", "candidate__last_name", "candidate__email", "reference"]))
                .order_by("-applied_at")[:5])
        if apps:
            groups.append({"title": "Applications", "kind": "application", "items": [
                {"label": a.candidate.full_name or a.reference, "hint": f"{a.requisition.title} · {a.get_stage_display()}",
                 "url": reverse("pipeline:application", args=[a.pk])} for a in apps]})
        if user.is_hr:
            people = (Candidate.objects.filter(_terms_filter(query, ["first_name", "last_name", "email", "phone"]))
                      .order_by("-id")[:5])
            if people:
                groups.append({"title": "Candidates", "kind": "candidate", "items": [
                    {"label": c.full_name or c.email or f"Candidate {c.pk}", "hint": c.current_job_title or c.email or "",
                     "url": reverse("candidates:detail", args=[c.pk])} for c in people]})
        roles = requisitions_for(user).filter(_terms_filter(query, ["title", "reference", "department__name"]))[:5]
        if roles:
            groups.append({"title": "Roles", "kind": "role", "items": [
                {"label": r.title, "hint": f"{r.reference} · {r.get_status_display()}",
                 "url": reverse("requisitions:detail", args=[r.pk])} for r in roles]})
    return JsonResponse({"query": query, "groups": groups})
