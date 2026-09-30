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
            "tools": "Honeywell Experion", "certifications": "", "preferred_skills": "", "justification": "Expansion",
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
        self.client.post(reverse("requisitions:advert", args=[req.pk]), {"generate": "1"})
        req.refresh_from_db()
        self.assertIn("Panel Operator", req.advert)
        self.client.post(reverse("requisitions:action", args=[req.pk, "publish"]), {"closing_date": "2099-01-01"})
        req.refresh_from_db()
        self.assertEqual(req.status, Requisition.Status.OPEN)
        self.assertEqual(self.client.get(reverse("careers:job", args=[req.reference])).status_code, 200)

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
