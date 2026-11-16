"""Only CVs become profiles, and each CV once (candidates/cv_filter.py, candidates/intake.py)."""

import shutil
import tempfile
from io import StringIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse

from accounts.models import User
from core.demo_files import cv_lines, simple_docx
from core.models import Department
from pipeline.models import Application
from requisitions.models import Requisition

from .cv_filter import judge, same_cv, text_key
from .cv_parser import parse_cv
from .intake import ingest_cv
from .models import Candidate, CandidateDocument

MEDIA = tempfile.mkdtemp(prefix="test-media-")


def tearDownModule():
    shutil.rmtree(MEDIA, ignore_errors=True)


FULL_CV = """ADA OBI
ada.obi@example.com | 0803 123 4567
PROFILE
Sales professional with B2B experience.
WORK EXPERIENCE
Sales Executive, Notore Chemical Industries Plc   Jan 2019 – Present
- Sold urea and NPK fertilizer to blenders and agro-dealers
Sales Representative, Dangote Cement   Mar 2014 – Dec 2018
- Managed key accounts with construction companies
EDUCATION
B.Sc Marketing, University of Port Harcourt 2008 - 2012
SKILLS
Negotiation, Microsoft Excel
"""
GRADUATE_CV = """CURRICULUM VITAE
Name: Chinedu Okafor
Phone: 08039998877
Email: chinedu@example.com
EDUCATION
B.Sc Chemical Engineering, University of Port Harcourt, 2023 (Second Class Upper)
SKILLS
Microsoft Excel, AutoCAD
REFEREES
Available on request"""
NO_HEADINGS_CV = """Bola Ade
bola.ade@example.com 08051234567
Accountant with Dangote Cement from 2019 - 2023 handling payables and reconciliations.
Accounts Assistant, Notore 2016 - 2019.
I hold a B.Sc in Accounting from UNILAG (2015) and I am an ICAN student."""
COVER_LETTER = """12 Aba Road, Port Harcourt
ada.obi@example.com 08031234567

The Human Resources Manager
Indorama Eleme Fertilizer & Chemicals Ltd

Dear Sir/Madam,

APPLICATION FOR THE POSITION OF SALES OFFICER

I wish to apply for the position of Sales Officer advertised on your website. I hold a B.Sc in Marketing and have six
years of experience selling fertilizer to distributors across the South-South. I am confident that my skills will add
value to your team and I would welcome the chance to discuss my application at an interview.

Please find attached my curriculum vitae for your consideration. I look forward to hearing from you.

Yours faithfully,
Ada Obi"""
NYSC = """NATIONAL YOUTH SERVICE CORPS
CERTIFICATE OF NATIONAL SERVICE
This is to certify that OBI ADA CHIOMA of University of Port Harcourt has successfully completed the service year
from March 2013 to February 2014.
Director-General"""
JOB_DESCRIPTION = """JOB DESCRIPTION
Job Title: Accounts Payable Officer
Reports to: Finance Manager
Key Responsibilities
Process supplier invoices and payments accurately and on time
Prepare vendor reconciliations and payment schedules
Requirements
HND/B.Sc Accounting; minimum of 3 years experience
The successful candidate must have good knowledge of SAP.
How to apply: send your CV to careers@example.com"""
INVOICE = ("INVOICE\nInvoice No: 0042\nBill to: Indorama\nDescription Qty Amount\nPrinting of forms 200 45,000\n"
           "Amount due: 45,000\nThank you for your business. Pay into GTBank 0123456789 within 14 days of this invoice.")


def read(text, name="file.txt"):
    return judge(parse_cv(text.encode(), name), name)


