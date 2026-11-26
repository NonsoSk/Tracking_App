"""Only real matches are called matches, and each result says why (pipeline/matching.py: judge_match, explain)."""

from datetime import date
from unittest import mock

from django.test import TestCase, override_settings
from django.urls import reverse

from accounts.models import User
from candidates.models import Candidate

from .criteria import jd_criteria, role_profile
from .matching import compute_match, score_application
from .models import Application
from .test_jd_criteria import CVS, INDUSTRIAL_JD, person, requisition

TODAY = date(2026, 11, 12)


def today(*args):
    return TODAY


# The title only says "Sales Officer"; the purpose and duties say what is sold, and to whom.
PLAIN_TITLE_JD = """SALES OFFICER
Job Purpose
To drive sales of urea and other products to industrial customers and distributors in the assigned territory.
Key Responsibilities
- Develop and maintain relationships with industrial customers and key accounts
- Prepare monthly sales reports and forecasts
- Negotiate prices and contracts with customers
Requirements
- 3 years' sales experience
"""
ACCOUNTS_JD = """ACCOUNTS OFFICER
Job Purpose
To keep the books of our fertilizer manufacturing plant accurate and up to date.
Key Responsibilities
- Post journals and reconcile the general ledger every month
- Prepare bank reconciliations and payment vouchers
- Support the month-end close and the production cost reports for the plant
Requirements
- 3 years' accounting experience
"""
BANK_ACCOUNTANT = """EXPERIENCE
Accountant, Zenith Bank   Jan 2018 - Present
- Posted journals and reconciled the general ledger every month
- Prepared bank reconciliations and payment vouchers; supported the month-end close
EDUCATION
B.Sc Accounting, UNILAG 2012 - 2016"""


@mock.patch("candidates.experience.timezone.localdate", today)
class VerdictTests(TestCase):
    def setUp(self):
        self.req = requisition()

    def match(self, name, years=10, **kw):
        return compute_match(self.req, person(name, years, **kw), aliases={})

    def test_a_match_passes_the_requirements_then_the_role_then_the_score(self):
        result = self.match("industrial", 12)
        verdict = result["match"]
        self.assertTrue(verdict["is_match"])
        self.assertEqual([(s["name"], s["passed"]) for s in verdict["stages"]],
                         [("Requirements", True), ("The role", True), ("Overall", True)])
        why = result["why"]
        self.assertTrue(why["headline"].startswith("Match:"))
        self.assertIn("To drive sales of urea", why["role"])       # what the job entails
        self.assertIn("5+ years in industrial sales", why["role"])
        self.assertIn("in sales", why["cv"])                        # what the CV shows of the working life
        self.assertTrue(why["fits"][0].startswith("Industrial sales: Sales Executive · Notore Chemical Industries"))
        self.assertTrue(any(line.startswith("Has done 5 of the 6 duties") for line in why["fits"]))
        self.assertTrue(any("Monitor competitor activities" in line for line in why["gaps"]))
        self.assertTrue(any("driver's licence" in line for line in why["confirm"]))

    def test_general_experience_is_not_a_match_and_the_note_says_why(self):
        result = self.match("retail")
        self.assertFalse(result["match"]["is_match"])
        self.assertEqual([s["passed"] for s in result["match"]["stages"]], [True, False, False])
        self.assertIn("the job asks for industrial sales; the closest in the CV is Sales Representative, Shoprite",
                      result["match"]["reason"])
        self.assertIn("this job reads as retail", result["why"]["gaps"][0])

    def test_a_requirement_that_is_not_met_comes_first(self):
        result = self.match("industrial", 12, course="Mass Communication", highest_qualification="ond")
        self.assertFalse(result["match"]["is_match"])
        self.assertTrue(result["match"]["reason"].startswith("not met: minimum qualification"))
        self.assertTrue(result["match"]["stages"][1]["passed"])  # the role itself is shown

    def test_the_right_kind_of_job_without_any_of_the_duties_is_not_a_match(self):
        result = self.match("production", 8)  # a two-line CV: the job title fits, nothing shows what was done
        self.assertFalse(result["match"]["is_match"])
        self.assertIn("none of the duties", result["match"]["reason"])

    @override_settings(RECRUITMENT={"MATCH_MIN_SCORE": 99, "MATCH_MIN_REQUIRED_SKILLS_PERCENT": 50,
                                    "HND_EQUIVALENT_TO_BSC": False})
    def test_the_score_a_match_needs_can_be_raised(self):
        result = self.match("industrial", 12)
        self.assertFalse(result["match"]["is_match"])
        self.assertIn("a match needs 99", result["match"]["reason"])

    def test_a_profile_without_a_cv_is_never_a_match_on_an_unjudged_role(self):
        """A sparse profile that meets every stated requirement and scores well is not called a Match while the
        role itself could not be judged: it goes to a person (the defect found in the diagnosis)."""
        result = self.match("none", cv_text="")
        verdict = result["match"]
        self.assertEqual(verdict["stages"][0]["passed"], True)
        self.assertIsNone(verdict["stages"][1]["passed"])
        self.assertIn("Not judged", verdict["stages"][1]["detail"])
        self.assertEqual((verdict["is_match"], verdict["verdict"], verdict["label"]),
                         (False, "review", "Needs review"))
        self.assertIn("not judged", verdict["reason"])

    def test_missing_information_is_for_review_and_a_shown_mismatch_is_not_a_match(self):
        unknown = self.match("industrial", highest_qualification="")["match"]
        self.assertEqual(unknown["verdict"], "review")
        self.assertIn("minimum qualification", unknown["reason"])
        wrong = self.match("industrial", highest_qualification="ond")["match"]
        self.assertEqual(wrong["verdict"], "no_match")
        self.assertIn("Not met", wrong["stages"][0]["detail"])
        no_years = self.match("industrial", years=None)["match"]
        self.assertNotEqual(no_years["verdict"], "match")

    def test_age_community_and_source_do_not_change_the_score(self):
        base = self.match("industrial")
        for extra in (dict(date_of_birth=date(1960, 1, 1)), dict(date_of_birth=date(2001, 1, 1)),
                      dict(region="host", community_status="host"), dict(region="outside"),
                      dict(source="referral"), dict(source="import"), dict(gender="female"),
                      dict(state_of_origin="Lagos")):
            other = self.match("industrial", **extra)
            self.assertEqual((other["score"], other["match"]["verdict"]), (base["score"], base["match"]["verdict"]),
                             extra)


