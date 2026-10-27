"""Loading the website applications dump. All names and contacts here are made up."""

import os
import shutil
import tempfile
from datetime import date, datetime

from django.test import TestCase

from candidates.models import Candidate
from core import excel_link
from core.test_workbook_import import write
from core.workbook_import import WorkbookImporter, nysc_status

HEADERS = ["Full Name", "dob", "Gender", "Email ID", "Phone #", "Marital Status", "Marks_Obtained", "Qualification",
           "Discipline", "Institution", "Profile_Link", "Community", "Local_Govt", "Year_of_Graduation",
           "NYSC_Completion_Year", "Column1"]
SITE = "https://www.example.com/resume/"


def row(name, dob, sex, email, phone, link, course="Chemical Engineering", school="Sample University", year=2019,
        degree="B.Sc", marks="Second Class Upper Division", nysc="2021"):
    return [name, datetime(*dob), sex, email, phone, "Single", marks, degree, course, school, SITE + link, "Akpajo",
            "Eleme", year, nysc, None]


class ApplicationsDumpTests(TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "Application_Query_Application Dumps.xlsx")
        # Already in the portal from the CV file / interview records
        self.ada = Candidate.objects.create(first_name="Ada", last_name="Testperson", email="ada.test@example.com",
                                            phone="2348031234567", gender="female", course="Chemical Engineering")
        self.bayo = Candidate.objects.create(first_name="Bayo", last_name="Sample", email="bayo@example.com",
                                             date_of_birth=date(1995, 8, 22), gender="male")
        self.chidi = Candidate.objects.create(first_name="Chidi", last_name="Okafor Nnamdi", phone="2348050000001",
                                              date_of_birth=date(1994, 2, 2), gender="male", course="Mechanical Engineering")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def load(self, rows):
        write(self.path, [("Indorama", ["ib_applynow"], [["id"]]), ("ApplicationS Dump_Indorama", HEADERS, rows)])
        return WorkbookImporter([self.path], replace=False, report_dir=None, log=lambda m: None,
                                require_all=False).run()

    def test_matches_new_people_repeats_and_doubts(self):
        rows = [
            # 2: Ada, same email and phone, her full name in another order: matched; empty fields filled
            row("Testperson Ada", (1996, 3, 13), "Female", "ADA.TEST@example.com", "08031234567", "1700000000-ada.pdf"),
            # 3: Bayo by email, but a different date of birth and only one shared name: held
            row("Bayo Adeleke", (1997, 1, 1), "Male", "bayo@example.com", "08049999999", "1700000001-bayo.pdf"),
            # 4: someone new
            row("Ngozi Newperson", (1999, 9, 9), "Female", "ngozi@example.com", "08077776666", "1700000002-ngozi.docx"),
            # 5 and 6: Emeka applied twice with new emails and phones: one profile, the later resume
            row("Emeka Johnson Obi", (1998, 5, 5), "Male", "emeka1@example.com", "08011111111", "1600000000-old.pdf"),
            row("Obi Emeka Johnson", (1998, 5, 5), "Male", "emeka2@example.com", "08022222222", "1700000003-new.pdf"),
            # 7: uses Ada's phone under a different name: held, Ada untouched
            row("Zainab Other", (2000, 1, 1), "Female", "zainab@example.com", "08031234567", "1700000004-z.pdf"),
            # 8: same full name and birthday as Chidi, new contacts, same gender and course: the same person
            row("Chidi Okafor Nnamdi", (1994, 2, 2), "Male", "chidi.new@example.com", "08090000000", "1700000005-c.pdf",
                course="Mechanical Engineering"),
        ]
        result = self.load(rows)
        counts = result.counts
        self.assertEqual(counts["website applications: new candidates"], 2)  # Ngozi, Emeka
        self.assertEqual(counts["website applications: matched to candidates already in the portal"], 2)  # Ada, Chidi
        self.assertEqual(counts["website applications: held for checking (see report)"], 2)  # Bayo, Zainab
        self.assertEqual(counts["website applications: same person applied more than once (one profile)"], 1)

        self.ada.refresh_from_db()
        self.assertEqual(self.ada.resume_url, SITE + "1700000000-ada.pdf")
        self.assertEqual(self.ada.date_of_birth, date(1996, 3, 13))  # was empty
        self.assertEqual((self.ada.first_name, self.ada.email), ("Ada", "ada.test@example.com"))  # kept
        self.assertEqual(self.ada.lga, "Eleme / Akpajo")
        self.assertEqual(self.ada.nysc_status, "completed")
        self.assertEqual(self.ada.degree_class, "2_1")

        self.bayo.refresh_from_db()
        self.assertEqual(self.bayo.resume_url, "")
        self.assertEqual(self.bayo.date_of_birth, date(1995, 8, 22))
        held = {h[1]: h[5] for h in result.applications_held}
        self.assertIn("date of birth", held["Bayo Adeleke"])
        self.assertIn("Ada Testperson", held["Zainab Other"])

        emeka = Candidate.objects.get(email="emeka2@example.com")
        self.assertEqual(emeka.resume_url, SITE + "1700000003-new.pdf")
        self.assertIn("emeka1@example.com", emeka.other_contacts)
        self.assertEqual(emeka.source_detail, "Website application")
        self.assertEqual(len(emeka.source_records), 2)
        self.assertFalse(Candidate.objects.filter(email="emeka1@example.com").exists())

        self.chidi.refresh_from_db()
        self.assertEqual(self.chidi.resume_url, SITE + "1700000005-c.pdf")
        self.assertEqual(self.chidi.email, "chidi.new@example.com")  # was empty
        self.assertEqual(self.chidi.phone, "2348050000001")  # kept; the new number is noted as another contact
        self.assertIn("8090000000", self.chidi.other_contacts)
        self.assertFalse(Candidate.objects.filter(email__startswith="zainab").exists())
        self.assertEqual(Candidate.objects.count(), 5)

        # Loading the same file again changes nothing and holds the same rows.
        again = self.load(rows)
        self.assertEqual(again.counts["website applications: new candidates"], 0)
        self.assertEqual(again.counts["website applications: profiles updated"], 0)
        self.assertEqual({h[0] for h in again.applications_held}, {h[0] for h in result.applications_held})
        self.assertEqual(Candidate.objects.count(), 5)

    def test_two_applications_for_one_profile_that_disagree_are_held(self):
        rows = [row("Ada Testperson", (1996, 3, 13), "Female", "ada.test@example.com", "08000000001", "1-a.pdf"),
                row("Ada Testperson", (1996, 9, 9), "Female", "ada.other@example.com", "08031234567", "2-b.pdf")]
        result = self.load(rows)
        self.assertEqual(len(result.applications_held), 2)
        self.ada.refresh_from_db()
        self.assertEqual(self.ada.resume_url, "")

    def test_the_dump_can_be_linked_to_the_excel_link(self):
        write(self.path, [("ApplicationS Dump_Indorama", HEADERS, [
            row("Ngozi Newperson", (1999, 9, 9), "Female", "ngozi@example.com", "08077776666", "1-n.pdf")])])
        workbook = excel_link.link([self.path])[0]
        self.assertEqual(workbook.sheets, "Website applications")

    def test_nysc_words(self):
        for value, expected in (("2021", "completed"), ("01/01/2025", "completed"), ("2031", "ongoing"),
                                ("Yes", "completed"), ("Not yet", "not_yet"), ("Exemption", "exempted"),
                                ("Nil", ""), (None, "")):
            self.assertEqual(nysc_status(value, 2026), expected, value)
