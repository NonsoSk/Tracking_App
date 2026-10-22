"""Keeping the portal in step with the Excel workbooks. All names and contacts here are made up."""

import io
import os
import shutil
import tempfile
import time
from datetime import datetime
from pathlib import Path
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse

from accounts.models import User
from candidates.models import Candidate, CBTResult
from core import excel_link
from core.models import LinkedWorkbook
from core.test_workbook_import import (
    CBT_HEADERS, CV_HEADERS, IV_HEADERS, REQ_HEADERS, STAFF_HEADERS, cbt_rows, cv_rows, iv_rows, req_rows, staff_rows,
    write,
)
from pipeline.models import Application, InterviewRecord
from pipeline.services import log
from requisitions.models import Requisition

STATUS = REQ_HEADERS.index("Status")
COORDINATOR = REQ_HEADERS.index("Rec. Coordinator")
RESULT = IV_HEADERS.index("Remarks_Query")
EXAM_SCORE = CBT_HEADERS.index("Exam Score")


class ExcelLinkTests(TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.cv = os.path.join(self.dir, "CV_file.xlsx")
        self.master = os.path.join(self.dir, "Recruitment Master.xlsx")
        self.reqs, self.ivs, self.cbts, self.cvs = req_rows(), iv_rows(), cbt_rows(), cv_rows()
        self.save_master()
        self.save_cv()
        reports = Path(self.dir) / "reports"
        patcher = mock.patch.object(excel_link, "report_dir", lambda: reports)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def settle(self, path):
        """Pretend the file was saved a minute ago, so Excel has finished writing it."""
        past = time.time() - 60
        os.utime(path, (past, past))

    def save_master(self):
        write(self.master, [
            ("Manpower_Requisition_Summary", REQ_HEADERS, self.reqs),
            ("Recruitment_Interview Records", IV_HEADERS, self.ivs),
            ("Recruitment_CBTs", CBT_HEADERS, self.cbts),
            ("Retirement Forecast_3 Years Pro", STAFF_HEADERS, staff_rows()),
        ])
        self.settle(self.master)

    def save_cv(self):
        write(self.cv, [("CV Dump", CV_HEADERS, self.cvs)])
        self.settle(self.cv)

    def link_and_load(self, *paths):
        excel_link.link(paths or [self.master, self.cv])
        return excel_link.check(log=lambda *a: None)

    def totals(self):
        return (Candidate.objects.count(), CBTResult.objects.count(), InterviewRecord.objects.count(),
                Application.objects.count(), Requisition.objects.count())

    def test_link_loads_once_and_unchanged_files_are_not_reloaded(self):
        self.link_and_load()
        first = self.totals()
        self.assertEqual(first[4], 2)
        self.assertTrue(all(w.state == "ok" and w.fingerprint for w in LinkedWorkbook.objects.all()))
        self.assertIsNone(excel_link.check(log=lambda *a: None))  # nothing saved since
        result = excel_link.check(force=True, log=lambda *a: None)  # loading the same files again adds nothing
        self.assertEqual(self.totals(), first)
        self.assertFalse(any(k for k, v in result.counts.items() if v and "repeated" not in k), result.counts)

    def test_master_workbook_alone_can_be_followed(self):
        self.link_and_load(self.master)
        self.assertEqual(Requisition.objects.count(), 2)
        self.assertTrue(InterviewRecord.objects.exists())
        self.assertEqual(LinkedWorkbook.objects.get().sheets,
                         "Manpower requisition tracker, Interview records, CBT results, Staff list (retirement forecast)")

    def test_edits_in_excel_update_records_without_duplicates(self):
        self.link_and_load()
        before = self.totals()
        dan = Application.objects.get(candidate__email="dan.iv@example.com", requisition__reference="Req_901")
        self.assertEqual((dan.stage, dan.status), ("decision", "active"))

        self.ivs[2][RESULT] = "Rejected"  # Dan's interview result corrected
        self.cbts[0][EXAM_SCORE] = self.cbts[1][EXAM_SCORE] = 110  # Ada's CBT score corrected (the row appears twice)
        self.ivs.append(["Req_901", None, "Experienced", "New Person", "Female", "2348099990000", "new.person@example.com",
                         datetime(2026, 8, 26), "QAQC", "QA Panel", None, None, None, 0.7, "On-Hold", None, "Not Engaged"])
        self.cvs.append([4, "Ngozi Newrow", "08077776666", "ngozi.new@example.com", None, None, "Female", "Rivers", "",
                         "Yes", 3, "B.Sc", "Chemistry", 2020, "PAC", "Sample University", "Second class upper", "", ""])
        self.save_master()
        self.save_cv()
        result = excel_link.check(log=lambda *a: None)

        candidates, cbts, records, apps, reqs = self.totals()
        self.assertEqual((cbts, reqs), (before[1], before[4]))
        self.assertEqual(candidates, before[0] + 2)  # the new interviewee and the new CV
        self.assertEqual(records, before[2] + 1)  # only the new interview; the corrected one was updated
        self.assertEqual(apps, before[3] + 1)
        self.assertEqual(result.counts["interview records changed in Excel (updated)"], 1)
        self.assertEqual(result.counts["CBT results changed in Excel (updated)"], 1)
        dan.refresh_from_db()
        self.assertEqual((dan.status, dan.decision), ("rejected", "reject"))
        self.assertEqual(CBTResult.objects.get(candidate__email="ada.test@example.com", category="Lab_GET").score, 110)
        newcomer = Application.objects.get(candidate__email="new.person@example.com")
        self.assertEqual(newcomer.status, "on_hold")

    def test_work_done_in_the_portal_is_kept(self):
        self.link_and_load()
        hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        req = Requisition.objects.get(reference="Req_901")
        req.status = Requisition.Status.OPEN
        req.education_level = "bsc"
        req.save()
        log("Opened for applications on the careers page.", verb="requisition", requisition=req, actor=hr)
        dan = Application.objects.get(candidate__email="dan.iv@example.com", requisition=req)
        log("Moved to Document review.", verb="stage", application=dan, actor=hr)

        # Other cells change in Excel, and Dan's result too: the portal keeps its own status and stage.
        self.reqs[1][COORDINATOR] = "Coordinator Three"
        self.ivs[2][RESULT] = "Rejected"
        self.save_master()
        excel_link.check(log=lambda *a: None)
        req.refresh_from_db()
        dan.refresh_from_db()
        self.assertEqual((req.status, req.education_level, req.coordinator_name),
                         (Requisition.Status.OPEN, "bsc", "Coordinator Three"))
        self.assertEqual(dan.status, "active")

        # Closing it in the tracker is a change made in Excel: the portal follows.
        self.reqs[1][STATUS] = "Closed"
        self.save_master()
        excel_link.check(log=lambda *a: None)
        req.refresh_from_db()
        self.assertIn(req.status, {Requisition.Status.CLOSED, Requisition.Status.FILLED})

    def test_recently_saved_and_missing_files(self):
        self.link_and_load(self.master)
        self.reqs[1][COORDINATOR] = "Someone Else"
        write(self.master, [("Manpower_Requisition_Summary", REQ_HEADERS, self.reqs)])  # saved just now
        self.assertIsNone(excel_link.check(log=lambda *a: None))  # Excel may still be writing it
        os.remove(self.master)
        excel_link.check(log=lambda *a: None)
        self.assertEqual(LinkedWorkbook.objects.get().state, "missing")

    def test_a_workbook_without_recruitment_sheets_is_refused(self):
        other = os.path.join(self.dir, "Budget.xlsx")
        write(other, [("Sheet1", ["Item", "Amount"], [["Chairs", 3]])])
        with self.assertRaisesMessage(Exception, "No recruitment sheets were found in Budget.xlsx"):
            excel_link.link([other])
        self.assertFalse(LinkedWorkbook.objects.exists())

    def test_command(self):
        out = io.StringIO()
        call_command("sync_workbooks", "--link", self.master, stdout=out)
        self.assertIn("Linked", out.getvalue())
        self.assertIn("Refreshed", out.getvalue())
        out = io.StringIO()
        call_command("sync_workbooks", "--list", stdout=out)
        self.assertIn("Up to date", out.getvalue())
        call_command("sync_workbooks", "--unlink", stdout=io.StringIO())
        self.assertFalse(LinkedWorkbook.objects.exists())
        self.assertEqual(Requisition.objects.count(), 2)  # records stay


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class ExcelLinkPageTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("admin1", password="x", role=User.Role.HR_ADMIN)
        self.recruiter = User.objects.create_user("rec", password="x", role=User.Role.RECRUITER)

    def upload(self, name, sheets):
        buffer = os.path.join(tempfile.mkdtemp(), name)
        write(buffer, sheets)
        with open(buffer, "rb") as handle:
            return SimpleUploadedFile(name, handle.read())

    def test_only_hr_admin(self):
        self.client.force_login(self.recruiter)
        self.assertEqual(self.client.get(reverse("core:excel_link")).status_code, 403)
        self.client.force_login(self.admin)
        page = self.client.get(reverse("core:excel_link"))
        self.assertContains(page, "No workbooks linked yet")

    def test_upload_links_the_copy_and_refresh_is_requested(self):
        self.client.force_login(self.admin)
        bad = self.upload("Budget.xlsx", [("Sheet1", ["Item"], [["Chairs"]])])
        response = self.client.post(reverse("core:excel_link"), {"action": "upload", "file": bad}, follow=True)
        self.assertContains(response, "No recruitment sheets were found in Budget.xlsx")
        self.assertFalse(LinkedWorkbook.objects.exists())

        good = self.upload("Master.xlsx", [("Manpower_Requisition_Summary", REQ_HEADERS, req_rows())])
        self.client.post(reverse("core:excel_link"), {"action": "upload", "file": good})
        workbook = LinkedWorkbook.objects.get()
        self.assertTrue(workbook.path.endswith(os.path.join("excel-link", "Master.xlsx")))
        self.assertTrue(workbook.refresh_requested)
        self.assertEqual(workbook.linked_by, self.admin)

        LinkedWorkbook.objects.update(refresh_requested=False)
        response = self.client.post(reverse("core:excel_link"), {"action": "refresh"}, follow=True)
        self.assertContains(response, "nothing is checking the files")
        self.assertTrue(LinkedWorkbook.objects.get().refresh_requested)
        self.client.post(reverse("core:excel_link"), {"action": "unlink", "workbook": workbook.pk})
        self.assertFalse(LinkedWorkbook.objects.exists())
