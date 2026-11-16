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

    def test_a_profile_without_a_cv_is_judged_on_the_requirements_only(self):
        result = self.match("none", cv_text="")
        self.assertIsNone(result["match"]["stages"][1]["passed"])
        self.assertIn("Not judged", result["match"]["stages"][1]["detail"])


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
        self.assertIn(result["match"]["label"], {"Match", "Not a match"})
        self.assertEqual(result["why"]["cv"], "")
        self.assertTrue(INDUSTRIAL_JD)
