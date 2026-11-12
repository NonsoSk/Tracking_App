"""Strict matching against what the job description actually asks for (pipeline/criteria.py, pipeline/ai_assess.py)."""

from datetime import date
from unittest import mock

from django.test import TestCase, override_settings
from django.urls import reverse

from accounts.models import User
from candidates.experience import jobs_in
from candidates.models import Candidate
from core.models import Department
from requisitions.models import Requisition

from .criteria import CAP_NOT_MET, CAP_PARTLY, jd_criteria
from .matching import compute_match, score_application
from .models import Application

TODAY = date(2026, 11, 12)

INDUSTRIAL_JD = """INDUSTRIAL SALES OFFICER
Job Purpose
To drive sales of urea and other products to industrial customers and distributors in the assigned territory.

Key Responsibilities
• Develop and maintain relationships with industrial customers and key accounts
• Identify new business opportunities and prospect for new customers
• Prepare monthly sales reports and forecasts
• Negotiate prices and contracts with customers in line with company policy
• Monitor competitor activities and market trends

Requirements
• B.Sc/HND in Marketing, Business Administration or related field
• Minimum of 5 years' experience in industrial sales, preferably in a manufacturing or petrochemical company
• Experience in B2B sales of chemicals or fertilizer is an added advantage
• Excellent communication and negotiation skills
• Proficiency in Microsoft Office
• Valid driver's licence and willingness to travel

How to apply
Send your CV to careers@example.com
"""

CVS = {
    # Sales in chemicals, fertilizer and cement: industrial sales without ever writing the words.
    "industrial": """ADA OBI
WORK EXPERIENCE
Sales Executive
Notore Chemical Industries Plc, Onne
Jan 2019 – Present
- Sold urea and NPK fertilizer to blenders and agro-dealers across the South-South
- Grew sales volume by 30% and opened 12 new distributor accounts
- Prepared weekly and monthly sales reports and forecasts
Sales Representative | Dangote Cement | Mar 2014 – Dec 2018
- Managed key accounts with construction companies; negotiated prices and supply contracts
EDUCATION
B.Sc Marketing, UNIPORT 2008 - 2012""",
    "production": """BOLA ADE
EXPERIENCE
Production Sales Officer, Flour Mills of Nigeria 2017 - 2025
Handled bulk orders from bakeries and food manufacturers; met quarterly sales targets
""",
    "retail": """CHIDI EZE
SUMMARY
Result-driven sales professional with 10 years experience
EXPERIENCE
Sales Representative, Shoprite
Jan 2016 - Dec 2020
- Served customers and met monthly sales targets on the shop floor
Sales Supervisor, Justrite Supermarket
Jan 2021 - Present
- Led a team of 6 sales attendants and achieved store sales targets""",
    "marketing": """DAPO KING
EXPERIENCE
Marketing Officer, Indorama Eleme Petrochemicals 2018 - Present
Ran brand campaigns and market research for polymer products
""",
    "accountant": """EMEKA OBI
EXPERIENCE
Accountant, Notore Chemical Industries 2015 - Present
Posted the sales ledger, prepared bank reconciliations and monthly management accounts
""",
}


def requisition(**kw):
    department = Department.objects.get_or_create(name="Marketing", code="MKT")[0]
    values = dict(department=department, title="Industrial Sales Officer", status="open",
                  employment_type="experienced", education_level="bsc", min_experience_years=5,
                  courses=["Marketing"], required_skills=["Microsoft Office"], job_description=INDUSTRIAL_JD)
    values.update(kw)
    return Requisition.objects.create(**values)


def person(name, years=10, **kw):
    values = dict(first_name=name.title(), last_name="Test", highest_qualification="bsc", course="Marketing",
                  years_experience=years, skills=["Microsoft Office"], tools=[], certifications=[],
                  cv_text=CVS.get(name, ""), summary="")
    values.update(kw)
    return Candidate(**values)


def row(result, text):
    return next(r for r in result["components"]["jd"]["criteria"] if r["text"].startswith(text))


