"""The intake queue, the worker and live screens: receipts first, each file read once, nothing lost when a worker
stops, workbook saves imported in order and fast, open screens told after each commit."""

import json
import os
import shutil
import tempfile
import threading
import time
from datetime import timedelta
from pathlib import Path
from unittest import mock

from django.db import transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from accounts.models import User
from candidates.models import Candidate
from core import cv_folder, excel_link
from core.demo_files import cv_lines, simple_docx
from core.models import LinkedWorkbook
from core.test_workbook_import import (
    CBT_HEADERS, IV_HEADERS, REQ_HEADERS, STAFF_HEADERS, cbt_rows, iv_rows, req_rows, staff_rows, write,
)
from requisitions.models import Requisition

from . import live, process, queue, sync
from .models import Job, LiveTopic, Receipt, Worker
from .receive import receive, requeue
from .worker import PortalWorker

MEDIA = tempfile.mkdtemp(prefix="test-intake-media-")
COORDINATOR = REQ_HEADERS.index("Rec. Coordinator")


def tearDownModule():
    shutil.rmtree(MEDIA, ignore_errors=True)


def cv_bytes(first, last, email, phone="", summary="Accountant"):
    return simple_docx(cv_lines(dict(first=first, last=last, email=email, phone=phone, summary=summary, jobs=[],
                                     degree="HND", course="Accounting", school="Rivers State Polytechnic", year=2015)))


