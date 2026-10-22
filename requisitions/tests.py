import io

from django.test import TestCase, override_settings
from django.urls import reverse

from accounts.models import User
from core.models import Department, Employee, Notification
from pipeline.models import Application

from .knowledge_base import match_families
from .models import Requisition
from .suggestions import suggest_requirements


class KnowledgeBaseTests(TestCase):
    def test_role_titles_map_to_job_families(self):
        self.assertEqual(match_families("Rotating Equipment Engineer")[0], "mechanical_maintenance")
        self.assertIn("hse", match_families("HSE Officer"))
        self.assertIn("instrumentation_control", match_families("Instrument Technician"))

    def test_suggestions_without_ai(self):
        data = suggest_requirements("Process Engineer", "Production")
        self.assertIn("Aspen HYSYS", data["tools"])
        self.assertIn("HAZOP", data["skills"])
        self.assertEqual(data["source"], "knowledge base")


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class RequisitionFlowTests(TestCase):
    def setUp(self):
        self.prod = Department.objects.create(name="Production", code="PROD")
        self.ict = Department.objects.create(name="IT", code="ICT")
        self.hod = User.objects.create_user("hod", password="x", role=User.Role.HOD, department=self.prod)
        self.prod.hod = self.hod
        self.prod.save()
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        self.other_hod = User.objects.create_user("ict", password="x", role=User.Role.HOD, department=self.ict)

    def form_data(self, **extra):
        data = {
            "department": self.prod.pk, "title": "Panel Operator", "positions": 2, "employment_type": "experienced",
            "location": "Eleme", "reason": "new", "min_experience_years": 2, "education_level": "hnd",
            "courses": "Chemical Engineering\nIndustrial Chemistry", "required_skills": "Plant start-up and shutdown, DCS",
            "tools": "Honeywell Experion", "certifications": "", "preferred_skills": "Ammonia synthesis loop",
            "other_requirements": "Willingness to work shifts", "justification": "Expansion of the urea plant",
            "job_description": "Run the DCS console during shifts\nCoordinate start-ups and shutdowns",
        }
        data.update(extra)
        return data

    def test_department_raises_hr_approves_and_publishes(self):
        self.client.force_login(self.hod)
        response = self.client.post(reverse("requisitions:create"), self.form_data(submit="1"))
        req = Requisition.objects.get()
        self.assertRedirects(response, req.get_absolute_url())
        self.assertEqual(req.status, Requisition.Status.SUBMITTED)
        self.assertEqual(req.courses, ["Chemical Engineering", "Industrial Chemistry"])
        self.assertEqual(req.required_skills, ["Plant start-up and shutdown", "DCS"])
        self.assertTrue(Notification.objects.filter(recipient=self.hr, title__icontains="New requisition").exists())

        self.client.force_login(self.hr)
        self.client.post(reverse("requisitions:action", args=[req.pk, "approve"]), {"hr_owner": self.hr.pk})
        req.refresh_from_db()
        self.assertEqual((req.status, req.hr_owner), (Requisition.Status.APPROVED, self.hr))
        self.assertTrue(Notification.objects.filter(recipient=self.hod, title__icontains="approved").exists())
        self.client.get(reverse("requisitions:advert", args=[req.pk]))
        req.refresh_from_db()
        self.assertIn("Job title: Panel Operator", req.advert)
        self.assertIn("• Run the DCS console during shifts", req.advert)
        self.client.post(reverse("requisitions:advert", args=[req.pk]),
                         {"advert": req.advert, "closing_date": "2099-01-01", "publish": "1"})
        req.refresh_from_db()
        self.assertEqual(req.status, Requisition.Status.OPEN)
        self.assertEqual(self.client.get(reverse("careers:job", args=[req.reference])).status_code, 200)

    def test_context_fields_are_required_to_submit_but_not_for_a_draft(self):
        self.client.force_login(self.hod)
        empty = {f: "" for f in ("required_skills", "preferred_skills", "tools", "other_requirements",
                                 "justification", "job_description")}
        response = self.client.post(reverse("requisitions:create"), self.form_data(submit="1", **empty))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.context["form"].errors), set(empty))
        self.assertFalse(Requisition.objects.exists())

        self.client.post(reverse("requisitions:create"), self.form_data(save="1", **empty))
        draft = Requisition.objects.get()
        self.assertEqual(draft.status, Requisition.Status.DRAFT)
        # Submitting the incomplete draft from its page sends the department back to the form.
        response = self.client.post(reverse("requisitions:action", args=[draft.pk, "submit"]))
        self.assertRedirects(response, reverse("requisitions:edit", args=[draft.pk]))
        draft.refresh_from_db()
        self.assertEqual(draft.status, Requisition.Status.DRAFT)

        response = self.client.post(reverse("requisitions:edit", args=[draft.pk]), self.form_data(submit="1"))
        draft.refresh_from_db()
        self.assertEqual(draft.status, Requisition.Status.SUBMITTED)
        self.assertEqual(draft.preferred_skills, ["Ammonia synthesis loop"])

    def test_form_marks_the_context_fields_required(self):
        self.client.force_login(self.hod)
        form = self.client.get(reverse("requisitions:create")).context["form"]
        for name in ("required_skills", "preferred_skills", "tools", "other_requirements", "justification",
                     "job_description"):
            self.assertTrue(form.fields[name].required, name)
        self.assertFalse(form.fields["certifications"].required)

    def test_replacement_is_prefilled_from_retirement(self):
        employee = Employee.objects.create(staff_id="S1", first_name="Old", last_name="Timer", department=self.prod,
                                           job_title="Panel Operator", grade="S3")
        self.client.force_login(self.hod)
        response = self.client.get(reverse("requisitions:create") + f"?replace={employee.pk}")
        form = response.context["form"]
        self.assertEqual(form.initial["replacing_employee"], employee.pk)
        self.assertEqual(form.initial["reason"], "retirement")
        self.assertEqual(form.initial["title"], "Panel Operator")

    def test_replacement_requires_employee(self):
        self.client.force_login(self.hod)
        response = self.client.post(reverse("requisitions:create"), self.form_data(reason="resignation"))
        self.assertEqual(response.status_code, 200)
        self.assertIn("replacing_employee", response.context["form"].errors)

    def test_department_limited_to_own_department(self):
        self.client.force_login(self.other_hod)
        response = self.client.post(reverse("requisitions:create"), self.form_data())
        self.assertEqual(response.status_code, 200)
        self.assertIn("department", response.context["form"].errors)

    def test_return_for_changes(self):
        req = Requisition.objects.create(department=self.prod, title="X", status="submitted", raised_by=self.hod)
        self.client.force_login(self.hr)
        self.client.post(reverse("requisitions:action", args=[req.pk, "return"]), {"reason": "Add tools"})
        req.refresh_from_db()
        self.assertEqual(req.status, Requisition.Status.RETURNED)
        self.assertEqual(req.notes.count(), 1)

    def test_suggest_and_terms_api(self):
        self.client.force_login(self.hod)
        data = self.client.get(reverse("requisitions:api_suggest"), {"title": "Electrical Engineer", "department": self.prod.pk}).json()
        self.assertTrue(data["skills"])
        terms = self.client.get(reverse("requisitions:api_terms"), {"kind": "tool", "q": "hys"}).json()["results"]
        self.assertIn("Aspen HYSYS", terms)

    def test_messages_notify_other_side(self):
        req = Requisition.objects.create(department=self.prod, title="X", status="open", raised_by=self.hod, hr_owner=self.hr)
        self.client.force_login(self.hod)
        self.client.post(reverse("requisitions:note", args=[req.pk]), {"message": "Any update?"})
        self.assertTrue(Notification.objects.filter(recipient=self.hr, message__icontains="Any update").exists())

    def test_export_excel(self):
        from candidates.models import Candidate
        from openpyxl import load_workbook
        from pipeline.services import create_application

        req = Requisition.objects.create(department=self.prod, title="X", status="open", required_skills=["DCS"])
        create_application(Candidate.objects.create(first_name="A", last_name="B", skills=["DCS"]), req)
        self.client.force_login(self.hr)
        response = self.client.get(reverse("requisitions:export", args=[req.pk]))
        workbook = load_workbook(io.BytesIO(response.content))
        rows = list(workbook.active.values)
        self.assertEqual(rows[0][2], "Name")
        self.assertEqual(rows[1][2], "A B")

    def test_auto_shortlist(self):
        from candidates.models import Candidate
        from pipeline.services import create_application

        req = Requisition.objects.create(department=self.prod, title="X", status="open", required_skills=["DCS"],
                                         education_level="")
        strong, _ = create_application(Candidate.objects.create(first_name="S", skills=["DCS"]), req)
        weak, _ = create_application(Candidate.objects.create(first_name="W", skills=["Cooking"]), req)
        self.client.force_login(self.hr)
        self.client.post(reverse("requisitions:auto_shortlist", args=[req.pk]), {"threshold": "70"})
        strong.refresh_from_db()
        weak.refresh_from_db()
        self.assertEqual((strong.stage, weak.stage), ("shortlisted", "applied"))


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class JobDescriptionTests(TestCase):
    def setUp(self):
        self.prod = Department.objects.create(name="Production", code="PROD")
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        self.req = Requisition.objects.create(
            department=self.prod, title="Process Engineer", positions=2, status=Requisition.Status.APPROVED,
            education_level="bsc", courses=["Chemical Engineering", "Petroleum Engineering"], min_experience_years=3,
            required_skills=["HAZOP", "Process simulation"], preferred_skills=["Catalyst management"],
            tools=["Aspen HYSYS"], certifications=["COREN"], other_requirements="Willingness to work shifts",
            justification="Replacement for Joseph Ekanem, retiring in December.",
            job_description="Monitor ammonia plant performance\nLead HAZOP and MOC reviews",
        )
        self.client.force_login(self.hr)

    def test_opening_the_page_drafts_a_standard_job_description(self):
        response = self.client.get(reverse("requisitions:advert", args=[self.req.pk]))
        self.assertTrue(response.context["drafted"])
        self.req.refresh_from_db()
        text = self.req.advert
        for heading in ("Job title: Process Engineer", "Job summary", "Key responsibilities",
                        "• Monitor ammonia plant performance", "Qualifications and experience",
                        "• Minimum of Bachelor's (BSc / BEng / BA / LLB) in Chemical Engineering or Petroleum Engineering",
                        "• At least 3 years", "Required skills\n• HAZOP", "Tools, software and equipment\n• Aspen HYSYS",
                        "Certifications and licences\n• COREN", "Desirable\n• Catalyst management",
                        "Other requirements\n• Willingness to work shifts", "How to apply"):
            self.assertIn(heading, text)
        # The internal reason for the hire never reaches the careers page.
        self.assertNotIn("Ekanem", text)
        self.assertContains(response, "<h3>Key responsibilities</h3>", html=False)
        # A second visit keeps what is there.
        self.req.advert = "Edited by HR"
        self.req.save()
        response = self.client.get(reverse("requisitions:advert", args=[self.req.pk]))
        self.assertFalse(response.context["drafted"])
        self.req.refresh_from_db()
        self.assertEqual(self.req.advert, "Edited by HR")

    def test_edit_then_publish(self):
        self.client.get(reverse("requisitions:advert", args=[self.req.pk]))
        response = self.client.post(reverse("requisitions:advert", args=[self.req.pk]), {
            "advert": "Job summary\nRun the plant.\n\nKey responsibilities\n• Lead HAZOP reviews",
            "closing_date": "2099-01-31", "publish": "1"})
        self.assertRedirects(response, self.req.get_absolute_url())
        self.req.refresh_from_db()
        self.assertEqual(self.req.status, Requisition.Status.OPEN)
        self.assertEqual(str(self.req.closing_date), "2099-01-31")
        page = self.client.get(reverse("careers:job", args=[self.req.reference]))
        self.assertContains(page, "<h3>Key responsibilities</h3><ul><li>Lead HAZOP reviews</li></ul>", html=False)

    def test_cannot_publish_an_empty_job_description(self):
        response = self.client.post(reverse("requisitions:advert", args=[self.req.pk]), {"advert": " ", "publish": "1"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("advert", response.context["form"].errors)
        self.req.refresh_from_db()
        self.assertEqual(self.req.status, Requisition.Status.APPROVED)

    def test_save_without_publishing(self):
        self.client.post(reverse("requisitions:advert", args=[self.req.pk]), {"advert": "Draft text", "save": "1"})
        self.req.refresh_from_db()
        self.assertEqual((self.req.advert, self.req.status), ("Draft text", Requisition.Status.APPROVED))

    @override_settings(ANTHROPIC_API_KEY="test-key", AI_ENABLED=True)
    def test_ai_draft_gets_the_whole_requisition_and_is_cleaned(self):
        from unittest import mock

        reply = "**Job title:** Process Engineer\n\n## Job summary\nKeep the plant running.\n\n- Lead HAZOP reviews"
        with mock.patch("core.ai.text_request", return_value=reply) as call:
            self.client.post(reverse("requisitions:advert", args=[self.req.pk]), {"generate": "1"})
        prompt = call.call_args.kwargs["prompt"]
        for fact in ("Required skills: HAZOP; Process simulation", "Nice-to-have skills: Catalyst management",
                     "Tools / software / equipment: Aspen HYSYS", "Other requirements: Willingness to work shifts",
                     "Duties as described by the department:\nMonitor ammonia plant performance",
                     "Internal context (do not quote): Replacement for Joseph Ekanem"):
            self.assertIn(fact, prompt)
        self.assertIn("never name any employee", call.call_args.kwargs["system"])
        self.req.refresh_from_db()
        self.assertEqual(self.req.advert, "Job title: Process Engineer\n\nJob summary\nKeep the plant running.\n\n• Lead HAZOP reviews")


class JobTextFilterTests(TestCase):
    def test_headings_bullets_facts_and_escaping(self):
        from core.templatetags.ds import job_text

        html = job_text("Job title: Engineer <b>\nDepartment: Production\n\nJob summary\nWe make urea.\n"
                        "Second line.\n\nKey responsibilities\n• Run <script>\n- Report\n\nThanks for applying.")
        self.assertEqual(html, (
            '<p class="jd-fact"><b>Job title:</b> Engineer &lt;b&gt;</p><p class="jd-fact"><b>Department:</b> Production</p>'
            "<h3>Job summary</h3><p>We make urea.<br>Second line.</p>"
            "<h3>Key responsibilities</h3><ul><li>Run &lt;script&gt;</li><li>Report</li></ul>"
            "<p>Thanks for applying.</p>"))
        self.assertEqual(job_text(""), "")
