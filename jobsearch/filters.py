"""Decide which listings are matches and attach a monthly USD salary."""

import datetime
import re

from .outreach import find_contacts
from .salary import monthly_usd, parse_salary_text

# Signs a post is more than a regular listing: a better shot or a faster hire.
SIGNALS = [
    ("urgent", r"\burgent(ly)?\b|\basap\b|immediate (start|hire|availability)|start immediately"
               r"|available immediately"),
    ("early-stage", r"\bfounding\b|first (data|analytics) hire|early[- ]stage|seed[- ](round|stage|funded)"
                    r"|series a\b|small team"),
    ("names Africa", r"\bnigeria\b|\blagos\b|(?<!south )\bafrica\b"),
]


def contains_term(text, term):
    return re.search(r"(?<![a-z])" + re.escape(term.strip()) + r"(?![a-z])", text) is not None


def title_matches(title, config):
    lowered = title.lower()
    if any(contains_term(lowered, term) for term in config["title_exclude"]):
        return False
    return any(contains_term(lowered, term) for term in config["title_keywords"])


def location_ok(location, config):
    """Open to the candidate: worldwide, or a region listed in allowed_locations.
    Phrases in location_ignore ("south africa") don't count as a match for a
    shorter allowed term inside them ("africa")."""
    lowered = location.lower().strip()
    if lowered in ("", "remote"):
        return True
    for phrase in config.get("location_ignore", []):
        lowered = lowered.replace(phrase, " ")
    return any(contains_term(lowered, term) for term in config["allowed_locations"])


def fresh(item, config, now):
    """Posted within max_age_hours. A post with no posting time is not fresh."""
    hours = config.get("max_age_hours")
    if not hours:
        return True
    posted = item.get("posted_at")
    return posted is not None and now - posted <= datetime.timedelta(hours=hours)


def signals(item):
    text = f"{item['title']} {item['location']} {item.get('description') or ''}".lower()
    found = [name for name, pattern in SIGNALS if re.search(pattern, text)]
    if find_contacts(item.get("raw_description") or item.get("description")):
        found.append("direct email")
    return found


def salary_for(item, config):
    rates, hours = config["usd_rates"], config["hours_per_month"]
    if item.get("salary_min") or item.get("salary_max"):
        try:
            low = float(item["salary_min"]) if item.get("salary_min") else None
            high = float(item["salary_max"]) if item.get("salary_max") else None
        except (TypeError, ValueError):
            low = high = None
        if low or high:
            return monthly_usd(low, high, item.get("currency"), item.get("period"), rates, hours)
    return parse_salary_text(item.get("salary_text"), rates, hours)


def evaluate(item, config, now=None):
    """Return (is_match, reason) and fill in the item's monthly salary and signals."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    low, high = salary_for(item, config)
    item["monthly_usd_min"], item["monthly_usd_max"] = low, high
    item["signals"] = ", ".join(signals(item))
    if not title_matches(item["title"], config):
        return False, "title"
    if not location_ok(item["location"], config):
        return False, "location"
    excluded = {name.lower() for name in config["exclude_companies"]}
    if item["company"].lower() in excluded:
        return False, "company"
    if not fresh(item, config, now):
        return False, "too old"
    if config.get("require_signals") and not item["signals"]:
        return False, "no signals"
    if high is None:
        return config["include_unknown_salary"], "salary unknown"
    if high < config["min_monthly_usd"]:
        return False, "salary"
    return True, "match"


def matches(jobs, config, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    found, rejected = [], {}
    for item in jobs:
        ok, reason = evaluate(item, config, now)
        if ok:
            found.append(item)
        else:
            rejected[reason] = rejected.get(reason, 0) + 1
    return found, rejected