@mock.patch("candidates.experience.timezone.localdate", today)
class ReadingTheRoleAsAWholeTests(TestCase):
    def test_what_is_sold_and_to_whom_is_read_from_the_purpose_and_duties(self):
        req = requisition(title="Sales Officer", job_description=PLAIN_TITLE_JD, min_experience_years=3)
        role = jd_criteria(req)[0]
        self.assertEqual((role.origin, role.core, role.functions), ("role", True, ("sales",)))
        self.assertEqual(set(role.settings), {"fertilizer", "industrial"})
        note = role_profile(req)["note"]
        self.assertTrue(note.startswith("Sales Officer: To drive sales of urea"))
        self.assertIn("Must have: Bachelor's in Marketing; experience in sales (fertilizer or industrial)", note)
        # So a supermarket seller is not a match for it, and someone who sold fertilizer is.
        self.assertFalse(compute_match(req, person("retail"), aliases={})["match"]["is_match"])
        self.assertTrue(compute_match(req, person("industrial", 12), aliases={})["match"]["is_match"])

    def test_an_accountants_work_carries_across_businesses(self):
        req = requisition(title="Accounts Officer", job_description=ACCOUNTS_JD, min_experience_years=3,
                          courses=["Accounting"], required_skills=[])
        core = [c for c in jd_criteria(req) if c.core]  # the plant in the purpose is not made a requirement
        self.assertEqual([(c.functions, set(c.settings)) for c in core], [(("accounting",), set())])
        banker = person("banker", 8.8, course="Accounting", cv_text=BANK_ACCOUNTANT, skills=[])
        result = compute_match(req, banker, aliases={})
        self.assertTrue(result["match"]["is_match"], result["match"]["reason"])

    def test_skills_and_other_sections_are_read_as_weaker_evidence(self):
        req = requisition()
        cv = CVS["retail"] + "\nSKILLS\nPreparing monthly sales reports and forecasts; competitor and market trend analysis"
        result = compute_match(req, person("retail", cv_text=cv), aliases={})
        rows = {r["text"]: r for r in result["components"]["jd"]["criteria"]}
        self.assertIn("Skills and other sections", rows["Monitor competitor activities and market trends"]["evidence"])
        # …but a list of skills never stands in for the experience itself.
        self.assertFalse(result["match"]["is_match"])


