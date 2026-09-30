"""Tell departments (and HR) about staff retiring soon. Schedule daily or weekly."""

from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Q
from django.urls import reverse
from django.utils import timezone

from core.models import Employee
from core.notify import hr_team, notify, notify_department


class Command(BaseCommand):
    help = "Notify departments about employees retiring within RETIREMENT_ALERT_MONTHS."

    def add_arguments(self, parser):
        parser.add_argument("--repeat-days", type=int, default=90,
                            help="Re-notify if the last alert is older than this many days (default 90).")

    def handle(self, *args, **options):
        today = timezone.localdate()
        horizon = today + timedelta(days=30 * settings.RECRUITMENT["RETIREMENT_ALERT_MONTHS"])
        cutoff = timezone.now() - timedelta(days=options["repeat_days"])
        due = Employee.objects.filter(
            status=Employee.Status.ACTIVE, retirement_date__lte=horizon, department__isnull=False,
        ).filter(Q(replacement_notified_at__isnull=True) | Q(replacement_notified_at__lt=cutoff)) \
            .exclude(replacement_requisitions__status__in=["submitted", "approved", "open", "pending_management", "filled"]) \
            .select_related("department").distinct()
        count = 0
        for employee in due:
            url = reverse("requisitions:create") + f"?replace={employee.pk}"
            notify_department(
                employee.department,
                f"{employee.full_name} retires on {employee.retirement_date:%d %b %Y}",
                f"{employee.full_name} ({employee.job_title}, staff ID {employee.staff_id}) is due to retire on "
                f"{employee.retirement_date:%d %B %Y}. Do you need a replacement? Raise a requisition in one click.",
                url=url, level="warning",
            )
            employee.replacement_notified_at = timezone.now()
            employee.save(update_fields=["replacement_notified_at"])
            count += 1
        if count:
            notify(hr_team(), f"Retirement alerts sent for {count} employee(s)",
                   "Departments were asked whether they need replacements.", url=reverse("core:employees"), email=False)
        self.stdout.write(self.style.SUCCESS(f"Sent {count} retirement alert(s)."))