@mock.patch("candidates.experience.timezone.localdate", lambda: TODAY)
class ReadingTheJobDescriptionTests(TestCase):
    def test_each_kind_of_requirement_is_read(self):
        found = {c.text: c for c in jd_criteria(requisition())}
        main = found["Minimum of 5 years' experience in industrial sales"]
        self.assertEqual((main.kind, main.core, main.years, main.functions, set(main.settings)),
                         ("experience", True, 5.0, ("sales",), {"industrial"}))
        # "…preferably in a petrochemical company" is a nice-to-have on its own; the main requirement stays required.
        extra = next(c for c in found.values() if "preferably" in c.text)
        self.assertTrue(extra.preferred)
        self.assertFalse(extra.core)
        self.assertTrue(found["Experience in B2B sales of chemicals or fertilizer is an added advantage"].preferred)
        self.assertEqual(found["Excellent communication and negotiation skills"].kind, "interview")
        self.assertEqual(found["Valid driver's licence and willingness to travel"].kind, "confirm")
        duties = [c.text for c in found.values() if c.kind == "duty"]
        self.assertIn("Prepare monthly sales reports and forecasts", duties)
        # The qualification, a skill the requisition already scores, the title line and "How to apply" are not.
        for text in ("B.Sc/HND in Marketing", "Proficiency in Microsoft Office", "INDUSTRIAL SALES OFFICER",
                     "Send your CV"):
            self.assertFalse(any(t.startswith(text) for t in found), text)
        # The job title asks for the same as the main requirement: it is not asked twice.
        self.assertFalse(any(c.origin == "title" for c in found.values()))

    def test_the_job_title_says_what_kind_of_experience_is_needed(self):
        criteria = jd_criteria(requisition(job_description="Requirements:\n3 years' experience in sales"))
        title = criteria[0]
        self.assertEqual((title.origin, title.core, title.functions, set(title.settings)),
                         ("title", True, ("sales",), {"industrial"}))

    def test_jobs_are_read_with_their_titles_duties_and_dates(self):
        jobs = jobs_in(CVS["industrial"].split("WORK EXPERIENCE\n")[1].split("EDUCATION")[0])
        self.assertEqual(len(jobs), 2)
        self.assertIn("Notore Chemical Industries", jobs[0].title)
        self.assertIn("Sold urea", jobs[0].body)
        self.assertEqual((jobs[0].months, jobs[1].months), (94, 58))  # Jan 2019 to 12 Nov 2026; Mar 2014 – Dec 2018
        training = jobs_in("NOTORE CHEMICAL   2012 - 2014\nIndustrial Training (SIWES)\nAssisted in the lab")
        self.assertFalse(training[0].is_work)


@mock.patch("candidates.experience.timezone.localdate", lambda: TODAY)
class StrictMatchingTests(TestCase):
    def setUp(self):
        self.req = requisition()

    def match(self, name, **kw):
        return compute_match(self.req, person(name, **kw), aliases={})

    def test_industrial_sales_worded_differently_is_met(self):
        result = self.match("industrial")
        main = row(result, "Minimum of 5 years")
        self.assertEqual(main["verdict"], "met")
        self.assertIn("Notore Chemical Industries", main["evidence"])
        self.assertIn("counts as industrial", main["evidence"])
        self.assertIsNone(result["cap"])
        self.assertTrue(result["eligible"])
        self.assertGreaterEqual(result["score"], 85)
        self.assertIn("counted towards industrial sales", result["components"]["experience"]["found"])

    def test_production_sales_counts_as_industrial_sales(self):
        result = self.match("production", years=8)
        self.assertEqual(row(result, "Minimum of 5 years")["verdict"], "met")
        self.assertIsNone(result["cap"])

    def test_sales_alone_is_not_enough_for_an_industrial_sales_job(self):
        result = self.match("retail")
        main = row(result, "Minimum of 5 years")
        self.assertEqual(main["verdict"], "partly")
        self.assertIn("this job reads as retail", main["evidence"])
        self.assertLessEqual(result["score"], CAP_PARTLY)
        self.assertNotIn(result["grade"], {"A", "B"})
        self.assertIn("Experience: industrial sales", result["unmet"])  # for the hiring manager to judge
        self.assertTrue(result["cap"]["applied"])
        self.assertGreater(result["cap"]["before"], result["score"])

    def test_related_work_in_the_right_business_is_partly_met(self):
        result = self.match("marketing", years=8)
        self.assertEqual(row(result, "Minimum of 5 years")["verdict"], "partly")
        self.assertIn("marketing, related to sales", row(result, "Minimum of 5 years")["evidence"])

    def test_the_right_business_without_the_work_is_not_met(self):
        result = self.match("accountant", years=11)  # "sales ledger" is accounting, not selling
        self.assertEqual(row(result, "Minimum of 5 years")["verdict"], "not_met")
        self.assertLessEqual(result["score"], CAP_NOT_MET)

    def test_the_best_match_ranks_first(self):
        scores = {name: self.match(name, years=y)["score"] for name, y in
                  [("industrial", 12), ("production", 8), ("marketing", 8), ("retail", 10), ("accountant", 11)]}
        ranked = sorted(scores, key=scores.get, reverse=True)
        self.assertEqual(ranked[:2], ["industrial", "production"])
        self.assertEqual(ranked[-1], "accountant")
        self.assertGreater(scores["production"], scores["retail"])

    def test_years_asked_count_only_from_jobs_that_fit(self):
        cv = ("EXPERIENCE\nSales Executive, Notore Chemical Industries Jan 2024 - Present\nSold urea to blenders\n"
              "Sales Representative, Shoprite Jan 2015 - Dec 2023\nMet monthly sales targets on the shop floor")
        result = compute_match(self.req, person("mixed", years=11.9, cv_text=cv), aliases={})
        main = row(result, "Minimum of 5 years")
        self.assertEqual(main["verdict"], "partly")  # 2 yrs 10 mos of industrial sales; 5 asked
        self.assertIn("2 yrs 10 mos in jobs that fully count", main["evidence"])
        self.assertIn("similar work counted in part", result["components"]["experience"]["found"])

    def test_graduate_trainees_are_not_held_to_experience(self):
        req = requisition(title="Graduate Trainee (Sales)", employment_type="trainee", min_experience_years=0)
        result = compute_match(req, person("retail"), aliases={})
        self.assertIsNone(result["cap"])
        self.assertFalse(any(s["key"].startswith("jd_") for s in result["screening"]))

    def test_a_profile_without_a_cv_is_not_judged_on_the_jd(self):
        result = compute_match(self.req, person("none", cv_text=""), aliases={})
        self.assertNotIn("jd", result["components"])
        self.assertIsNone(result["cap"])

    def test_the_application_page_shows_each_requirement(self):
        candidate = person("retail")
        candidate.save()
        application = Application.objects.create(candidate=candidate, requisition=self.req)
        score_application(application)
        self.client.force_login(User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN))
        page = self.client.get(reverse("pipeline:application", args=[application.pk]))
        self.assertContains(page, "What the job description asks for")
        self.assertContains(page, "Minimum of 5 years&#x27; experience in industrial sales")
        self.assertContains(page, "this job reads as retail")
        self.assertContains(page, f"Held at {CAP_PARTLY}")
        self.assertContains(page, "At interview")