@mock.patch("candidates.experience.timezone.localdate", today)
class ShowingWhyTests(TestCase):
    def setUp(self):
        self.req = requisition()
        self.people = {}
        for name, years in [("industrial", 12), ("retail", 10), ("accountant", 11)]:
            candidate = person(name, years)
            candidate.email = f"{name}@example.com"
            candidate.save()
            self.people[name] = candidate
        self.client.force_login(User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN))

    def grid(self, **extra):
        query = [("r", self.req.pk)] + [("c", c.pk) for c in self.people.values()] + list(extra.items())
        return self.client.get(reverse("candidates:match"), query)

    def test_the_grid_shows_only_the_matches_with_their_note(self):
        page = self.grid()
        self.assertEqual([r["candidate"] for r in page.context["rows"]], [self.people["industrial"]])
        self.assertEqual(page.context["hidden"], 2)
        self.assertContains(page, "2 other CVs did not match")
        self.assertContains(page, "1 match</b> of 3 CVs")
        self.assertContains(page, "Why it matches")
        self.assertContains(page, "Where the CV matches the job")
        self.assertContains(page, "what the job entails")
        self.assertContains(page, "To drive sales of urea and other products")
        self.assertTrue(page.context["rows"][0]["cells"][0]["tick"])

    def test_everyone_can_still_be_shown_with_why_they_do_not_match(self):
        page = self.grid(show="all")
        self.assertEqual(len(page.context["rows"]), 3)
        self.assertContains(page, "Why not: the job asks for industrial sales")
        ticked = [r["candidate"] for r in page.context["rows"] if r["cells"][0].get("tick")]
        self.assertEqual(ticked, [self.people["industrial"]])  # only a match is ticked to add

    def test_when_nothing_matches_the_page_says_so(self):
        self.people.pop("industrial").delete()
        page = self.grid()
        self.assertEqual(page.context["rows"], [])
        self.assertContains(page, "None of these CVs is a match")
        self.assertContains(page, "Show all 2 CVs and why they do not match")

    def test_the_ranked_list_and_the_application_say_why(self):
        apps = {}
        for name, candidate in self.people.items():
            apps[name] = Application.objects.create(candidate=candidate, requisition=self.req)
            score_application(apps[name])
        self.assertTrue(apps["industrial"].is_match)
        self.assertFalse(apps["retail"].is_match)
        ranked = self.client.get(self.req.get_absolute_url())
        self.assertEqual(len(ranked.context["applications"]), 3)
        self.assertContains(ranked, "Not a match")
        self.assertContains(ranked, "How the portal reads this job")
        only = self.client.get(self.req.get_absolute_url(), {"matches": "1"})
        self.assertEqual(list(only.context["applications"]), [apps["industrial"]])
        page = self.client.get(apps["retail"].get_absolute_url())
        self.assertContains(page, "Why this result")
        self.assertContains(page, "Not a match: the job asks for industrial sales")
        self.assertContains(page, "What is missing")
        page = self.client.get(apps["industrial"].get_absolute_url())
        self.assertContains(page, "Match: meets the requirements, has done the work and scores well")


class CandidateWithoutStoryTests(TestCase):
    def test_an_excel_profile_still_gets_a_verdict(self):
        req = requisition()
        result = compute_match(req, Candidate(first_name="A", last_name="B", highest_qualification="bsc",
                                              course="Marketing", years_experience=6, skills=["Microsoft Office"]),
                               aliases={})
        self.assertEqual(result["match"]["label"], "Needs review")  # no CV text: the role cannot be judged
        self.assertEqual(result["why"]["cv"], "")
        self.assertTrue(INDUSTRIAL_JD)


