"""Interview reminders, overdue selection reports and expired offers. Schedule hourly."""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.urls import reverse
from django.utils import timezone

from core.models import Notification
from core.notify import hr_team, notify, send_email
from pipeline.models import Interview, Offer


def not_recently_notified(users, title, hours=24):
    """Safe to run this command often: nobody gets the same chaser twice a day."""
    since = timezone.now() - timedelta(hours=hours)
    recent = set(Notification.objects.filter(title=title, created_at__gte=since).values_list("recipient_id", flat=True))
    return [u for u in users if u.pk not in recent]


class Command(BaseCommand):
    help = "Send interview reminders (24h before), chase missing selection reports and flag expired offers."

    def handle(self, *args, **options):
        now = timezone.now()
        reminded = 0
        upcoming = Interview.objects.filter(status=Interview.Status.SCHEDULED, reminder_sent_at__isnull=True,
                                            scheduled_at__gt=now, scheduled_at__lte=now + timedelta(hours=24))
        for interview in upcoming.select_related("application__candidate", "application__requisition"):
            app = interview.application
            when = timezone.localtime(interview.scheduled_at).strftime("%A %d %B at %I:%M %p")
            send_email([app.candidate.email], f"Reminder: interview {when}",
                       f"Dear {app.candidate.first_name},\n\nThis is a reminder of your {interview.get_round_display()} "
                       f"for {app.requisition.title} on {when}. Where: {interview.where}.",
                       action_url=app.get_portal_url(), action_label="View details")
            notify(interview.panel.all(), f"Reminder: interview with {app.candidate.full_name} {when}",
                   interview.get_round_display(), url=reverse("pipeline:application", args=[app.pk]))
            interview.reminder_sent_at = now
            interview.save(update_fields=["reminder_sent_at"])
            reminded += 1

        chased = 0
        overdue = Interview.objects.filter(status=Interview.Status.COMPLETED, scheduled_at__lt=now - timedelta(hours=24),
                                           scheduled_at__gt=now - timedelta(days=14))
        for interview in overdue.select_related("application__candidate"):
            app = interview.application
            if not app.is_open:
                continue
            missing = [u for u in interview.panel.all()
                       if not app.evaluations.filter(evaluator=u, submitted_at__isnull=False).exists()]
            title = f"Selection report overdue: {app.candidate.full_name}"
            missing = not_recently_notified(missing, title)
            if missing:
                notify(missing, title,
                       "Please submit your scores so the hiring decision can be made.",
                       url=reverse("pipeline:evaluate", args=[app.pk]) + f"?interview={interview.pk}", level="danger")
                chased += len(missing)

        expired = Offer.objects.filter(status=Offer.Status.SENT, expires_on__lt=timezone.localdate())
        flagged = 0
        for offer in expired.select_related("application__candidate"):
            title = f"Offer expired without response: {offer.application.candidate.full_name}"
            recipients = not_recently_notified(hr_team(), title, hours=24 * 7)
            if not recipients:
                continue
            flagged += 1
            notify(recipients, title,
                   "Follow up with the candidate or move to the next candidate.",
                   url=reverse("pipeline:application", args=[offer.application_id]), level="warning", email=False)
        self.stdout.write(self.style.SUCCESS(
            f"Interview reminders: {reminded}; evaluation chasers: {chased}; expired offers flagged: {flagged}"))
