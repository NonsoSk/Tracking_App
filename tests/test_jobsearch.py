import json
import os
import shutil
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
        cli.main(["--fixtures", FIXTURES, "--no-drafts", "--tracker", csv_path,
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


class FakeBlock:
    type = "text"

    def __init__(self, text):
        self.text = text


class FakeClient:
    """Stands in for anthropic.Anthropic and records each request."""

    def __init__(self):
        self.requests = []
        self.beta = self
        self.messages = self

    def create(self, **request):
        self.requests.append(request)
        docs = {
            "resume_markdown": "# Ada Obi\n\n## Experience\n- **Analyst** at Acme, built SQL dashboards",
            "cover_letter": "Dear hiring team,\n\nI would like to apply.\n\nAda Obi",
            "email_subject": "Senior Data Analyst application",
            "email_body": "Hello,\n\nPlease find my resume attached.\n\nAda",
            "fit_score": 8,
            "gaps": ["Looker"],
        }
        response = type("Response", (), {})()
        response.stop_reason = "end_turn"
        response.content = [FakeBlock(json.dumps(docs))]
        return response


class ApplicationTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.folder)
        os.makedirs(os.path.join(self.folder, "profile"))
        with open(os.path.join(self.folder, "profile", "resume.md"), "w") as handle:
            handle.write("Ada Obi\nAnalyst at Acme, 2021 to now. SQL, Python, Tableau.")
        self.paths = ["--root", self.folder,
                      "--tracker", os.path.join(self.folder, "jobs.csv"),
                      "--report", os.path.join(self.folder, "JOBS.md")]

    def test_contacts_come_from_the_post(self):
        from jobsearch.outreach import find_contacts
        text = "Questions: noreply@x.com. Apply to careers@startup.io or ceo@startup.io"
        self.assertEqual(find_contacts(text), ["careers@startup.io", "ceo@startup.io"])

    def test_drafts_then_sends_only_approved_jobs(self):
        client = FakeClient()
        cli.main(["--fixtures", FIXTURES, *self.paths], client=client)
        self.assertEqual(len(client.requests), 4)
        self.assertIn("Ada Obi", client.requests[0]["system"][0]["text"])

        rows = tracker.load(os.path.join(self.folder, "jobs.csv"))
        paystack = next(row for row in rows if row["company"] == "Paystack Labs")
        self.assertEqual((paystack["contact"], paystack["fit"]), ("jobs@paystacklabs.io", "8"))
        package = os.path.join(self.folder, paystack["package"])
        for name in ("job.md", "resume.md", "resume.html", "cover_letter.md", "outreach.md"):
            self.assertTrue(os.path.exists(os.path.join(package, name)), name)

        sent = []
        sender = lambda settings, to, subject, body, files: sent.append(to)
        os.environ.update(SMTP_USER="me@gmail.com", SMTP_PASSWORD="x")
        try:
            cli.main(["send", *self.paths], sender=sender)
            self.assertEqual(sent, [])  # nothing is approved yet

            paystack["status"] = "Approved"
            tracker.save(os.path.join(self.folder, "jobs.csv"), rows)
            cli.main(["send", *self.paths], sender=sender)
            cli.main(["send", *self.paths], sender=sender)  # never sends twice
        finally:
            del os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"]
        self.assertEqual(sent, ["jobs@paystacklabs.io"])
        after = tracker.load(os.path.join(self.folder, "jobs.csv"))
        self.assertEqual(next(r for r in after if r["company"] == "Paystack Labs")["status"], "Applied")

    def test_no_drafts_without_a_resume(self):
        os.remove(os.path.join(self.folder, "profile", "resume.md"))
        client = FakeClient()
        cli.main(["--fixtures", FIXTURES, *self.paths], client=client)
        self.assertEqual(client.requests, [])


class DocumentTest(unittest.TestCase):
    def test_markdown_to_html(self):
        from jobsearch.documents import markdown_to_html
        out = markdown_to_html("# Ada\n\n- **SQL** & [site](https://a.io)\nPlain <b>")
        self.assertIn("<h1>Ada</h1>", out)
        self.assertIn('<li><strong>SQL</strong> &amp; <a href="https://a.io">site</a></li>', out)
        self.assertIn("<p>Plain &lt;b&gt;</p>", out)


if __name__ == "__main__":
    unittest.main()
