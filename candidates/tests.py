import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from accounts.models import User
from core.demo_files import cv_lines, simple_docx, simple_pdf

from .cv_parser import extract_text, heuristic_extract, parse_cv
from .intake import apply_parsed, find_existing, ingest_cv
from .models import Candidate

MEDIA = tempfile.mkdtemp(prefix="test-media-")


def tearDownModule():
    shutil.rmtree(MEDIA, ignore_errors=True)


SAMPLE = """CURRICULUM VITAE
ENGR. IFEOMA  CHUKWU
Plot 5, Trans-Amadi, Port Harcourt | ifeoma.chukwu@example.com | +234 803 555 0101
Date of Birth: 14th March 1992      Sex: Female

CAREER OBJECTIVE
Instrumentation engineer seeking to improve plant reliability.

PROFESSIONAL EXPERIENCE
Instrument Engineer - Indorama Eleme Petrochemicals Ltd
Jan 2019 - Present
- DCS configuration on Yokogawa CENTUM VP; instrument calibration with Fluke calibrators
- Safety instrumented systems (Triconex) testing
Graduate Trainee, Dangote Cement Plc   06/2016 - 12/2018

EDUCATION
University of Nigeria, Nsukka — B.Eng Electrical/Electronics Engineering, 2015
Second Class Upper Division
NYSC: completed 2016

CERTIFICATIONS
TÜV Functional Safety Engineer (2021)
COREN
"""


class HeuristicParserTests(TestCase):
    def test_extracts_core_fields(self):
        data = heuristic_extract(SAMPLE)
        self.assertEqual((data["first_name"], data["last_name"]), ("Ifeoma", "Chukwu"))
        self.assertEqual(data["email"], "ifeoma.chukwu@example.com")
        self.assertEqual(data["phone"], "+2348035550101")
        self.assertEqual(data["gender"], "female")
        self.assertEqual(str(data["date_of_birth"]), "1992-03-14")
        self.assertEqual(data["highest_qualification"], "bsc")
        self.assertEqual(data["course"], "Electrical/Electronics Engineering")
        self.assertIn("University of Nigeria", data["institution"])
        self.assertEqual(data["degree_class"], "2_1")
        self.assertEqual(data["nysc_status"], "completed")
        self.assertEqual(data["location"], "Port Harcourt")
        self.assertGreaterEqual(data["years_experience"], 9)
        self.assertIn("Yokogawa CENTUM VP", data["tools"])
        self.assertIn("Fluke calibrators", data["tools"])
        self.assertIn("Instrument calibration", data["skills"])
        self.assertIn("COREN", data["certifications"])
        self.assertEqual(data["current_employer"], "Indorama Eleme Petrochemicals Ltd")

    def test_plc_company_suffix_is_not_a_skill(self):
        data = heuristic_extract("John Doe\njohn@example.com\nEXPERIENCE\nAccountant, Dangote Cement Plc 2019 - 2022\n")
        self.assertNotIn("PLC", data["tools"])
        self.assertNotIn("PLC programming", data["skills"])

    def test_empty_text(self):
        self.assertEqual(heuristic_extract("   "), {})


class FileExtractionTests(TestCase):
    def test_pdf_docx_and_txt(self):
        lines = SAMPLE.splitlines()
        for name, content in (("cv.pdf", simple_pdf(lines)), ("cv.docx", simple_docx(lines)), ("cv.txt", SAMPLE.encode())):
            with self.subTest(name=name):
                result = extract_text(content, name)
                self.assertIn("Chukwu", result.text.title())
                parsed = parse_cv(content, name)
                self.assertEqual(parsed["email"], "ifeoma.chukwu@example.com")
                self.assertEqual(parsed["method"], "heuristic")

    def test_scanned_pdf_without_ocr_or_ai_is_reported(self):
        blank = simple_pdf([""])
        parsed = parse_cv(blank, "scan.pdf")
        self.assertTrue(parsed["scanned"])
        self.assertTrue(any("scanned" in n.lower() for n in parsed["notes"]))

    def test_unsupported_and_corrupt_files_do_not_crash(self):
        self.assertTrue(extract_text(b"hello", "cv.exe").notes)
        self.assertTrue(extract_text(b"not a pdf", "cv.pdf").notes)


