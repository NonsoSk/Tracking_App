"""Linking CV folders from the CV intake page, the answers HR gives about received files, and the connector that sends
folders from a PC the server cannot reach (including while it is offline)."""

import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

from django.test import LiveServerTestCase, TestCase, override_settings
from django.urls import reverse

from accounts.models import User
from candidates.models import Candidate
from core import cv_folder
from core.models import Department, WatchedFolder
from pipeline.models import Application
from requisitions.models import Requisition

from . import sync
from .models import Connector, Receipt
from .tests import MEDIA, cv_bytes

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import portal_connector  # noqa: E402


def put(root: Path, name: str, content: bytes, age=60):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    stamp = time.time() - age
    os.utime(path, (stamp, stamp))
    return path


@override_settings(MEDIA_ROOT=MEDIA)
class LinkFromTheIntakePageTests(TestCase):
    def setUp(self):
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        self.client.force_login(self.hr)
        self.root = Path(tempfile.mkdtemp(prefix="cv-link-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        dept = Department.objects.create(name="Finance", code="FIN")
        self.vacancy = Requisition.objects.create(department=dept, title="Accounts Officer", status="open",
                                                  courses=["Accounting"])

    def link(self, path, **extra):
        data = {"label": "Emailed CVs", "location": "server", "path": str(path), "source": "email",
                "include_subfolders": "on", "mode": "existing", **extra}
        preview = self.client.post(reverse("intake:folder_link"), data)
        self.assertEqual(preview.status_code, 200)
        self.assertContains(preview, "Check before linking")
        done = self.client.post(reverse("intake:folder_link"), {**data, "confirm": "1"})
        self.assertRedirects(done, reverse("candidates:intake") + "#folders", fetch_redirect_response=False)
        return WatchedFolder.objects.get(path=str(Path(path).resolve()))

    def test_two_separate_actions_and_no_folders_yet(self):
        page = self.client.get(reverse("candidates:intake"))
        self.assertContains(page, "Link a folder")
        self.assertContains(page, "Upload files once")
        self.assertContains(page, "No folders linked yet")

    def test_link_a_general_folder_then_a_vacancy_folder(self):
        put(self.root / "general", "Ada.docx", cv_bytes("Ada", "Obi", "ada@example.com"))
        put(self.root / "general", "Old/Bola.docx", cv_bytes("Bola", "Ade", "bola@example.com"))
        put(self.root / "vacancy", "Chidi.docx", cv_bytes("Chidi", "Eze", "chidi@example.com"))
        preview = self.client.post(reverse("intake:folder_link"), {
            "label": "Emailed CVs", "location": "server", "path": str(self.root / "general"), "source": "email",
            "include_subfolders": "on", "mode": "existing"})
        self.assertContains(preview, "2 files, of which 2 could be CVs")
        self.assertFalse(WatchedFolder.objects.exists())  # nothing until confirmed
        general = self.link(self.root / "general")
        self.assertEqual(general.state, "pending")  # not "Linked" until the worker has opened it
        self.assertContains(self.client.get(reverse("candidates:intake")), "Waiting for the worker")
        vacancy = self.link(self.root / "vacancy", label="Accounts applicants", requisition=self.vacancy.pk)
        sync.folders()
        general.refresh_from_db()
        vacancy.refresh_from_db()
        self.assertEqual((general.state, vacancy.state), ("ok", "ok"))
        self.assertIsNotNone(general.verified_at)
        self.assertEqual(Candidate.objects.count(), 3)
        self.assertEqual(list(Application.objects.values_list("candidate__email", "requisition")),
                         [("chidi@example.com", self.vacancy.pk)])  # the general folder fills the talent pool
        page = self.client.get(reverse("candidates:intake"))
        self.assertContains(page, "Accounts applicants")
        self.assertContains(page, "Last checked")

    def test_watch_new_files_only(self):
        put(self.root, "Old.docx", cv_bytes("Old", "Person", "old@example.com"))
        self.link(self.root, mode="new_only")
        sync.folders()
        self.assertFalse(Candidate.objects.exists())
        put(self.root, "New.docx", cv_bytes("New", "Person", "new@example.com"))
        sync.folders()
        self.assertEqual(list(Candidate.objects.values_list("email", flat=True)), ["new@example.com"])

    def test_a_folder_the_portal_cannot_open_is_refused_with_guidance(self):
        response = self.client.post(reverse("intake:folder_link"), {
            "label": "Mine", "location": "server", "path": str(self.root / "missing"), "source": "email",
            "mode": "existing"})
        self.assertContains(response, "connector")
        self.assertFalse(WatchedFolder.objects.exists())

    def test_stopping_one_folder_keeps_its_candidates_and_the_other_folders(self):
        put(self.root / "a", "Ada.docx", cv_bytes("Ada", "Obi", "ada@example.com"))
        put(self.root / "b", "Bola.docx", cv_bytes("Bola", "Ade", "bola@example.com"))
        a = self.link(self.root / "a", label="A")
        self.link(self.root / "b", label="B")
        sync.folders()
        self.client.post(reverse("intake:folder_action", args=[a.pk]), {"action": "stop"})
        self.assertEqual(list(WatchedFolder.objects.values_list("label", flat=True)), ["B"])
        self.assertEqual(Candidate.objects.count(), 2)
        self.assertTrue((self.root / "a" / "Ada.docx").exists())
        put(self.root / "b", "Chidi.docx", cv_bytes("Chidi", "Eze", "chidi@example.com"))
        sync.folders()
        self.assertEqual(Candidate.objects.count(), 3)

    def test_hr_answers_a_same_person_question(self):
        grace = Candidate.objects.create(first_name="Grace", last_name="Okon", email="shared@example.com")
        put(self.root, "Grace new CV.docx", cv_bytes("Gracious", "Okonkwo", "shared@example.com"))
        self.link(self.root)
        sync.folders()
        receipt = Receipt.objects.get(outcome="identity")
        page = self.client.get(reverse("candidates:intake"))
        self.assertContains(page, "Same person: update Grace Okon")
        self.client.post(reverse("intake:receipt_action", args=[receipt.pk]), {"action": "same",
                                                                               "candidate": grace.pk})
        receipt.refresh_from_db()
        self.assertEqual((receipt.status, receipt.outcome, receipt.candidate), ("done", "updated", grace))
        self.assertEqual(Candidate.objects.count(), 1)

    def test_only_hr_may_link(self):
        employee = User.objects.create_user("emp", password="x", role=User.Role.EMPLOYEE)
        self.client.force_login(employee)
        self.assertEqual(self.client.get(reverse("intake:folder_link")).status_code, 403)


@override_settings(MEDIA_ROOT=MEDIA)
class ConnectorApiTests(TestCase):
    def setUp(self):
        self.connector, self.token = Connector.issue("HR laptop")
        self.folder = WatchedFolder.objects.create(path="C:/Users/hr/CVs", label="Laptop CVs", location="connector",
                                                   connector=self.connector, state="pending")
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.token}"}

    def test_only_the_key_opens_it(self):
        self.assertEqual(self.client.get(reverse("intake:api_config")).status_code, 401)
        self.assertEqual(self.client.get(reverse("intake:api_config"), HTTP_AUTHORIZATION="Bearer nope").status_code,
                         401)
        config = self.client.get(reverse("intake:api_config"), **self.auth).json()
        self.assertEqual([f["id"] for f in config["folders"]], [self.folder.pk])
        self.connector.refresh_from_db()
        self.assertTrue(self.connector.online)
        self.connector.revoked_at = self.connector.last_seen_at
        self.connector.save()
        self.assertEqual(self.client.get(reverse("intake:api_config"), **self.auth).status_code, 401)

    def test_a_file_sent_twice_is_received_once(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        content = cv_bytes("Ada", "Obi", "ada@example.com")
        for attempt in range(2):
            answer = self.client.post(reverse("intake:api_file"), {
                "kind": "cv", "folder": self.folder.pk, "source_path": "Ada.docx", "modified": "1700000000",
                "file": SimpleUploadedFile("Ada.docx", content)}, **self.auth).json()
            self.assertEqual(answer["new"], attempt == 0)
        self.assertEqual(Receipt.objects.count(), 1)
        self.client.post(reverse("intake:api_report"), json.dumps({"folders": [{"id": self.folder.pk, "ok": True}]}),
                         content_type="application/json", **self.auth)
        self.folder.refresh_from_db()
        self.assertEqual(self.folder.state, "ok")


@override_settings(MEDIA_ROOT=MEDIA)
class ConnectorProgramTests(LiveServerTestCase):
    """The program on the PC: it keeps what it finds while the portal cannot be reached, then catches up."""

    def test_offline_then_catching_up(self):
        connector, token = Connector.issue("HR laptop")
        root = Path(tempfile.mkdtemp(prefix="pc-cvs-"))
        spool_dir = Path(tempfile.mkdtemp(prefix="pc-spool-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        self.addCleanup(shutil.rmtree, spool_dir, ignore_errors=True)
        folder = WatchedFolder.objects.create(path=str(root), label="Laptop CVs", location="connector",
                                              connector=connector, state="pending")
        put(root, "Ada.docx", cv_bytes("Ada", "Obi", "ada@example.com"))
        spool = portal_connector.Spool(spool_dir)
        offline = portal_connector.Portal("http://127.0.0.1:9", token, timeout=2)  # nothing listens there
        with self.assertRaises(portal_connector.Offline):
            offline.config()
        config = {"id": folder.pk, "path": str(root), "subfolders": True, "import_existing": True}
        portal_connector.scan_folder(spool, config, 10)  # found while offline: kept in the queue
        put(root, "Bola.docx", cv_bytes("Bola", "Ade", "bola@example.com"))
        portal_connector.scan_folder(spool, config, 10)
        self.assertEqual(len(spool.pending()), 2)
        with self.assertRaises(portal_connector.Offline):
            portal_connector.send_pending(spool, offline, lambda *a: None)
        self.assertEqual(len(spool.pending()), 2)  # nothing lost
        online = portal_connector.Portal(self.live_server_url, token)
        self.assertEqual([f["id"] for f in online.config()["folders"]], [folder.pk])
        self.assertEqual(portal_connector.send_pending(spool, online, lambda *a: None), 2)
        report = portal_connector.scan_folder(spool, config, 10)
        online.report({"folders": [report], "workbooks": []})
        self.assertEqual(spool.pending(), [])
        sync.drain()
        folder.refresh_from_db()
        self.assertEqual(folder.state, "ok")
        self.assertEqual(sorted(Candidate.objects.values_list("email", flat=True)),
                         ["ada@example.com", "bola@example.com"])
        self.assertEqual(set(Receipt.objects.values_list("channel", flat=True)), {"connector"})
