import json
import os
import tempfile
import unittest

from jobsearch import __main__ as cli
from jobsearch import filters, tracker
from jobsearch.salary import parse_salary_text

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FIXTURES = os.path.join(HERE, "fixtures")

with open(os.path.join(ROOT, "config.json"), encoding="utf-8") as handle:
    CONFIG = json.load(handle)
RATES = CONFIG["usd_rates"]


class SalaryTest(unittest.TestCase):
    def test_annual_k_range(self):
        self.assertEqual(parse_salary_text("$60k - $90k", RATES), (5000, 7500))

    def test_monthly(self):
        self.assertEqual(parse_salary_text("$5,000 - $7,000 per month", RATES), (5000, 7000))

    def test_hourly(self):
        self.assertEqual(parse_salary_text("USD 40/hour", RATES), (6400, 6400))

    def test_euro_converted(self):
        self.assertEqual(parse_salary_text("€60,000 a year", RATES), (5400, 5400))

    def test_period_guessed_from_size(self):
        self.assertEqual(parse_salary_text("120000", RATES), (10000, 10000))

    def test_empty(self):
        self.assertEqual(parse_salary_text("Competitive", RATES), (None, None))


class FilterTest(unittest.TestCase):
    def test_location(self):
        self.assertTrue(filters.location_ok("Worldwide", CONFIG))
        self.assertTrue(filters.location_ok("", CONFIG))
        self.assertTrue(filters.location_ok("Europe, Africa", CONFIG))
        self.assertFalse(filters.location_ok("USA Only", CONFIG))
        self.assertFalse(filters.location_ok("Ukraine", CONFIG))

    def test_title(self):
        self.assertTrue(filters.title_matches("Senior Data Analyst", CONFIG))
        self.assertFalse(filters.title_matches("Data Analyst Intern", CONFIG))
        self.assertFalse(filters.title_matches("Data Engineer", CONFIG))


class EndToEndTest(unittest.TestCase):
    def run_cli(self, folder):
        csv_path = os.path.join(folder, "jobs.csv")
        cli.main(["--fixtures", FIXTURES, "--tracker", csv_path,
                  "--report", os.path.join(folder, "JOBS.md")])
        return csv_path

    def test_records_only_matches_and_keeps_edits(self):
        with tempfile.TemporaryDirectory() as folder:
            csv_path = self.run_cli(folder)
            rows = tracker.load(csv_path)
            self.assertEqual(
                sorted(row["company"] for row in rows),
                ["Acme Analytics", "Deel-ish", "EuroStart", "Paystack Labs"],
            )

            rows[0]["status"], rows[0]["notes"] = "Applied", "sent CV"
            tracker.save(csv_path, rows)
            self.run_cli(folder)

            again = tracker.load(csv_path)
            self.assertEqual(len(again), 4)
            edited = next(row for row in again if row["id"] == rows[0]["id"])
            self.assertEqual((edited["status"], edited["notes"]), ("Applied", "sent CV"))
            with open(os.path.join(folder, "JOBS.md"), encoding="utf-8") as handle:
                self.assertIn("## Applied (1)", handle.read())


if __name__ == "__main__":
    unittest.main()
