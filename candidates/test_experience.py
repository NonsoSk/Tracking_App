from datetime import date
from decimal import Decimal
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import TestCase, override_settings

from .cv_parser import heuristic_extract, parse_cv
from .experience import from_history, recalculate
from .models import Candidate

TODAY = date(2026, 11, 12)


def years(text):
    data = heuristic_extract(text)
    return data["years_experience"], data.get("experience_note", "")


@mock.patch("candidates.experience.timezone.localdate", lambda: TODAY)
class YearsOfExperienceTests(TestCase):
    """From the dates of the jobs: the earliest start to the latest end, gaps between jobs left out."""

    def test_jobs_that_follow_on_count_from_the_first_start_to_the_last_end(self):
        value, note = years("WORK EXPERIENCE\nAccounts Officer, Notore 2023 - 2024\nSenior Accountant, Dangote 2024 - 2026\n"
                            "EDUCATION\nB.Sc Accounting, UNIPORT 2015 - 2019")
        self.assertEqual(value, 3.0)
        self.assertIn("3 yrs, from the job dates (2023 – 2026)", note)

    def test_a_gap_between_jobs_is_not_counted(self):
        value, note = years("WORK EXPERIENCE\nAccountant, Notore\n2023 - 2024\nFinance Officer, Indorama\nMay 2026 - Present")
        self.assertEqual(value, 1.5)  # 1 year, then May to November 2026
        self.assertIn("2023 – 2024, May 2026 – now", note)
        self.assertIn("2 yrs 4 mos between jobs not counted", note)

    def test_months_count_the_end_month_included(self):
        self.assertIn("2 yrs 3 mos", years("EXPERIENCE\nHR Assistant | Shoprite | Jan 2019 – Mar 2021")[1])
        value, note = years("PROFESSIONAL EXPERIENCE\nHR Assistant | Shoprite | Jan 2019 – Mar 2021\n"
                            "HR Officer | MTN | Apr 2021 – Till Date")
        self.assertEqual(value, 7.8)  # Jan 2019 to Nov 2026, no gap
        self.assertIn("(Jan 2019 – now)", note)

    def test_jobs_at_the_same_time_count_once(self):
        self.assertEqual(years("Experience\nConsultant 2018 - 2022\nAccountant, Notore (Feb 2020 - Aug 2021)")[0], 4.0)

    def test_dates_written_in_other_ways(self):
        self.assertEqual(years("WORK HISTORY\nAccountant, Notore 01/2020 - 06/2022")[0], 2.5)
        self.assertEqual(years("EMPLOYMENT HISTORY (MOST RECENT FIRST)\nPayables Officer, since March 2024")[0], 2.7)
        self.assertEqual(years("WORK EXPERIENCE\nClerk, Notore\nSept. 2024 to date")[0], 2.2)
        self.assertEqual(years("WORK EXPERIENCE\nClerk, Notore 15th June, 2025 - Present")[0], 1.4)

    def test_school_and_student_training_are_not_work(self):
        # The education section, a school line with no headings, and SIWES (as an entry or its own section).
        self.assertEqual(years("ADA OBI\nUniversity of Lagos 2012 - 2016\nB.Sc Accounting\nNotore, Accountant 2018 - 2021")[0], 3.0)
        self.assertEqual(years("WORK EXPERIENCE & ACHIEVEMENTS\nIndustrial Training (SIWES)\nNNPC, Warri 2016 - 2017\n"
                               "Accountant, Notore\nJune 2020 – present")[0], 6.4)
        self.assertEqual(years("INDUSTRIAL TRAINING\nNNPC, Warri 2016 - 2017\nWORK EXPERIENCE\n"
                               "Accountant, Notore June 2020 – present")[0], 6.4)

    def test_nysc_counts_unless_switched_off(self):
        text = "WORK EXPERIENCE\nNYSC: Ministry of Finance, Port Harcourt 2019 - 2020\nAccountant, Notore, 2021 - 2022"
        self.assertEqual(years(text)[0], 2.0)
        with override_settings(EXPERIENCE_COUNTS_NYSC=False):
            self.assertEqual(years(text)[0], 1.0)

    def test_stated_years_only_when_there_are_no_dates(self):
        self.assertEqual(years("SUMMARY\nOver 15 years of experience.\nWORK HISTORY\nAccountant 01/2020 - 06/2022")[0], 2.5)
        value, note = years("PROFILE\nAccountant with 7 years experience in manufacturing.")
        self.assertEqual(value, 7.0)
        self.assertIn("no job dates found", note)

    def test_a_date_in_the_future_counts_up_to_today(self):
        value, note = years("EXPERIENCE\nAnalyst, Notore Jan 2026 - Dec 2027")
        self.assertEqual(value, 0.8)  # January to 12 November 2026: 10 months
        self.assertIn("10 mos", note)

    def test_the_same_count_from_the_jobs_the_ai_reads(self):
        jobs = [{"job_title": "Accountant", "company": "Notore", "start": "2023", "end": "2024"},
                {"job_title": "Finance Officer", "company": "Indorama", "start": "May 2026", "end": "Present"},
                {"job_title": "Industrial training (SIWES)", "company": "NNPC", "start": "2016", "end": "2017"}]
        self.assertEqual(from_history(jobs).years, 1.5)

    @override_settings(AI_ENABLED=True, ANTHROPIC_API_KEY="test")
    def test_with_ai_the_years_come_from_the_dates_not_the_ais_total(self):
        ai = {"first_name": "Ada", "last_name": "Obi", "years_experience": 9,
              "work_history": [{"job_title": "Accountant", "company": "Notore", "start": "2023", "end": "2024",
                                "description": ""},
                               {"job_title": "Finance Officer", "company": "Indorama", "start": "May 2026",
                                "end": "Present", "description": ""}]}
        with mock.patch("candidates.cv_parser.ai.ai_enabled", return_value=True), \
                mock.patch("candidates.cv_parser.ai_extract", return_value=ai):
            parsed = parse_cv(b"Ada Obi\nAccountant", "ada.txt")
        self.assertEqual(parsed["years_experience"], 1.5)
        self.assertTrue(any(n.startswith("Experience: 1 yr 6 mos") for n in parsed["notes"]))


