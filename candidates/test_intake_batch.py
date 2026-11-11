import shutil
import tempfile
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from accounts.models import User
from core.demo_files import cv_lines, simple_docx

from .models import Candidate

MEDIA = tempfile.mkdtemp(prefix="test-media-")


def tearDownModule():
    shutil.rmtree(MEDIA, ignore_errors=True)


def cv(first, email, name=None):
    lines = cv_lines(dict(first=first, last="Test", email=email, phone="", summary="Accountant", jobs=[], degree="HND",
                          course="Accounting", school="Rivers State Polytechnic", year=2015))
    return SimpleUploadedFile(name or f"{first}.docx", simple_docx(lines))


@override_settings(MEDIA_ROOT=MEDIA)
class ManyCvsTests(TestCase):
    """A folder of CVs goes in at once: a stray file is set aside, and a big selection arrives in batches."""

    def setUp(self):
        self.client.force_login(User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN))
        self.url = reverse("candidates:intake")

    def test_the_page_offers_a_folder_and_limits_the_picker_to_cv_files(self):
        response = self.client.get(self.url)
        self.assertContains(response, "Choose a whole folder")
        self.assertContains(response, 'webkitdirectory')
        self.assertContains(response, 'accept=".bmp,.doc,.docx,')
        self.assertContains(response, 'data-max-mb="10"')
        self.assertContains(response, 'data-batch-upload="5"')

    @override_settings(MAX_UPLOAD_MB=1)
    def test_a_stray_or_oversized_file_is_set_aside_and_the_rest_are_read(self):
        files = [cv("Ada", "ada@example.com"), SimpleUploadedFile("applicants.xlsx", b"PK\x03\x04 not a cv"),
                 SimpleUploadedFile("huge.txt", b"x" * (1024 * 1024 + 1))]
        response = self.client.post(self.url, {"files": files, "source": "email"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(Candidate.objects.filter(email="ada@example.com").exists())
        errors = {name: r.error for name, r in response.context["results"]}
        self.assertIn("not a file type the portal reads (.xlsx)", errors["applicants.xlsx"])
        self.assertIn("larger than 1 MB", errors["huge.txt"])
        self.assertEqual((response.context["read_count"], response.context["problem_count"]), (1, 2))
        self.assertContains(response, "2 not read")

    def test_a_file_that_breaks_the_reader_does_not_stop_the_others(self):
        from . import views

        real = views.ingest_cv

        def flaky(content, filename, **kw):
            if filename == "broken.docx":
                raise ValueError("corrupt file")
            return real(content, filename, **kw)

        with mock.patch.object(views, "ingest_cv", side_effect=flaky):
            response = self.client.post(self.url, {"files": [cv("Bad", "bad@example.com", "broken.docx"),
                                                             cv("Ada", "ada@example.com")], "source": "email"})
        errors = {name: r.error for name, r in response.context["results"]}
        self.assertIn("Could not be read", errors["broken.docx"])
        self.assertEqual(errors["Ada.docx"], "")
        self.assertEqual(list(Candidate.objects.values_list("email", flat=True)), ["ada@example.com"])

    def test_a_big_selection_arrives_in_batches_then_shows_every_result(self):
        token = "run12345abc"
        first = self.client.post(self.url, {"files": [cv("Ada", "ada@example.com"), cv("Bola", "bola@example.com")],
                                            "source": "email"}, HTTP_X_INTAKE_BATCH=token)
        self.assertEqual(first.json(), {"results": [{"name": "Ada.docx", "ok": True, "error": ""},
                                                    {"name": "Bola.docx", "ok": True, "error": ""}]})
        second = self.client.post(self.url, {"files": [cv("Chidi", "chidi@example.com"),
                                                       SimpleUploadedFile("notes.zip", b"zip")], "source": "email"},
                                  HTTP_X_INTAKE_BATCH=token)
        self.assertEqual([r["ok"] for r in second.json()["results"]], [True, False])
        self.assertEqual(Candidate.objects.count(), 3)

        page = self.client.get(self.url, {"run": token, "lost": ["Dayo.pdf"]})
        names = [name for name, _ in page.context["results"]]
        self.assertEqual(names, ["Ada.docx", "Bola.docx", "Chidi.docx", "notes.zip"])
        self.assertEqual((page.context["read_count"], page.context["problem_count"]), (3, 1))
        self.assertContains(page, "Match these 3 CVs to vacancies")
        ids = sorted(Candidate.objects.values_list("pk", flat=True))
        self.assertEqual(page.context["match_url"], reverse("candidates:match") + "?" + "&".join(f"c={i}" for i in ids))
        self.assertContains(page, "1 file could not be sent")
        self.assertContains(page, "Dayo.pdf")

    def test_a_batch_with_nothing_to_read_says_why(self):
        response = self.client.post(self.url, {"source": "email"}, HTTP_X_INTAKE_BATCH="run12345abc")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(response.json()["error"])

    def test_an_unknown_run_shows_the_empty_page(self):
        response = self.client.get(self.url, {"run": "nosuchrun123"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["results"], [])

    def test_only_the_last_few_runs_are_kept(self):
        for n in range(5):
            self.client.post(self.url, {"files": [cv(f"P{n}", f"p{n}@example.com")], "source": "email"},
                             HTTP_X_INTAKE_BATCH=f"run{n}abcdefg")
        runs = self.client.session["intake_runs"]
        self.assertEqual(list(runs), ["run2abcdefg", "run3abcdefg", "run4abcdefg"])
