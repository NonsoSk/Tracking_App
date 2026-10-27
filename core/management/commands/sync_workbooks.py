import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from candidates.resumes import Fetcher, acquire_lock, pending, release_lock
from core import excel_link
from core.models import LinkedWorkbook
from core.workbook_import import WorkbookError


RESUMES_PER_CHECK = 100


class Command(BaseCommand):
    help = ("Keep the portal in step with the linked Excel workbooks: load any that were saved with changes. "
            "Nothing is removed or duplicated, and changes made in the portal are kept.")

    def add_arguments(self, parser):
        parser.add_argument("--link", nargs="+", metavar="FILE", help="Link these .xlsx workbooks (full paths).")
        parser.add_argument("--unlink", action="store_true", help="Stop following every linked workbook.")
        parser.add_argument("--list", action="store_true", help="Show the linked workbooks and when they were loaded.")
        parser.add_argument("--now", action="store_true", help="Load the linked workbooks now even if unchanged.")
        parser.add_argument("--watch", action="store_true",
                            help=f"Keep running and check every EXCEL_SYNC_MINUTES ({settings.EXCEL_SYNC_MINUTES}).")

    def handle(self, *args, **options):
        if options["unlink"]:
            count = LinkedWorkbook.objects.all().delete()[0]
            self.stdout.write(f"Stopped following {count} workbook(s). The records already loaded stay in the portal.")
            return
        if options["link"]:
            try:
                for workbook in excel_link.link(options["link"]):
                    self.stdout.write(self.style.SUCCESS(f"Linked {workbook.path}") + f"\n  Sheets: {workbook.sheets}")
            except WorkbookError as exc:
                raise CommandError(str(exc)) from exc
        if options["list"] or options["link"]:
            self.show()
            if options["list"]:
                return
        if not LinkedWorkbook.objects.exists():
            self.stdout.write("No Excel workbooks are linked. Use --link FILE (or link-excel.bat on Windows).")
            return
        if not options["watch"]:
            self.run_check(force=options["now"])
            return
        minutes = max(1, settings.EXCEL_SYNC_MINUTES)
        self.stdout.write(f"Watching {LinkedWorkbook.objects.count()} Excel workbook(s); checking every {minutes} "
                          "minute(s). Keep this window open (it can stay minimised). Press Ctrl+C to stop.")
        force = options["now"]
        try:
            while True:
                self.run_check(force=force)
                force = False
                # Wake up early when someone asks for a refresh on the Excel link page.
                for _ in range(minutes * 6):
                    time.sleep(10)
                    if LinkedWorkbook.objects.filter(refresh_requested=True).exists():
                        break
        except KeyboardInterrupt:
            self.stdout.write("Stopped watching.")

    def run_check(self, *, force):
        stamp = timezone.localtime().strftime("%H:%M")
        log = lambda msg: self.stdout.write(f"[{stamp}] {msg}")  # noqa: E731
        results = excel_link.check(force=force, log=log)
        for workbook, result in results.items():
            if result.report_path:
                self.stdout.write(f"[{stamp}] Report for {workbook.name}: {result.report_path}")
        # Resumes of applicants new in the applications dump, a few at a time (load-resumes.bat does many at once).
        queue = pending()[:RESUMES_PER_CHECK]
        if queue and acquire_lock():
            try:
                Fetcher(log=lambda msg: None).run(queue)
            finally:
                release_lock()

    def show(self):
        for wb in LinkedWorkbook.objects.all():
            synced = timezone.localtime(wb.synced_at).strftime("%d %b %Y %H:%M") if wb.synced_at else "not yet"
            self.stdout.write(f"- {wb.path}\n  {wb.get_state_display()} · last loaded {synced}"
                              + (f"\n  {wb.message}" if wb.message else ""))
