"""Host, pipeline and jetty communities, the Niger Delta and the rest. All names here are made up."""

from django.test import TestCase
from django.urls import reverse

from accounts.models import User

from .models import Candidate
from .regions import assign_all, canonical_state, classify, group_in


def record(**values):
    return {"file": "x.xlsx", "sheet": "Sheet", "row": 2, "values": values}


class ClassifyTests(TestCase):
    def test_a_column_that_says_the_group(self):
        self.assertEqual(classify(source_records=[record(**{"LGA/Community Tag": "Pipeline"})])[0], "pipeline")
        self.assertEqual(classify(source_records=[record(Community="Host Community")])[0], "host")
        self.assertEqual(classify(source_records=[record(**{"Community Category": "JETTY"})])[0], "jetty")
        self.assertEqual(classify(source_records=[record(Region="Niger-Delta")])[0], "niger_delta")
        group, how = classify(source_records=[record(**{"LGA/Community Tag": "Pipeline"})])
        self.assertEqual(how, "LGA/Community Tag: Pipeline")

    def test_words_in_other_columns_or_negatives_do_not_count(self):
        self.assertEqual(group_in("Discipline", "Pipeline Engineering"), "")
        self.assertEqual(group_in("Community", "Non Host"), "")
        self.assertEqual(group_in("Community Query", "Non Community"), "")
        self.assertEqual(group_in("Community Query", "Community"), "host")
        self.assertEqual(group_in("Community", "Elelenwo"), "")

    def test_the_state_decides_when_no_column_says_it(self):
        self.assertEqual(classify(state="Rivers State"), ("niger_delta", "State: Rivers"))
        self.assertEqual(classify(state="LAGOS")[0], "other_states")
        self.assertEqual(classify(country="Ghana")[0], "outside")
        self.assertEqual(classify(), ("", ""))
        # A column that names the group wins over the state.
        self.assertEqual(classify(source_records=[record(Community="Jetty")], state="Lagos")[0], "jetty")

    def test_state_spellings(self):
        for text, state in (("Akwa-Ibom", "Akwa Ibom"), ("CROSS RIVER STATE", "Cross River"), ("Abuja", "FCT"),
                            ("Nassarawa", "Nasarawa"), ("Eleme", "")):
            self.assertEqual(canonical_state(text), state, text)


class CandidateGroupTests(TestCase):
    def test_saved_with_a_group_and_hr_can_set_it(self):
        ada = Candidate.objects.create(first_name="Ada", last_name="Test", state_of_origin="rivers state",
                                       source_records=[record(**{"LGA/Community Tag": "Host"})])
        self.assertEqual((ada.region, ada.state_of_origin, ada.country), ("host", "Rivers", "Nigeria"))
        self.assertEqual(ada.zone, "South South")

        hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        self.client.force_login(hr)
        data = {"first_name": "Ada", "last_name": "Test", "source": "import", "state_of_origin": "Rivers",
                "country": "Nigeria", "region": "pipeline", "years_experience": "0"}
        self.client.post(reverse("candidates:edit", args=[ada.pk]), data)
        ada.refresh_from_db()
        self.assertEqual((ada.region, ada.region_fixed, ada.region_note), ("pipeline", True, "Set by HR"))
        assign_all()  # what every import does afterwards
        ada.refresh_from_db()
        self.assertEqual(ada.region, "pipeline")
        data["region"] = ""
        self.client.post(reverse("candidates:edit", args=[ada.pk]), data)
        ada.refresh_from_db()
        self.assertEqual((ada.region, ada.region_fixed), ("host", False))  # back to what the records say

    def test_talent_page_counts_and_filters_by_group_state_zone_and_country(self):
        Candidate.objects.create(first_name="Ada", last_name="Host", source_records=[record(Community="Host")])
        Candidate.objects.create(first_name="Bayo", last_name="Pipe", source_records=[record(Community="Pipeline")])
        Candidate.objects.create(first_name="Chidi", last_name="Delta", state_of_origin="Delta")
        Candidate.objects.create(first_name="Dayo", last_name="Lagos", state_of_origin="Lagos")
        Candidate.objects.create(first_name="Efe", last_name="Accra", country="Ghana")
        Candidate.objects.create(first_name="Femi", last_name="Unknown")
        self.client.force_login(User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN))

        page = self.client.get(reverse("candidates:list"))
        counts = {g["value"]: g["n"] for g in page.context["groups"]}
        self.assertEqual(counts, {"host": 1, "pipeline": 1, "jetty": 0, "niger_delta": 1, "other_states": 1,
                                  "outside": 1, "none": 1})

        def names(query):
            return {c.first_name for c in self.client.get(reverse("candidates:list") + query).context["candidates"]}

        self.assertEqual(names("?region=pipeline"), {"Bayo"})
        self.assertEqual(names("?region=none"), {"Femi"})
        self.assertEqual(names("?state=Lagos"), {"Dayo"})
        self.assertEqual(names("?zone=South South"), {"Chidi"})
        self.assertEqual(names("?country=Ghana"), {"Efe"})
        # The counts follow the other filters, and the group links keep them.
        searched = self.client.get(reverse("candidates:list") + "?country=Nigeria")
        counts = {g["value"]: g["n"] for g in searched.context["groups"]}
        self.assertEqual((counts["niger_delta"], counts["outside"]), (1, 0))
        self.assertContains(searched, "?country=Nigeria&amp;region=niger_delta")
