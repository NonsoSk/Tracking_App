"""The summary page (home). All names here are made up."""

from datetime import date, datetime, timedelta
from urllib.parse import urlparse

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from accounts.models import User
from candidates.models import Candidate
from candidates.people import STAFF_LIST
from pipeline.models import Application, Interview, InterviewRecord
from requisitions.models import Requisition

from .models import Department, Employee
from .overview import period_for


def at(day, hour=10):
    return timezone.make_aware(datetime(day.year, day.month, day.day, hour))


class PeriodTests(TestCase):
    def test_windows_and_the_period_before(self):
        today = date(2026, 3, 31)
        month = period_for("month", today)
        self.assertEqual((month.start, month.end), (at(date(2026, 3, 1), 0), at(date(2026, 4, 1), 0)))
        self.assertEqual((month.prev_start, month.prev_end), (at(date(2026, 2, 1), 0), at(date(2026, 3, 1), 0)))
        year = period_for("year", today)
        self.assertEqual((year.start, year.step), (at(date(2026, 1, 1), 0), "month"))
        self.assertEqual(year.prev_end, at(date(2025, 4, 1), 0))  # the same time last year
        past = period_for("2024", today)
        self.assertEqual((past.start, past.end), (at(date(2024, 1, 1), 0), at(date(2025, 1, 1), 0)))
        self.assertEqual(period_for("all", today).start, None)
        self.assertEqual(period_for("nonsense", today).key, "year")
        self.assertEqual(period_for("2026", today).key, "year")  # the current year is "This year"


class SummaryTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.prod = Department.objects.create(name="Production", code="PROD")
        self.fin = Department.objects.create(name="Finance", code="FIN")
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        self.hod = User.objects.create_user("hod", password="x", role=User.Role.HOD, department=self.prod)
        self.req = Requisition.objects.create(department=self.prod, title="Panel Operator",
                                              status=Requisition.Status.OPEN, submitted_at=at(self.today))
        self.fin_req = Requisition.objects.create(department=self.fin, title="Accountant",
                                                  status=Requisition.Status.SUBMITTED, submitted_at=at(self.today))

        def person(first, region="", detail="Website application", source="import", day=None):
            c = Candidate.objects.create(first_name=first, last_name="Test", source=source, source_detail=detail)
            Candidate.objects.filter(pk=c.pk).update(region=region, created_at=at(day or self.today))
            c.refresh_from_db()
            return c

        self.ada = person("Ada", "host")
        self.bayo = person("Bayo", "pipeline", detail="", source="referral")
        self.chidi = person("Chidi", "host", day=self.today.replace(year=self.today.year - 1))
        self.dayo = person("Dayo", "")
        self.efe = person("Efe", "niger_delta")
        self.staff_only = person("Femi", "", detail=STAFF_LIST, source="internal")

        Application.objects.create(candidate=self.ada, requisition=self.req, stage="shortlisted",
                                   applied_at=at(self.today), stage_changed_at=at(self.today))
        app_b = Application.objects.create(candidate=self.bayo, requisition=self.req, applied_at=at(self.today))
        Application.objects.create(candidate=self.dayo, requisition=self.fin_req, applied_at=at(self.today))
        Interview.objects.create(application=app_b, scheduled_at=at(self.today, 14))
        InterviewRecord.objects.create(candidate=self.efe, requisition=self.req, interview_date=self.today)

        self.joseph = Employee.objects.create(staff_id="P1", first_name="Joseph", last_name="Staff",
                                              department=self.prod, candidate=self.staff_only)
        self.grace = Employee.objects.create(staff_id="F1", first_name="Grace", last_name="Money", department=self.fin,
                                             candidate=self.efe)

    def test_hiring_roles_land_on_the_summary_and_others_on_their_tasks(self):
        response = self.client.post(reverse("accounts:login"), {"username": "hr", "password": "x"})
        self.assertEqual(urlparse(response["Location"]).path, "/")
        self.client.force_login(self.hr)
        page = self.client.get("/")
        self.assertContains(page, "Recruitment summary")
        self.assertEqual([item["label"] for item in self._nav(self.hr)][:2], ["Summary", "My tasks"])
        self.client.force_login(User.objects.create_user("emp", password="x", role=User.Role.EMPLOYEE))
        self.assertRedirects(self.client.get("/"), reverse("core:dashboard"))
        self.assertEqual(self.client.get(reverse("core:dashboard")).status_code, 200)

    def _nav(self, user):
        from core.templatetags.ds import _nav

        return [i for i in _nav(user) if not i.get("sep")]

    def test_company_figures(self):
        self.client.force_login(self.hr)
        ctx = self.client.get("/").context
        today = ctx["today"]
        # Applied today: everyone who joined today, but not the staff-list profile.
        self.assertEqual(today["applied"], 4)
        self.assertEqual(today["interview_count"], 2)  # one booked in the portal, one from the records
        self.assertEqual(today["shortlisted"], 1)
        kpis = {k["key"]: k["value"] for k in ctx["kpis"]}
        self.assertEqual((kpis["requisitions"], kpis["applicants"], kpis["applications"], kpis["shortlisted"]),
                         (2, 4, 3, 1))
        regions = {r["value"]: r["n"] for r in ctx["regions"]}
        self.assertEqual((regions["host"], regions["pipeline"], regions["niger_delta"], regions["none"]), (1, 1, 1, 1))
        channels = {r["label"]: r["n"] for r in ctx["channels"]}
        self.assertEqual(channels, {"Website application": 3, "Referral": 1})
        rows = {r["department"].code: r for r in ctx["dept_rows"]}
        self.assertEqual((rows["PROD"]["applicants"], rows["PROD"]["open_roles"], rows["FIN"]["applicants"]), (2, 1, 1))

        # A past year, a group and a channel.
        past = self.client.get(f"/?period={self.today.year - 1}").context
        self.assertEqual({k["key"]: k["value"] for k in past["kpis"]}["applicants"], 1)
        host = self.client.get("/?period=all&region=host").context
        self.assertEqual({k["key"]: k["value"] for k in host["kpis"]}["applicants"], 2)
        referral = self.client.get("/?channel=portal:referral").context
        self.assertEqual(referral["today"]["applied"], 1)

    def test_each_figure_opens_the_same_people_in_the_talent_database(self):
        self.client.force_login(self.hr)
        ctx = self.client.get("/?department=%d" % self.prod.pk).context
        host = next(r for r in ctx["regions"] if r["value"] == "host")
        listed = self.client.get(host["url"])
        self.assertEqual(listed.context["total"], host["n"])
        self.assertContains(listed, "People who applied to Production")
        everyone = self.client.get(ctx["talent_url"])
        self.assertEqual(everyone.context["total"], ctx["applicants_total"])

    def test_a_head_of_department_sees_only_their_department_and_its_staff(self):
        self.client.force_login(self.hod)
        page = self.client.get("/?department=%d" % self.fin.pk)  # cannot switch department
        ctx = page.context
        self.assertEqual(ctx["scope"].department, self.prod)
        self.assertEqual({k["key"]: k["value"] for k in ctx["kpis"]}["applications"], 2)
        self.assertEqual(ctx["dept_rows"], [])
        self.assertContains(page, "Staff in Production")
        self.assertContains(page, reverse("candidates:detail", args=[self.staff_only.pk]))
        self.assertNotContains(page, "Grace")
        # Their staff's pages open; another department's staff do not.
        self.assertEqual(self.client.get(reverse("candidates:detail", args=[self.staff_only.pk])).status_code, 200)
        self.assertEqual(self.client.get(reverse("candidates:detail", args=[self.efe.pk])).status_code, 403)
        found = self.client.get("/?staff_q=joseph").context["staff"]
        self.assertEqual([e.staff_id for e in found["people"]], ["P1"])

    def test_insights_point_out_what_needs_attention(self):
        Application.objects.create(candidate=self.chidi, requisition=self.req, applied_at=timezone.now() - timedelta(days=20))
        Requisition.objects.filter(pk=self.fin_req.pk).update(submitted_at=timezone.now() - timedelta(days=10))
        self.client.force_login(self.hr)
        texts = " ".join(str(i["text"]) for i in self.client.get("/").context["insights"])
        self.assertIn("waited more than two weeks to be screened", texts)
        self.assertIn("waited more than a week for approval", texts)
