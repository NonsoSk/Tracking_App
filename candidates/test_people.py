"""Applicants, current staff and former staff in one list. All names here are made up."""

from datetime import date, datetime

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from accounts.models import User
from core.models import Department, Employee
from pipeline.models import Application, Onboarding
from pipeline.services import complete_onboarding
from requisitions.models import Requisition

from .models import Candidate, CandidateDocument
from .people import STAFF_LIST, link_staff, same_name


class SameNameTests(TestCase):
    def test_order_and_a_missing_middle_name(self):
        self.assertTrue(same_name("Ada Testperson", "TESTPERSON Ada"))
        self.assertTrue(same_name("Emeka Johnson Obi", "Obi Emeka"))
        self.assertFalse(same_name("Chidi Okafor", "Chidi Eze"))
        self.assertFalse(same_name("Emeka Johnson Obi", "Emeka Obi Daniel"))  # neither is part of the other


class StaffMixin:
    def setUp(self):
        self.dept = Department.objects.create(name="Production", code="PROD")
        self.req = Requisition.objects.create(department=self.dept, title="Panel Operator",
                                              status=Requisition.Status.OPEN)
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)

    def staff(self, staff_id, first, last, **extra):
        return Employee.objects.create(staff_id=staff_id, first_name=first, last_name=last, department=self.dept,
                                       **extra)

    def hire(self, candidate, day):
        return Application.objects.create(candidate=candidate, requisition=self.req, status="hired",
                                          hired_at=timezone.make_aware(datetime(day.year, day.month, day.day, 9)))


class LinkStaffTests(StaffMixin, TestCase):
    def test_joins_only_when_it_is_clearly_the_same_person(self):
        ada = Candidate.objects.create(first_name="Testperson", last_name="Ada", date_of_birth=date(1990, 1, 1))
        bayo = Candidate.objects.create(first_name="Bayo", last_name="Sample")
        self.hire(bayo, date(2024, 3, 1))
        efe = Candidate.objects.create(first_name="Efe", last_name="Ojo", email="efe.ojo@example.com")
        chidi_applicant = Candidate.objects.create(first_name="Chidi", last_name="Eze", date_of_birth=date(1992, 2, 2))
        twin_a = Candidate.objects.create(first_name="Ngozi", last_name="Twin", date_of_birth=date(1995, 5, 5))
        twin_b = Candidate.objects.create(first_name="Ngozi", last_name="Twin", date_of_birth=date(1995, 5, 5))

        s_ada = self.staff("IE001", "Ada", "Testperson", date_of_birth=date(1990, 1, 1))
        s_bayo = self.staff("IE002", "Bayo", "Sample", date_of_employment=date(2024, 3, 1))
        s_efe = self.staff("IE003", "Efe", "Ojo", email="EFE.OJO@example.com")
        s_chidi = self.staff("IE004", "Chidi", "Okafor", date_of_birth=date(1992, 2, 2))  # same birthday, other name
        s_ngozi = self.staff("IE005", "Ngozi", "Twin", date_of_birth=date(1995, 5, 5))  # two profiles fit

        stats = link_staff()
        self.assertEqual(stats["staff joined to their profile"], 3)
        self.assertEqual(stats["staff given a profile of their own"], 2)
        for employee in (s_ada, s_bayo, s_efe, s_chidi, s_ngozi):
            employee.refresh_from_db()
        self.assertEqual((s_ada.candidate, s_ada.link_note), (ada, "Same name and date of birth"))
        self.assertEqual(s_bayo.candidate, bayo)
        self.assertEqual(s_efe.candidate, efe)
        self.assertNotEqual(s_chidi.candidate, chidi_applicant)
        self.assertEqual((s_chidi.candidate.source_detail, s_chidi.candidate.full_name), (STAFF_LIST, "Chidi Okafor"))
        self.assertNotIn(s_ngozi.candidate, (twin_a, twin_b))
        self.assertIn("more than one", s_ngozi.link_note.lower())

        # Running again (every import does) changes nothing.
        before = Candidate.objects.count()
        self.assertEqual(sum(link_staff().values()), 0)
        self.assertEqual(Candidate.objects.count(), before)

    def test_an_import_of_the_staff_list_joins_staff(self):
        import os
        import shutil
        import tempfile

        from core.test_workbook_import import STAFF_HEADERS, staff_rows, write
        from core.workbook_import import WorkbookImporter

        trainee = Candidate.objects.create(first_name="Young", last_name="Trainee", date_of_birth=date(2004, 11, 25))
        folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, folder, ignore_errors=True)
        path = os.path.join(folder, "staff.xlsx")
        write(path, [("Retirement Forecast", STAFF_HEADERS, staff_rows())])
        result = WorkbookImporter([path], replace=False, report_dir=None, log=lambda m: None,
                                  require_all=False).run()
        self.assertEqual(result.counts["staff joined to their profile"], 1)
        self.assertEqual(Employee.objects.get(staff_id="FDT9002").candidate, trainee)
        self.assertEqual(Employee.objects.get(staff_id="SR9001").candidate.source_detail, STAFF_LIST)