class IsItACvTests(TestCase):
    def test_cvs_of_every_shape_are_cvs(self):
        for name, text in [("full", FULL_CV), ("graduate", GRADUATE_CV), ("no headings", NO_HEADINGS_CV),
                           ("letter then cv", "Dear Sir,\nI wish to apply for the post.\nYours faithfully\n\n" + FULL_CV)]:
            self.assertTrue(read(text).is_cv, name)

    def test_a_short_cv_is_still_a_cv(self):
        short = ("ADA OBI\nada.obi@example.com | 0803 123 4567\nWORK EXPERIENCE\nAccountant, Notore   Jan 2019 - Present\n"
                 "EDUCATION\nB.Sc Accounting, UNIPORT 2008 - 2012\n")
        self.assertTrue(read(short).is_cv)  # under 25 words, but everything a CV has
        self.assertEqual(read("scan 0001 page").kind, "unreadable")

    def test_what_comes_with_cvs_is_not_a_cv(self):
        for text, kind in [(COVER_LETTER, "a cover letter"), (NYSC, "a certificate, result or ID"),
                           (JOB_DESCRIPTION, "a job description"), (INVOICE, "an invoice or receipt")]:
            verdict = read(text)
            self.assertFalse(verdict.is_cv, kind)
            self.assertEqual(verdict.kind, kind)
            self.assertTrue(verdict.reason.startswith("Not a CV"))

    def test_a_file_that_cannot_be_read_is_set_aside_too(self):
        verdict = judge({"text": "", "method": "", "scanned": True,
                         "notes": ["Enable AI (ANTHROPIC_API_KEY) or install Tesseract OCR to read scanned CVs."]})
        self.assertEqual((verdict.is_cv, verdict.kind), (False, "unreadable"))
        self.assertIn("scan or a photo", verdict.reason)
        self.assertIn("Tesseract", verdict.reason)

    def test_the_ai_reader_can_say_it_is_not_a_cv(self):
        self.assertFalse(judge({"text": "", "method": "ai", "is_cv": False}).is_cv)
        scanned = {"text": "Sales Executive Notore", "method": "ai", "is_cv": True, "email": "a@example.com",
                   "phone": "0803", "work_history": [{"job_title": "Sales Executive"}],
                   "education_history": [{"course": "Marketing"}]}
        self.assertTrue(judge(scanned).is_cv)

    def test_the_same_cv_is_recognised_whatever_the_layout(self):
        self.assertEqual(text_key(FULL_CV), text_key(FULL_CV.replace("\n", "\n\n  ").upper()))
        self.assertNotEqual(text_key(FULL_CV), text_key(GRADUATE_CV))
        self.assertTrue(same_cv(FULL_CV, FULL_CV.replace("- Sold", "• Sold")))
        self.assertFalse(same_cv(FULL_CV, FULL_CV + "\nSales Manager, Lafarge Africa Jan 2026 - Present\nLed 12 reps"))


@override_settings(MEDIA_ROOT=MEDIA)
class NoDuplicatesTests(TestCase):
    def setUp(self):
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        department = Department.objects.create(name="Sales", code="SAL")
        self.vacancy = Requisition.objects.create(department=department, title="Sales Officer", status="open",
                                                  courses=["Marketing"])

    def add(self, text=FULL_CV, name="Ada Obi CV.txt", **kw):
        return ingest_cv(text.encode(), name, source="email", only_cvs=True, notify_team=False, **kw)

    def test_a_file_that_is_not_a_cv_leaves_nothing_behind(self):
        result = self.add(COVER_LETTER, "Ada Obi cover letter.txt")
        self.assertEqual((result.status, result.set_aside), ("not_cv", "a cover letter"))
        self.assertFalse(Candidate.objects.exists())
        self.assertFalse(CandidateDocument.objects.exists())

    def test_the_same_file_again_adds_nothing(self):
        first = self.add()
        self.assertEqual(first.status, "added")
        again = self.add(name="CV (1).txt")  # the same file under another name
        self.assertEqual((again.status, again.candidate), ("duplicate", first.candidate))
        self.assertEqual((Candidate.objects.count(), CandidateDocument.objects.count()), (1, 1))

    def test_the_same_cv_in_another_format_adds_nothing(self):
        first = self.add()
        word = ingest_cv(simple_docx(FULL_CV.splitlines()), "Ada Obi.docx", source="email", only_cvs=True)
        self.assertEqual((word.status, word.candidate), ("duplicate", first.candidate))
        self.assertEqual(CandidateDocument.objects.count(), 1)

    def test_a_cv_already_held_is_still_put_forward_for_the_vacancy_chosen(self):
        first = self.add()
        again = self.add(requisition=self.vacancy)
        self.assertTrue(again.duplicate)
        self.assertEqual(Application.objects.get().candidate, first.candidate)
        self.assertEqual(CandidateDocument.objects.count(), 1)

    def test_a_newer_cv_brings_the_profile_up_to_date(self):
        person = self.add().candidate
        self.assertEqual(person.current_job_title or "Sales Executive", "Sales Executive")
        newer = FULL_CV.replace("WORK EXPERIENCE\n", "WORK EXPERIENCE\nSales Manager, Lafarge Africa   Jan 2010 – Feb 2014\n"
                                                     "- Led a team of 12 sales representatives\n")
        result = self.add(newer, "Ada Obi CV 2026.txt")
        self.assertEqual((result.status, result.candidate), ("updated", person))
        person.refresh_from_db()
        self.assertEqual(person.documents.count(), 2)
        self.assertGreater(float(person.years_experience), 16)  # was about 12.7 years
        self.assertIn("Lafarge", person.cv_text)

    def test_figures_hr_corrected_by_hand_are_left_alone(self):
        person = self.add().candidate
        self.client.force_login(self.hr)
        self.client.post(reverse("candidates:edit", args=[person.pk]), {
            "first_name": "Ada", "last_name": "Obi", "email": "ada.obi@example.com", "source": "email",
            "years_experience": "9"})
        person.refresh_from_db()
        self.assertIsNotNone(person.checked_at)
        self.add(FULL_CV + "\nSales Manager, Lafarge Africa   Jan 2010 – Feb 2014\nLed a team of 12 reps", "new.txt")
        person.refresh_from_db()
        self.assertEqual(float(person.years_experience), 9)

    def test_uploading_the_same_folder_twice(self):
        self.client.force_login(self.hr)

        def folder():
            return [SimpleUploadedFile("Ada Obi CV.txt", FULL_CV.encode()),
                    SimpleUploadedFile("Chinedu.txt", GRADUATE_CV.encode()),
                    SimpleUploadedFile("Ada cover letter.txt", COVER_LETTER.encode()),
                    SimpleUploadedFile("NYSC.txt", NYSC.encode()),
                    SimpleUploadedFile("Copy of Ada Obi CV.txt", FULL_CV.encode())]

        first = self.client.post(reverse("candidates:intake"), {"files": folder(), "source": "email"})
        self.assertEqual(first.context["counts"], {"added": 2, "updated": 0, "duplicate": 1, "not_cv": 2,
                                                   "unreadable": 0, "error": 0})
        self.assertContains(first, "Not a CV: it reads as a cover or application letter.")
        self.assertContains(first, "not added again")
        self.assertEqual(Candidate.objects.count(), 2)
        again = self.client.post(reverse("candidates:intake"), {"files": folder(), "source": "email"})
        self.assertEqual((again.context["counts"]["added"], again.context["counts"]["duplicate"]), (0, 3))
        self.assertEqual((Candidate.objects.count(), CandidateDocument.objects.count()), (2, 2))
        # Both runs offer to match the CVs, those already held included.
        self.assertEqual(again.context["match_count"], 2)

    def test_a_file_set_aside_by_mistake_can_be_added_on_request(self):
        self.client.force_login(self.hr)
        odd = SimpleUploadedFile("Musa.txt", b"Musa Ibrahim\nWelder, ten years on rigs and pipelines in the Niger Delta. "
                                             b"Trade Test Grade 1. Available at once for work anywhere in Rivers State.")
        response = self.client.post(reverse("candidates:intake"), {"files": [odd], "source": "hard_copy"})
        self.assertEqual(response.context["counts"]["not_cv"], 1)
        self.assertFalse(Candidate.objects.exists())
        odd.seek(0)
        response = self.client.post(reverse("candidates:intake"), {"files": [odd], "source": "hard_copy",
                                                                   "every_file": "1"})
        self.assertEqual(response.context["counts"]["added"], 1)
        self.assertEqual(Candidate.objects.get().first_name, "Musa")

    def test_tidying_duplicates_from_before(self):
        first = self.add().candidate
        # As uploads used to leave them: a second copy on the profile, and a second profile from the same CV.
        document = first.documents.get()
        CandidateDocument.objects.create(candidate=first, doc_type="cv", file=document.file.name,
                                         original_name="copy.txt", sha256=document.sha256)
        twin = Candidate.objects.create(first_name="Ada", last_name="Obi", cv_text=FULL_CV, source="email")
        applied = Candidate.objects.create(first_name="Ada", last_name="O.", cv_text=FULL_CV, source="email")
        Application.objects.create(candidate=applied, requisition=self.vacancy)
        out = StringIO()
        call_command("tidy_duplicate_cvs", stdout=out)
        self.assertIn("Would remove 1 extra copy and 1 duplicate profile", out.getvalue())
        self.assertEqual(Candidate.objects.count(), 3)
        call_command("tidy_duplicate_cvs", "--apply", stdout=StringIO())
        self.assertFalse(Candidate.objects.filter(pk=twin.pk).exists())
        self.assertTrue(Candidate.objects.filter(pk=applied.pk).exists())  # it has an application: left alone
        self.assertEqual(first.documents.count(), 1)


