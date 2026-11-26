from django.conf import settings
from django.core.management.base import BaseCommand

from intake.worker import PortalWorker


class Command(BaseCommand):
    help = ("Run the background worker: read the linked workbooks and CV folders as they change, work through the "
            "queue (CVs, workbook saves, OCR, re-assessment) and keep 'Portal updates.xlsx' current. Keep it running "
            "(start-portal.bat does, and the pilot's 'worker' service). Ctrl+C stops it; unfinished work is picked up "
            "again when it starts.")

    def add_arguments(self, parser):
        parser.add_argument("--name", default="", help="A name for this worker (default: WORKER_NAME, or host:pid).")
        parser.add_argument("--no-inputs", action="store_true",
                            help="Do not read the linked folders and workbooks; only work through the queue.")

    def handle(self, *args, **options):
        inputs = False if options["no_inputs"] else settings.PORTAL_INPUTS_ENABLED
        if not settings.PORTAL_INPUTS_ENABLED and not options["no_inputs"]:
            self.stdout.write("PORTAL_INPUTS_ENABLED is false (or this is a rehearsal): the linked folders and "
                              "workbooks are not read.")
        PortalWorker(options["name"] or None, inputs=inputs, log=self.stdout.write).run_forever()
