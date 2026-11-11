import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from accounts.models import User
from core.demo_files import cv_lines, simple_docx
from core.models import Department
from pipeline.models import Application
from requisitions.models import Requisition

from .models import Candidate, CandidateDocument

MEDIA = tempfile.mkdtemp(prefix="test-media-")


def tearDownModule():
    shutil.rmtree(MEDIA, ignore_errors=True)


def cv(first, last, email, name=None, phone=""):
    lines = cv_lines(dict(first=first, last=last, email=email, phone=phone, summary="Accountant", jobs=[],
                          degree="HND", course="Accounting", school="Rivers State Polytechnic", year=2015))
    return SimpleUploadedFile(name or f"{first}.docx", simple_docx(lines))


@override_settings(MEDIA_ROOT=MEDIA)
class ProfileCheckTests(TestCase):
    """A profile read from a CV is checked by HR against the CV before it can be matched or put forward."""

    def setUp(self):
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN, first_name="Ngozi")
        self.client.force_login(self.hr)
        dept = Department.objects.create(name="Finance", code="FIN")
        self.vacancy = Requisition.objects.create(department=dept, title="Accounts Officer", status="approved",
                                                  education_level="hnd", courses=["Accounting"])

    def upload(self, *files, vacancy=None):
        data = {"files": list(files), "source": "email"}
        if vacancy:
            data["requisition"] = vacancy.pk
        return self.client.post(reverse("candidates:intake"), data)

    def confirm(self, person, query="", **changes):
        data = {"first_name": person.first_name, "last_name": person.last_name, "email": person.email,
                "phone": person.phone, "highest_qualification": person.highest_qualification, "course": person.course,
                "years_experience": "3", "confirm": "1", **changes}
        return self.client.post(reverse("candidates:check_profile", args=[person.pk]) + query, data)

    def test_a_vacancy_chosen_at_upload_is_applied_to_once_checked(self):
        self.upload(cv("Ada", "Obi", "ada@example.com"), vacancy=self.vacancy)
        ada = Candidate.objects.get()
        self.assertTrue(ada.needs_check)
        self.assertEqual(ada.pending_requisition, self.vacancy)
        self.assertFalse(Application.objects.exists())

        page = self.client.get(reverse("candidates:check_profile", args=[ada.pk]))
        self.assertContains(page, "Once confirmed, this CV goes to Accounts Officer")
        self.assertEqual(page.context["form"]["first_name"].value(), "Ada")
        html = page.content.decode()
        # The CV beside the form: as a PDF (Word files are turned into one where a converter is installed) or as text.
        self.assertTrue("check-frame" in html or "check-plain" in html)

        response = self.confirm(ada, last_name="Obi-Nwosu")
        self.assertRedirects(response, reverse("candidates:check"), target_status_code=200)
        ada.refresh_from_db()
        self.assertEqual((ada.needs_check, ada.checked_by, ada.last_name, ada.pending_requisition),
                         (False, self.hr, "Obi-Nwosu", None))
        app = Application.objects.get()
        self.assertEqual(app.requisition, self.vacancy)
        self.assertIsNotNone(app.matched_at)

    def test_the_queue_goes_from_one_profile_to_the_next(self):
        self.upload(cv("Ada", "Obi", "ada@example.com", phone="0803 111 2222"),
                    cv("Bola", "Ade", "bola@example.com", phone="0805 333 4444"))
        ada, bola = Candidate.objects.order_by("created_at", "pk")
        query = f"?c={ada.pk}&c={bola.pk}"
        start = self.client.get(reverse("candidates:check") + query)
        self.assertRedirects(start, reverse("candidates:check_profile", args=[ada.pk]) + query)
        page = self.client.get(reverse("candidates:check_profile", args=[ada.pk]) + query)
        self.assertEqual((page.context["place"], page.context["left"]), (1, 2))
        skip = self.client.post(reverse("candidates:check_profile", args=[ada.pk]) + query, {"skip": "1"})
        self.assertRedirects(skip, reverse("candidates:check_profile", args=[bola.pk]) + query)
        self.confirm(bola, query)
        self.confirm(ada, query)
        done = self.client.get(reverse("candidates:check") + query)
        self.assertContains(done, "All checked")
        self.assertContains(done, "Match these CVs to vacancies")

    def test_a_name_and_a_way_to_reach_them_are_needed(self):
        self.upload(cv("Ada", "Obi", "ada@example.com"))
        ada = Candidate.objects.get()
        response = self.confirm(ada, first_name="", email="", phone="")
        self.assertEqual(response.status_code, 200)
        form = response.context["form"]
        self.assertIn("first_name", form.errors)
        self.assertIn("Give an email address or a phone number", str(form.non_field_errors()))
        ada.refresh_from_db()
        self.assertTrue(ada.needs_check)

    def test_another_profile_with_the_same_email_is_flagged(self):
        Candidate.objects.create(first_name="Ada", last_name="Obi", email="ada.obi@example.com")
        self.upload(cv("Ada", "Obi", "ada2@example.com"))
        copy = Candidate.objects.get(email="ada2@example.com")
        response = self.confirm(copy, email="ada.obi@example.com")
        self.assertIn("already has this email address", str(response.context["form"].errors["email"]))

    def test_not_a_cv_is_deleted_with_its_file(self):
        self.upload(cv("Ada", "Obi", "ada@example.com"))
        ada = Candidate.objects.get()
        document = CandidateDocument.objects.get()
        path = document.file.path
        response = self.client.post(reverse("candidates:check_profile", args=[ada.pk]), {"delete": "1"})
        self.assertRedirects(response, reverse("candidates:check"), target_status_code=200)
        self.assertFalse(Candidate.objects.exists())
        import os

        self.assertFalse(os.path.exists(path))

    def test_an_unchecked_profile_cannot_be_put_forward(self):
        self.upload(cv("Ada", "Obi", "ada@example.com"))
        ada = Candidate.objects.get()
        response = self.client.post(reverse("candidates:add_to_requisition", args=[ada.pk]),
                                    {"requisition": self.vacancy.pk})
        self.assertRedirects(response, reverse("candidates:check_profile", args=[ada.pk]))
        self.client.post(reverse("candidates:match_add"), {"pair": [f"{ada.pk}:{self.vacancy.pk}"]})
        self.assertFalse(Application.objects.exists())
        profile = self.client.get(ada.get_absolute_url())
        self.assertContains(profile, "has not been checked yet")
        talent = self.client.get(reverse("candidates:list"))
        self.assertContains(talent, "Check 1 new profile")

    def test_a_cv_for_someone_already_checked_updates_them_without_a_new_check(self):
        known = Candidate.objects.create(first_name="Ada", last_name="Obi", email="ada@example.com")
        self.upload(cv("Ada", "Obi", "ada@example.com"), vacancy=self.vacancy)
        known.refresh_from_db()
        self.assertFalse(known.needs_check)
        self.assertTrue(Application.objects.filter(candidate=known, requisition=self.vacancy).exists())

    def test_hr_only(self):
        self.upload(cv("Ada", "Obi", "ada@example.com"))
        ada = Candidate.objects.get()
        hod = User.objects.create_user("hod", password="x", role=User.Role.HOD)
        self.client.force_login(hod)
        self.assertEqual(self.client.get(reverse("candidates:check_profile", args=[ada.pk])).status_code, 403)
