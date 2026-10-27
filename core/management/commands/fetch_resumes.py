"""Save resumes from the website into candidates' folders as PDFs. Safe to stop and run again."""

from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from candidates.resumes import Fetcher, acquire_lock, convert_stored, pending, release_lock


class Command(BaseCommand):
    help = ("Download each candidate's resume from the link in the website applications dump and file it as a PDF "
            "in their folder. Runs until all are done; stop it at any time and it carries on next time.")

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, help="Save at most this many resumes this time.")
        parser.add_argument("--retry", action="store_true", help="Also try again the links that failed today.")
        parser.add_argument("--workers", type=int, default=6, help="Downloads at the same time (default 6).")
        parser.add_argument("--no-read", action="store_true",
                            help="Do not fill empty skills and experience from the resumes.")
        parser.add_argument("--report-dir", default=str(Path(settings.BASE_DIR) / "import-reports"))

    def handle(self, *args, **options):
        queue = pending(retry_failed=options["retry"])
        if options["limit"]:
            queue = queue[:options["limit"]]
        if not acquire_lock():
            self.stdout.write("Resumes are already being saved in another window. Wait for it to finish, or close it "
                              "and run this again.")
            return
        fetcher = Fetcher(read=not options["no_read"], workers=max(1, options["workers"]), log=self.stdout.write)
        try:
            converted = convert_stored(log=self.stdout.write)
            if converted["converted"]:
                self.stdout.write(f"CVs turned into PDF: {converted['converted']:,}")
            stats = fetcher.run(queue)
        except KeyboardInterrupt:
            self.stdout.write("Stopped. Run it again to carry on.")
            stats = fetcher.stats
        finally:
            release_lock()
        if fetcher.rows:
            path = fetcher.write_report(options["report_dir"])
            self.stdout.write(f"Report: {path}")
        left = pending(retry_failed=True).count()
        self.stdout.write(self.style.SUCCESS(
            f"Saved {stats['saved']:,}; already in the folder {stats['already there']:,}; not saved {stats['not saved']:,}. "
            f"Still to do (including ones to try again later): {left:,}."))
