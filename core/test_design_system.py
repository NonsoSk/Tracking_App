"""Design-system guarantees: AA contrast, vendored assets only, and a working style guide."""

import re
from pathlib import Path
from types import SimpleNamespace

from django.conf import settings
from django.template import Context, Template
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse

from accounts.models import User
from core import contrast
from core.templatetags import ds

BASE = Path(settings.BASE_DIR)


class ContrastTests(TestCase):
    def test_every_pair_passes_in_both_themes(self):
        rows = contrast.report()
        self.assertEqual({r["theme"] for r in rows}, {"light", "dark"})
        failures = [f'{r["theme"]}: {r["fg"]} on {r["bg"]} = {r["ratio"]} (needs {r["min"]})' for r in rows if not r["ok"]]
        self.assertEqual(failures, [])

    def test_text_pairs_use_aa_and_ui_pairs_use_3_to_1(self):
        self.assertTrue(all(minimum == 4.5 for _, _, minimum, _ in contrast.TEXT_PAIRS))
        self.assertTrue(all(minimum == 3.0 for _, _, minimum, _ in contrast.UI_PAIRS))

    def test_ratio_matches_wcag_reference_values(self):
        self.assertEqual(contrast.ratio((0, 0, 0), (255, 255, 255)), 21.0)
        self.assertEqual(contrast.ratio(contrast.hex_to_rgb("#767676"), (255, 255, 255)), 4.54)


class AssetTests(TestCase):
    ICON_TAG = re.compile(r'{%\s*icon\s+"([\w-]+)"')

    def test_every_icon_referenced_is_vendored(self):
        names = set()
        for path in (BASE / "templates").rglob("*.html"):
            names |= set(self.ICON_TAG.findall(path.read_text(encoding="utf-8")))
        names |= set(re.findall(r'"icon": "([\w-]+)"', (BASE / "core" / "templatetags" / "ds.py").read_text(encoding="utf-8")))
        missing = sorted(n for n in names if not (ds.ICON_DIR / f"{n}.svg").is_file())
        self.assertTrue(names)
        self.assertEqual(missing, [])

    def test_design_system_loads_nothing_from_a_cdn(self):
        files = [*(BASE / "static" / "ds").glob("*.*"), *(BASE / "templates" / "ds").rglob("*.html")]
        offenders = []
        for path in files:
            for url in re.findall(r"https?://[^\s\"')]+", path.read_text(encoding="utf-8")):
                if not url.startswith("http://www.w3.org/"):
                    offenders.append(f"{path.name}: {url}")
        self.assertEqual(offenders, [])

    def test_fonts_and_logo_are_vendored(self):
        self.assertTrue((BASE / "static/vendor/fonts/nunito-sans/nunito-sans-latin-wght-normal.woff2").is_file())
        self.assertTrue((BASE / "static/img/brand/indorama-logo.jpg").is_file())

    def test_theme_is_applied_before_the_stylesheet_loads(self):
        base = (BASE / "templates" / "ds" / "base.html").read_text(encoding="utf-8")
        self.assertLess(base.index("iefcl-theme"), base.index("ds/ds.css"))


class TagTests(TestCase):
    def render(self, source, **context):
        return Template("{% load ds %}" + source).render(Context(context))

    def test_icon_is_inline_and_decorative_unless_labelled(self):
        html = self.render('{% icon "bell" %}')
        self.assertIn('aria-hidden="true"', html)
        self.assertNotIn("license", html)
        self.assertIn('aria-label="Alerts"', self.render('{% icon "bell" label="Alerts" %}'))

    @override_settings(DEBUG=False)
    def test_unknown_icon_renders_nothing_in_production(self):
        self.assertEqual(self.render('{% icon "not-a-real-icon" %}'), "")

    def test_status_chip_palette(self):
        app = SimpleNamespace(stage="applied", status="active")
        self.assertIn('class="chip neutral">Received', str(ds.status_chip(app)))
        app.status = "rejected"
        self.assertIn('class="chip danger">Rejected', str(ds.status_chip(app)))
        self.assertIn('class="chip gold">Hired', str(ds.status_chip(stage="hired", status="hired")))
        self.assertIn('class="chip warning">On hold', str(ds.status_chip(key="on_hold")))

    def test_stage_rail_states(self):
        rail = ds.stage_rail(stage="offer")
        states = [i["state"] for i in rail["items"]]
        self.assertEqual(states.count("now"), 1)
        self.assertEqual(states.index("now"), 5)
        self.assertEqual((rail["position"], rail["total"], rail["label"]), (6, 9, "Offer"))
        stopped = ds.stage_rail(stage="interview", status="rejected")
        self.assertIn("halted", [i["state"] for i in stopped["items"]])
        hired = ds.stage_rail(stage="hired", status="hired")
        self.assertEqual(hired["items"][-1]["state"], "gold")

    def test_stage_rail_skips_stages_the_application_skips(self):
        trainee = SimpleNamespace(stage="medical", status="active",
                                  pipeline_stages=lambda: ["applied", "shortlisted", "interview", "decision",
                                                           "documents", "medical", "onboarding", "hired"])
        rail = ds.stage_rail(trainee)
        self.assertNotIn("offer", [i["key"] for i in rail["items"]])
        self.assertEqual(rail["total"], 8)

    def test_score_ring(self):
        html = str(ds.score_ring(97.5, 112, True, "match"))
        self.assertIn("is-gold", html)
        self.assertIn('aria-label="match 97.5 out of 100"', html)
        self.assertIn("not available", str(ds.score_ring(None)))

    def test_avatar_initials(self):
        self.assertIn(">CO<", str(ds.avatar("Chinedu Okafor")))
        self.assertIn(">?<", str(ds.avatar("")))

    def test_navigation_follows_role(self):
        hr = User(username="hr", role=User.Role.HR_ADMIN)
        employee = User(username="e", role=User.Role.EMPLOYEE)
        hr_labels = [i.get("label") for i in ds._nav(hr)]
        emp_labels = [i.get("label") for i in ds._nav(employee)]
        self.assertIn("Talent", hr_labels)
        self.assertNotIn("Talent", emp_labels)
        self.assertNotIn("Pipeline", emp_labels)
        self.assertIn("Interviews", emp_labels)

    def test_navigation_marks_the_current_page(self):
        request = RequestFactory().get("/candidates/intake/")
        request.user = User(username="hr", role=User.Role.HR_ADMIN)
        current = [i["label"] for i in ds.nav_items({"request": request}) if i.get("current")]
        self.assertEqual(current, ["CV intake"])