AI_ANSWER = {"overall": "possible", "summary": "Sells in retail; no industrial buyers shown. Probe B2B exposure.",
             "requirements": []}


@mock.patch("candidates.experience.timezone.localdate", lambda: TODAY)
@override_settings(AI_ENABLED=True, ANTHROPIC_API_KEY="test", AI_MATCH_ASSESSMENT=True)
class ClaudeAssessmentTests(TestCase):
    def setUp(self):
        self.req = requisition()
        self.candidate = person("retail")
        self.candidate.save()
        self.application = Application.objects.create(candidate=self.candidate, requisition=self.req)
        score_application(self.application)

    def answer(self, verdict):
        ids = {c.text: c.id for c in jd_criteria(self.req)}
        rows = [{"id": i, "verdict": "met", "evidence": "Shown", "relevant_years": None} for i in ids.values()]
        main = ids["Minimum of 5 years' experience in industrial sales"]
        rows = [r for r in rows if r["id"] != main] + [
            {"id": main, "verdict": verdict, "evidence": "Sales Supervisor at Justrite sells to walk-in shoppers.",
             "relevant_years": 0}, {"id": "made-up", "verdict": "met", "evidence": "x", "relevant_years": None}]
        return dict(AI_ANSWER, requirements=rows)

    def test_claudes_verdicts_replace_the_rules_while_the_cv_and_jd_are_unchanged(self):
        from .ai_assess import run

        with mock.patch("pipeline.ai_assess.ai.structured_request", return_value=self.answer("not_met")) as call:
            saved = run(self.application)
        content = call.call_args.kwargs["content"]
        self.assertIn("<cv>", content)
        self.assertIn("Minimum of 5 years' experience in industrial sales", content)
        self.assertNotIn("made-up", saved["criteria"])
        self.application.refresh_from_db()
        result = self.application.match_breakdown
        main = row(result, "Minimum of 5 years")
        self.assertEqual((main["source"], main["verdict"]), ("AI", "not_met"))
        self.assertIn("Justrite", main["evidence"])
        self.assertLessEqual(float(self.application.match_score), CAP_NOT_MET)
        self.assertEqual(self.application.ai_summary, AI_ANSWER["summary"])
        # A new CV: the rules judge it again until Claude reads it afresh.
        self.candidate.cv_text = CVS["industrial"]
        self.candidate.save()
        self.application.refresh_from_db()
        result = score_application(self.application)
        self.assertEqual(row(result, "Minimum of 5 years")["source"], "rules")

    def test_the_scheduled_job_reads_a_few_at_a_time_and_waits_after_a_failure(self):
        from .ai_assess import assess_pending

        with mock.patch("pipeline.ai_assess.ai.structured_request", return_value=None) as call:
            self.assertEqual(assess_pending(), 0)
            self.assertEqual(assess_pending(), 0)
        self.assertEqual(call.call_count, 1)  # not asked again straight after a failure
        self.application.refresh_from_db()
        self.application.ai_assessment = {}
        self.application.save()
        with mock.patch("pipeline.ai_assess.ai.structured_request", return_value=self.answer("partly")):
            self.assertEqual(assess_pending(), 1)
            self.assertEqual(assess_pending(), 0)  # already read in its current form

    @override_settings(ANTHROPIC_API_KEY="")
    def test_nothing_is_sent_without_a_key(self):
        from .ai_assess import assess_pending

        with mock.patch("pipeline.ai_assess.ai.structured_request") as call:
            self.assertEqual(assess_pending(), 0)
        call.assert_not_called()

    def test_the_button_asks_claude(self):
        self.client.force_login(User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN))
        with mock.patch("pipeline.ai_assess.ai.structured_request", return_value=self.answer("partly")):
            response = self.client.post(reverse("pipeline:ai_summary", args=[self.application.pk]), follow=True)
        self.assertContains(response, "judged by Claude")
        self.assertContains(response, "Sales Supervisor at Justrite sells to walk-in shoppers.")
