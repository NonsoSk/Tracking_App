"""Filters for ranked candidates, the same on the match grid and on a vacancy's ranked list: the top 10/20/50, a
score range, and only those meeting every key requirement."""

from __future__ import annotations

TOP_CHOICES = [(5, "Top 5"), (10, "Top 10"), (20, "Top 20"), (50, "Top 50")]
GOOD_ENOUGH = 55  # a "possible match" or better: pre-ticked on the match grid when no score range is chosen


def read_filters(params) -> dict:
    def number(name):
        try:
            return max(0.0, min(100.0, float(params.get(name, ""))))
        except (TypeError, ValueError):
            return None

    top = params.get("top", "")
    low, high = number("min"), number("max")
    if low is not None and high is not None and low > high:
        low, high = high, low
    return {"top": int(top) if top.isdigit() and int(top) > 0 else None, "min": low, "max": high,
            "keyreq": params.get("keyreq") == "1"}


def in_range(score: float, filters: dict) -> bool:
    return ((filters["min"] is None or score >= filters["min"])
            and (filters["max"] is None or score <= filters["max"]))


def describe(filters: dict) -> str:
    parts = []
    if filters["top"]:
        parts.append(f"top {filters['top']}")
    if filters["min"] is not None and filters["max"] is not None:
        parts.append(f"scoring {filters['min']:g}–{filters['max']:g}")
    elif filters["min"] is not None:
        parts.append(f"scoring {filters['min']:g}+")
    elif filters["max"] is not None:
        parts.append(f"scoring up to {filters['max']:g}")
    if filters["keyreq"]:
        parts.append("meeting every key requirement")
    return ", ".join(parts)


def active(filters: dict) -> bool:
    return bool(filters["top"] or filters["min"] is not None or filters["max"] is not None or filters["keyreq"])
