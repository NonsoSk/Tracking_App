import logging
import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from candidates.resumes import Fetcher, acquire_lock, pending, release_lock
from core import cv_folder, excel_link, excel_updates
from core.models import LinkedWorkbook, PortalUpdatesFile, WatchedFolder
from core.workbook_import import WorkbookError

logger = logging.getLogger(__name__)

RESUMES_PER_CHECK = 100


class Command(BaseCommand):
    help = ("Keep the portal in step with Excel and the CV folder: load linked workbooks saved with changes, read new "
            "CVs from a watched folder, and rewrite 'Portal updates.xlsx' when the portal's data changes. Nothing is "
            "removed or duplicated, and changes made in the portal are kept.")

    def add_arguments(self, parser):
        parser.add_argument("--link", nargs="+", metavar="FILE", help="Link these .xlsx workbooks (full paths).")
        parser.add_argument("--unlink", action="store_true", help="Stop following every linked workbook.")
        parser.add_argument("--list", action="store_true", help="Show the linked workbooks and when they were loaded.")
        parser.add_argument("--now", action="store_true", help="Load the linked workbooks now even if unchanged.")
        parser.add_argument("--watch", action="store_true",
                            help=f"Keep running: workbooks every EXCEL_SYNC_MINUTES ({settings.EXCEL_SYNC_MINUTES}), "
                                 f"the CV folder every CV_FOLDER_SECONDS ({settings.CV_FOLDER_SECONDS}).")

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
        if not options["watch"]:
            if not LinkedWorkbook.objects.exists() and not WatchedFolder.objects.exists():
                self.stdout.write("No Excel workbooks or CV folder are linked yet (Excel link page, or link-excel.bat).")
            self.run_check(force=options["now"])
            return
        minutes = max(1, settings.EXCEL_SYNC_MINUTES)
        folder_seconds = max(15, settings.CV_FOLDER_SECONDS)
        self.stdout.write(f"Keeping the portal in step with Excel (every {minutes} minute(s)) and the CV folder (every "
                          f"{folder_seconds} seconds). Keep this window open (it can stay minimised). Ctrl+C stops it.")
        force, next_books, next_folders = options["now"], 0.0, 0.0
        try:
            while True:
                now = time.monotonic()
                wrote = False
                if now >= next_books or LinkedWorkbook.objects.filter(refresh_requested=True).exists():
                    self.safely(self.check_workbooks, force=force)
                    force, next_books, wrote = False, now + minutes * 60, True
                if now >= next_folders or WatchedFolder.objects.filter(check_requested=True).exists():
                    self.safely(self.check_folders)
                    next_folders, wrote = now + folder_seconds, True
                if wrote or PortalUpdatesFile.objects.filter(write_requested=True).exists():
                    self.safely(self.write_updates)
                time.sleep(10)
        except KeyboardInterrupt:
            self.stdout.write("Stopped watching.")

    def log(self, message):
        self.stdout.write(f"[{timezone.localtime().strftime('%H:%M')}] {message}")

    def safely(self, step, **kwargs):
        """One step failing (a locked file, a network folder that dropped) never stops the watcher."""
        try:
            step(**kwargs)
        except Exception as exc:  # noqa: BLE001
            logger.exception("%s failed", step.__name__)
            self.log(f"{step.__name__.replace('_', ' ')} failed: {exc}. Trying again at the next check.")

    def run_check(self, *, force):
        """One round (the server's scheduler, or sync_workbooks without --watch)."""
        self.safely(self.check_workbooks, force=force)
        self.safely(self.check_folders)
        self.safely(self.write_updates)

    def check_workbooks(self, *, force=False):
        if not LinkedWorkbook.objects.exists():
            return
        results = excel_link.check(force=force, log=self.log)
        for workbook, result in results.items():
            if result.report_path:
                self.log(f"Report for {workbook.name}: {result.report_path}")
        # Resumes of applicants new in the applications dump, a few at a time (load-resumes.bat does many at once).
        queue = pending()[:RESUMES_PER_CHECK]
        if queue and acquire_lock():
            try:
                Fetcher(log=lambda msg: None).run(queue)
            finally:
                release_lock()

    def check_folders(self):
        if WatchedFolder.objects.exists():
            cv_folder.check(log=self.log)

    def write_updates(self):
        state = PortalUpdatesFile.objects.filter(pk=1).first()
        if LinkedWorkbook.objects.exists() or WatchedFolder.objects.exists() or (state and state.write_requested):
            excel_updates.write(log=self.log)

    def show(self):
        for wb in LinkedWorkbook.objects.all():
            synced = timezone.localtime(wb.synced_at).strftime("%d %b %Y %H:%M") if wb.synced_at else "not yet"
            self.stdout.write(f"- {wb.path}\n  {wb.get_state_display()} · last loaded {synced}"
                              + (f"\n  {wb.message}" if wb.message else ""))
        for folder in WatchedFolder.objects.all():
            self.stdout.write(f"- CV folder {folder.path}\n  {folder.get_state_display()} · {folder.files_read} CV(s) read")
