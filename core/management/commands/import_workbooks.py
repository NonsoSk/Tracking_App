import getpass
import sys
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q

from accounts.models import User
from core.workbook_import import WorkbookError, WorkbookImporter


class Command(BaseCommand):
    help = ("Load the recruitment workbooks (CV file, recruitment master workbook and, optionally, the website "
            "applications dump). With --replace, every existing record, demo data included, is removed first.")

    def add_arguments(self, parser):
        parser.add_argument("files", nargs="+", help="The .xlsx workbooks, in any order.")
        parser.add_argument("--replace", action="store_true",
                            help="Remove every existing record first, so only the workbooks' records remain.")
        parser.add_argument("--report-dir", default=str(Path(settings.BASE_DIR) / "import-reports"),
                            help="Folder for the import report (default: import-reports next to the portal).")
        parser.add_argument("--no-input", action="store_true", help="Do not ask to create a sign-in account.")

    def handle(self, *args, **options):
        for name in options["files"]:
            if not Path(name).is_file():
                raise CommandError(f"File not found: {name}")
        # Replacing everything needs every record sheet; adding to the portal can take any of them.
        importer = WorkbookImporter(options["files"], replace=options["replace"], report_dir=options["report_dir"],
                                    log=self.stdout.write, require_all=options["replace"])
        try:
            result = importer.run()
        except WorkbookError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Import finished."))
        if result.removed:
            self.stdout.write("Removed before import: " + ", ".join(
                f"{n:,} {k}" for k, n in result.removed.items() if n) + ".")
        for key, value in sorted(result.counts.items()):
            self.stdout.write(f"  {key}: {value:,}")
        self.stdout.write(f"  values not used (see report): {len(result.issues):,}")
        self.stdout.write(f"  contacts shared by different names (see report): {len(result.shared_contacts):,}")
        self.stdout.write(f"  names used by more than one person (see report): {len(result.same_names):,}")
        if result.applications_held:
            self.stdout.write(f"  website applications held for checking (see report): {len(result.applications_held):,}")
        if result.report_path:
            self.stdout.write(f"Report: {result.report_path}")

        has_admin = User.objects.filter(is_active=True).filter(
            Q(is_superuser=True) | Q(role=User.Role.HR_ADMIN)).exists()
        if not has_admin:
            if options["no_input"] or not sys.stdin.isatty():
                self.stdout.write(self.style.WARNING(
                    "No HR Admin account exists. Create one with: python manage.py createsuperuser"))
            else:
                self.create_admin()

    def create_admin(self):
        self.stdout.write("")
        self.stdout.write("Create your own sign-in for the portal (HR Admin).")
        username = ""
        while not username:
            username = input("Username: ").strip()
            if User.objects.filter(username=username).exists():
                self.stdout.write("That username is taken.")
                username = ""
        first = input("First name: ").strip()
        last = input("Last name: ").strip()
        email = input("Email (optional): ").strip()
        password = ""
        while not password:
            first_try = getpass.getpass("Password (typing is hidden): ")
            if len(first_try) < 8:
                self.stdout.write("Use at least 8 characters.")
                continue
            if getpass.getpass("Password again: ") != first_try:
                self.stdout.write("The passwords did not match.")
                continue
            password = first_try
        User.objects.create_superuser(username, email, password, first_name=first, last_name=last,
                                      role=User.Role.HR_ADMIN)
        self.stdout.write(self.style.SUCCESS(f"Account {username} created. Sign in with it."))
