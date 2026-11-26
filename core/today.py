"""What a recruiter's day starts with, on Home: what arrived, what is waiting for a person, and what is wrong."""

from __future__ import annotations

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone


def today(user) -> dict | None:
    if not user.is_hr:
        return None
    from intake.models import Receipt
    from intake.worker import status
    from pipeline.models import Application

    from .models import LinkedWorkbook, WatchedFolder

    start = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
    cvs = Receipt.objects.filter(kind=Receipt.Kind.CV)
    arrivals = {
        "cvs_added": cvs.filter(finished_at__gte=start, outcome__in=["added", "updated"]).count(),
        "cvs_received": cvs.filter(received_at__gte=start).count(),
        "applications": Application.objects.filter(applied_at__gte=start).count(),
        "being_read": cvs.filter(status__in=[Receipt.Status.RECEIVED, Receipt.Status.PROCESSING]).count(),
    }
    open_apps = Application.objects.filter(status__in=[Application.Status.ACTIVE, Application.Status.ON_HOLD],
                                           matched_at__isnull=False)
    to_review = [a for a in open_apps.filter(reviews__isnull=True).only("id", "match_breakdown", "matched_at")
                 .iterator(chunk_size=500) if a.match_verdict.get("needs_review")]
    action = {
        "files": cvs.filter(status=Receipt.Status.NEEDS_REVIEW).count(),
        "matches": len(to_review),
        "eligibility": sum(1 for a in open_apps.filter(eligibility="").select_related("candidate")[:2000]
                           if a.needs_eligibility_call),
    }
    problems = []
    worker = status()
    if (WatchedFolder.objects.exists() or LinkedWorkbook.objects.exists()) and not worker["online"]:
        problems.append(("The background worker is not running: linked folders and workbooks are not being read.",
                         reverse("candidates:intake") + "#folders"))
    for folder in WatchedFolder.objects.exclude(state__in=[WatchedFolder.State.OK, WatchedFolder.State.PENDING]):
        problems.append((f"Folder '{folder.name}': {folder.get_state_display().lower()}. {folder.message}",
                         reverse("candidates:intake") + "#folders"))
    for folder in WatchedFolder.objects.filter(state=WatchedFolder.State.PENDING,
                                               created_at__lt=timezone.now() - timedelta(minutes=5)):
        problems.append((f"Folder '{folder.name}' has not been opened yet: {folder.message}",
                         reverse("candidates:intake") + "#folders"))
    for book in LinkedWorkbook.objects.exclude(state__in=[LinkedWorkbook.State.OK, LinkedWorkbook.State.WAITING]):
        problems.append((f"Workbook {book.name}: {book.get_state_display().lower()}. {book.message}",
                         reverse("core:excel_link")))
    failed = cvs.filter(status=Receipt.Status.FAILED).count()
    if failed:
        problems.append((f"{failed} received file{'s' if failed != 1 else ''} could not be processed.",
                         reverse("candidates:intake") + "#review"))
    return {"arrivals": arrivals, "action": action, "problems": problems, "worker": worker}