@override_settings(MEDIA_ROOT=MEDIA)
class FolderLeavesOutWhatIsNotACvTests(TestCase):
    def test_letters_and_copies_are_noted_and_unread_files_can_be_tried_again(self):
        import os
        import time
        from pathlib import Path

        from core import cv_folder
        from core.models import FolderFile

        root = Path(tempfile.mkdtemp(prefix="cv-folder-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        for name, content in [("Ada Obi CV.txt", FULL_CV.encode()), ("Ada cover letter.txt", COVER_LETTER.encode()),
                              ("scan.txt", b"  ")]:
            (root / name).write_bytes(content)
            os.utime(root / name, (time.time() - 120, time.time() - 120))
        ingest_cv(simple_docx(FULL_CV.splitlines()), "Ada.docx", source="email")  # already in the portal
        folder = cv_folder.link(str(root))
        self.assertEqual(cv_folder.check(), [])
        notes = {f.name: f.skipped for f in FolderFile.objects.all()}
        self.assertIn("Already in the portal", notes["Ada Obi CV.txt"])
        self.assertIn("cover or application letter", notes["Ada cover letter.txt"])
        self.assertIn("Could not be read", notes["scan.txt"])
        stats = cv_folder.summary(folder)
        self.assertEqual((stats["read"], stats["held"], stats["skipped"], stats["unread"]), (0, 1, 1, 1))
        self.assertEqual(cv_folder.retry_unread(folder), 1)
        self.assertFalse(FolderFile.objects.filter(name="scan.txt").exists())
