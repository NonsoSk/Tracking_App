"""Where a candidate is from, in IEFCL's groups: host, pipeline and jetty communities, the Niger Delta and the rest.

The group comes from the recruitment records when a column says it: any column whose heading mentions community,
tag, region, zone, catchment or category, holding a value such as "Host community", "Pipeline", "Jetty" or "Niger
Delta" (and the interview records' Community Query, where "Community" means a host community). Otherwise the
state decides: one of the Niger Delta states, another Nigerian state, or outside Nigeria. HR can set it by hand on
the profile, and the imports then leave it alone.
"""

from __future__ import annotations

import re
from collections import Counter

HOST, PIPELINE, JETTY, NIGER_DELTA, OTHER_STATES, OUTSIDE = (
    "host", "pipeline", "jetty", "niger_delta", "other_states", "outside")
REGION_CHOICES = [
    (HOST, "Host community"), (PIPELINE, "Pipeline community"), (JETTY, "Jetty community"),
    (NIGER_DELTA, "Niger Delta"), (OTHER_STATES, "Other states"), (OUTSIDE, "Outside Nigeria"),
]

# The 36 states and the FCT, by geopolitical zone.
ZONES = {
    "North Central": ["Benue", "Kogi", "Kwara", "Nasarawa", "Niger", "Plateau", "FCT"],
    "North East": ["Adamawa", "Bauchi", "Borno", "Gombe", "Taraba", "Yobe"],
    "North West": ["Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Sokoto", "Zamfara"],
    "South East": ["Abia", "Anambra", "Ebonyi", "Enugu", "Imo"],
    "South South": ["Akwa Ibom", "Bayelsa", "Cross River", "Delta", "Edo", "Rivers"],
    "South West": ["Ekiti", "Lagos", "Ogun", "Ondo", "Osun", "Oyo"],
}
STATE_ZONE = {state: zone for zone, states in ZONES.items() for state in states}
# The nine Niger Delta states (as covered by the NDDC).
NIGER_DELTA_STATES = {"Abia", "Akwa Ibom", "Bayelsa", "Cross River", "Delta", "Edo", "Imo", "Ondo", "Rivers"}
STATE_ALIASES = {"abuja": "FCT", "federal capital territory": "FCT", "fct abuja": "FCT", "nassarawa": "Nasarawa",
                 "akwaibom": "Akwa Ibom", "crossriver": "Cross River", "portharcourt": "Rivers"}
_STATE_KEYS = {re.sub(r"[^a-z]", "", s.lower()): s for s in STATE_ZONE}

# Headings of the columns that can say which group someone belongs to.
GROUP_HEADINGS = ("community", "tag", "region", "zone", "catchment", "category", "group")
GROUP_WORDS = [(JETTY, ("jetty",)), (PIPELINE, ("pipeline",)), (HOST, ("host",)),
               (NIGER_DELTA, ("niger delta", "nigerdelta"))]


def canonical_state(text: str) -> str:
    """'Rivers State', 'RIVERS', 'Akwa-Ibom', 'Abuja' -> the state's usual name; '' when it is not a state."""
    if not text:
        return ""
    key = re.sub(r"\bstate\b", "", str(text).lower())
    key = re.sub(r"[^a-z]", "", key)
    return _STATE_KEYS.get(key) or STATE_ALIASES.get(key, "")


def zone_of(state: str) -> str:
    return STATE_ZONE.get(canonical_state(state), "")


def group_in(heading: str, value) -> str:
    """The group a single cell names, if its column is one that records groups."""
    head = str(heading or "").lower()
    if not any(word in head for word in GROUP_HEADINGS):
        return ""
    text = re.sub(r"[^a-z ]", " ", str(value or "").lower())
    text = " ".join(text.split())
    if not text or len(text) > 40:
        return ""
    if "query" in head and text == "community":
        return HOST  # interview records: Community / Non Community
    if text.startswith(("non ", "not ")):
        return ""
    for group, words in GROUP_WORDS:
        if any(word in text for word in words):
            return group
    return ""


def classify(*, source_records=(), community_status: str = "", state: str = "", country: str = "") -> tuple[str, str]:
    """(group, how it was decided) from what the records hold."""
    votes, notes = Counter(), {}
    for order, record in enumerate(source_records or []):
        for heading, value in (record.get("values") or {}).items():
            group = group_in(heading, value)
            if group:
                votes[group] += 1
                notes[group] = (order, f"{heading}: {value}")
    if community_status == "community":
        votes[HOST] += 1
        notes.setdefault(HOST, (-1, "Interview records: host community"))
    if votes:
        group = max(votes, key=lambda g: (votes[g], notes[g][0]))
        return group, str(notes[group][1])[:120]
    state_name = canonical_state(state)
    if state_name:
        return (NIGER_DELTA if state_name in NIGER_DELTA_STATES else OTHER_STATES), f"State: {state_name}"
    if country and country.strip().lower() not in {"nigeria", "nigerian", "ng"}:
        return OUTSIDE, f"Country: {country}"
    return "", ""


def country_from(source_records=(), state: str = "") -> str:
    for record in reversed(list(source_records or [])):
        for heading, value in (record.get("values") or {}).items():
            if str(heading).strip().lower() in {"country", "nationality", "country of residence"} and value:
                text = str(value).strip()
                return "Nigeria" if text.lower() in {"nigerian", "ng", "nga"} else text.title()[:60]
    return "Nigeria" if canonical_state(state) else ""


def apply(candidate) -> bool:
    """Set the candidate's group, state spelling and country from their records. True if anything changed."""
    before = (candidate.region, candidate.region_note, candidate.country, candidate.state_of_origin)
    state = canonical_state(candidate.state_of_origin)
    if state:
        candidate.state_of_origin = state
    if not candidate.country:
        candidate.country = country_from(candidate.source_records, candidate.state_of_origin)
    if not candidate.region_fixed:
        candidate.region, candidate.region_note = classify(
            source_records=candidate.source_records, community_status=candidate.community_status,
            state=candidate.state_of_origin, country=candidate.country)
    return (candidate.region, candidate.region_note, candidate.country, candidate.state_of_origin) != before


def assign_all(queryset=None, *, log=None) -> int:
    """Re-work out every candidate's group (after an import). Returns how many changed."""
    from .models import Candidate

    queryset = queryset if queryset is not None else Candidate.objects.all()
    fields = ["id", "source_records", "community_status", "state_of_origin", "country", "region", "region_note",
              "region_fixed"]
    changed = []
    for candidate in queryset.only(*fields).iterator(chunk_size=2000):
        if apply(candidate):
            changed.append(candidate)
    Candidate.objects.bulk_update(changed, ["region", "region_note", "country", "state_of_origin"], batch_size=1000)
    if log and changed:
        log(f"Groups (host, pipeline, jetty, Niger Delta...) worked out for {len(changed):,} candidate(s).")
    return len(changed)
