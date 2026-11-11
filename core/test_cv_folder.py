import os
import shutil
import tempfile
import time
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse

from accounts.models import User
from candidates.models import Candidate
from core.demo_files import cv_lines, simple_docx
from core.models import Department, FolderFile, Notification, PortalUpdatesFile, WatchedFolder
from pipeline.models import Application
from requisitions.models import Requisition

from . import cv_folder, excel_updates

MEDIA = tempfile.mkdtemp(prefix="test-media-")


def tearDownModule():
    shutil.rmtree(MEDIA, ignore_errors=True)


def cv_bytes(first, last, email, phone=""):
    return simple_docx(cv_lines(dict(first=first, last=last, email=email, phone=phone, summary="Accountant", jobs=[],
                                     degree="HND", course="Accounting", school="Rivers State Polytechnic", year=2015)))


@override_settings(MEDIA_ROOT=MEDIA)
class CvFolderTests(TestCase):
    """CVs saved into a watched folder are read on their own, once each, and wait for HR's check."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="cv-folder-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)

    def put(self, name, content, age=120):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        stamp = time.time() - age
        os.utime(path, (stamp, stamp))
        return path

    def test_new_files_are_read_once_and_wait_for_the_check(self):
        self.put("Ada Obi CV.docx", cv_bytes("Ada", "Obi", "ada@example.com"))
        self.put("May/Bola Ade.docx", cv_bytes("Bola", "Ade", "bola@example.com"))
        self.put("Applicants list.xlsx", b"PK not a cv")
        self.put("~$Ada Obi CV.docx", b"word lock file")
        self.put("Thumbs.db", b"x")
        folder = cv_folder.link(str(self.root), user=self.hr)
        read = cv_folder.check()
        self.assertEqual(sorted(p.email for p in read), ["ada@example.com", "bola@example.com"])
        self.assertTrue(all(p.needs_check and p.source == "email" for p in read))
        folder.refresh_from_db()
        self.assertEqual((folder.files_read, folder.state), (2, "ok"))
        skipped = FolderFile.objects.get(name="Applicants list.xlsx")
        self.assertIn("Not a CV file type", skipped.skipped)
        self.assertFalse(FolderFile.objects.filter(name__startswith="~$").exists())
        self.assertTrue(Notification.objects.filter(recipient=self.hr, title__contains="2 new CVs").exists())
        # Nothing new: nothing read again.
        self.assertEqual(cv_folder.check(), [])
        self.assertEqual(Candidate.objects.count(), 2)

    def test_only_what_is_new_or_changed(self):
        self.put("Ada.docx", cv_bytes("Ada", "Obi", "ada@example.com"))
        cv_folder.link(str(self.root))
        cv_folder.check()
        # A copy of a CV already read, under another name, is not read again.
        self.put("Ada (copy).docx", (self.root / "Ada.docx").read_bytes())
        self.assertEqual(cv_folder.check(), [])
        self.assertIn("copy", FolderFile.objects.get(name="Ada (copy).docx").skipped)
        # A new CV is read; one saved again with changes is read again (and updates the same person).
        self.put("Chidi.docx", cv_bytes("Chidi", "Eze", "chidi@example.com"))
        self.put("Ada.docx", cv_bytes("Ada", "Obi", "ada@example.com", phone="0803 111 2222"), age=60)
        read = cv_folder.check()
        self.assertEqual(sorted(p.first_name for p in read), ["Ada", "Chidi"])
        self.assertEqual(Candidate.objects.count(), 2)
        self.assertEqual(Candidate.objects.get(email="ada@example.com").phone, "08031112222")

    def test_a_file_still_being_copied_waits_for_the_next_check(self):
        cv_folder.link(str(self.root))
        self.put("Fresh.docx", cv_bytes("Efe", "Musa", "efe@example.com"), age=0)
        self.assertEqual(cv_folder.check(), [])
        self.assertIn("waiting for the next check", WatchedFolder.objects.get().message)
        os.utime(self.root / "Fresh.docx", (time.time() - 120, time.time() - 120))
        self.assertEqual(len(cv_folder.check()), 1)

    def test_only_files_added_from_now_on(self):
        self.put("Old.docx", cv_bytes("Old", "Person", "old@example.com"))
        cv_folder.link(str(self.root), read_existing=False)
        self.assertEqual(cv_folder.check(), [])
        self.put("New.docx", cv_bytes("New", "Person", "new@example.com"))
        self.assertEqual([p.email for p in cv_folder.check()], ["new@example.com"])

    def test_a_vacancy_is_applied_to_once_checked(self):
        dept = Department.objects.create(name="Finance", code="FIN")
        vacancy = Requisition.objects.create(department=dept, title="Accounts Officer", status="open",
                                             courses=["Accounting"])
        self.put("Ada.docx", cv_bytes("Ada", "Obi", "ada@example.com"))
        cv_folder.link(str(self.root), requisition=vacancy, source="hard_copy")
        person = cv_folder.check()[0]
        self.assertEqual((person.pending_requisition, person.source), (vacancy, "hard_copy"))
        self.assertFalse(Application.objects.exists())

    def test_a_missing_folder_is_reported(self):
        folder = cv_folder.link(str(self.root))
        shutil.rmtree(self.root)
        cv_folder.check()
        folder.refresh_from_db()
        self.assertEqual(folder.state, "missing")
        with self.assertRaises(cv_folder.FolderError):
            cv_folder.link(str(self.root / "nope"))

    def test_the_excel_link_page(self):
        self.client.force_login(self.hr)
        self.put("Ada.docx", cv_bytes("Ada", "Obi", "ada@example.com"))
        response = self.client.post(reverse("core:excel_link"), {"action": "folder_link", "path": str(self.root),
                                                                 "source": "email", "read_existing": "1"})
        self.assertRedirects(response, reverse("core:excel_link"))
        folder = WatchedFolder.objects.get()
        page = self.client.get(reverse("core:excel_link"))
        self.assertContains(page, "CV folder")
        self.assertContains(page, folder.path)
        self.client.post(reverse("core:excel_link"), {"action": "folder_check", "folder": folder.pk})
        folder.refresh_from_db()
        self.assertTrue(folder.check_requested)
        self.client.post(reverse("core:excel_link"), {"action": "folder_unlink", "folder": folder.pk})
        self.assertFalse(WatchedFolder.objects.exists())
        self.assertTrue((self.root / "Ada.docx").exists())  # the folder's files are never touched
        recruiter = User.objects.create_user("rec", password="x", role=User.Role.RECRUITER)
        self.client.force_login(recruiter)
        self.assertEqual(self.client.get(reverse("core:excel_link")).status_code, 403)

    def test_the_scheduled_run_reads_the_folder_and_writes_the_updates(self):
        out = Path(tempfile.mkdtemp(prefix="updates-"))
        self.addCleanup(shutil.rmtree, out, ignore_errors=True)
        self.put("Ada.docx", cv_bytes("Ada", "Obi", "ada@example.com"))
        cv_folder.link(str(self.root))
        with override_settings(PORTAL_UPDATES_PATH=str(out)), mock.patch("sys.stdout"):
            call_command("sync_workbooks")
        self.assertTrue(Candidate.objects.filter(email="ada@example.com").exists())
        self.assertTrue((out / excel_updates.FILE_NAME).exists())
        self.assertEqual(PortalUpdatesFile.current().rows["CVs received"], 1)
