import io
import shutil
import tempfile
import zipfile
from datetime import date

from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse

from accounts.models import User
from core.demo_files import cv_lines, simple_docx
from core.models import Department
from pipeline.services import create_application
from requisitions.models import Requisition

from .exports import FIELDS, age_on
from .intake import ingest_cv
from .models import Candidate

MEDIA = tempfile.mkdtemp(prefix="test-media-")


def tearDownModule():
    shutil.rmtree(MEDIA, ignore_errors=True)


@override_settings(MEDIA_ROOT=MEDIA, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class ExportTests(TestCase):
    """Matched candidates go out as CVs (one, or a .zip) and a basic list (Excel or CSV): downloaded, shared or
    emailed."""

    def setUp(self):
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN, email="hr@iefcl.com",
                                           first_name="Ngozi", last_name="Eze")
        self.client.force_login(self.hr)
        dept = Department.objects.create(name="Marketing", code="MKT")
        self.vacancy = Requisition.objects.create(department=dept, title="Marketing Officer", status="open",
                                                  courses=["Marketing"], education_level="bsc")
        lines = cv_lines(dict(first="Samuel", last="Nelson", email="samuel@example.com", phone="0803 111 2222",
                              summary="Marketer", jobs=[], degree="B.Sc", course="Marketing", school="UNILAG",
                              year=2010))
        self.samuel = ingest_cv(simple_docx(lines), "Samuel Nelson CV.docx", source="email").candidate
        self.samuel.date_of_birth, self.samuel.degree_class = date(1990, 6, 1), "2_1"
        self.samuel.save()
        self.joy = Candidate.objects.create(first_name="Joy", last_name="Umezurike", email="joy@example.com",
                                            phone="08055556666", highest_qualification="hnd", course="Marketing")
        self.apps = [create_application(p, self.vacancy, notify_team=False)[0] for p in (self.samuel, self.joy)]
        self.url = reverse("candidates:export")
        self.picks = [f"{self.samuel.pk}:{self.vacancy.pk}", f"{self.joy.pk}:{self.vacancy.pk}"]

    def sheet(self, response):
        from openpyxl import load_workbook

        content = b"".join(response.streaming_content)
        rows = [[c.value for c in row] for row in load_workbook(io.BytesIO(content)).active.iter_rows()]
        return rows

    def test_one_cv_downloads_named_after_the_candidate(self):
        response = self.client.get(reverse("candidates:cv", args=[self.samuel.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertIn('attachment; filename="Samuel Nelson - CV.', response["Content-Disposition"])
        self.assertEqual(self.client.get(reverse("candidates:cv", args=[self.joy.pk])).status_code, 404)

    def test_excel_with_the_seven_fields(self):
        response = self.client.post(self.url, {"pick": [self.picks[0]], "shown": self.picks, "format": "xlsx"})
        self.assertIn("Marketing Officer - candidates -", response["Content-Disposition"])
        rows = self.sheet(response)
        self.assertEqual(rows[0], FIELDS)
        self.assertEqual(rows[1], ["Samuel Nelson", "samuel@example.com", "08031112222", "Marketing",
                                   "BSc / BEng (2:1)", age_on(date(1990, 6, 1)), "Marketing Officer"])
        self.assertEqual(len(rows), 2)  # only the ticked one

    def test_none_ticked_takes_everyone_shown_and_csv_opens_in_excel(self):
        response = self.client.post(self.url, {"shown": self.picks, "format": "csv"})
        content = b"".join(response.streaming_content)
        self.assertTrue(content.startswith(b"\xef\xbb\xbf"))
        text = content.decode("utf-8-sig").splitlines()
        self.assertEqual(text[0], ",".join(FIELDS))
        self.assertEqual(text[2], "Joy Umezurike,joy@example.com,08055556666,Marketing,HND,,Marketing Officer")

    def test_cvs_in_one_zip(self):
        response = self.client.post(self.url, {"shown": self.picks, "format": "zip"})
        self.assertIn("Marketing Officer - CVs -", response["Content-Disposition"])
        archive = zipfile.ZipFile(io.BytesIO(b"".join(response.streaming_content)))
        names = archive.namelist()
        self.assertTrue(any(n.startswith("Samuel Nelson - CV.") for n in names))
        self.assertIn("No CV on file.txt", names)
        self.assertIn("Joy Umezurike", archive.read("No CV on file.txt").decode())

    def test_email_from_the_portal(self):
        response = self.client.post(self.url, {"shown": self.picks, "deliver": "email", "email_format": "xlsx",
                                               "to": "head@iefcl.com, panel@iefcl.com", "note": "For review",
                                               "next": "/candidates/match/?r=1"})
        self.assertRedirects(response, "/candidates/match/?r=1", fetch_redirect_response=False)
        self.assertEqual(len(mail.outbox), 1)
        sent = mail.outbox[0]
        self.assertEqual((sent.to, sent.cc), (["head@iefcl.com", "panel@iefcl.com"], ["hr@iefcl.com"]))
        self.assertTrue(sent.body.startswith("For review"))
        self.assertEqual(sent.attachments[0][0].split(" - ")[0], "Marketing Officer")
        self.assertTrue(sent.attachments[0][0].endswith(".xlsx"))
        # A bad address sends nothing.
        self.client.post(self.url, {"shown": self.picks, "deliver": "email", "email_format": "zip", "to": "not-an-address"})
        self.assertEqual(len(mail.outbox), 1)

    def test_from_a_vacancys_ranked_list(self):
        page = self.client.get(self.vacancy.get_absolute_url())
        self.assertContains(page, "Download CVs")
        self.assertContains(page, reverse("candidates:cv", args=[self.samuel.pk]))
        response = self.client.post(self.url, {"selected": [self.apps[1].pk], "shown_app": [a.pk for a in self.apps],
                                               "format": "xlsx"})
        rows = self.sheet(response)
        self.assertEqual([r[0] for r in rows[1:]], ["Joy Umezurike"])

    def test_the_match_grid_offers_it(self):
        grid = self.client.get(reverse("candidates:match"), {"r": self.vacancy.pk, "c": [self.samuel.pk, self.joy.pk]})
        self.assertContains(grid, 'name="pick"')
        self.assertContains(grid, "Share the list (Excel)")
        self.assertContains(grid, reverse("candidates:cv", args=[self.samuel.pk]))

    def test_hr_only(self):
        hod = User.objects.create_user("hod", password="x", role=User.Role.HOD)
        self.client.force_login(hod)
        self.assertEqual(self.client.post(self.url, {"shown": self.picks, "format": "xlsx"}).status_code, 403)
        self.assertEqual(self.client.get(reverse("candidates:cv", args=[self.samuel.pk])).status_code, 403)
