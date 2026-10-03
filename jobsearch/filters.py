"""Decide which listings are matches and attach a monthly USD salary."""

import re

from .salary import monthly_usd, parse_salary_text


def contains_term(text, term):
    return re.search(r"(?<![a-z])" + re.escape(term.strip()) + r"(?![a-z])", text) is not None


def title_matches(title, config):
    lowered = title.lower()
    if any(contains_term(lowered, term) for term in config["title_exclude"]):
        return False
    return any(contains_term(lowered, term) for term in config["title_keywords"])


def location_ok(location, config):
    """Open to the candidate: worldwide, or a region listed in allowed_locations."""
    lowered = location.lower().strip()
    if lowered in ("", "remote"):
        return True
    return any(contains_term(lowered, term) for term in config["allowed_locations"])


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


def evaluate(item, config):
    """Return (is_match, reason) and fill in the item's monthly salary."""
    low, high = salary_for(item, config)
    item["monthly_usd_min"], item["monthly_usd_max"] = low, high
    if not title_matches(item["title"], config):
        return False, "title"
    if not location_ok(item["location"], config):
        return False, "location"
    excluded = {name.lower() for name in config["exclude_companies"]}
    if item["company"].lower() in excluded:
        return False, "company"
    if high is None:
        return config["include_unknown_salary"], "salary unknown"
    if high < config["min_monthly_usd"]:
        return False, "salary"
    return True, "match"


def matches(jobs, config):
    found, rejected = [], {}
    for item in jobs:
        ok, reason = evaluate(item, config)
        if ok:
            found.append(item)
        else:
            rejected[reason] = rejected.get(reason, 0) + 1
    return found, rejected
