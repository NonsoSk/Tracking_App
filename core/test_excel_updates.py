import shutil
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest import mock

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from accounts.models import User
from candidates.models import Candidate
from core.models import Department, LinkedWorkbook, PortalUpdatesFile
from pipeline.models import Interview
from pipeline.services import create_application, move_to_stage
from requisitions.models import Requisition

from . import excel_updates
from .workbook_import import WorkbookError


def read(path):
    from openpyxl import load_workbook

    workbook = load_workbook(path)
    return {sheet.title: [[cell.value for cell in row] for row in sheet.iter_rows()] for sheet in workbook}


class PortalUpdatesTests(TestCase):
    """The portal keeps 'Portal updates.xlsx' beside the linked workbooks, rewritten when its data changes."""

    def setUp(self):
        self.out = Path(tempfile.mkdtemp(prefix="updates-"))
        self.addCleanup(shutil.rmtree, self.out, ignore_errors=True)
        dept = Department.objects.create(name="Finance", code="FIN")
        self.vacancy = Requisition.objects.create(department=dept, title="Accounts Officer", status="open",
                                                  education_level="hnd", courses=["Accounting"],
                                                  required_skills=["Accounts payable"])
        self.ada = Candidate.objects.create(first_name="Ada", last_name="Obi", email="ada@example.com",
                                            source="email", highest_qualification="hnd", course="Accounting",
                                            skills=["Accounts payable"], needs_check=False)
        self.imported = Candidate.objects.create(first_name="Old", last_name="Row", source="import")
        self.app, _ = create_application(self.ada, self.vacancy, notify_team=False)

    def test_it_goes_beside_the_workbook_with_the_requisition_tracker(self):
        other = self.out / "cvs"
        other.mkdir()
        LinkedWorkbook.objects.create(path=str(other / "CV file.xlsx"), sheets="Applications dump")
        LinkedWorkbook.objects.create(path=str(self.out / "Recruitment Master.xlsx"), sheets="Requisition tracker")
        self.assertEqual(excel_updates.target_path(), self.out / "Portal updates.xlsx")
        with override_settings(PORTAL_UPDATES_PATH=str(other)):
            self.assertEqual(excel_updates.target_path(), other / "Portal updates.xlsx")

    def test_the_sheets_hold_the_portals_latest_data(self):
        Interview.objects.create(application=self.app, scheduled_at=timezone.now() + timedelta(days=2))
        move_to_stage(self.app, "shortlisted", quiet=True)
        with override_settings(PORTAL_UPDATES_PATH=str(self.out)):
            state = excel_updates.write(force=True)
        path = self.out / "Portal updates.xlsx"
        self.assertEqual(state.path, str(path))
        sheets = read(path)
        self.assertEqual(list(sheets), ["Applicants", "CVs received", "Vacancies", "Interviews", "Read me"])
        head, row = sheets["Applicants"][0], sheets["Applicants"][1]
        record = dict(zip(head, row))
        self.assertEqual((record["Candidate"], record["Vacancy"], record["Stage"]), ("Ada Obi", "Accounts Officer",
                                                                                   "Shortlisted"))
        self.assertIsNotNone(record["Next interview"])
        self.assertEqual(record["Score"], float(self.app.match_score))
        # Only profiles that came in through the portal: Excel's own rows are already in Excel.
        self.assertEqual([r[0] for r in sheets["CVs received"][1:]], ["Ada Obi"])
        vacancy = dict(zip(sheets["Vacancies"][0], sheets["Vacancies"][1]))
        self.assertEqual((vacancy["Applicants"], vacancy["Shortlisted"]), (1, 1))
        self.assertEqual(len(sheets["Interviews"]), 2)
        self.assertEqual(state.rows, {"Applicants": 1, "CVs received": 1, "Vacancies": 1, "Interviews": 1})

    def test_rewritten_only_when_something_changed(self):
        with override_settings(PORTAL_UPDATES_PATH=str(self.out)):
            first = excel_updates.write().written_at
            self.assertEqual(excel_updates.write().written_at, first)
            move_to_stage(self.app, "shortlisted", quiet=True)
            self.assertGreater(excel_updates.write().written_at, first)

    def test_while_open_in_excel_it_waits(self):
        with override_settings(PORTAL_UPDATES_PATH=str(self.out)), \
                mock.patch("core.excel_updates.os.replace", side_effect=PermissionError):
            state = excel_updates.write(force=True)
        self.assertIn("open in Excel", state.message)
        self.assertIsNone(state.written_at)
        self.assertEqual([p.name for p in self.out.iterdir()], [])  # no half-written file left behind
        with override_settings(PORTAL_UPDATES_PATH=str(self.out)):
            state = excel_updates.write()
        self.assertEqual((state.message, (self.out / "Portal updates.xlsx").exists()), ("", True))

    def test_never_linked_back_as_a_recruitment_workbook(self):
        from . import excel_link

        with override_settings(PORTAL_UPDATES_PATH=str(self.out)):
            excel_updates.write(force=True)
            with self.assertRaisesMessage(WorkbookError, "the file the portal writes its updates to"):
                excel_link.link([str(self.out / "Portal updates.xlsx")])

    def test_download_and_write_now_on_the_page(self):
        hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        self.client.force_login(hr)
        response = self.client.get(reverse("core:excel_link"), {"updates": "download"})
        self.assertEqual(response["Content-Disposition"], 'attachment; filename="Portal updates.xlsx"')
        with override_settings(PORTAL_UPDATES_PATH=str(self.out)):
            self.client.post(reverse("core:excel_link"), {"action": "updates_write"})
            page = self.client.get(reverse("core:excel_link"))
        self.assertTrue((self.out / "Portal updates.xlsx").exists())
        self.assertContains(page, "Portal updates.xlsx")
        self.assertEqual(PortalUpdatesFile.current().rows["Applicants"], 1)
