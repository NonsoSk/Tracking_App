from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse

from accounts.models import User
from core.demo_files import simple_docx
from core.models import Department

from .jd_reader import read_jd, title_from
from .models import Requisition

ACCOUNTS_PAYABLE = """ACCOUNTS PAYABLE OFFICER
Department: Finance

Job Summary
Process supplier invoices and payments accurately and on time.

Key Responsibilities
• Three-way matching of purchase orders, goods received notes and invoices
• Vendor reconciliation and supplier statement reviews
• Prepare payment schedules and process payments
• Withholding tax and VAT deductions and remittances
• Month-end accruals

Requirements
• B.Sc/HND in Accounting, Finance or related field (minimum Second Class Lower / Upper Credit)
• 2-4 years' experience in accounts payable
• Proficiency in SAP and Microsoft Excel
• ICAN or ACCA
• NYSC discharge or exemption certificate
• Knowledge of IFRS is an added advantage
"""


class JobDescriptionReaderTests(TestCase):
    """A job description file fills in a requisition's requirements from what the document says."""

    def test_reads_the_requirements_from_a_word_file(self):
        result = read_jd(simple_docx(ACCOUNTS_PAYABLE.splitlines()), "Accounts Payable JD.docx")
        self.assertEqual(result["warning"], "")
        values = result["values"]
        self.assertEqual(values["title"], "Accounts Payable Officer")
        for skill in ("Accounts payable", "Three-way matching", "Vendor reconciliation", "Payment processing",
                      "Withholding tax", "VAT"):
            self.assertIn(skill, values["required_skills"])
        # The general term is dropped beside the specific one the JD names.
        self.assertNotIn("Reconciliations", values["required_skills"])
        # Written next to "an added advantage": nice to have, not required.
        self.assertEqual(values["preferred_skills"], ["Financial reporting (IFRS)"])
        self.assertEqual(sorted(values["certifications"]), ["ACCA", "ICAN"])
        self.assertIn("Microsoft Excel", values["tools"])
        self.assertEqual(sorted(values["courses"]), ["Accounting", "Finance"])
        # "B.Sc/HND": the lowest qualification accepted; "Second Class Lower / Upper Credit": the lowest class.
        self.assertEqual((values["education_level"], values["min_degree_class"]), ("hnd", "2_2"))
        self.assertEqual((values["min_experience_years"], values["max_experience_years"]), (2, 4))
        self.assertTrue(values["requires_nysc"])
        self.assertIn("ACCOUNTS PAYABLE OFFICER", values["job_description"])

    def test_nothing_is_invented(self):
        values = read_jd(b"Job title: Driver\nDrive the staff bus safely.", "jd.txt")["values"]
        self.assertEqual(values["title"], "Driver")
        for field in ("required_skills", "preferred_skills", "tools", "certifications", "courses"):
            self.assertEqual(values[field], [], field)
        self.assertEqual((values["education_level"], values["min_experience_years"], values["requires_nysc"]), ("", 0, False))

    def test_an_empty_file_gives_a_warning(self):
        result = read_jd(b"   ", "blank.txt")
        self.assertTrue(result["warning"])
        self.assertEqual(result["values"], {})

    def test_title_from_the_heading_or_the_file_name(self):
        self.assertEqual(title_from("", "HR officer.docx"), "HR Officer")
        self.assertEqual(title_from("", "accounts_officer_JD.pdf"), "Accounts Officer")
        self.assertEqual(title_from("", "Marketing-Officer (final).docx"), "Marketing Officer")
        self.assertEqual(title_from("IEFCL\nHR OFFICER\nSummary", "hr officer.docx"), "HR Officer")
        self.assertEqual(title_from("Position: head of HSE", "x.docx"), "Head of HSE")
        self.assertEqual(title_from("", "JD (2).docx"), "")
        self.assertEqual(title_from("", "Marketing Officer Job Post.docx"), "Marketing Officer")


class ReadIntoRequisitionTests(TestCase):
    def setUp(self):
        self.finance = Department.objects.create(name="Finance", code="FIN")
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        self.client.force_login(self.hr)

    def upload(self, name="Accounts Payable JD.docx", text=ACCOUNTS_PAYABLE):
        return SimpleUploadedFile(name, simple_docx(text.splitlines()))

    def test_new_requisition_is_filled_in_but_not_saved(self):
        response = self.client.post(reverse("requisitions:create"), {"jd_file": self.upload(), "read_jd": "1"})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Requisition.objects.exists())
        form = response.context["form"]
        self.assertEqual(form.initial["title"], "Accounts Payable Officer")
        self.assertIn("Three-way matching", form.initial["required_skills"])
        self.assertTrue(response.context["jd_read"])
        self.assertContains(response, "Read Accounts Payable JD.docx")
        self.assertContains(response, "Three-way matching")

    def test_reading_without_a_file_says_so(self):
        response = self.client.post(reverse("requisitions:create"), {"read_jd": "1"})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Choose the job description file first.")
        self.assertFalse(response.context["jd_read"])

    def test_editing_keeps_the_title_and_the_written_job_description(self):
        req = Requisition.objects.create(department=self.finance, title="AP Officer", raised_by=self.hr,
                                         job_description="Our own words")
        response = self.client.post(reverse("requisitions:edit", args=[req.pk]), {"jd_file": self.upload(), "read_jd": "1"})
        self.assertEqual(response.status_code, 200)
        form = response.context["form"]
        self.assertEqual(form["title"].value(), "AP Officer")
        self.assertEqual(form["job_description"].value(), "Our own words")
        self.assertIn("Vendor reconciliation", form.initial["required_skills"])
        req.refresh_from_db()
        self.assertEqual(req.required_skills, [])  # nothing saved until HR saves the form
