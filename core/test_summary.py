"""The summary page (home): every figure is what the Excel workbooks say. All names here are made up."""

import os
import shutil
import tempfile
from collections import Counter
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from urllib.parse import urlparse

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from accounts.models import User
from candidates.dates import applied_on_from
from candidates.models import Candidate
from pipeline.models import Application, InterviewRecord
from requisitions.models import Requisition

from .models import Department, Employee
from .overview import period_for
from .test_applications import HEADERS as WEB_HEADERS
from .test_applications import row as web_row
from .test_workbook_import import (CBT_HEADERS, CV_HEADERS, IV_HEADERS, REQ_HEADERS, STAFF_HEADERS, cbt_rows, cv_rows,
                                   iv_rows, req_rows, staff_rows, write)
from .workbook_import import WorkbookImporter

NOON_2024_06_01 = 1717243200  # 1 Jun 2024, 12:00 UTC
NOON_2025_03_01 = 1740830400  # 1 Mar 2025, 12:00 UTC


def local_day(stamp):
    return datetime.fromtimestamp(stamp, tz=dt_timezone.utc).astimezone(timezone.get_current_timezone()).date()


class PeriodTests(TestCase):
    def test_windows_and_the_period_before(self):
        today = date(2026, 3, 31)
        month = period_for("month", today)
        self.assertEqual((month.first, month.end), (date(2026, 3, 1), date(2026, 4, 1)))
        self.assertEqual((month.prev_first, month.prev_end), (date(2026, 2, 1), date(2026, 3, 1)))
        year = period_for("year", today)
        self.assertEqual((year.first, year.step, year.prev_end), (date(2026, 1, 1), "month", date(2025, 4, 1)))
        past = period_for("2024", today)
        self.assertEqual((past.first, past.end), (date(2024, 1, 1), date(2025, 1, 1)))
        self.assertIsNone(period_for("all", today).first)
        self.assertEqual(period_for("nonsense", today).key, "year")
        self.assertEqual(period_for("2026", today).key, "year")  # the current year is "This year"


class ApplicationDateTests(TestCase):
    def test_dates_come_only_from_the_records(self):
        link = {"values": {"Profile_Link": f"https://example.com/resume/{NOON_2025_03_01}-ada.pdf"}}
        column = {"values": {"Date Applied": datetime(2024, 6, 1)}}
        undated = {"values": {"Name": "Ada", "Source": "Job portal"}}
        self.assertEqual(applied_on_from([link]), local_day(NOON_2025_03_01))
        self.assertEqual(applied_on_from([link, column]), date(2024, 6, 1))  # the earliest
        self.assertIsNone(applied_on_from([undated]))
        self.assertIsNone(applied_on_from([{"values": {"Profile_Link": "https://example.com/resume/cv.pdf"}}]))
        # Loaded today from Excel without a date: no date. Applied through the careers page today: today.
        loaded = Candidate.objects.create(first_name="Ada", last_name="Loaded", source="import", source_records=[undated])
        portal = Candidate.objects.create(first_name="Bayo", last_name="Portal", source="portal")
        self.assertIsNone(loaded.applied_on)
        self.assertEqual(portal.applied_on, timezone.localdate())


