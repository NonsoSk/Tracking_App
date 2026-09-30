import json
import shutil
import tempfile
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from accounts.models import User
from candidates.models import Candidate, CandidateDocument
from core.models import Department, Employee
from requisitions.models import Requisition

from . import services
from .ics import interview_ics
from .matching import compute_match, education_score, experience_score
from .models import Application, EvaluationCriterion, Interview, Offer, Stage, rating_for

MEDIA = tempfile.mkdtemp(prefix="test-media-")


def tearDownModule():
    shutil.rmtree(MEDIA, ignore_errors=True)


class RatingTests(TestCase):
    def test_legend_bands_from_the_paper_form(self):
        cases = [(0, "P"), (3, "P"), (4.5, "S"), (5, "S"), (7, "G"), (9, "VG"), (9.5, "E"), (10, "E")]
        for marks, code in cases:
            with self.subTest(marks=marks):
                self.assertEqual(rating_for(Decimal(marks), 10)["code"], code)
        self.assertEqual(rating_for(91, 100)["code"], "E")
        self.assertEqual(rating_for(71, 100)["code"], "VG")
        self.assertEqual(rating_for(30, 100)["code"], "P")

    def test_seeded_criteria_match_form(self):
        names = list(EvaluationCriterion.objects.values_list("name", "max_marks"))
        self.assertEqual(len(names), 9)
        self.assertEqual(sum(m for _, m in names), 100)
        self.assertEqual(names[0], ("Job Knowledge", 15))


class MatchingTests(TestCase):
    def setUp(self):
        self.dept = Department.objects.create(name="Production", code="PROD")
        self.req = Requisition(
            department=self.dept, title="Process Engineer", employment_type="experienced", min_experience_years=3,
            education_level="bsc", courses=["Chemical Engineering"], required_skills=["HAZOP", "Process simulation"],
            tools=["Aspen HYSYS", "Microsoft Excel"], certifications=["COREN"],
        )

    def candidate(self, **kw):
        defaults = dict(highest_qualification="bsc", course="Chemical Engineering", years_experience=5,
                        skills=["HAZOP", "Process simulation"], tools=["HYSYS", "MS Excel"], certifications=["COREN"])
        defaults.update(kw)
        return Candidate(**defaults)

    def test_perfect_candidate_scores_100_using_aliases(self):
        result = compute_match(self.req, self.candidate())
        self.assertEqual(result["score"], 100)
        self.assertEqual(result["grade"], "A")
        self.assertEqual(result["flags"], [])

    def test_skills_found_in_cv_text_count(self):
        result = compute_match(self.req, self.candidate(skills=[], cv_text="Led HAZOP studies and process simulation work"))
        self.assertEqual(result["components"]["skills"]["score"], 1)

    def test_irrelevant_experience_is_discounted(self):
        accountant = self.candidate(course="Accounting", skills=["Financial reporting (IFRS)"], tools=["Microsoft Excel"],
                                    certifications=["ICAN"])
        result = compute_match(self.req, accountant)
        self.assertLess(result["score"], 30)
        self.assertIn("weighted for relevance", result["components"]["experience"]["detail"])
        self.assertIn("Course not in accepted list", result["flags"])

    def test_missing_requirements_are_not_penalised(self):
        self.req.certifications = []
        result = compute_match(self.req, self.candidate(certifications=[]))
        self.assertNotIn("certifications", result["components"])
        self.assertEqual(result["score"], 100)

    def test_trainee_degree_class_and_nysc(self):
        self.req.employment_type = "trainee"
        self.req.min_experience_years = 0
        self.req.min_degree_class = "2_1"
        self.req.requires_nysc = True
        good = compute_match(self.req, self.candidate(degree_class="first", nysc_status="completed", years_experience=0))
        weak = compute_match(self.req, self.candidate(degree_class="2_2", nysc_status="", years_experience=0))
        self.assertGreater(good["score"], weak["score"])
        self.assertIn("Below required class of degree", weak["flags"])
        self.assertIn("NYSC status not stated", weak["flags"])
        self.assertEqual(good["track"], "trainee")

    def test_education_and_experience_helpers(self):
        self.assertEqual(education_score("msc", "bsc"), 1)
        self.assertEqual(education_score("hnd", "bsc"), 0.6)
        self.assertEqual(education_score("", "bsc"), 0)
        with self.settings(RECRUITMENT={**__import__("django.conf").conf.settings.RECRUITMENT, "HND_EQUIVALENT_TO_BSC": True}):
            self.assertEqual(education_score("hnd", "bsc"), 1)
        self.assertEqual(experience_score(2, 4, None), 0.5)
        self.assertLess(experience_score(20, 5, 8), 1)


