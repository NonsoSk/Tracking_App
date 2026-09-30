"""Who can see what. Every list and detail view goes through these helpers."""

from functools import wraps

from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.db.models import Q


def role_required(*checks):
    """Decorator: user must satisfy at least one of the given property names."""

    def decorator(view):
        @login_required
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            if request.user.is_superuser or any(getattr(request.user, check, False) for check in checks):
                return view(request, *args, **kwargs)
            raise PermissionDenied

        return wrapped

    return decorator


hr_required = role_required("is_hr")


def requisitions_for(user):
    from requisitions.models import Requisition

    qs = Requisition.objects.select_related("department", "raised_by", "hr_owner")
    if user.sees_all_departments:
        return qs
    q = Q(raised_by=user)
    if user.department_id:
        q |= Q(department_id=user.department_id)
    q |= Q(applications__interviews__panel=user)
    return qs.filter(q).distinct()


def applications_for(user):
    from pipeline.models import Application

    qs = Application.objects.select_related("candidate", "requisition", "requisition__department")
    if user.sees_all_departments or user.is_onboarding:
        return qs
    q = Q(interviews__panel=user) | Q(evaluations__evaluator=user)
    if user.is_department_user and user.department_id:
        q |= Q(requisition__department_id=user.department_id)
    return qs.filter(q).distinct()


def can_view_requisition(user, requisition) -> bool:
    return requisitions_for(user).filter(pk=requisition.pk).exists()


def can_view_application(user, application) -> bool:
    return applications_for(user).filter(pk=application.pk).exists()


def can_view_candidate(user, candidate) -> bool:
    if user.sees_all_departments or user.is_onboarding:
        return True
    if candidate.referred_by_id == user.pk:
        return True
    return applications_for(user).filter(candidate=candidate).exists()


def safe_next(request, fallback, value=None):
    """Redirect target from a form's `next` (or the referrer) — only if it points back to this site."""
    from django.shortcuts import resolve_url
    from django.utils.http import url_has_allowed_host_and_scheme

    target = value if value is not None else request.POST.get("next")
    if target and url_has_allowed_host_and_scheme(target, allowed_hosts={request.get_host()},
                                                  require_https=request.is_secure()):
        return target
    return resolve_url(fallback)


def ensure(condition: bool):
    if not condition:
        raise PermissionDenied