@mock.patch("candidates.experience.timezone.localdate", today)
class ReviewsVersionsAndEvaluationTests(TestCase):
    def setUp(self):
        self.req = requisition()
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        self.person = person("industrial")
        self.person.save()
        self.app = Application.objects.create(candidate=self.person, requisition=self.req)
        score_application(self.app)
        self.client.force_login(self.hr)

    def test_a_reviewers_judgement_with_a_reason_stands_and_is_kept(self):
        from .models import MatchReview

        url = reverse("pipeline:review_match", args=[self.app.pk])
        self.client.post(url, {"decision": "no_match", "reason": ""})  # a reason is required
        self.assertFalse(MatchReview.objects.exists())
        self.client.post(url, {"decision": "no_match", "reason": "Sold groceries retail, not industrial sales."})
        self.app.refresh_from_db()
        self.assertFalse(self.app.is_match)
        score_application(self.app)  # assessed again: the judgement stays
        self.app = Application.objects.get(pk=self.app.pk)
        self.assertEqual(self.app.review.decision, "no_match")
        self.assertFalse(self.app.review.outdated)
        self.assertContains(self.client.get(self.app.get_absolute_url()), "Sold groceries retail")
        self.person.cv_text += "\nNew job: Regional Sales Manager, Dangote Fertiliser 2025 - Present"
        self.person.save()
        score_application(self.app)
        self.app = Application.objects.get(pk=self.app.pk)
        self.assertTrue(self.app.review.outdated)  # the CV changed since the judgement

    def test_a_changed_job_description_queues_a_fresh_assessment(self):
        from intake import sync
        from intake.models import Job

        from .matching import is_stale, queue_stale

        self.assertFalse(is_stale(self.app))
        self.assertEqual(self.app.match_breakdown["versions"]["matcher"], 7)
        self.req.job_description += "\n- Manage key distributor accounts across the South-South region"
        self.req.save()
        self.app = Application.objects.select_related("candidate", "requisition").get(pk=self.app.pk)
        self.assertTrue(is_stale(self.app))
        self.assertEqual(queue_stale(), 1)
        self.assertEqual(queue_stale(), 1)  # queued once (the same job), not twice
        self.assertEqual(Job.objects.filter(kind="rescore_candidate", status="queued").count(), 1)
        sync.drain()
        self.app = Application.objects.select_related("candidate", "requisition").get(pk=self.app.pk)
        self.assertFalse(is_stale(self.app))

    def test_blind_review_then_report(self):
        import tempfile
        from pathlib import Path

        from openpyxl import load_workbook

        from . import evaluation

        out = Path(tempfile.mkdtemp()) / "blind.xlsx"
        evaluation.export_blind(self.req, out)
        sheet = load_workbook(out).active
        self.assertNotIn("score", " ".join(str(c.value or "").lower() for c in sheet[2]))  # blind: no scores
        unverified = evaluation.report(self.req, out)
        self.assertIn("UNVERIFIED", unverified["quality"])
        wb = load_workbook(out)
        wb.active.cell(row=3, column=4, value="yes")
        wb.save(out)
        result = evaluation.report(self.req, out)
        self.assertEqual((result["reviewed"], result["interview_worthy"]), (1, 1))
        self.assertEqual(result["new"]["top_10_interview_worthy"], 1)
        self.assertIsNotNone(result["old"])


class RubricConfirmationTests(TestCase):
    def test_the_hiring_manager_confirms_the_requirements_and_a_change_undoes_it(self):
        req = requisition()
        hod = User.objects.create_user("hod", password="x", role=User.Role.HOD, department=req.department)
        self.client.force_login(hod)
        self.assertContains(self.client.get(req.get_absolute_url()), "Not yet confirmed by the hiring manager")
        self.client.post(reverse("requisitions:confirm_rubric", args=[req.pk]))
        req.refresh_from_db()
        self.assertTrue(req.rubric_confirmed)
        req.required_skills = req.required_skills + ["Key account management"]
        req.save()
        self.assertFalse(req.rubric_confirmed)
        self.assertContains(self.client.get(req.get_absolute_url()), "Changed since the hiring manager confirmed it")