@override_settings(MEDIA_ROOT=MEDIA)
class ReceiptTests(TestCase):
    def test_the_file_is_kept_before_it_is_read_and_read_once(self):
        content = cv_bytes("Ada", "Obi", "ada@example.com")
        receipt, new = receive(content, "Ada.docx", channel=Receipt.Channel.UPLOAD, options={"source": "email"})
        self.assertTrue(new)
        self.assertEqual(receipt.status, "received")
        with receipt.stored.open("rb") as handle:
            self.assertEqual(handle.read(), content)
        self.assertEqual(Job.objects.get().kind, "cv")
        self.assertEqual(Candidate.objects.count(), 0)  # nothing read yet
        sync.drain()
        receipt.refresh_from_db()
        self.assertEqual((receipt.status, receipt.outcome), ("done", "added"))
        self.assertEqual(receipt.candidate.email, "ada@example.com")

    def test_replay_after_a_worker_stopped_part_way(self):
        """A worker that stopped while reading leaves the job; it is picked up again once, and read once."""
        receipt, _ = receive(cv_bytes("Bola", "Ade", "bola@example.com"), "Bola.docx", channel="upload")
        job = queue.claim(Job.Lane.FAST, "worker-a")
        self.assertEqual(job.status, "running")
        self.assertIsNone(queue.claim(Job.Lane.FAST, "worker-b"))  # nobody else takes a running job
        # worker-a dies. Its lease runs out; recovery puts the job back.
        Job.objects.filter(pk=job.pk).update(locked_until=timezone.now() - timedelta(seconds=1))
        self.assertEqual(queue.recover(), 1)
        self.assertEqual(len(sync.drain()), 1)
        receipt.refresh_from_db()
        self.assertEqual((receipt.status, receipt.outcome), ("done", "added"))
        self.assertEqual(Candidate.objects.count(), 1)

    def test_a_job_run_twice_adds_nothing_the_second_time(self):
        """The worker read the CV and stopped before marking the job done: running it again changes nothing."""
        receipt, _ = receive(cv_bytes("Chidi", "Eze", "chidi@example.com"), "Chidi.docx", channel="upload")
        job = queue.claim(Job.Lane.FAST, "worker-a")
        process.run(job)
        Job.objects.filter(pk=job.pk).update(locked_until=timezone.now() - timedelta(seconds=1))
        queue.recover()
        sync.drain()
        receipt.refresh_from_db()
        self.assertEqual((receipt.outcome, Candidate.objects.count()), ("added", 1))

    def test_a_job_that_keeps_failing_fails_its_receipt_with_a_reason(self):
        receipt, _ = receive(b"%PDF-1.4 broken", "Broken.pdf", channel="upload")
        with mock.patch("candidates.intake.parse_cv", side_effect=RuntimeError("cannot open")):
            sync.drain()
        receipt.refresh_from_db()
        self.assertEqual((receipt.status, receipt.outcome), ("failed", "error"))
        self.assertIn("cannot open", receipt.message)
        self.assertTrue(receipt.can_retry)
        self.assertTrue(receipt.stored)  # the evidence is kept

    def test_the_same_file_from_a_folder_is_received_once(self):
        from core.models import WatchedFolder

        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        folder = WatchedFolder.objects.create(path=root)
        content = cv_bytes("Dayo", "Ola", "dayo@example.com")
        first, new = receive(content, "Dayo.docx", channel="folder", folder=folder, source_path="Dayo.docx")
        again, new_again = receive(content, "Dayo.docx", channel="folder", folder=folder, source_path="Dayo.docx")
        self.assertTrue(new)
        self.assertFalse(new_again)
        self.assertEqual(first.pk, again.pk)
        self.assertEqual(Job.objects.count(), 1)

    def test_word_and_pdf_of_the_same_cv_and_an_updated_cv(self):
        """Renamed copies and the same CV in two formats add nothing; a newer CV updates the same profile."""
        sync_receive = lambda content, name: receive(content, name, channel="upload")[0]  # noqa: E731
        first = sync_receive(cv_bytes("Efe", "Musa", "efe@example.com"), "Efe Musa CV.docx")
        renamed = sync_receive(cv_bytes("Efe", "Musa", "efe@example.com"), "CV (1).docx")
        sync.drain()
        newer = sync_receive(cv_bytes("Efe", "Musa", "efe@example.com", phone="0803 111 2222",
                                      summary="Senior accountant with audit experience"), "Efe Musa CV 2026.docx")
        sync.drain()
        for receipt in (first, renamed, newer):
            receipt.refresh_from_db()
        self.assertEqual([first.outcome, renamed.outcome, newer.outcome], ["added", "duplicate", "updated"])
        self.assertEqual(Candidate.objects.count(), 1)
        self.assertEqual(Candidate.objects.get().phone, "08031112222")

    def test_an_uncertain_identity_goes_to_review_and_the_answer_is_applied(self):
        hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        existing = Candidate.objects.create(first_name="Grace", last_name="Okon", email="family@example.com")
        receipt, _ = receive(cv_bytes("Peter", "Ugo", "family@example.com"), "Peter.docx", channel="upload")
        sync.drain()
        receipt.refresh_from_db()
        self.assertEqual((receipt.status, receipt.outcome, receipt.candidate), ("needs_review", "identity", existing))
        self.assertIn("Grace Okon", receipt.message)
        self.assertEqual(Candidate.objects.count(), 1)  # nothing merged on a guess
        requeue(receipt, options={"new_person": True}, user=hr)
        sync.drain()
        receipt.refresh_from_db()
        self.assertEqual((receipt.status, receipt.outcome), ("done", "added"))
        self.assertEqual(Candidate.objects.count(), 2)
        self.assertEqual(Candidate.objects.get(email="family@example.com"), existing)  # the email stays theirs
        self.assertEqual(receipt.resolved_by, hr)

    def test_a_scan_waits_for_the_slow_lane_and_never_blocks_the_fast_one(self):
        receipt, _ = receive(cv_bytes("Hauwa", "Bello", "hauwa@example.com"), "scan.docx", channel="upload")
        job = queue.claim(Job.Lane.FAST, "w")
        with mock.patch("candidates.intake.parse_cv", return_value={"ocr_deferred": True, "text": ""}):
            process.run(job, slow_lane_running=True)
        queue.finish(job)
        receipt.refresh_from_db()
        self.assertEqual(receipt.status, "received")
        self.assertIn("OCR", receipt.message)
        ocr = Job.objects.get(kind="ocr")
        self.assertEqual(ocr.lane, "slow")
        self.assertIsNone(queue.claim(Job.Lane.FAST, "w"))  # the fast lane is free for the next file
        sync.drain()
        receipt.refresh_from_db()
        self.assertEqual(receipt.outcome, "added")

    def test_a_closed_vacancy_sends_the_cv_to_the_talent_pool(self):
        from core.models import Department

        dept = Department.objects.create(name="Finance", code="FIN")
        vacancy = Requisition.objects.create(department=dept, title="Accounts Officer", status="closed")
        receipt, _ = receive(cv_bytes("Ike", "Obi", "ike@example.com"), "Ike.docx", channel="upload",
                             requisition=vacancy)
        sync.drain()
        receipt.refresh_from_db()
        self.assertEqual(receipt.outcome, "added")
        self.assertFalse(receipt.candidate.applications.exists())


@override_settings(MEDIA_ROOT=MEDIA)
class UploadTests(TestCase):
    def setUp(self):
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        self.client.force_login(self.hr)

    def test_an_upload_is_received_then_read_in_the_request(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        files = [SimpleUploadedFile("Ada.docx", cv_bytes("Ada", "Obi", "ada@example.com")),
                 SimpleUploadedFile("notes.xlsx", b"PK not a cv")]
        response = self.client.post(reverse("candidates:intake"), {"files": files, "source": "email"})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "<b>1</b> new CV")
        outcomes = dict(Receipt.objects.values_list("original_name", "outcome"))
        self.assertEqual(outcomes, {"Ada.docx": "added", "notes.xlsx": "not_cv"})
        self.assertEqual(Receipt.objects.get(original_name="Ada.docx").received_by, self.hr)
        self.assertFalse(Job.objects.filter(status__in=["queued", "running"]).exists())