@mock.patch("candidates.experience.timezone.localdate", lambda: TODAY)
class RecalculateTests(TestCase):
    CV = "WORK EXPERIENCE\nAccountant, Notore 2023 - 2024\nFinance Officer, Indorama May 2026 - Present"

    def make(self, **kw):
        defaults = dict(first_name="Ada", last_name="Obi", cv_text=self.CV, parse_method="heuristic",
                        years_experience=Decimal("3.5"), source="email", parse_notes="Name taken from the file name")
        defaults.update(kw)
        return Candidate.objects.create(**defaults)

    def test_a_profile_is_worked_out_again_from_its_cv(self):
        person = self.make()
        old, new, note = recalculate(person)
        person.refresh_from_db()
        self.assertEqual((old, new, person.years_experience), (Decimal("3.5"), Decimal("1.5"), Decimal("1.5")))
        self.assertEqual(person.parse_notes.splitlines()[0], "Name taken from the file name")
        self.assertTrue(person.parse_notes.splitlines()[1].startswith("Experience: 1 yr 6 mos"))

    def test_the_command_lists_then_applies_and_leaves_checked_and_excel_profiles(self):
        unchecked = self.make()
        from django.utils import timezone

        checked = self.make(first_name="Bola", checked_at=timezone.now())
        excel = self.make(first_name="Chidi", source="import")
        out = StringIO()
        call_command("recalculate_experience", stdout=out)
        self.assertIn("Ada Obi: 3.5 -> 1.5", out.getvalue())
        self.assertNotIn("Bola", out.getvalue())
        unchecked.refresh_from_db()
        self.assertEqual(unchecked.years_experience, Decimal("3.5"))  # not saved without --apply
        call_command("recalculate_experience", "--apply", stdout=StringIO())
        for person, expected in ((unchecked, "1.5"), (checked, "3.5"), (excel, "3.5")):
            person.refresh_from_db()
            self.assertEqual(person.years_experience, Decimal(expected), person.first_name)
        call_command("recalculate_experience", "--apply", "--include-checked", stdout=StringIO())
        checked.refresh_from_db()
        self.assertEqual(checked.years_experience, Decimal("1.5"))


class CheckPageShowsTheWorkingTests(TestCase):
    def test_the_years_field_says_how_it_was_worked_out(self):
        from django.urls import reverse

        from accounts.models import User

        person = Candidate.objects.create(
            first_name="Ada", last_name="Obi", email="ada@example.com", needs_check=True, years_experience=1.5,
            parse_notes="Experience: 1 yr 6 mos, from the job dates (2023 – 2024, May 2026 – now); 2 yrs 4 mos "
                        "between jobs not counted.")
        self.client.force_login(User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN))
        page = self.client.get(reverse("candidates:check_profile", args=[person.pk]))
        self.assertContains(page, "Worked out: 1 yr 6 mos, from the job dates (2023 – 2024, May 2026 – now)")
        self.assertNotContains(page, "<b>Check these</b>")
