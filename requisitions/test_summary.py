import io
from datetime import datetime, timedelta
from unittest import mock

from django.core import mail
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from accounts.models import User
from candidates.models import Candidate
from core.models import Department, Notification
from pipeline.models import Activity, Application, Stage
from pipeline.services import create_application, move_to_stage, set_status

from .models import Requisition
from .summary import awaiting_review, is_due


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class DepartmentSummaryTests(TestCase):
    def setUp(self):
        self.prod = Department.objects.create(name="Production", code="PROD", email="production@example.com")
        self.hod = User.objects.create_user("hod", password="x", role=User.Role.HOD, department=self.prod,
                                            email="hod@example.com", first_name="Ada", last_name="Obi")
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN, email="hr@example.com")
        self.req = Requisition.objects.create(department=self.prod, title="Panel Operator", positions=2,
                                              status=Requisition.Status.OPEN, required_skills=["DCS"],
                                              education_level="", hr_owner=self.hr)
        self.apps = {}
        for name, skills in (("Bola", ["DCS"]), ("Chidi", ["DCS"]), ("Dayo", []), ("Efe", [])):
            cand = Candidate.objects.create(first_name=name, last_name="Test", skills=skills,
                                            email=f"{name.lower()}@mail.com", phone="08030000000")
            self.apps[name], _ = create_application(cand, self.req, notify_team=False)
        for name in ("Bola", "Chidi"):
            move_to_stage(self.apps[name], Stage.SHORTLISTED, quiet=True)
        set_status(self.apps["Efe"], Application.Status.REJECTED, reason="Not shortlisted")

    def test_send_now_emails_the_department_with_counts_profiles_and_attachment(self):
        self.client.force_login(self.hr)
        response = self.client.post(reverse("requisitions:summary", args=[self.req.pk]),
                                    {"send": "1", "summary_frequency": "off", "note": "Please reply by Friday."})
        self.assertRedirects(response, self.req.get_absolute_url() + "?tab=activity")
        self.assertEqual(len(mail.outbox), 1)
        email = mail.outbox[0]
        self.assertEqual(sorted(email.to), ["hod@example.com", "production@example.com"])
        self.assertEqual(email.cc, ["hr@example.com"])
        self.assertIn("Candidate summary: Panel Operator", email.subject)
        text = email.body
        for line in ("Please reply by Friday.", "2 shortlisted candidates are waiting for your approval",
                     "Applied in total: 4", "Shortlisted: 2", "Waiting to be screened: 1",
                     "Not progressing (rejected, withdrawn or not engaged): 1", "Hired (of 2 positions): 0",
                     "Bola Test", "Awaiting your approval", "/review/"):
            self.assertIn(line, text)
        html = email.alternatives[0][0]
        self.assertIn("Shortlisted candidates", html)
        self.assertIn("Review the shortlist", html)
        # The attachment lists every applicant, with no contact details.
        name, content, mimetype = email.attachments[0]
        self.assertTrue(name.endswith("-candidates.xlsx"))
        from openpyxl import load_workbook

        rows = list(load_workbook(io.BytesIO(content)).active.values)
        self.assertEqual(len(rows), 5)
        self.assertNotIn("bola@mail.com", str(rows))
        self.assertNotIn("08030000000", str(rows))
        self.req.refresh_from_db()
        self.assertIsNotNone(self.req.summary_sent_at)
        self.assertTrue(Activity.objects.filter(requisition=self.req, verb="summary").exists())
        self.assertTrue(Notification.objects.filter(recipient=self.hod, title__startswith="Candidate summary").exists())

    def test_department_without_email_is_told_not_sent(self):
        self.prod.email = ""
        self.prod.save()
        self.hod.email = ""
        self.hod.save()
        self.client.force_login(self.hr)
        response = self.client.post(reverse("requisitions:summary", args=[self.req.pk]), {"send": "1"}, follow=True)
        self.assertContains(response, "has no email address yet")
        self.assertEqual(len(mail.outbox), 0)

    def test_only_hr_sends_and_previews(self):
        self.client.force_login(self.hod)
        self.assertEqual(self.client.post(reverse("requisitions:summary", args=[self.req.pk]), {"send": "1"}).status_code, 403)
        self.assertEqual(self.client.get(reverse("requisitions:summary_preview", args=[self.req.pk])).status_code, 403)
        self.client.force_login(self.hr)
        preview = self.client.get(reverse("requisitions:summary_preview", args=[self.req.pk]))
        self.assertContains(preview, "Bola Test")
        self.assertEqual(len(mail.outbox), 0)

    def test_hod_approves_and_declines_and_hr_hears_back(self):
        self.client.force_login(self.hod)
        page = self.client.get(reverse("requisitions:review", args=[self.req.pk]))
        self.assertEqual([a.candidate.first_name for a in page.context["waiting"]], ["Bola", "Chidi"])
        self.client.post(reverse("requisitions:review", args=[self.req.pk]),
                         {"application": self.apps["Bola"].pk, "answer": "approved", "note": "Strong on DCS"})
        self.apps["Bola"].refresh_from_db()
        self.assertEqual(self.apps["Bola"].current_department_review, "approved")
        self.assertEqual(self.apps["Bola"].department_reviewed_by, self.hod)
        self.assertEqual(list(awaiting_review(self.req)), [self.apps["Chidi"]])
        self.client.post(reverse("requisitions:review", args=[self.req.pk]),
                         {"application": self.apps["Chidi"].pk, "answer": "declined"})
        done = Notification.objects.get(recipient=self.hr, title__contains="has reviewed the shortlist")
        self.assertIn("1 approved to move on to interviews, 1 not approved", done.message)
        # Once the candidate moves on, the answer belongs to the earlier stage.
        move_to_stage(self.apps["Bola"], Stage.INTERVIEW, quiet=True)
        self.apps["Bola"].refresh_from_db()
        self.assertEqual(self.apps["Bola"].current_department_review, "")
        self.assertEqual(self.apps["Bola"].department_review, "approved")

    def test_review_is_for_the_department_and_hr_only(self):
        other = Department.objects.create(name="IT", code="ICT")
        outsider = User.objects.create_user("ict", password="x", role=User.Role.HOD, department=other)
        self.client.force_login(outsider)
        self.assertEqual(self.client.get(reverse("requisitions:review", args=[self.req.pk])).status_code, 403)
        # Candidates not on the shortlist cannot be answered for.
        self.client.force_login(self.hod)
        self.client.post(reverse("requisitions:review", args=[self.req.pk]),
                         {"application": self.apps["Dayo"].pk, "answer": "approved"})
        self.apps["Dayo"].refresh_from_db()
        self.assertEqual(self.apps["Dayo"].department_review, "")

    def test_hod_sees_the_task_and_the_banner(self):
        self.client.force_login(self.hod)
        home = self.client.get(reverse("core:dashboard"))
        self.assertContains(home, "Approve the shortlist for <b>Panel Operator</b>", html=False)
        detail = self.client.get(self.req.get_absolute_url())
        self.assertContains(detail, "2 shortlisted candidates waiting for your approval")
        self.assertContains(detail, reverse("requisitions:review", args=[self.req.pk]))

    def test_schedule_is_saved_and_the_command_sends_when_due(self):
        self.client.force_login(self.hr)
        self.client.post(reverse("requisitions:summary", args=[self.req.pk]), {"summary_frequency": "weekly", "save": "1"})
        self.req.refresh_from_db()
        self.assertEqual(self.req.summary_frequency, "weekly")
        self.assertEqual(len(mail.outbox), 0)

        monday_9am = timezone.make_aware(datetime(2026, 10, 19, 9, 0))
        with mock.patch("django.utils.timezone.now", return_value=monday_9am):
            call_command("send_department_summaries", stdout=io.StringIO())
            call_command("send_department_summaries", stdout=io.StringIO())
        self.assertEqual(len(mail.outbox), 1)
        self.req.refresh_from_db()
        self.assertFalse(is_due(self.req, monday_9am + timedelta(days=6)))
        self.assertTrue(is_due(self.req, monday_9am + timedelta(days=7)))

    def test_when_summaries_are_due(self):
        monday = timezone.make_aware(datetime(2026, 10, 19, 9, 0))
        self.req.summary_frequency = "daily"
        self.assertTrue(is_due(self.req, monday))
        self.assertFalse(is_due(self.req, monday.replace(hour=6)))  # before SUMMARY_EMAIL_HOUR
        self.assertFalse(is_due(self.req, monday + timedelta(days=5)))  # Saturday
        self.req.summary_sent_at = monday
        self.assertFalse(is_due(self.req, monday + timedelta(hours=3)))
        self.assertTrue(is_due(self.req, monday + timedelta(days=1)))
        self.req.summary_frequency = "off"
        self.assertFalse(is_due(self.req, monday + timedelta(days=1)))
        self.req.summary_frequency = "daily"
        self.req.status = Requisition.Status.FILLED
        self.assertFalse(is_due(self.req, monday + timedelta(days=1)))