@override_settings(MEDIA_ROOT=MEDIA, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class WorkflowTests(TestCase):
    def setUp(self):
        self.dept = Department.objects.create(name="Production", code="PROD")
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.RECRUITER, email="hr@example.com")
        self.hod = User.objects.create_user("hod", password="x", role=User.Role.HOD, department=self.dept, email="hod@example.com")
        self.panel = User.objects.create_user("panel", password="x", role=User.Role.INTERVIEWER, email="panel@example.com")
        self.mgmt = User.objects.create_user("gm", password="x", role=User.Role.MANAGEMENT, email="gm@example.com")
        self.onb = User.objects.create_user("onb", password="x", role=User.Role.ONBOARDING, email="onb@example.com")
        self.req = Requisition.objects.create(department=self.dept, title="Process Engineer", status="open",
                                              required_skills=["HAZOP"], positions=1)
        self.candidate = Candidate.objects.create(first_name="Ada", last_name="Eze", email="ada@example.com", skills=["HAZOP"],
                                                  highest_qualification="bsc")
        self.app, _ = services.create_application(self.candidate, self.req, source="portal")

    def interview_all_rounds(self, app):
        for round_ in Interview.Round.values:
            interview = services.schedule_interview(app, round=round_, scheduled_at=timezone.now() + timezone.timedelta(days=1),
                                                    panel=[self.panel], actor=self.hr)
            services.complete_interview(interview, actor=self.hr)
        return interview

    def select_and_clear_documents(self, app):
        services.record_decision(app, "select", actor=self.hr)
        self.assertEqual(app.stage, Stage.DOCUMENTS)
        for requirement in services.required_documents(app):
            doc = CandidateDocument.objects.create(candidate=app.candidate, doc_type=requirement.doc_type, file="x.pdf",
                                                   status=CandidateDocument.Status.VERIFIED)
        return doc

    def test_interviews_send_invites_and_move_to_decision(self):
        services.shortlist(self.app, actor=self.hr)
        mail.outbox.clear()
        interview = services.schedule_interview(self.app, round=Interview.Round.TECHNICAL, scheduled_at=timezone.now(),
                                                panel=[self.panel], mode=Interview.Mode.VIDEO, actor=self.hr)
        self.assertTrue(interview.meeting_link.startswith("https://"))
        recipients = {addr for m in mail.outbox for addr in m.to}
        self.assertIn("ada@example.com", recipients)
        self.assertIn("panel@example.com", recipients)
        self.assertTrue(any(att[0] == "interview.ics" for m in mail.outbox for att in m.attachments))
        self.interview_all_rounds(self.app)
        self.app.refresh_from_db()
        self.assertEqual(self.app.stage, Stage.DECISION)

    def test_documents_gate_and_experienced_track_to_offer(self):
        services.shortlist(self.app, actor=self.hr)
        self.interview_all_rounds(self.app)
        services.record_decision(self.app, "select", actor=self.hr)
        with self.assertRaises(services.WorkflowError):
            services.clear_documents(self.app, actor=self.hr)
        self.select_and_clear_documents_existing()
        services.clear_documents(self.app, actor=self.hr)
        self.assertEqual(self.app.stage, Stage.OFFER)

    def select_and_clear_documents_existing(self):
        for requirement in services.required_documents(self.app):
            CandidateDocument.objects.create(candidate=self.candidate, doc_type=requirement.doc_type, file="x.pdf",
                                             status=CandidateDocument.Status.VERIFIED)

    def test_trainee_skips_offer_and_goes_to_onboarding(self):
        self.req.employment_type = "trainee"
        self.req.save()
        self.app.refresh_from_db()
        self.assertNotIn(Stage.OFFER, self.app.pipeline_stages())
        services.shortlist(self.app, actor=self.hr)
        self.interview_all_rounds(self.app)
        self.select_and_clear_documents(self.app)
        services.clear_documents(self.app, actor=self.hr)
        self.app.refresh_from_db()
        self.assertEqual(self.app.stage, Stage.ONBOARDING)
        self.assertTrue(self.app.onboarding.tasks.exists())

    def _to_offer(self):
        services.shortlist(self.app, actor=self.hr)
        self.interview_all_rounds(self.app)
        self.select_and_clear_documents(self.app)
        services.clear_documents(self.app, actor=self.hr)
        offer = services.create_offer(self.app, job_title="Process Engineer", annual_salary=Decimal("12000000"), actor=self.hr)
        services.send_offer(offer, actor=self.hr)
        return offer

    def test_offer_accept_medical_onboarding_hired_and_filled(self):
        offer = self._to_offer()
        services.candidate_offer_response(offer, "accept")
        self.app.refresh_from_db()
        self.assertEqual(self.app.stage, Stage.MEDICAL)
        medical = services.schedule_medical(self.app, scheduled_for=timezone.now(), facility="Clinic", actor=self.hr)
        services.record_medical_result(medical, "fit", actor=self.hr)
        self.app.refresh_from_db()
        self.assertEqual(self.app.stage, Stage.ONBOARDING)
        onboarding = self.app.onboarding
        onboarding.staff_id = "IE9999"
        onboarding.save()
        services.complete_onboarding(onboarding, actor=self.onb)
        self.app.refresh_from_db()
        self.req.refresh_from_db()
        self.assertEqual((self.app.stage, self.app.status), (Stage.HIRED, Application.Status.HIRED))
        self.assertEqual(self.req.status, Requisition.Status.FILLED)
        self.assertTrue(Employee.objects.filter(staff_id="IE9999", department=self.dept).exists())

    def test_offer_review_revise_creates_new_version(self):
        offer = self._to_offer()
        services.candidate_offer_response(offer, "review", comment="Market rate", counter_salary=Decimal("15000000"))
        self.assertTrue(self.mgmt.notifications.filter(title__icontains="review").exists())
        revised = services.management_offer_decision(offer, "revise", new_salary=Decimal("14000000"), actor=self.mgmt)
        offer.refresh_from_db()
        self.assertEqual(offer.status, Offer.Status.SUPERSEDED)
        self.assertEqual((revised.version, revised.status, revised.annual_salary), (2, Offer.Status.SENT, Decimal("14000000")))

    def test_offer_review_maintain_and_withdraw(self):
        offer = self._to_offer()
        services.candidate_offer_response(offer, "review")
        services.management_offer_decision(offer, "maintain", actor=self.mgmt)
        offer.refresh_from_db()
        self.assertEqual(offer.status, Offer.Status.SENT)
        services.candidate_offer_response(offer, "review")
        services.management_offer_decision(offer, "withdraw", actor=self.mgmt)
        self.app.refresh_from_db()
        self.assertEqual(self.app.status, Application.Status.WITHDRAWN)
        with self.assertRaises(services.WorkflowError):
            services.candidate_offer_response(offer, "accept")

    def test_decline_suggests_next_candidates(self):
        other = Candidate.objects.create(first_name="Next", last_name="Best", email="n@example.com")
        backup, _ = services.create_application(other, self.req)
        services.shortlist(backup, actor=self.hr)
        offer = self._to_offer()
        services.candidate_offer_response(offer, "decline", comment="Accepted another offer")
        self.assertIn(backup, services.next_best_candidates(self.req))

    def test_reject_sends_regret_email(self):
        mail.outbox.clear()
        services.set_status(self.app, Application.Status.REJECTED, actor=self.hr, email_candidate=True)
        self.assertEqual(mail.outbox[0].to, ["ada@example.com"])

    def test_evaluation_view_saves_scores(self):
        services.shortlist(self.app, actor=self.hr)
        interview = services.schedule_interview(self.app, round="technical", scheduled_at=timezone.now(),
                                                panel=[self.panel], actor=self.hr)
        self.client.force_login(self.panel)
        data = {"recommendation": "select", "remarks": "Good"}
        for criterion in EvaluationCriterion.objects.all():
            data[f"c_{criterion.pk}"] = criterion.max_marks * 0.8
        response = self.client.post(reverse("pipeline:evaluate", args=[self.app.pk]) + f"?interview={interview.pk}", data)
        self.assertRedirects(response, self.app.get_absolute_url())
        summary = self.app.evaluation_summary()
        self.assertEqual(summary["total"], Decimal("80.0"))
        self.assertEqual(summary["rating"]["code"], "VG")
        # Marks above the maximum are rejected.
        data["c_%d" % EvaluationCriterion.objects.first().pk] = 99
        response = self.client.post(reverse("pipeline:evaluate", args=[self.app.pk]) + f"?interview={interview.pk}", data)
        self.assertEqual(response.status_code, 200)

    def test_panel_member_outside_department_only_sees_their_candidates(self):
        other_req = Requisition.objects.create(department=self.dept, title="Other", status="open")
        other_app, _ = services.create_application(self.candidate, other_req)
        services.shortlist(self.app, actor=self.hr)
        services.schedule_interview(self.app, round="technical", scheduled_at=timezone.now(), panel=[self.panel], actor=self.hr)
        self.client.force_login(self.panel)
        self.assertEqual(self.client.get(self.app.get_absolute_url()).status_code, 200)
        self.assertEqual(self.client.get(other_app.get_absolute_url()).status_code, 403)

    def test_board_drag_and_drop_endpoint(self):
        self.client.force_login(self.hr)
        url = reverse("pipeline:move", args=[self.app.pk])
        ok = self.client.post(url, {"stage": "shortlisted"}, HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertEqual(ok.json()["ok"], True)
        self.req.employment_type = "trainee"
        self.req.save()
        bad = self.client.post(url, {"stage": "offer"}, HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertEqual(bad.status_code, 400)

    def test_ics_is_valid_and_folded(self):
        self.candidate.first_name = "Ọlá — Ẹ̀wà long name to force folding of the summary line"
        self.candidate.save()
        services.shortlist(self.app, actor=self.hr)
        interview = services.schedule_interview(self.app, round="technical", scheduled_at=timezone.now(), panel=[self.panel],
                                                actor=self.hr, send=False)
        ics = interview_ics(interview).decode("utf-8")
        self.assertTrue(ics.startswith("BEGIN:VCALENDAR"))
        self.assertIn("METHOD:REQUEST", ics)
        for line in ics.split("\r\n"):
            self.assertLessEqual(len(line.encode("utf-8")), 75)
        self.assertIn("METHOD:CANCEL", interview_ics(interview, cancel=True).decode())


class AIWrapperTests(TestCase):
    """The Claude integration is exercised with a fake client (no network, no cost)."""

    def fake_response(self, payload, stop_reason="end_turn"):
        return SimpleNamespace(stop_reason=stop_reason, _request_id="req_test",
                               content=[SimpleNamespace(type="text", text=json.dumps(payload))])

    @override_settings(ANTHROPIC_API_KEY="test-key", AI_ENABLED=True, ANTHROPIC_MODEL="claude-opus-5-5")
    def test_structured_request_uses_json_schema_and_fallbacks(self):
        from core import ai

        fake = mock.MagicMock()
        fake.beta.messages.create.return_value = self.fake_response({"skills": ["HAZOP"]})
        with mock.patch.object(ai, "_client", return_value=fake):
            result = ai.structured_request(system="s", content="c", schema={"type": "object"})
        self.assertEqual(result, {"skills": ["HAZOP"]})
        kwargs = fake.beta.messages.create.call_args.kwargs
        self.assertEqual(kwargs["model"], "claude-opus-5-5")
        self.assertEqual(kwargs["output_config"]["format"]["type"], "json_schema")
        self.assertEqual(kwargs["fallbacks"], "default")
        self.assertIn("server-side-fallback-2026-07-01", kwargs["betas"])
        self.assertNotIn("thinking", kwargs)

    @override_settings(ANTHROPIC_API_KEY="test-key", AI_ENABLED=True)
    def test_refusal_and_truncation_return_none(self):
        from core import ai

        for stop in ("refusal", "max_tokens"):
            fake = mock.MagicMock()
            fake.beta.messages.create.return_value = self.fake_response({}, stop_reason=stop)
            with mock.patch.object(ai, "_client", return_value=fake):
                self.assertIsNone(ai.structured_request(system="s", content="c", schema={}))

    @override_settings(ANTHROPIC_API_KEY="")
    def test_disabled_without_key(self):
        from core import ai

        self.assertFalse(ai.ai_enabled())
        self.assertIsNone(ai.structured_request(system="s", content="c", schema={}))

    @override_settings(ANTHROPIC_API_KEY="test-key", AI_ENABLED=True)
    def test_cv_parse_merges_ai_with_rules(self):
        from candidates import cv_parser
        from core import ai

        ai_payload = {k: "" for k in cv_parser.CV_SCHEMA["required"]}
        ai_payload.update({"first_name": "Ngozi", "last_name": "Obi", "email": "ngozi@example.com", "graduation_year": 0,
                           "years_experience": 7, "skills": ["Root cause analysis"], "tools": [], "certifications": [],
                           "education_history": [], "work_history": [], "highest_qualification": "msc"})
        fake = mock.MagicMock()
        fake.beta.messages.create.return_value = self.fake_response(ai_payload)
        text = b"Ngozi Obi\nngozi@example.com\n0803 000 1234\nSKILLS\nAspen HYSYS, HAZOP"
        with mock.patch.object(ai, "_client", return_value=fake):
            parsed = cv_parser.parse_cv(text, "cv.txt")
        self.assertEqual(parsed["method"], "ai")
        self.assertEqual(parsed["highest_qualification"], "msc")
        self.assertEqual(parsed["phone"], "08030001234", "rule-based extractor fills what AI left empty")
        self.assertIn("Aspen HYSYS", parsed["tools"])
        self.assertIsNone(parsed["graduation_year"])

    @override_settings(ANTHROPIC_API_KEY="test-key", AI_ENABLED=True)
    def test_scanned_pdf_is_sent_as_document(self):
        from candidates import cv_parser
        from core import ai
        from core.demo_files import simple_pdf

        fake = mock.MagicMock()
        fake.beta.messages.create.return_value = self.fake_response(None)
        with mock.patch.object(ai, "_client", return_value=fake):
            cv_parser.parse_cv(simple_pdf([""]), "scan.pdf")
        content = fake.beta.messages.create.call_args.kwargs["messages"][0]["content"]
        self.assertEqual(content[0]["type"], "document")
        self.assertEqual(content[0]["source"]["media_type"], "application/pdf")
