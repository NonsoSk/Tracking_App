import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core import backup


class Command(BaseCommand):
    help = ("Back up the portal (every record and every stored file) into one .zip, and check that it restores. Keep "
            "backups in private storage only: they hold personal data.")

    def add_arguments(self, parser):
        parser.add_argument("--out", default=str(Path(settings.BASE_DIR) / "backups"),
                            help="Folder for the .zip (default: backups/ beside the portal, ignored by Git).")
        parser.add_argument("--verify", action="store_true",
                            help="Then restore it into a throwaway second installation and compare (recommended).")
        parser.add_argument("--verify-only", metavar="ZIP", help="Only check an existing backup by restoring it.")

    def handle(self, *args, **options):
        target = Path(options["verify_only"]) if options["verify_only"] else backup.create(options["out"],
                                                                                         log=self.stdout.write)
        if options["verify"] or options["verify_only"]:
            findings = verify_elsewhere(target)
            self.stdout.write(json.dumps(findings, indent=1))
            if not findings.get("ok"):
                raise CommandError("The backup did not restore cleanly: see above.")
            self.stdout.write(self.style.SUCCESS("Restored on a second installation: records and files match."))


def verify_elsewhere(archive: Path) -> dict:
    """Restore into a new SQLite database and media folder in a separate process (a second installation)."""
    with tempfile.TemporaryDirectory(prefix="portal-restore-check-") as tmp:
        env = {k: v for k, v in os.environ.items() if not k.startswith("POSTGRES_")}
        env.update(SQLITE_PATH=str(Path(tmp) / "restored.sqlite3"), MEDIA_DIR=str(Path(tmp) / "media"),
                   PORTAL_REHEARSAL="true", ANTHROPIC_API_KEY="", POSTGRES_DB="")
        manage = [sys.executable, str(Path(settings.BASE_DIR) / "manage.py")]
        subprocess.run(manage + ["migrate", "--noinput", "-v", "0"], env=env, check=True, cwd=settings.BASE_DIR)
        run = subprocess.run(manage + ["portal_restore", str(archive), "--json"], env=env, cwd=settings.BASE_DIR,
                             capture_output=True, text=True)
        if run.returncode:
            return {"ok": False, "error": (run.stderr or run.stdout)[-2000:]}
        return json.loads(run.stdout.strip().splitlines()[-1])
