"""In-app notifications and email, in one call."""

from __future__ import annotations

import logging
from collections.abc import Iterable

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

from .models import Notification

logger = logging.getLogger(__name__)


def absolute(url: str) -> str:
    if not url or url.startswith("http"):
        return url
    return f"{settings.SITE_URL}{url}"


def send_email(to: Iterable[str], subject: str, body: str, *, cc: Iterable[str] = (), attachments=None,
               action_url: str = "", action_label: str = "Open in portal") -> bool:
    recipients = sorted({addr for addr in to if addr})
    if not recipients:
        return False
    context = {
        "subject": subject,
        "body": body,
        "action_url": absolute(action_url),
        "action_label": action_label,
        "company": settings.COMPANY_NAME,
        "portal": settings.PORTAL_NAME,
    }
    text = body + (f"\n\n{action_label}: {absolute(action_url)}" if action_url else "")
    text += f"\n\n— {settings.COMPANY_NAME} · {settings.PORTAL_NAME}"
    message = EmailMultiAlternatives(
        subject=f"[{settings.COMPANY_SHORT_NAME} Recruitment] {subject}",
        body=text,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=recipients,
        cc=sorted({addr for addr in cc if addr and addr not in recipients}),
    )
    message.attach_alternative(render_to_string("emails/base.html", context), "text/html")
    for filename, content, mimetype in attachments or []:
        message.attach(filename, content, mimetype)
    try:
        message.send()
        return True
    except Exception:  # email problems must never break the workflow
        logger.exception("Failed to send email '%s' to %s", subject, recipients)
        return False


def notify(users, title: str, message: str = "", *, url: str = "", level: str = "info", email: bool = True,
           attachments=None, exclude=None) -> int:
    """Create a bell notification for each user and (optionally) email them."""
    unique = []
    seen = set()
    for user in users or []:
        if user is None or not user.is_active or user.pk in seen or (exclude is not None and user.pk == exclude.pk):
            continue
        seen.add(user.pk)
        unique.append(user)
    Notification.objects.bulk_create(
        [Notification(recipient=u, title=title[:200], message=message, url=url, level=level) for u in unique]
    )
    if email and unique:
        send_email([u.email for u in unique], title, message, attachments=attachments, action_url=url)
    return len(unique)


def hr_team():
    from accounts.models import User

    return list(User.objects.filter(is_active=True, role__in=User.HR_ROLES))


def management_team():
    from accounts.models import User

    return list(User.objects.filter(is_active=True, role=User.Role.MANAGEMENT))


def onboarding_team():
    from accounts.models import User

    return list(User.objects.filter(is_active=True, role=User.Role.ONBOARDING)) or hr_team()


def notify_department(department, title: str, message: str = "", **kwargs) -> int:
    count = notify(department.contacts(), title, message, **kwargs)
    if department.email and kwargs.get("email", True):
        send_email([department.email], title, message, action_url=kwargs.get("url", ""))
    return count
