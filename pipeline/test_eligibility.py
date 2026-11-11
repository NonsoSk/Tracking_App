from django.test import TestCase
from django.urls import reverse

from accounts.models import User
from candidates.models import Candidate
from core.models import Department
from requisitions.models import Requisition

from .models import Application, Stage
from .services import auto_shortlist, create_application


class HiringManagerDecidesTests(TestCase):
    """Missing a key requirement never zeroes a score or rules a candidate out: the hiring manager decides."""

    def setUp(self):
        self.hr_dept = Department.objects.create(name="Human Resources", code="HR")
        self.other = Department.objects.create(name="Finance", code="FIN")
        self.req = Requisition.objects.create(
            department=self.hr_dept, title="HR Officer", status="open", employment_type="experienced",
            education_level="bsc", courses=["Human Resource Management"], min_experience_years=3,
            required_skills=["Employee engagement", "Employee relations", "Industrial relations"],
            tools=["Microsoft Office"])
        # Has the qualification, course, experience and tools, but none of the three required skills in the CV.
        self.person = Candidate.objects.create(
            first_name="Uche", last_name="Obi", highest_qualification="bsc", course="Human Resource Management",
            years_experience=5, tools=["Microsoft 365"], summary="HR generalist: recruitment and payroll.")
        self.app, _ = create_application(self.person, self.req, notify_team=False)
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN, first_name="Ngozi")
        self.hod = User.objects.create_user("hod", password="x", role=User.Role.HOD, department=self.hr_dept)
        self.outsider = User.objects.create_user("fin", password="x", role=User.Role.HOD, department=self.other)
        self.url = reverse("pipeline:eligibility", args=[self.app.pk])

    def test_the_score_counts_what_they_have_and_the_gap_is_listed(self):
        self.app.refresh_from_db()
        self.assertGreater(float(self.app.match_score), 0)
        self.assertNotEqual(self.app.match_grade, "X")
        self.assertEqual(self.app.unmet_requirements, ["Required skills"])
        self.assertTrue(self.app.needs_eligibility_call)
        self.client.force_login(self.hr)
        page = self.client.get(self.app.get_absolute_url())
        self.assertContains(page, "1 key requirement not met: Required skills")
        self.assertContains(page, "Keep in the running")
        listing = self.client.get(self.req.get_absolute_url())
        self.assertContains(listing, "Decide: 1 key requirement not met")

    def test_the_department_keeps_them_in_the_running(self):
        self.client.force_login(self.hod)
        response = self.client.post(self.url, {"decision": "kept"})
        self.assertRedirects(response, self.app.get_absolute_url() + "#match", fetch_redirect_response=False)
        self.app.refresh_from_db()
        self.assertEqual((self.app.eligibility, self.app.eligibility_by, self.app.status), ("kept", self.hod, "active"))
        self.assertFalse(self.app.needs_eligibility_call)
        self.assertTrue(self.app.activities.filter(message__contains="kept the candidate in the running").exists())
        # And can take it back.
        self.client.post(self.url, {"decision": "undo"})
        self.app.refresh_from_db()
        self.assertEqual(self.app.eligibility, "")

    def test_not_eligible_closes_the_application_without_emailing(self):
        from django.core import mail

        self.client.force_login(self.hr)
        self.client.post(self.url, {"decision": "not_eligible"})
        self.app.refresh_from_db()
        self.assertEqual((self.app.eligibility, self.app.status), ("not_eligible", Application.Status.REJECTED))
        self.assertEqual(self.app.status_reason, "Not eligible: Required skills")
        self.assertEqual(mail.outbox, [])

    def test_only_hr_or_the_vacancys_department_decides(self):
        self.client.force_login(self.outsider)
        self.assertEqual(self.client.post(self.url, {"decision": "kept"}).status_code, 403)
        self.app.refresh_from_db()
        self.assertEqual(self.app.eligibility, "")

    def test_auto_shortlist_leaves_the_call_to_the_hiring_manager(self):
        undecided = []
        picked = auto_shortlist(self.req, threshold=1, undecided=undecided)
        self.assertEqual((picked, undecided), ([], [self.app]))
        self.app.eligibility = "kept"
        self.app.save()
        picked = auto_shortlist(self.req, threshold=1)
        self.assertEqual(picked, [self.app])
        self.app.refresh_from_db()
        self.assertEqual(self.app.stage, Stage.SHORTLISTED)

    def test_the_match_grid_scores_everyone(self):
        self.client.force_login(self.hr)
        grid = self.client.get(reverse("candidates:match"), {"r": self.req.pk, "c": self.person.pk})
        cell = grid.context["rows"][0]["cells"][0]
        self.assertGreater(cell["score"], 0)
        self.assertNotContains(grid, "Not eligible")
        self.assertContains(grid, "1 key requirement not met")
        self.assertTrue(cell.get("best"))
