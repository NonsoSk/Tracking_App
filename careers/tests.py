import shutil
import tempfile
from decimal import Decimal

from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from accounts.models import User
from candidates.models import Candidate
from core.demo_files import simple_pdf
from core.models import Department
from pipeline import services
from pipeline.models import Application, Offer
from requisitions.models import Requisition

MEDIA = tempfile.mkdtemp(prefix="test-media-")

CV = """Grace Effiong
grace.effiong@example.com | 0809 111 2222 | Uyo
PROFESSIONAL EXPERIENCE
HSE Officer, Mobil Producing Nigeria  2018 - Present
- Risk assessment, incident investigation, permit to work administration
EDUCATION
B.Sc. Environmental Science, University of Uyo, 2016
CERTIFICATIONS
NEBOSH IGC
"""


def tearDownModule():
    shutil.rmtree(MEDIA, ignore_errors=True)


@override_settings(MEDIA_ROOT=MEDIA, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class CareersTests(TestCase):
    def setUp(self):
        self.dept = Department.objects.create(name="HSE", code="HSE")
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.RECRUITER, email="hr@example.com")
        self.req = Requisition.objects.create(
            department=self.dept, title="HSE Officer", status="open", min_experience_years=3, education_level="bsc",
            courses=["Environmental Science"], required_skills=["Risk assessment", "Incident investigation"],
            certifications=["NEBOSH IGC"],
        )

    def apply(self, **overrides):
        data = {
            "cv": SimpleUploadedFile("grace.pdf", simple_pdf(CV.splitlines()), content_type="application/pdf"),
            "first_name": "Grace", "last_name": "Effiong", "email": "grace.effiong@example.com", "phone": "08091112222",
            "highest_qualification": "bsc", "course": "Environmental Science", "years_experience": "0",
            "skills": "", "tools": "", "certifications": "", "consent": "on",
        }
        data.update(overrides)
        return self.client.post(reverse("careers:apply", args=[self.req.reference]), data)

    def test_job_list_shows_only_open_jobs(self):
        Requisition.objects.create(department=self.dept, title="Secret draft", status="draft")
        response = self.client.get(reverse("careers:jobs"))
        self.assertContains(response, "HSE Officer")
        self.assertNotContains(response, "Secret draft")

    def test_apply_creates_scored_application_and_cv_fills_gaps(self):
        response = self.apply()
        app = Application.objects.get()
        self.assertRedirects(response, reverse("careers:hub", args=[app.token]))
        candidate = app.candidate
        self.assertTrue(candidate.consent_given)
        self.assertIn("NEBOSH IGC", candidate.certifications)
        self.assertIn("Risk assessment", candidate.skills)
        self.assertGreater(candidate.years_experience, 5, "experience read from the CV when the form said 0")
        self.assertEqual(app.match_grade, "A")
        self.assertEqual(candidate.documents.count(), 1)
        self.assertTrue(any("Application received" in m.subject for m in mail.outbox))

    def test_duplicate_application_redirects_to_hub(self):
        self.apply()
        response = self.apply()
        self.assertEqual(Application.objects.count(), 1)
        self.assertRedirects(response, reverse("careers:hub", args=[Application.objects.get().token]))

    def test_honeypot_and_missing_consent_rejected(self):
        self.assertEqual(self.apply(website="spam").status_code, 200)
        self.assertEqual(self.apply(consent="").status_code, 200)
        self.assertFalse(Application.objects.exists())

    def test_closed_vacancy_cannot_be_applied_for(self):
        self.req.closing_date = timezone.localdate() - timezone.timedelta(days=1)
        self.req.save()
        response = self.apply()
        self.assertRedirects(response, reverse("careers:jobs"))
        self.assertFalse(Candidate.objects.exists())

    def test_cv_preview_endpoint(self):
        response = self.client.post(reverse("careers:parse_cv"), {"cv": SimpleUploadedFile("cv.txt", CV.encode())})
        data = response.json()
        self.assertEqual(data["fields"]["email"], "grace.effiong@example.com")
        self.assertIn("first_name", data["filled"])
        self.assertEqual(self.client.post(reverse("careers:parse_cv"), {"cv": SimpleUploadedFile("x.exe", b"1")}).status_code, 400)

    def test_status_lookup(self):
        self.apply()
        app = Application.objects.get()
        response = self.client.post(reverse("careers:status"), {"reference": app.reference.lower(), "email": "GRACE.effiong@example.com"})
        self.assertRedirects(response, reverse("careers:hub", args=[app.token]))
        response = self.client.post(reverse("careers:status"), {"reference": app.reference, "email": "wrong@example.com"})
        self.assertEqual(response.status_code, 200)

    def test_hub_interview_documents_and_offer(self):
        self.apply()
        app = Application.objects.get()
        services.shortlist(app, actor=self.hr)
        interview = services.schedule_interview(app, round="technical", scheduled_at=timezone.now() + timezone.timedelta(days=2),
                                                panel=[self.hr], actor=self.hr)
        hub = reverse("careers:hub", args=[app.token])
        self.assertContains(self.client.get(hub), "Phase 1")
        self.client.post(reverse("careers:hub_interview", args=[app.token, interview.pk]), {"response": "confirmed"})
        interview.refresh_from_db()
        self.assertEqual(interview.candidate_response, "confirmed")

        services.move_to_stage(app, "decision", actor=self.hr)
        services.record_decision(app, "select", actor=self.hr)
        self.assertContains(self.client.get(hub), "Documents we need")
        self.client.post(reverse("careers:hub_document", args=[app.token]),
                         {"doc_type": "degree", "file": SimpleUploadedFile("degree.pdf", simple_pdf(["Degree"]))})
        self.assertTrue(app.candidate.documents.filter(doc_type="degree").exists())

        services.move_to_stage(app, "offer", actor=self.hr)
        offer = services.create_offer(app, job_title="HSE Officer", annual_salary=Decimal("9000000"), actor=self.hr)
        services.send_offer(offer, actor=self.hr)
        self.assertContains(self.client.get(hub), "₦9,000,000")
        self.client.post(reverse("careers:hub_offer", args=[app.token, offer.pk]), {"response": "accept"})
        offer.refresh_from_db()
        app.refresh_from_db()
        self.assertEqual(offer.status, Offer.Status.ACCEPTED)
        self.assertEqual(app.stage, "medical")

    def test_unknown_token_404(self):
        self.assertEqual(self.client.get("/careers/my/00000000-0000-0000-0000-000000000000/").status_code, 404)
