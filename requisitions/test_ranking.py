from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from candidates.models import Candidate
from core.models import Department
from pipeline.models import Application

from .models import Requisition


class RankedListFilterTests(TestCase):
    """A vacancy's ranked candidates can be narrowed to the top 10/20/50, a score range, or those meeting every key
    requirement."""

    def setUp(self):
        dept = Department.objects.create(name="Finance", code="FIN")
        self.req = Requisition.objects.create(department=dept, title="Accounts Officer", status="open",
                                              required_skills=["Accounts payable"])
        self.scores = [92, 81, 74, 66, 58, 41, 30]
        for i, score in enumerate(self.scores):
            person = Candidate.objects.create(first_name=f"C{i}", last_name="Test")
            unmet = ["Required skills"] if i % 2 else []
            Application.objects.create(candidate=person, requisition=self.req, match_score=Decimal(score),
                                       match_grade="A" if score >= 85 else "B" if score >= 70 else "C" if score >= 55 else "D",
                                       matched_at=timezone.now(),
                                       match_breakdown={"version": 4, "eligible": not unmet, "unmet": unmet, "screening": []})
        self.client.force_login(User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN))

    def shown(self, **params):
        response = self.client.get(self.req.get_absolute_url(), params)
        return [float(a.match_score) for a in response.context["applications"]], response

    def test_everyone_highest_first_by_default(self):
        scores, response = self.shown()
        self.assertEqual(scores, self.scores)
        self.assertFalse(response.context["filtered"])

    def test_top_n(self):
        scores, response = self.shown(top="3")
        self.assertEqual(scores, [92, 81, 74])
        self.assertContains(response, "Showing 3 of 7: top 3, highest score first.")

    def test_score_range(self):
        scores, _ = self.shown(min="55", max="80")
        self.assertEqual(scores, [74, 66, 58])
        scores, _ = self.shown(min="70")
        self.assertEqual(scores, [92, 81, 74])

    def test_meeting_every_key_requirement(self):
        scores, _ = self.shown(keyreq="1")
        self.assertEqual(scores, [92, 74, 58, 30])
        scores, response = self.shown(keyreq="1", top="2", min="50")
        self.assertEqual(scores, [92, 74])
        self.assertContains(response, "top 2, scoring 50+, meeting every key requirement")
