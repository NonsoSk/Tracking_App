import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from accounts.models import User
from core.demo_files import cv_lines, simple_docx
from core.models import Department
from pipeline.models import Application
from pipeline.services import create_application
from requisitions.models import Requisition

from .models import Candidate


MEDIA = tempfile.mkdtemp(prefix="test-media-")


def tearDownModule():
    shutil.rmtree(MEDIA, ignore_errors=True)


@override_settings(MEDIA_ROOT=MEDIA)
class MatchGridTests(TestCase):
    """CVs scored against several vacancies at once; HR adds the matches it wants as applications."""

    def setUp(self):
        self.finance = Department.objects.create(name="Finance", code="FIN")
        self.people = Department.objects.create(name="Human Resources", code="HR")
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        common = dict(employment_type="experienced", education_level="hnd", min_experience_years=2)
        self.payable = Requisition.objects.create(
            department=self.finance, title="Accounts Payable Officer", status=Requisition.Status.APPROVED,
            courses=["Accounting"], required_skills=["Accounts payable", "Vendor reconciliation"],
            certifications=["ICAN"], **common)
        self.hr_officer = Requisition.objects.create(
            department=self.people, title="HR Officer", status=Requisition.Status.OPEN,
            courses=["Human Resource Management"], required_skills=["Recruitment and selection", "Payroll administration"],
            certifications=["CIPM"], **common)
        self.marketing = Requisition.objects.create(
            department=self.finance, title="Marketing Officer", status=Requisition.Status.DRAFT,
            courses=["Marketing"], required_skills=["Market research"], **common)
        self.ada = Candidate.objects.create(
            first_name="Ada", last_name="Obi", highest_qualification="bsc", course="Accounting", years_experience=4,
            skills=["Accounts payable", "Supplier reconciliation"], certifications=["ICAN"])
        self.tunde = Candidate.objects.create(
            first_name="Tunde", last_name="Bello", highest_qualification="hnd", course="Human Resources",
            years_experience=3, skills=["Recruitment", "Payroll"], certifications=["CIPM"])
        self.client.force_login(self.hr)

    def grid(self, *vacancies, people=None):
        people = people or [self.ada, self.tunde]
        query = [("r", v.pk) for v in vacancies] + [("c", p.pk) for p in people]
        return self.client.get(reverse("candidates:match"), query)

    def test_each_cv_is_scored_and_ranked_for_each_vacancy(self):
        response = self.grid(self.payable, self.hr_officer)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context["rank_by"], "any")
        rows = {r["candidate"].first_name: r for r in response.context["rows"]}
        # Ranked by each CV's strongest role, and called out only where it is clearly stronger.
        self.assertEqual(rows["Ada"]["key"]["vacancy"], self.payable)
        self.assertEqual(rows["Tunde"]["key"]["vacancy"], self.hr_officer)
        ada_pay, ada_hr = rows["Ada"]["cells"]
        self.assertTrue(ada_pay.get("strongest"))
        self.assertGreater(ada_pay["score"], ada_hr["score"])
        self.assertEqual((ada_pay["rank"], ada_pay["of"]), (1, 2))
        self.assertFalse(ada_hr["eligible"])
        self.assertTrue(any(f.startswith("Accepted course") or "course" in f.lower() for f in ada_hr["failed"]))
        columns = {c["vacancy"].title: c for c in response.context["columns"]}
        self.assertEqual((columns["HR Officer"]["scored"], columns["HR Officer"]["meets_all"]), (2, 1))
        # Possible matches or better in each CV's ranked role are ticked, ready to add; weak ones are not.
        self.assertContains(response, f'value="{self.ada.pk}:{self.payable.pk}" checked')
        self.assertNotContains(response, f'value="{self.ada.pk}:{self.hr_officer.pk}" checked')
        # Nothing is saved by looking.
        self.assertFalse(Application.objects.exists())

    def make_people(self, n):
        """n accountants with fewer and fewer of the payables skills, so their scores spread out."""
        skills = ["Accounts payable", "Vendor reconciliation", "Three-way matching", "Payment processing"]
        people = []
        for i in range(n):
            weak = i >= 9  # the last few have none of the skills, a lower qualification and another course
            people.append(Candidate.objects.create(
                first_name=f"P{i}", last_name="Test", highest_qualification="ond" if weak else "hnd" if i % 3 else "bsc",
                course="Mass Communication" if weak or not i % 4 else "Accounting", years_experience=1 if weak else 6 - (i % 5),
                skills=[] if weak else skills[: max(1, 4 - i // 2)], certifications=["ICAN"] if i % 2 == 0 else []))
        return people

    def test_one_role_never_calls_everyone_the_best_fit(self):
        people = self.make_people(12)
        response = self.grid(self.payable, people=people)
        rows = response.context["rows"]
        self.assertFalse(any(c.get("strongest") for r in rows for c in r["cells"]))
        self.assertNotContains(response, 'class="mt-best"')
        labels = {r["cells"][0]["label"] for r in rows}
        self.assertGreater(len(labels), 1)  # the comments vary with the score
        ranks = [r["cells"][0]["rank"] for r in rows]
        self.assertEqual(ranks, list(range(1, 13)))  # highest score first
        scores = [r["cells"][0]["score"] for r in rows]
        self.assertEqual(scores, sorted(scores, reverse=True))
        ticked = [r for r in rows if r["cells"][0].get("tick")]
        self.assertTrue(all(r["cells"][0]["score"] >= 55 for r in ticked))
        self.assertLess(len(ticked), len(rows))

    def test_filters_top_n_score_range_and_key_requirements(self):
        people = self.make_people(12)
        query = [("r", self.payable.pk)] + [("c", p.pk) for p in people]
        top = self.client.get(reverse("candidates:match"), query + [("top", "5")])
        self.assertEqual(len(top.context["rows"]), 5)
        self.assertContains(top, "Top 5")
        everyone = [r["cells"][0]["score"] for r in self.grid(self.payable, people=people).context["rows"]]
        self.assertEqual([r["cells"][0]["score"] for r in top.context["rows"]], everyone[:5])
        band = self.client.get(reverse("candidates:match"), query + [("min", "40"), ("max", "80")])
        self.assertTrue(all(40 <= r["cells"][0]["score"] <= 80 for r in band.context["rows"]))
        self.assertEqual(len(band.context["rows"]), sum(1 for s in everyone if 40 <= s <= 80))
        strict = self.client.get(reverse("candidates:match"), query + [("keyreq", "1")])
        self.assertTrue(strict.context["rows"])
        self.assertTrue(all(not r["cells"][0]["failed"] for r in strict.context["rows"]))
        nothing = self.client.get(reverse("candidates:match"), query + [("max", "0.5")])
        self.assertContains(nothing, "No CVs in this range")

    def test_rank_by_one_role_among_several(self):
        response = self.client.get(reverse("candidates:match"), [("r", self.payable.pk), ("r", self.hr_officer.pk),
                                                                 ("c", self.ada.pk), ("c", self.tunde.pk),
                                                                 ("rank", self.hr_officer.pk)])
        rows = response.context["rows"]
        self.assertEqual(rows[0]["candidate"], self.tunde)  # the HR officer comes first when ranked for HR
        self.assertTrue(all(r["key"]["vacancy"] == self.hr_officer for r in rows))

    def test_the_scores_are_the_ones_an_application_gets(self):
        response = self.grid(self.payable)
        cell = {r["candidate"].first_name: r["cells"][0] for r in response.context["rows"]}["Ada"]
        app, _ = create_application(self.ada, self.payable, notify_team=False)
        self.assertEqual((cell["score"], cell["grade"]), (float(app.match_score), app.match_grade))

    def test_adding_the_ticked_matches(self):
        query = f"r={self.payable.pk}&r={self.hr_officer.pk}&c={self.ada.pk}&c={self.tunde.pk}"
        response = self.client.post(reverse("candidates:match_add"), {
            "pair": [f"{self.ada.pk}:{self.payable.pk}", f"{self.tunde.pk}:{self.hr_officer.pk}"], "query": query})
        self.assertRedirects(response, reverse("candidates:match") + "?" + query)
        self.assertEqual(set(Application.objects.values_list("candidate__first_name", "requisition__title")),
                         {("Ada", "Accounts Payable Officer"), ("Tunde", "HR Officer")})
        self.assertTrue(all(a.matched_at for a in Application.objects.all()))
        # Added again: nothing new.
        self.client.post(reverse("candidates:match_add"), {"pair": [f"{self.ada.pk}:{self.payable.pk}"]})
        self.assertEqual(Application.objects.count(), 2)
        response = self.grid(self.payable)
        self.assertContains(response, "Applied")

    def test_a_vacancy_not_yet_approved_is_scored_but_takes_no_applications(self):
        response = self.grid(self.marketing)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "scores only")
        self.assertNotContains(response, 'name="pair"')
        self.client.post(reverse("candidates:match_add"), {"pair": [f"{self.ada.pk}:{self.marketing.pk}"]})
        self.assertFalse(Application.objects.exists())

    def test_a_vacancy_without_requirements_is_not_scored(self):
        empty = Requisition.objects.create(department=self.finance, title="Clerk", status=Requisition.Status.OPEN,
                                         education_level="")
        response = self.grid(empty)
        self.assertTrue(all(r["cells"][0]["unscored"] for r in response.context["rows"]))
        self.assertContains(response, "No requirements yet")
        self.assertNotContains(response, 'name="pair"')

    def test_cvs_added_on_a_day(self):
        response = self.client.get(reverse("candidates:match"), {"r": self.payable.pk})
        self.assertEqual(response.context["total"], 2)  # both were added today
        response = self.client.get(reverse("candidates:match"), {"r": self.payable.pk, "added": "2001-01-01"})
        self.assertEqual(response.context["total"], 0)

    def test_starts_from_the_last_day_cvs_were_added(self):
        from datetime import timedelta

        from django.utils import timezone

        Candidate.objects.update(created_at=timezone.now() - timedelta(days=3))
        response = self.client.get(reverse("candidates:match"), {"r": self.payable.pk})
        self.assertEqual(response.context["added"], timezone.localdate() - timedelta(days=3))
        self.assertEqual(response.context["total"], 2)

    def test_the_vacancy_page_links_to_the_grid(self):
        response = self.client.get(self.payable.get_absolute_url())
        self.assertContains(response, f'href="{reverse("candidates:match")}?r={self.payable.pk}"')
        self.assertContains(response, "Match CVs to this vacancy")

    def test_hr_only(self):
        hod = User.objects.create_user("hod", password="x", role=User.Role.HOD, department=self.finance)
        self.client.force_login(hod)
        self.assertNotEqual(self.grid(self.payable).status_code, 200)
        self.client.post(reverse("candidates:match_add"), {"pair": [f"{self.ada.pk}:{self.payable.pk}"]})
        self.assertFalse(Application.objects.exists())

    def test_cv_intake_leads_to_the_check_then_the_grid(self):
        cv = SimpleUploadedFile("bayo.docx", simple_docx(cv_lines(dict(
            first="Bayo", last="Ade", email="bayo@example.com", phone="0802 000 1111", summary="Accountant",
            jobs=[], degree="HND", course="Accounting", school="Rivers State Polytechnic", year=2012))))
        response = self.client.post(reverse("candidates:intake"), {"files": [cv], "source": "email"})
        self.assertEqual(response.status_code, 200)
        bayo = Candidate.objects.get(email="bayo@example.com")
        self.assertTrue(bayo.needs_check)
        self.assertEqual(response.context["check_url"], reverse("candidates:check") + f"?c={bayo.pk}")
        self.assertContains(response, "Check the 1 new profile")
        # Not in the grid until checked.
        grid = self.client.get(reverse("candidates:match"), {"r": self.payable.pk, "c": bayo.pk})
        self.assertEqual(grid.context["rows"], [])
        self.assertEqual(grid.context["unchecked"], 1)
        self.client.post(reverse("candidates:check_profile", args=[bayo.pk]) + f"?c={bayo.pk}", {
            "first_name": "Bayo", "last_name": "Ade", "email": "bayo@example.com", "highest_qualification": "hnd",
            "course": "Accounting", "years_experience": "3", "confirm": "1"})
        done = self.client.get(reverse("candidates:check"), {"c": bayo.pk})
        self.assertContains(done, "Match these CVs to vacancies")
        self.assertContains(done, reverse("candidates:match") + f"?c={bayo.pk}")
