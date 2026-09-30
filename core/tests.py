import io
import shutil
import tempfile
from datetime import date, timedelta

from django.core import mail
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from accounts.models import User
from core.models import Department, Employee, Notification
from core.notify import notify
from core.permissions import applications_for, requisitions_for
from pipeline.models import Application, Interview, Offer, Onboarding
from requisitions.models import Requisition

MEDIA = tempfile.mkdtemp(prefix="test-media-")


def tearDownModule():
    shutil.rmtree(MEDIA, ignore_errors=True)


@override_settings(MEDIA_ROOT=MEDIA, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class RetirementTests(TestCase):
    def test_retirement_is_earliest_of_age_and_service(self):
        dept = Department.objects.create(name="Production", code="PROD")
        by_age = Employee.objects.create(staff_id="A1", first_name="A", last_name="B", department=dept,
                                         date_of_birth=date(1970, 5, 1), date_of_employment=date(2005, 1, 1))
        self.assertEqual(by_age.retirement_date, date(2030, 5, 1))
        by_service = Employee.objects.create(staff_id="A2", first_name="C", last_name="D", department=dept,
                                             date_of_birth=date(1975, 5, 1), date_of_employment=date(1995, 1, 1))
        self.assertEqual(by_service.retirement_date, date(2030, 1, 1))

    def test_leap_day_birthday(self):
        e = Employee.objects.create(staff_id="L1", first_name="L", last_name="D", date_of_birth=date(1980, 1, 1),
                                    date_of_employment=date(1996, 2, 29))
        self.assertEqual(e.retirement_date, date(2031, 2, 28))

    def test_alert_command_notifies_department_once(self):
        dept = Department.objects.create(name="Lab", code="LAB")
        hod = User.objects.create_user("hod", password="x", role=User.Role.HOD, department=dept, email="hod@example.com")
        dept.hod = hod
        dept.save()
        soon = timezone.localdate() - timedelta(days=365 * 60 - 40)
        Employee.objects.create(staff_id="R1", first_name="Retiring", last_name="Soon", department=dept, date_of_birth=soon)
        call_command("send_retirement_alerts", stdout=io.StringIO())
        self.assertEqual(Notification.objects.filter(recipient=hod).count(), 1)
        self.assertIn("replace=", Notification.objects.get(recipient=hod).url)
        call_command("send_retirement_alerts", stdout=io.StringIO())
        self.assertEqual(Notification.objects.filter(recipient=hod).count(), 1, "should not re-notify within 90 days")

    def test_staff_import_csv(self):
        dept = Department.objects.create(name="Finance & Accounts", code="FIN")
        hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        self.client.force_login(hr)
        csv_data = ("staff_id,first_name,last_name,department,job_title,date_of_birth,date_of_employment\n"
                    "F1,Ada,Obi,FIN,Accountant,12/03/1970,2001-02-01\n,,,,,,\n")
        upload = io.BytesIO(csv_data.encode())
        upload.name = "staff.csv"
        response = self.client.post(reverse("core:import_employees"), {"file": upload})
        self.assertRedirects(response, reverse("core:employees"))
        employee = Employee.objects.get(staff_id="F1")
        self.assertEqual(employee.department, dept)
        self.assertEqual(employee.date_of_birth, date(1970, 3, 12))


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class NotifyTests(TestCase):
    def test_notify_creates_bell_and_email_and_skips_inactive(self):
        active = User.objects.create_user("a", email="a@example.com", password="x")
        inactive = User.objects.create_user("b", email="b@example.com", password="x", is_active=False)
        count = notify([active, inactive, active], "Hello", "World", url="/x/")
        self.assertEqual(count, 1)
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["a@example.com"])
        self.assertIn("http", mail.outbox[0].alternatives[0][0])


