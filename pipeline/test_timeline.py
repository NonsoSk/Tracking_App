"""Each application's hiring timeline, and who sees the working of the match score. All names here are made up."""

from datetime import date, datetime

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from accounts.models import User
from candidates.models import Candidate, CBTResult
from core.models import Department
from requisitions.models import Requisition

from .matching import score_application
from .models import Activity, Application, Interview, InterviewRecord, Onboarding
from .timeline import build

STAMP_2025_01_10 = 1736510400  # 10 Jan 2025, 12:00 UTC: the website names each resume <time>-<name>


def at(day, hour=10):
    return timezone.make_aware(datetime(day.year, day.month, day.day, hour))


class TimelineTests(TestCase):
    def setUp(self):
        self.dept = Department.objects.create(name="Production", code="PROD")
        self.req = Requisition.objects.create(department=self.dept, title="Process Engineer", status="open",
                                              education_level="bsc", courses=["Chemical Engineering"],
                                              required_skills=["HAZOP"])
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)

    def excel_application(self):
        """As the Excel load makes it: the person's rows, an application from the interview records, onboarding."""
        ada = Candidate.objects.create(first_name="Ada", last_name="Test", source="import", source_records=[
            {"file": "Applications.xlsx", "sheet": "Dump", "row": 2,
             "values": {"Profile_Link": f"https://example.com/resume/{STAMP_2025_01_10}-ada.pdf"}}])
        CBTResult.objects.create(candidate=ada, test_date=date(2024, 2, 26))  # before she applied: not this one
        CBTResult.objects.create(candidate=ada, test_date=date(2025, 1, 30))
        app = Application.objects.create(candidate=ada, requisition=self.req, source="import", stage="onboarding",
                                         decision="select", applied_at=timezone.now())  # the load's fallback
        InterviewRecord.objects.create(candidate=ada, requisition=self.req, application=app,
                                       interview_date=date(2025, 2, 20), result="selected", join_date=date(2025, 5, 5))
        Onboarding.objects.create(application=app, status=Onboarding.Status.IN_PROGRESS)  # made today by the load
        return app

    def test_an_excel_application_uses_only_dates_written_in_excel(self):
        t = build(self.excel_application())
        days = {s.key: s.day for s in t.steps}
        self.assertEqual(days, {"applied": date(2025, 1, 10), "cbt": date(2025, 1, 30), "shortlisted": None,
                                "interview": date(2025, 2, 20), "selected": date(2025, 2, 20), "offer": None,
                                "onboarding": None, "started": date(2025, 5, 5)})
        steps = {s.key: s for s in t.steps}
        self.assertEqual(steps["onboarding"].note, "In progress (no date in Excel)")  # never the day it was loaded
        self.assertIn("Join Date", steps["started"].source)
        self.assertEqual((steps["cbt"].gap, steps["interview"].gap, steps["started"].gap), (20, 21, 74))
        self.assertEqual(t.measure("started")["days"], (date(2025, 5, 5) - date(2025, 1, 10)).days)
        self.assertEqual(t.measure("interview")["days"], 41)
        self.assertIsNone(t.measure("onboarding")["days"])

    def test_without_an_application_date_nothing_is_counted_from_it(self):
        app = self.excel_application()
        app.candidate.source_records = [{"values": {"Name": "Ada Test"}}]  # the CV list gives no date
        app.candidate.save()
        t = build(app)
        self.assertIsNone(t.day("applied"))
        self.assertEqual(t.measure("started")["reason"], "No application date in Excel")

    def test_a_portal_application_uses_its_own_record(self):
        bayo = Candidate.objects.create(first_name="Bayo", last_name="Test", source="portal")
        app = Application.objects.create(candidate=bayo, requisition=self.req, applied_at=at(date(2026, 1, 5)),
                                         stage="hired", status="hired", decision="select",
                                         decided_at=at(date(2026, 1, 25)), hired_at=at(date(2026, 2, 15)))
        Activity.objects.create(application=app, verb="stage", message="Moved from Applied to Shortlisted.")
        Activity.objects.filter(application=app).update(created_at=at(date(2026, 1, 10)))
        Interview.objects.create(application=app, scheduled_at=at(date(2026, 1, 20)))
        onboarding = Onboarding.objects.create(application=app, status=Onboarding.Status.COMPLETED,
                                               start_date=date(2026, 2, 16))
        Onboarding.objects.filter(pk=onboarding.pk).update(created_at=at(date(2026, 2, 1)))
        t = build(Application.objects.get(pk=app.pk))
        self.assertEqual([(s.key, s.day) for s in t.dated], [
            ("applied", date(2026, 1, 5)), ("shortlisted", date(2026, 1, 10)), ("interview", date(2026, 1, 20)),
            ("selected", date(2026, 1, 25)), ("onboarding", date(2026, 2, 1)), ("started", date(2026, 2, 16))])
        self.assertEqual({k: t.measure(k)["days"] for k in ("interview", "selected", "onboarding", "started")},
                         {"interview": 15, "selected": 20, "onboarding": 27, "started": 42})

    def test_pages_show_the_timeline_and_the_chosen_measure(self):
        app = self.excel_application()
        self.client.force_login(self.hr)
        page = self.client.get(reverse("candidates:detail", args=[app.candidate.pk]) + "?until=interview")
        t, m = page.context["timelines"][0]
        self.assertEqual((page.context["until"], m["days"], m["label"]), ("interview", 41, "First interview"))
        self.assertContains(page, "Applications and hiring timeline")
        application = self.client.get(app.get_absolute_url())
        self.assertEqual(application.context["hiring_measure"]["days"], 115)
        self.assertContains(application, "Hiring timeline")


class ScoreBreakdownAccessTests(TestCase):
    def test_hr_sees_the_working_and_a_department_head_sees_the_must_haves(self):
        dept = Department.objects.create(name="Production", code="PROD")
        req = Requisition.objects.create(department=dept, title="Process Engineer", status="open",
                                         education_level="bsc", required_skills=["HAZOP"], tools=["AutoCAD"])
        person = Candidate.objects.create(first_name="Chidi", last_name="Test", source="portal",
                                          highest_qualification="bsc", skills=["HAZOP"], tools=["AutoCAD 2D/3D"])
        app = Application.objects.create(candidate=person, requisition=req)
        score_application(app)
        hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        hod = User.objects.create_user("hod", password="x", role=User.Role.HOD, department=dept)
        self.client.force_login(hr)
        page = self.client.get(app.get_absolute_url())
        self.assertContains(page, "How the score was worked out")
        self.assertContains(page, "Must-haves")
        self.assertContains(page, "the candidate wrote “AutoCAD 2D/3D”")
        self.client.force_login(hod)
        page = self.client.get(app.get_absolute_url())
        self.assertContains(page, "Must-haves")
        self.assertNotContains(page, "How the score was worked out")


class OutOfOrderTests(TestCase):
    def test_only_the_dates_that_do_not_fit_are_flagged(self):
        from .timeline import STEPS, Step, in_order

        days = [date(2026, 10, 22), None, date(2026, 11, 9), date(2026, 9, 30), date(2026, 11, 9), date(2026, 11, 9),
                date(2026, 11, 9), date(2026, 11, 4)]
        steps = [Step(key, label, day) for (key, label), day in zip(STEPS, days)]
        kept = in_order([s for s in steps if s.day])
        self.assertEqual({s.key for s in steps if s.day and s not in kept}, {"interview", "started"})
