from django.test import TestCase

from candidates.models import Candidate
from core.models import Department
from requisitions.models import Requisition

from .matching import SIMILAR_CREDIT, compute_match, match_terms, Evidence

AP_DUTIES = """Process supplier invoices and payments accurately and on time
Three-way matching of purchase orders, goods received notes and invoices
Prepare payment schedules and vendor reconciliations
Month-end accruals and withholding tax remittances"""


def person(**kw):
    defaults = dict(first_name="Test", last_name="Person", highest_qualification="bsc", course="Accounting",
                    years_experience=4, skills=[], tools=[], certifications=[], cv_text="", summary="")
    defaults.update(kw)
    return Candidate(**defaults)


class BroaderTermTests(TestCase):
    def found(self, required, candidate):
        found, missing = match_terms(required, list(candidate.skills) + list(candidate.tools), Evidence(candidate), {})
        return {f["term"]: f for f in found}, missing

    def test_ms_word_is_microsoft_word(self):
        found, missing = self.found(["Microsoft Word", "Microsoft PowerPoint"], person(tools=["MS Word", "Power Point"]))
        self.assertEqual(missing, [])
        self.assertEqual(found["Microsoft Word"]["how"], "synonym")

    def test_microsoft_365_covers_excel_word_and_powerpoint(self):
        found, missing = self.found(["Microsoft Excel", "Microsoft Word", "Microsoft PowerPoint"],
                                    person(tools=["Microsoft 365"]))
        self.assertEqual(missing, [])
        self.assertEqual(found["Microsoft Excel"]["how"], "covered by “Microsoft 365”")
        # And the other way round: a part of the suite shows the suite is used.
        found, missing = self.found(["Microsoft Office"], person(tools=["Excel"]))
        self.assertEqual(missing, [])
        # Computer literacy is met by any office software; HSE Level 3 covers Level 1.
        found, missing = self.found(["Computer literacy", "HSE Level 1"], person(skills=["MS Office"],
                                                                                 certifications=["HSE Level 3"],
                                                                                 tools=["HSE Level 3"]))
        self.assertEqual(missing, [])

    def test_ordinary_words_are_not_software(self):
        _, missing = self.found(["Microsoft Excel"], person(cv_text="I excel at teamwork and meeting deadlines."))
        self.assertEqual(missing, ["Microsoft Excel"])
        found, missing = self.found(["Microsoft Excel", "Microsoft Word"],
                                    person(cv_text="Computer skills: Word, Excel and PowerPoint"))
        self.assertEqual(missing, [])
        self.assertEqual(found["Microsoft Excel"]["evidence"], "CV text")

    def test_similar_wording_in_the_cv_counts_at_three_quarters(self):
        cv = "Accounts Assistant, Dangote 2019 - 2023\n- Reconciled vendor statements every month\n- Prepared budgets"
        found, missing = self.found(["Vendor reconciliation", "Budgeting", "Treasury management"], person(cv_text=cv))
        self.assertEqual(missing, ["Treasury management"])
        self.assertEqual(found["Vendor reconciliation"]["how"], "similar wording in the CV")
        self.assertEqual(found["Vendor reconciliation"]["credit"], SIMILAR_CREDIT)
        self.assertIn("Reconciled vendor statements", found["Vendor reconciliation"]["wrote"])

    def test_hr_work_as_cvs_describe_it(self):
        cv = ("HR Officer, Indorama 2019 - 2024\n- Handled staff relations, grievances and disciplinary matters\n"
              "- Organised staff welfare programmes\n- Liaised with the union on collective bargaining\n"
              "- Ran performance appraisals and the induction of new staff")
        found, missing = self.found(["Employee engagement", "Employee relations", "Industrial relations",
                                     "Performance management", "Onboarding"], person(cv_text=cv))
        self.assertEqual(missing, [])

    def test_words_far_apart_are_not_similar_wording(self):
        cv = "Worked with vendors on deliveries\nBank reconciliation and cash book"
        _, missing = self.found(["Vendor reconciliation"], person(cv_text=cv))
        self.assertEqual(missing, ["Vendor reconciliation"])


class FitWithTheJobTests(TestCase):
    def setUp(self):
        dept = Department.objects.create(name="Finance", code="FIN")
        self.req = Requisition(department=dept, title="Accounts Payable Officer", employment_type="experienced",
                               education_level="hnd", courses=["Accounting"], min_experience_years=2,
                               required_skills=["Accounts payable", "Vendor reconciliation"],
                               tools=["Microsoft Excel"], job_description=AP_DUTIES)

    def test_a_cv_about_the_same_work_fits_without_the_same_words(self):
        payables = person(
            current_job_title="Payables Clerk", tools=["MS Office"],
            work_history=[{"job_title": "Accounts Payable Clerk", "company": "Notore", "description": ""}],
            summary="Handled supplier invoice processing, payment runs and reconciliation of vendor accounts; "
                    "posted month-end accrual entries and remitted withholding tax.")
        hr_person = person(course="Human Resource Management", current_job_title="HR Assistant", tools=["Excel"],
                           summary="Recruitment, onboarding and staff welfare.", skills=["Accounts payable"])
        good = compute_match(self.req, payables)
        weak = compute_match(self.req, hr_person)
        fit_good, fit_weak = good["components"]["relevance"], weak["components"]["relevance"]
        self.assertGreaterEqual(fit_good["percent"], 80)
        self.assertLess(fit_weak["percent"], 30)
        self.assertIn("past role “Accounts Payable Clerk” matches the job title", fit_good["found"])
        self.assertGreater(good["score"], weak["weighted_score"])
        # Covered and similar-wording matches carried the skills: nothing required is missing.
        self.assertEqual(good["components"]["skills"]["missing"], [])
        self.assertTrue(good["eligible"])
        self.assertEqual(round(sum(c["points"] for c in good["components"].values()), 1), good["weighted_score"])

    def test_related_course_and_unstated_details_do_not_rule_out(self):
        self.req.min_degree_class = "2_2"
        self.req.requires_nysc = True
        banker = person(course="Banking and Finance", degree_class="", nysc_status="", skills=["Accounts payable",
                                                                                               "Vendor reconciliation"])
        result = compute_match(self.req, banker)
        self.assertTrue(result["eligible"])
        unknown = {s["key"] for s in result["screening"] if s["unknown"]}
        self.assertEqual(unknown, {"degree_class", "nysc"})
        self.assertEqual(result["components"]["course"]["percent"], 60)

    def test_no_cv_text_leaves_the_fit_out_rather_than_scoring_zero(self):
        bare = person(skills=["Accounts payable", "Vendor reconciliation"], tools=["Excel"])
        result = compute_match(self.req, bare)
        self.assertNotIn("relevance", result["components"])
        self.assertEqual(round(sum(c["weight"] for c in result["components"].values()), 1), 100)