@override_settings(MEDIA_ROOT=MEDIA, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class DemoSmokeTests(TestCase):
    """Loads the full demo data set and opens every screen as every role."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo", password="pw-Demo-123", stdout=io.StringIO())

    def pages_for(self, user):
        urls = [
            reverse("core:dashboard"), reverse("core:notifications"), reverse("pipeline:interviews"),
            reverse("pipeline:interviews") + "?scope=past", reverse("candidates:refer"), reverse("accounts:profile"),
        ]
        if user.is_hr or user.is_department_user or user.is_management:
            urls += [reverse("requisitions:list"), reverse("pipeline:applications"), reverse("core:employees"),
                     reverse("core:employees") + "?view=all", reverse("core:employees") + "?view=exits"]
            for req in requisitions_for(user):
                urls += [req.get_absolute_url(), reverse("requisitions:export", args=[req.pk])]
            for app in applications_for(user):
                urls.append(app.get_absolute_url())
                if app.evaluations.exists():
                    urls.append(reverse("pipeline:selection_report", args=[app.pk]))
        if user.is_hr:
            urls += [reverse("candidates:list"), reverse("candidates:intake"), reverse("candidates:import"),
                     reverse("candidates:create"), reverse("requisitions:create"), reverse("core:import_employees")]
            for req in Requisition.objects.all():
                urls += [reverse("requisitions:edit", args=[req.pk]), reverse("requisitions:advert", args=[req.pk])]
            for app in Application.objects.all():
                urls += [app.candidate.get_absolute_url(), reverse("candidates:edit", args=[app.candidate.pk]),
                         reverse("pipeline:schedule_interview", args=[app.pk])]
            for interview in Interview.objects.all():
                urls += [reverse("pipeline:edit_interview", args=[interview.pk]), reverse("pipeline:ics", args=[interview.pk])]
        if user.is_management or user.is_hr:
            urls.append(reverse("pipeline:offer_reviews"))
            for offer in Offer.objects.all():
                urls.append(reverse("pipeline:offer_review", args=[offer.pk]))
        if user.is_onboarding:
            urls += [reverse("pipeline:onboarding_list"), reverse("pipeline:onboarding_list") + "?show=all"]
            urls += [reverse("pipeline:onboarding", args=[o.pk]) for o in Onboarding.objects.all()]
        for interview in Interview.objects.filter(panel=user):
            urls.append(reverse("pipeline:evaluate", args=[interview.application_id]) + f"?interview={interview.pk}")
        return urls

    def test_every_page_renders_for_every_role(self):
        for user in User.objects.filter(is_active=True):
            self.client.force_login(user)
            for url in self.pages_for(user):
                with self.subTest(user=user.username, url=url):
                    response = self.client.get(url)
                    self.assertEqual(response.status_code, 200, f"{user.username} {url}")

    def test_public_pages(self):
        self.client.logout()
        urls = [reverse("careers:jobs"), reverse("careers:status"), reverse("accounts:login")]
        for req in Requisition.objects.filter(status="open"):
            urls += [reverse("careers:job", args=[req.reference]), reverse("careers:apply", args=[req.reference])]
        for app in Application.objects.all():
            urls.append(reverse("careers:hub", args=[app.token]))
        for url in urls:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_department_user_cannot_see_other_departments(self):
        hod_ict = User.objects.get(username="hod.ict")
        self.client.force_login(hod_ict)
        production_req = Requisition.objects.get(title="Process Engineer")
        self.assertEqual(self.client.get(production_req.get_absolute_url()).status_code, 403)
        app = production_req.applications.first()
        self.assertEqual(self.client.get(app.get_absolute_url()).status_code, 403)
        self.assertEqual(self.client.get(reverse("candidates:list")).status_code, 403)
        doc = app.candidate.documents.first()
        self.assertEqual(self.client.get(reverse("candidates:document", args=[doc.pk])).status_code, 403)

    def test_anonymous_redirected_to_login(self):
        self.client.logout()
        response = self.client.get(reverse("core:dashboard"))
        self.assertEqual(response.status_code, 302)
        self.assertIn(reverse("accounts:login"), response["Location"])

    def test_demo_covers_every_stage(self):
        stages = set(Application.objects.values_list("stage", flat=True))
        self.assertTrue({"applied", "shortlisted", "interview", "decision", "documents", "offer", "medical",
                         "onboarding", "hired"} <= stages)
        self.assertEqual(Requisition.objects.get(title="Laboratory Analyst").status, "filled")
        self.assertTrue(Employee.objects.filter(staff_id="IE0990").exists())