class PeopleListTests(StaffMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.ada = Candidate.objects.create(first_name="Ada", last_name="Staff")
        self.staff("IE001", "Ada", "Staff", candidate=self.ada)
        self.bayo = Candidate.objects.create(first_name="Bayo", last_name="Retired")
        self.staff("IE002", "Bayo", "Retired", candidate=self.bayo, status=Employee.Status.RETIRED,
                   exit_date=date(2024, 6, 30))
        self.chidi = Candidate.objects.create(first_name="Chidi", last_name="Applicant", state_of_origin="Rivers")
        self.dayo = Candidate.objects.create(first_name="Dayo", last_name="Hired")
        self.hire(self.dayo, date(2025, 1, 6))  # hired through recruitment, no staff record joined yet
        self.client.force_login(self.hr)

    def names(self, query=""):
        return {c.first_name for c in self.client.get(reverse("candidates:list") + query).context["candidates"]}

    def test_tabs_count_and_list_staff_former_staff_and_applicants(self):
        page = self.client.get(reverse("candidates:list"))
        counts = {w["value"]: w["n"] for w in page.context["whos"]}
        self.assertEqual(counts, {"": 4, "applicants": 1, "staff": 2, "former": 1})
        self.assertContains(page, "Retired 2024")
        self.assertContains(page, ">Staff</span>")
        self.assertEqual(self.names("?who=staff"), {"Ada", "Dayo"})
        self.assertEqual(self.names("?who=former"), {"Bayo"})
        self.assertEqual(self.names("?who=applicants"), {"Chidi"})
        # The tabs follow the other filters, and the group cards follow the tab.
        searched = self.client.get(reverse("candidates:list") + "?region=niger_delta")
        self.assertEqual({w["value"]: w["n"] for w in searched.context["whos"]}["applicants"], 1)
        self.assertEqual({w["value"]: w["n"] for w in searched.context["whos"]}["staff"], 0)
        staff_tab = self.client.get(reverse("candidates:list") + "?who=staff")
        self.assertEqual({g["value"]: g["n"] for g in staff_tab.context["groups"]}["niger_delta"], 0)
        self.assertContains(staff_tab, 'name="who" value="staff"')

    def test_a_staff_members_page_shows_the_staff_record_and_resume(self):
        CandidateDocument.objects.create(candidate=self.ada, doc_type=CandidateDocument.DocType.CV,
                                         file="candidates/ada.pdf", original_name="ada.pdf")
        page = self.client.get(reverse("candidates:detail", args=[self.ada.pk]))
        self.assertContains(page, "Staff record")
        self.assertContains(page, "IE001")
        self.assertContains(page, "candidates/documents/")  # the resume viewer
        self.assertNotContains(page, "On the staff list?")
        applicant = self.client.get(reverse("candidates:detail", args=[self.chidi.pk]))
        self.assertContains(applicant, "On the staff list?")


class JoinAndUnlinkTests(StaffMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.applicant = Candidate.objects.create(first_name="Ada", last_name="Testperson", email="ada@example.com",
                                                  resume_url="https://example.com/ada.pdf")
        self.employee = self.staff("IE001", "Ada", "Testperson", date_of_birth=date(1990, 1, 1))
        link_staff()  # no date of birth on the application, so the staff list gets a profile of its own
        self.employee.refresh_from_db()
        self.placeholder = self.employee.candidate
        self.client.force_login(self.hr)

    def test_staff_only_profile_suggests_the_application_and_joins_it(self):
        self.assertEqual(self.placeholder.source_detail, STAFF_LIST)
        page = self.client.get(reverse("candidates:detail", args=[self.placeholder.pk]))
        self.assertEqual(list(page.context["maybe_same"]), [self.applicant])
        self.assertContains(page, "Same person: join")

        response = self.client.post(reverse("candidates:link_staff", args=[self.applicant.pk]), {"staff_id": "ie001"})
        self.assertRedirects(response, self.applicant.get_absolute_url() + "#profile", fetch_redirect_response=False)
        self.employee.refresh_from_db()
        self.assertEqual((self.employee.candidate, self.employee.link_fixed), (self.applicant, True))
        self.assertFalse(Candidate.objects.filter(pk=self.placeholder.pk).exists())

        # Unlinking gives the staff record a profile of its own again; imports leave it there.
        self.client.post(reverse("candidates:unlink_staff", args=[self.applicant.pk]))
        self.employee.refresh_from_db()
        self.assertNotEqual(self.employee.candidate, self.applicant)
        self.assertEqual(self.employee.candidate.source_detail, STAFF_LIST)
        link_staff()
        self.employee.refresh_from_db()
        self.assertNotEqual(self.employee.candidate, self.applicant)

    def test_joining_refuses_what_would_lose_or_mix_up_records(self):
        url = reverse("candidates:link_staff", args=[self.applicant.pk])
        self.client.post(url, {"staff_id": "NOPE"})
        self.assertEqual(self.employee.__class__.objects.get(pk=self.employee.pk).candidate, self.placeholder)

        # The staff number is on a profile that holds an application: never removed.
        self.hire(self.placeholder, date(2024, 1, 1))
        self.client.post(url, {"staff_id": "IE001"})
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.candidate, self.placeholder)

        # A profile already joined to another staff number.
        other = self.staff("IE002", "Bola", "Other", candidate=self.applicant)
        self.client.post(reverse("candidates:link_staff", args=[self.applicant.pk]), {"staff_id": "IE001"})
        other.refresh_from_db()
        self.assertEqual(other.candidate, self.applicant)

    def test_only_hr_can_join(self):
        hod = User.objects.create_user("hod", password="x", role=User.Role.HOD, department=self.dept)
        self.client.force_login(hod)
        response = self.client.post(reverse("candidates:link_staff", args=[self.applicant.pk]), {"staff_id": "IE001"})
        self.assertEqual(response.status_code, 403)


class OnboardingTests(StaffMixin, TestCase):
    def test_onboarding_joins_the_new_staff_record_and_a_rehire_moves_it(self):
        person = Candidate.objects.create(first_name="Efe", last_name="Ojo", date_of_birth=date(1990, 1, 1))
        old = self.staff("IE100", "Efe", "Ojo", candidate=person, status=Employee.Status.RESIGNED)
        # The staff list was loaded before onboarding finished, so the new number already has a staff-list profile.
        placeholder = Candidate.objects.create(first_name="Efe", last_name="Ojo", source="internal",
                                               source_detail=STAFF_LIST)
        self.staff("IE200", "Efe", "Ojo", candidate=placeholder)
        app = Application.objects.create(candidate=person, requisition=self.req)
        onboarding = Onboarding.objects.create(application=app, staff_id="IE200", start_date=date(2026, 1, 5))
        complete_onboarding(onboarding)
        new = Employee.objects.get(staff_id="IE200")
        old.refresh_from_db()
        self.assertEqual((new.candidate, new.link_fixed), (person, True))
        self.assertIsNone(old.candidate)
        self.assertIn("IE200", old.link_note)
        self.assertFalse(Candidate.objects.filter(pk=placeholder.pk).exists())
