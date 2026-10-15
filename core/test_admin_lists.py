"""Admin list boxes: skills, tools and courses are typed one per line or with commas."""

from django.test import TestCase

from accounts.models import User
from core.admin_lists import ListTextField
from requisitions.models import JobRole, SkillTag


class ListBoxTests(TestCase):
    def test_parsing(self):
        f = ListTextField(required=False)
        self.assertEqual(f.clean("[]Communication"), ["Communication"])
        self.assertEqual(f.clean("[]Excel, Power BI"), ["Excel", "Power BI"])
        self.assertEqual(f.clean("Teamwork\nLeadership\n\nteamwork"), ["Teamwork", "Leadership"])
        self.assertEqual(f.clean('["MS Excel", "Excel"]'), ["MS Excel", "Excel"])
        self.assertEqual(f.clean(""), [])
        self.assertEqual(f.prepare_value(["Excel", "Power BI"]), "Excel\nPower BI")

    def test_add_job_role_in_admin(self):
        admin = User.objects.create_superuser("owner", "owner@iefcl.example", "x" * 12, role="hr_admin")
        self.client.force_login(admin)
        page = self.client.get("/admin/requisitions/jobrole/add/").content.decode()
        self.assertIn("One per line, or separated by commas.", page)
        response = self.client.post("/admin/requisitions/jobrole/add/", {
            "title": "Data Analyst", "job_family": "", "grade": "", "description": "",
            "default_min_experience": "4", "default_education": "bsc",
            "default_skills": "[]Communication", "default_tools": "[]Excel, Power BI",
            "default_certifications": "", "default_courses": "Statistics\nEconomics", "is_active": "on",
        })
        self.assertEqual(response.status_code, 302, response.content.decode()[:2000])
        role = JobRole.objects.get(title="Data Analyst")
        self.assertEqual(role.default_skills, ["Communication"])
        self.assertEqual(role.default_tools, ["Excel", "Power BI"])
        self.assertEqual(role.default_courses, ["Statistics", "Economics"])
        self.assertEqual(role.default_certifications, [])
        edit = self.client.get(f"/admin/requisitions/jobrole/{role.pk}/change/").content.decode()
        self.assertIn("Excel\nPower BI", edit)
        response = self.client.post("/admin/requisitions/skilltag/add/", {
            "name": "Microsoft Excel", "kind": "tool", "job_family": "", "aliases": "MS Excel, Excel"})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(SkillTag.objects.get(name="Microsoft Excel").aliases, ["MS Excel", "Excel"])


class PublishImportedRequisitionTests(TestCase):
    def test_imported_requisition_can_be_published(self):
        from core.models import Department
        from requisitions.models import Requisition
        dept = Department.objects.create(name="QA/QC", code="QAQC")
        req = Requisition.objects.create(department=dept, title="Lab DET", reference="Req_901", education_level="",
                                         location="Port Harcourt", status=Requisition.Status.APPROVED,
                                         business_unit="IPL", classification="Trainee")
        hr = User.objects.create_user("hr", "hr@iefcl.example", "x" * 12, role="hr_admin")
        self.client.force_login(hr)
        detail = self.client.get(req.get_absolute_url()).content.decode()
        self.assertIn("Publish vacancy", detail)
        response = self.client.post(f"/requisitions/{req.pk}/action/publish/", {"closing_date": "2099-12-31"})
        self.assertEqual(response.status_code, 302)
        req.refresh_from_db()
        self.assertEqual(req.status, Requisition.Status.OPEN)
        self.client.logout()
        for url in ("/careers/", "/careers/jobs/Req_901/", "/careers/jobs/Req_901/apply/"):
            page = self.client.get(url)
            self.assertEqual(page.status_code, 200, url)
        self.assertIn("Lab DET", self.client.get("/careers/").content.decode())
        self.assertNotIn("Minimum of <", self.client.get("/careers/jobs/Req_901/").content.decode())
        self.assertNotIn('<span class="tag">+</span>', self.client.get("/careers/").content.decode())