class SummaryMatchesExcelTests(TestCase):
    """Load the test workbooks, then check every summary figure against the workbook rows themselves."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        master, cv, web = (os.path.join(self.dir, n) for n in ("Master.xlsx", "CV.xlsx", "Applications.xlsx"))
        write(master, [("Manpower_Requisition_Summary", REQ_HEADERS, req_rows()),
                       ("Recruitment_Interview Records", IV_HEADERS, iv_rows()),
                       ("Recruitment_CBTs", CBT_HEADERS, cbt_rows()),
                       ("Retirement Forecast_3 Years Pro", STAFF_HEADERS, staff_rows())])
        write(cv, [("CV Dump", CV_HEADERS, cv_rows())])
        self.web_rows = [
            web_row("Ngozi Webapplicant", (1999, 9, 9), "Female", "ngozi.web@example.com", "08077776666",
                    f"{NOON_2024_06_01}-ngozi.pdf"),
            web_row("Uche Webapplicant", (1998, 1, 2), "Male", "uche.web@example.com", "08077775555",
                    f"{NOON_2025_03_01}-uche.pdf"),
        ]
        write(web, [("ApplicationS Dump_Indorama", WEB_HEADERS, self.web_rows)])
        WorkbookImporter([master, cv, web], replace=True, report_dir=None, log=lambda *a: None).run()
        self.hr = User.objects.create_user("hr.owner", password="x", role=User.Role.HR_ADMIN)
        self.client.force_login(self.hr)
        self.tracker = [dict(zip(REQ_HEADERS, r)) for r in req_rows() if r[0]]

    def page(self, query=""):
        return self.client.get("/" + query).context

    def tracker_sum(self, column, year=None):
        return sum(r[column] or 0 for r in self.tracker if year is None or r["Requisition Date"].year == year)

    def test_all_time_figures_equal_the_workbook(self):
        ctx = self.page("?period=all")
        kpis = {k["label"]: k for k in ctx["kpis"]}
        self.assertEqual(kpis["Requisitions"]["value"], len(self.tracker))
        self.assertEqual(kpis["Requisitions"]["note"], f"{self.tracker_sum('Manpower Required')} positions")
        self.assertEqual(kpis["Shortlisted for interview"]["value"], self.tracker_sum("Shortlisted for Interview"))
        self.assertEqual(kpis["Onboarded"]["value"], self.tracker_sum("Onboarded  #"))
        funnel = {s["label"]: s["n"] for s in ctx["funnel"]["steps"]}
        self.assertEqual(funnel, {"Participants": self.tracker_sum("Participants"),
                                  "Shortlisted": self.tracker_sum("Shortlisted for Interview"),
                                  "Selected": self.tracker_sum("Selected"), "Onboarded": self.tracker_sum("Onboarded  #")})
        self.assertEqual((ctx["funnel"]["rejected"], ctx["funnel"]["on_hold"], ctx["funnel"]["in_progress"]),
                         (self.tracker_sum("Rejected"), self.tracker_sum("On-Hold"), self.tracker_sum("In Progres")))
        # The status exactly as the tracker writes it, not the portal's own status names.
        self.assertEqual({s["label"]: s["n"] for s in ctx["statuses"]}, dict(Counter(r["Status"] for r in self.tracker)))
        dated_interviews = [r for r in iv_rows() if r[IV_HEADERS.index("Date")]]
        self.assertEqual(kpis["Interviews"]["value"], len(dated_interviews))
        self.assertEqual(kpis["Interviews"]["note"],
                         f"{sum(1 for r in dated_interviews if r[IV_HEADERS.index('Remarks_Query')] == 'Selected')} selected")
        active = [r for r in staff_rows() if not r[STAFF_HEADERS.index("Release Date")]]
        self.assertEqual(kpis["Current staff"]["value"], len(active))

    def test_a_year_counts_only_what_excel_dates_in_that_year(self):
        ctx = self.page("?period=2025")
        kpis = {k["label"]: k["value"] for k in ctx["kpis"]}
        self.assertEqual(kpis["Requisitions"], sum(1 for r in self.tracker if r["Requisition Date"].year == 2025))
        self.assertEqual(kpis["Onboarded"], self.tracker_sum("Onboarded  #", 2025))
        self.assertEqual(kpis["Interviews"], sum(1 for r in iv_rows() if r[IV_HEADERS.index("Date")].year == 2025))
        # Applicants by the moment in their resume link: Uche applied in 2025, Ngozi in 2024.
        self.assertEqual(kpis["Applicants"], 1)
        self.assertEqual(self.page("?period=2024")["kpis"][1]["value"], 1)
        # People in the CV list have no date in Excel: never counted as applying in a year, but counted overall.
        cv_people = Candidate.objects.filter(applied_on=None).exclude(source_detail="Staff list").count()
        self.assertGreater(cv_people, 0)
        self.assertEqual(ctx["undated_applicants"], cv_people)
        self.assertEqual(self.page("?period=all")["kpis"][1]["value"],
                         Candidate.objects.exclude(source_detail="Staff list").count())

    def test_nothing_is_dated_by_the_day_it_was_loaded(self):
        ctx = self.page("?period=today")
        today = {t["label"]: t["value"] for t in ctx["today"]}
        self.assertEqual(today, {"Applied": 0, "Interviews": 0, "CBTs": 0, "Requisitions received": 0})
        self.assertEqual({k["label"]: k["value"] for k in ctx["kpis"]}["Applicants"], 0)
        self.assertEqual(ctx["trend"]["total"], 0)

    def test_dates_and_retirement_follow_the_workbook(self):
        ada = Application.objects.get(candidate__first_name="Ada", requisition__reference="Req_900")
        self.assertEqual(timezone.localtime(ada.hired_at).date(), date(2025, 5, 5))  # Join Date
        web = Candidate.objects.get(email="uche.web@example.com")
        self.assertEqual(web.applied_on, local_day(NOON_2025_03_01))
        # Age 21 + Years to Retirement 39 on the staff list: retires at 60, not after 35 years' service.
        trainee = Employee.objects.get(staff_id="FDT9002")
        self.assertEqual((trainee.retirement_age, trainee.retirement_date), (60, date(2064, 11, 25)))
        req = Requisition.objects.get(reference="Req_901")
        self.assertEqual(timezone.localtime(req.submitted_at).date(), date(2026, 8, 10))

    def test_group_figures_open_the_same_people_in_the_talent_database(self):
        ctx = self.page("?period=all")
        for r in ctx["regions"]:
            if r["n"]:
                self.assertEqual(self.client.get(r["url"]).context["total"], r["n"], r["label"])
        self.assertEqual(self.client.get(ctx["talent_url"]).context["total"], ctx["applicants_total"])
        year = self.page("?period=2025")
        self.assertEqual(self.client.get(year["talent_url"]).context["total"], year["applicants_total"])


class SummaryAccessTests(TestCase):
    def setUp(self):
        self.prod = Department.objects.create(name="Production", code="PROD")
        self.fin = Department.objects.create(name="Finance", code="FIN")
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        self.hod = User.objects.create_user("hod", password="x", role=User.Role.HOD, department=self.prod)
        when = timezone.now() - timedelta(days=2)
        self.req = Requisition.objects.create(department=self.prod, title="Panel Operator", positions=3,
                                              status=Requisition.Status.OPEN, submitted_at=when)
        self.fin_req = Requisition.objects.create(department=self.fin, title="Accountant",
                                                  status=Requisition.Status.SUBMITTED, submitted_at=when)
        self.ada = Candidate.objects.create(first_name="Ada", last_name="Test", source="portal")
        self.efe = Candidate.objects.create(first_name="Efe", last_name="Test", source="portal")
        self.joseph_page = Candidate.objects.create(first_name="Joseph", last_name="Staff", source="internal",
                                                    source_detail="Staff list")
        Application.objects.create(candidate=self.ada, requisition=self.req, stage="shortlisted")
        Application.objects.create(candidate=self.efe, requisition=self.fin_req)
        InterviewRecord.objects.create(candidate=self.ada, requisition=self.req, interview_date=timezone.localdate())
        Employee.objects.create(staff_id="P1", first_name="Joseph", last_name="Staff", department=self.prod,
                                candidate=self.joseph_page)
        Employee.objects.create(staff_id="F1", first_name="Grace", last_name="Money", department=self.fin,
                                candidate=self.efe)

    def test_hiring_roles_land_on_the_summary_and_others_on_their_tasks(self):
        response = self.client.post(reverse("accounts:login"), {"username": "hr", "password": "x"})
        self.assertEqual(urlparse(response["Location"]).path, "/")
        from core.templatetags.ds import _nav

        self.assertEqual([i["label"] for i in _nav(self.hr) if not i.get("sep")][:2], ["Summary", "My tasks"])
        self.client.force_login(User.objects.create_user("emp", password="x", role=User.Role.EMPLOYEE))
        self.assertRedirects(self.client.get("/"), reverse("core:dashboard"))

    def test_portal_requisitions_count_with_their_own_figures(self):
        self.client.force_login(self.hr)
        ctx = self.client.get("/?period=month").context
        kpis = {k["label"]: k["value"] for k in ctx["kpis"]}
        self.assertEqual((kpis["Requisitions"], kpis["Shortlisted for interview"], kpis["Interviews"]), (2, 1, 1))
        self.assertEqual({s["label"]: s["n"] for s in ctx["statuses"]}, {"Awaiting approval": 1, "Open": 1})
        self.assertEqual({t["label"]: t["value"] for t in ctx["today"]}["Applied"], 3 - 1)  # the staff page is no applicant

    def test_a_head_of_department_sees_only_their_department(self):
        self.client.force_login(self.hod)
        ctx = self.client.get("/?department=%d" % self.fin.pk).context  # cannot switch department
        self.assertEqual(ctx["scope"].department, self.prod)
        kpis = {k["label"]: k["value"] for k in ctx["kpis"]}
        self.assertEqual((kpis["Requisitions"], kpis["Applicants"], kpis["Current staff"]), (1, 1, 1))
        self.assertIsNone(ctx["depts"])
        # Their staff's pages open; another department's staff do not.
        self.assertEqual(self.client.get(reverse("candidates:detail", args=[self.joseph_page.pk])).status_code, 200)
        self.assertEqual(self.client.get(reverse("candidates:detail", args=[self.efe.pk])).status_code, 403)
        staff_list = self.client.get(reverse("core:employees") + "?view=all")
        self.assertContains(staff_list, reverse("candidates:detail", args=[self.joseph_page.pk]))
