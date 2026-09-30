from django.conf import settings

from core.ai import ai_enabled


def portal(request):
    context = {
        "COMPANY_NAME": settings.COMPANY_NAME,
        "COMPANY_SHORT_NAME": settings.COMPANY_SHORT_NAME,
        "PORTAL_NAME": settings.PORTAL_NAME,
        "AI_ENABLED": ai_enabled(),
    }
    user = getattr(request, "user", None)
    if user is not None and user.is_authenticated:
        context["unread_notifications"] = user.notifications.filter(is_read=False).count()
        context["recent_notifications"] = user.notifications.all()[:6]
    return context