@override_settings(MEDIA_ROOT=MEDIA)
class WorkbookSaveTests(TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.master = os.path.join(self.dir, "Recruitment Master.xlsx")
        self.reqs, self.ivs, self.cbts = req_rows(), iv_rows(), cbt_rows()
        self.save()
        reports = Path(self.dir) / "reports"
        patcher = mock.patch.object(excel_link, "report_dir", lambda: reports)
        patcher.start()
        self.addCleanup(patcher.stop)
        excel_link.link([self.master])
        excel_link.check(log=lambda *a: None)
        self.workbook = LinkedWorkbook.objects.get()

    def save(self, coordinator=None):
        if coordinator:
            self.reqs[1][COORDINATOR] = coordinator
        write(self.master, [("Manpower_Requisition_Summary", REQ_HEADERS, self.reqs),
                            ("Recruitment_Interview_Records", IV_HEADERS, self.ivs),
                            ("Recruitment_CBTs", CBT_HEADERS, self.cbts),
                            ("Retirement Forecast_3 Years Pro", STAFF_HEADERS, staff_rows())])

    def test_fast_consecutive_saves_end_with_the_last_one(self):
        """Three saves before the first is imported: one import, of the last save; the others are marked replaced."""
        from .watch import WorkbookWatch

        watcher = WorkbookWatch(log=lambda *a: None)
        for n, who in enumerate(["First", "Second", "Third"]):
            self.save(coordinator=f"{who} Coordinator")
            stamp = time.time() + n  # each save a second apart
            os.utime(self.master, (stamp, stamp))
            watcher.poll()
        receipts = list(Receipt.objects.filter(workbook=self.workbook).order_by("pk"))
        self.assertEqual(len(receipts), 4)  # the first load and three saves
        self.assertEqual(Job.objects.filter(kind="workbook", status="queued").count(), 1)  # coalesced
        sync.drain()
        self.assertEqual(Requisition.objects.get(reference="Req_901").coordinator_name, "Third Coordinator")
        statuses = [r.status for r in Receipt.objects.filter(workbook=self.workbook).order_by("pk")]
        self.assertEqual(statuses, ["done", "superseded", "superseded", "done"])

    def test_an_older_save_never_overwrites_a_newer_one(self):
        self.save(coordinator="Older")
        older, _ = receive(open(self.master, "rb").read(), "Recruitment Master.xlsx", kind="workbook",
                           channel="workbook", workbook=self.workbook, source_path=self.master)
        Job.objects.filter(status="queued").update(key="")  # as if the two saves came by separate routes
        self.save(coordinator="Newer")
        newer, _ = receive(open(self.master, "rb").read(), "Recruitment Master.xlsx", kind="workbook",
                           channel="workbook", workbook=self.workbook, source_path=self.master)
        job = Job.objects.get(payload__receipt=newer.pk)
        process.run(job)  # the newer save is imported first (out of order)
        queue.finish(job)
        sync.drain()  # then the older one
        older.refresh_from_db()
        self.assertEqual(older.status, "superseded")
        self.assertEqual(Requisition.objects.get(reference="Req_901").coordinator_name, "Newer")

    def test_an_edit_reaches_the_database_with_the_rows_it_changed_only(self):
        self.save(coordinator="Edited Coordinator")
        excel_link.check(log=lambda *a: None)
        receipt = Receipt.objects.filter(workbook=self.workbook).latest("pk")
        self.assertEqual((receipt.details["rows_changed"], receipt.details["full"]), (1, False))
        self.workbook.refresh_from_db()
        self.assertIsNotNone(self.workbook.last_latency)
        self.assertLess(receipt.details["seconds"], 5)

    def test_a_requested_full_refresh_reads_every_row(self):
        LinkedWorkbook.objects.update(refresh_requested=True)
        excel_link.check(log=lambda *a: None)
        receipt = Receipt.objects.filter(workbook=self.workbook).latest("pk")
        self.assertTrue(receipt.details["full"])
        self.assertGreater(receipt.details["rows_changed"], 10)


class LiveTests(TestCase):
    def test_a_commit_raises_the_topic_and_a_rollback_does_not(self):
        start = live.state()
        with self.captureOnCommitCallbacks(execute=True):
            Candidate.objects.create(first_name="C", last_name="D")
            self.assertEqual(live.state(), start)  # not before the commit
        self.assertEqual(live.state()["people"], start["people"] + 1)
        try:
            with self.captureOnCommitCallbacks(execute=True):
                with transaction.atomic():
                    Candidate.objects.create(first_name="E", last_name="F")
                    raise RuntimeError("rolled back")
        except RuntimeError:
            pass
        self.assertEqual(live.state()["people"], start["people"] + 1)
        with self.captureOnCommitCallbacks(execute=True):
            Candidate.objects.create(first_name="G", last_name="H")
        self.assertEqual(live.state()["people"], start["people"] + 2)  # still counting after a rollback

    def test_only_signed_in_staff_get_the_counters(self):
        url = reverse("intake:live")
        self.assertEqual(self.client.get(url).status_code, 401)
        user = User.objects.create_user("rec", password="x", role=User.Role.RECRUITER)
        self.client.force_login(user)
        LiveTopic.objects.create(name="hiring", seq=7)
        data = json.loads(self.client.get(url + "?t=hiring,secret").content)
        self.assertEqual(data["seq"], {"hiring": 7})
        user.is_active = False
        user.save()
        self.assertEqual(self.client.get(url).status_code, 401)

    def test_pages_carry_their_live_regions_and_counters(self):
        user = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        self.client.force_login(user)
        page = self.client.get(reverse("requisitions:list"))
        self.assertContains(page, 'id="main"')
        self.assertContains(page, 'data-live="hiring"')
        self.assertContains(page, "data-live-seq=")
        self.assertContains(page, "ds/live.js")


class WorkerLeaseTests(TestCase):
    def test_only_one_worker_reads_the_inputs_and_another_takes_over(self):
        a = PortalWorker("worker-a", inputs=True)
        b = PortalWorker("worker-b", inputs=True)
        for w in (a, b):
            Worker.objects.create(name=w.name)
        self.assertTrue(a.take_inputs())
        self.assertFalse(b.take_inputs())
        # worker-a stops sending its heartbeat
        Worker.objects.filter(name="worker-a").update(beat_at=timezone.now() - timedelta(minutes=5))
        self.assertTrue(b.take_inputs())
        self.assertEqual(list(Worker.objects.filter(holds_inputs=True).values_list("name", flat=True)), ["worker-b"])

    @override_settings(PORTAL_INPUTS_ENABLED=False)
    def test_a_rehearsal_worker_never_reads_the_inputs(self):
        self.assertFalse(PortalWorker("rehearsal").want_inputs)


@override_settings(MEDIA_ROOT=MEDIA, WORKBOOK_POLL_SECONDS=0.05, CV_STABLE_SECONDS=0.2, CV_FOLDER_SECONDS=1)
class RunningWorkerTests(TransactionTestCase):
    """The worker's threads, as they run: a folder linked, files dropped, a workbook saved, the worker restarted."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="cv-drop-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

    def wait_for(self, check, seconds=20):
        end = time.time() + seconds
        while time.time() < end:
            if check():
                return True
            time.sleep(0.05)
        return False

    def drop(self, name, content):
        path = self.root / name
        temp = path.with_suffix(".part")
        temp.write_bytes(content)
        os.replace(temp, path)  # how a copy lands: written aside, then renamed in
        stamp = time.time() - 5
        os.utime(path, (stamp, stamp))

    def test_files_dropped_while_the_worker_runs_and_while_it_is_stopped(self):
        cv_folder.link(str(self.root))
        worker = PortalWorker("test-worker", inputs=True, log=lambda *a: None)
        worker.start()
        try:
            self.drop("Ada.docx", cv_bytes("Ada", "Obi", "ada@example.com"))
            self.assertTrue(self.wait_for(lambda: Candidate.objects.filter(email="ada@example.com").exists()))
        finally:
            worker.stop()
        # Files arrive while no worker runs: nothing is lost; the next start catches up once.
        self.drop("Bola.docx", cv_bytes("Bola", "Ade", "bola@example.com"))
        self.drop("Bola copy.docx", (self.root / "Bola.docx").read_bytes())
        worker = PortalWorker("test-worker", inputs=True, log=lambda *a: None)
        worker.start()
        try:
            self.assertTrue(self.wait_for(lambda: Receipt.objects.filter(status="done").count() == 3))
        finally:
            worker.stop()
        self.assertEqual(Candidate.objects.count(), 2)
        self.assertEqual(sorted(Receipt.objects.values_list("outcome", flat=True)), ["added", "added", "duplicate"])
        self.assertFalse(Worker.objects.get(name="test-worker").online)


class ThreadSafetyTests(TransactionTestCase):
    def test_two_workers_never_run_the_same_job(self):
        for n in range(20):
            Job.objects.create(kind="rescore_candidate", lane="slow", payload={"candidate": 0})
        taken, lock = [], threading.Lock()

        def take(name):
            from django.db import connection

            try:
                while True:
                    job = queue.claim(Job.Lane.SLOW, name)
                    if job is None:
                        return
                    with lock:
                        taken.append(job.pk)
            finally:
                connection.close()

        threads = [threading.Thread(target=take, args=(f"w{i}",)) for i in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sorted(taken), sorted(set(taken)))
        self.assertEqual(len(taken), 20)
