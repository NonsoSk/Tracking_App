"""A backup restores on a second installation with the same records, users and files (portal_backup --verify)."""

import shutil
import tempfile
import zipfile
from pathlib import Path

from django.core.files.base import ContentFile
from django.test import TestCase, override_settings

from accounts.models import User
from candidates.models import Candidate, CandidateDocument
from core import backup
from core.management.commands.portal_backup import verify_elsewhere
from core.models import Department
from intake.models import Receipt
from pipeline.models import Application
from pipeline.services import log
from requisitions.models import Requisition

MEDIA = tempfile.mkdtemp(prefix="test-backup-media-")


def tearDownModule():
    shutil.rmtree(MEDIA, ignore_errors=True)


@override_settings(MEDIA_ROOT=MEDIA)
class BackupRestoreTests(TestCase):
    def setUp(self):
        self.out = Path(tempfile.mkdtemp(prefix="backups-"))
        self.addCleanup(shutil.rmtree, self.out, ignore_errors=True)
        self.hr = User.objects.create_user("hr.officer", password="a-long-test-password", role=User.Role.HR_ADMIN)
        dept = Department.objects.create(name="Finance", code="FIN")
        req = Requisition.objects.create(department=dept, title="Accounts Officer", status="open")
        person = Candidate.objects.create(first_name="Ada", last_name="Obi", email="ada@example.com")
        doc = CandidateDocument(candidate=person, doc_type="cv", original_name="Ada.pdf")
        doc.file.save("Ada.pdf", ContentFile(b"%PDF-1.4 fictional cv"), save=True)
        app = Application.objects.create(candidate=person, requisition=req)
        log("Moved to Document review.", verb="stage", application=app, actor=self.hr)
        receipt = Receipt(channel="upload", original_name="Ada.pdf", sha256="x" * 64)
        receipt.stored.save("Ada.pdf", ContentFile(b"%PDF-1.4 fictional cv"), save=True)

    def test_a_backup_holds_records_and_files_and_restores_elsewhere(self):
        archive = backup.create(self.out, log=lambda *a: None)
        with zipfile.ZipFile(archive) as zf:
            names = zf.namelist()
        self.assertIn("data.json", names)
        self.assertIn("manifest.json", names)
        self.assertEqual(sum(n.startswith("media/") for n in names), 2)
        findings = verify_elsewhere(archive)
        self.assertTrue(findings["ok"], findings)
        self.assertEqual(findings["files_checked"], 2)
        self.assertEqual(findings["users"], 1)
        self.assertEqual(findings["staff_who_can_sign_in"], 1)

    def test_restore_refuses_a_portal_that_holds_data(self):
        archive = backup.create(self.out, log=lambda *a: None)
        with self.assertRaises(backup.BackupError):
            backup.restore(archive, log=lambda *a: None)
