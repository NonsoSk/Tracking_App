"""Candidate summaries that HR set to go to departments every day or every week. Safe to run often."""

from django.core.management.base import BaseCommand

from pipeline.services import WorkflowError
from requisitions.models import Requisition
from requisitions.summary import is_due, send_summary


class Command(BaseCommand):
    help = "Email each department the candidate summary for vacancies set to send it daily or weekly."

    def handle(self, *args, **options):
        sent = 0
        due = Requisition.objects.exclude(summary_frequency=Requisition.SummaryFrequency.OFF).filter(
            status__in=Requisition.ACTIVE_STATUSES, applications__isnull=False).distinct().select_related("department")
        for requisition in due:
            if not is_due(requisition):
                continue
            try:
                send_summary(requisition)
                sent += 1
            except WorkflowError as exc:
                self.stderr.write(f"{requisition.reference}: {exc}")
        self.stdout.write(f"Candidate summaries sent: {sent}")