class StyleguideTests(TestCase):
    def test_requires_sign_in(self):
        response = self.client.get(reverse("core:styleguide"))
        self.assertEqual(response.status_code, 302)

    def test_renders_every_section_in_both_themes(self):
        user = User.objects.create_user("staff", password="x", role=User.Role.EMPLOYEE)
        self.client.force_login(user)
        response = self.client.get(reverse("core:styleguide"))
        self.assertEqual(response.status_code, 200)
        html = response.content.decode()
        from core.styleguide import SECTIONS

        for slug, _, _ in SECTIONS:
            self.assertIn(f'id="{slug}"', html)
        self.assertEqual(html.count('class="sg-theme" data-theme="dark"'), len(SECTIONS))
        self.assertEqual(html.count('class="sg-theme" data-theme="light"'), len(SECTIONS))
        self.assertIn(f"All {len(contrast.report())} colour pairs pass AA", html)
        self.assertNotIn("bootstrap", html.lower())


class PaletteSearchTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from candidates.models import Candidate
        from core.models import Department
        from pipeline.models import Application
        from requisitions.models import Requisition

        dept = Department.objects.create(name="Production", code="PROD")
        cls.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        cls.hod = User.objects.create_user("hod", password="x", role=User.Role.HOD, department=dept)
        cls.employee = User.objects.create_user("emp", password="x", role=User.Role.EMPLOYEE)
        req = Requisition.objects.create(title="Process Engineer", department=dept, raised_by=cls.hod,
                                         status=Requisition.Status.OPEN)
        person = Candidate.objects.create(first_name="Chinedu", last_name="Okafor", email="chinedu@example.com")
        Application.objects.create(candidate=person, requisition=req)
        Candidate.objects.create(first_name="Chinedu", last_name="Eze", email="ce@example.com")

    def search(self, user, q):
        self.client.force_login(user)
        return self.client.get(reverse("core:palette_search"), {"q": q}).json()

    def test_full_name_finds_the_application_first(self):
        data = self.search(self.hr, "chinedu okafor")
        self.assertEqual(data["groups"][0]["title"], "Applications")
        self.assertEqual([i["label"] for i in data["groups"][0]["items"]], ["Chinedu Okafor"])
        self.assertIn("/pipeline/applications/", data["groups"][0]["items"][0]["url"])

    def test_talent_database_results_are_for_hr_only(self):
        hr_titles = [g["title"] for g in self.search(self.hr, "chinedu")["groups"]]
        hod_titles = [g["title"] for g in self.search(self.hod, "chinedu")["groups"]]
        self.assertIn("Candidates", hr_titles)
        self.assertNotIn("Candidates", hod_titles)
        self.assertIn("Applications", hod_titles)

    def test_respects_department_access(self):
        self.assertEqual(self.search(self.employee, "chinedu")["groups"], [])

    def test_roles_and_short_queries(self):
        titles = [g["title"] for g in self.search(self.hod, "process eng")["groups"]]
        self.assertEqual(titles, ["Roles"])
        self.assertEqual(self.search(self.hr, "c")["groups"], [])

    def test_requires_sign_in(self):
        self.assertEqual(self.client.get(reverse("core:palette_search"), {"q": "chinedu"}).status_code, 302)
