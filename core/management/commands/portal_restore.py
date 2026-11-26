import json

from django.core.management.base import BaseCommand, CommandError

from core import backup


class Command(BaseCommand):
    help = ("Restore a backup made by portal_backup into a NEW, EMPTY installation (migrated database, empty media "
            "folder), then check record counts and open every stored file. It refuses to run on a portal that "
            "already holds accounts or candidates.")

    def add_arguments(self, parser):
        parser.add_argument("archive")
        parser.add_argument("--json", action="store_true", help="Print only the check's findings, as JSON.")

    def handle(self, *args, **options):
        try:
            findings = backup.restore(options["archive"], log=lambda *_: None)
        except backup.BackupError as exc:
            raise CommandError(str(exc)) from exc
        if options["json"]:
            self.stdout.write(json.dumps(findings))
            return
        self.stdout.write(json.dumps(findings, indent=1))
        if not findings["ok"]:
            raise CommandError("The restore does not match the backup: see above.")
        self.stdout.write(self.style.SUCCESS("Restored: records and files match the backup."))