@override_settings(MEDIA_ROOT=MEDIA, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class IntakeTests(TestCase):
    def test_apply_parsed_never_overwrites_typed_values(self):
        candidate = Candidate(first_name="Typed", course="Typed Course", skills=["Welding"])
        apply_parsed(candidate, {"first_name": "Parsed", "last_name": "Name", "course": "Other", "skills": ["Welding", "HAZOP"],
                                 "method": "heuristic", "text": "cv"})
        self.assertEqual(candidate.first_name, "Typed")
        self.assertEqual(candidate.last_name, "Name")
        self.assertEqual(candidate.course, "Typed Course")
        self.assertEqual(candidate.skills, ["Welding", "HAZOP"])

    def test_duplicate_detection_by_email_and_phone(self):
        first = ingest_cv(SAMPLE.encode(), "ifeoma.txt", source=Candidate.Source.EMAIL)
        self.assertTrue(first.created)
        again = ingest_cv(SAMPLE.replace("ifeoma.chukwu@example.com", "other@example.com").encode(), "ifeoma2.txt",
                          source=Candidate.Source.HARD_COPY)
        self.assertFalse(again.created, "same phone number should match the existing candidate")
        self.assertEqual(Candidate.objects.count(), 1)
        self.assertEqual(first.candidate.documents.count(), 2)
        self.assertEqual(find_existing(phone="08035550101"), first.candidate)

    def test_name_falls_back_to_filename(self):
        result = ingest_cv(b"no details here", "Bola_Tinubu-CV.txt", source=Candidate.Source.EMAIL,
                           fallback_email="bola@example.com")
        self.assertEqual(result.candidate.first_name, "Bola")
        self.assertEqual(result.candidate.email, "bola@example.com")

    def test_bulk_intake_view(self):
        hr = User.objects.create_user("hr", password="x", role=User.Role.RECRUITER)
        self.client.force_login(hr)
        files = [SimpleUploadedFile("a.pdf", simple_pdf(SAMPLE.splitlines())),
                 SimpleUploadedFile("b.docx", simple_docx(cv_lines(dict(
                     first="Bayo", last="Ade", email="bayo@example.com", phone="0802 000 1111", summary="Engineer",
                     jobs=[], degree="HND", course="Mechanical Engineering", school="Rivers State Polytechnic", year=2012))))]
        response = self.client.post(reverse("candidates:intake"), {"files": files, "source": "hard_copy"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Candidate.objects.count(), 2)
        bayo = Candidate.objects.get(email="bayo@example.com")
        self.assertEqual(bayo.highest_qualification, "hnd")
        self.assertEqual(bayo.source, "hard_copy")

    def test_referral_by_employee(self):
        from core.models import Department
        from requisitions.models import Requisition

        dept = Department.objects.create(name="Instrumentation", code="INS")
        req = Requisition.objects.create(department=dept, title="Instrument Engineer", status="open",
                                         tools=["Yokogawa CENTUM VP"], required_skills=["Instrument calibration"])
        employee = User.objects.create_user("emp", password="x", role=User.Role.EMPLOYEE)
        self.client.force_login(employee)
        response = self.client.post(reverse("candidates:refer"), {
            "requisition": req.pk, "cv": SimpleUploadedFile("cv.txt", SAMPLE.encode()), "note": "Great engineer"})
        self.assertRedirects(response, reverse("core:dashboard"))
        candidate = Candidate.objects.get()
        self.assertEqual(candidate.referred_by, employee)
        application = candidate.applications.get()
        self.assertGreater(application.match_score, 80)
        # The referrer can open the profile of the person they referred but not the HR database.
        self.assertEqual(self.client.get(candidate.get_absolute_url()).status_code, 200)
        self.assertEqual(self.client.get(reverse("candidates:list")).status_code, 403)
