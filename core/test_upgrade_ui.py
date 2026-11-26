"""Home's day view, and two people editing the same record at once."""

from datetime import timedelta

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from accounts.models import User
from candidates.models import Candidate
from core.concurrency import version_of
from core.models import Department, WatchedFolder
from intake.models import Receipt
from requisitions.models import Requisition


class HomeTodayTests(TestCase):
    def setUp(self):
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        self.client.force_login(self.hr)

    def test_new_arrivals_what_needs_a_person_and_problems(self):
        ada = Candidate.objects.create(first_name="Ada", last_name="Obi")
        Receipt.objects.create(channel="upload", original_name="Ada.pdf", sha256="a", status="done", outcome="added",
                               candidate=ada, finished_at=timezone.now())
        Receipt.objects.create(channel="upload", original_name="Peter.pdf", sha256="b", status="needs_review",
                               outcome="identity", candidate=ada)
        folder = WatchedFolder.objects.create(path="/nowhere", label="Emailed CVs", state="missing",
                                              message="The folder is not there.")
        WatchedFolder.objects.filter(pk=folder.pk).update(created_at=timezone.now() - timedelta(hours=1))
        page = self.client.get(reverse("core:summary"))
        today = page.context["day"]
        self.assertEqual(today["arrivals"]["cvs_added"], 1)
        self.assertEqual(today["action"]["files"], 1)
        texts = " ".join(text for text, _ in today["problems"])
        self.assertIn("background worker is not running", texts)
        self.assertIn("Emailed CVs", texts)
        self.assertContains(page, "Needs a person")


class SimultaneousEditTests(TestCase):
    def setUp(self):
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        self.client.force_login(self.hr)

    def test_a_profile_saved_by_someone_else_meanwhile_is_not_overwritten(self):
        person = Candidate.objects.create(first_name="Ada", last_name="Obi", email="ada@example.com", phone="0801")
        url = reverse("candidates:edit", args=[person.pk])
        form = self.client.get(url)
        opened = form.context["edit_version"]
        # A colleague saves the profile while this form is open.
        Candidate.objects.filter(pk=person.pk).update(phone="0802",
                                                      updated_at=timezone.now() + timedelta(seconds=1))
        data = {**{k: v for k, v in form.context["form"].initial.items() if v is not None and not isinstance(v, list)},
                "first_name": "Adaeze", "last_name": "Obi", "email": "ada@example.com", "edited_version": opened}
        refused = self.client.post(url, data)
        self.assertEqual(refused.status_code, 200)
        self.assertContains(refused, "Someone else saved this profile")
        person.refresh_from_db()
        self.assertEqual((person.first_name, person.phone), ("Ada", "0802"))  # nothing overwritten
        self.assertEqual(refused.context["edit_version"], version_of(person))  # a second save is on purpose

    def test_a_requisition_edit_is_refused_the_same_way(self):
        dept = Department.objects.create(name="Finance", code="FIN")
        req = Requisition.objects.create(department=dept, title="Accounts Officer", status="draft")
        Requisition.objects.filter(pk=req.pk).update(updated_at=timezone.now() + timedelta(seconds=5))
        response = self.client.post(reverse("requisitions:edit", args=[req.pk]),
                                    {"title": "Changed", "edited_version": version_of(req)})
        self.assertContains(response, "Someone else saved this requisition")
        req.refresh_from_db()
        self.assertEqual(req.title, "Accounts Officer")
