"""Turn salary text or numeric ranges into a monthly USD range."""

import re

CURRENCY_MARKERS = [
    ("€", "EUR"), ("eur", "EUR"),
    ("£", "GBP"), ("gbp", "GBP"),
    ("cad", "CAD"), ("c$", "CAD"),
    ("aud", "AUD"), ("a$", "AUD"),
    ("chf", "CHF"),
    ("₹", "INR"), ("inr", "INR"),
    ("₦", "NGN"), ("ngn", "NGN"),
    ("$", "USD"), ("usd", "USD"),
]

NUMBER = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*([kK])?")


def detect_currency(text):
    lowered = text.lower()
    for marker, code in CURRENCY_MARKERS:
        if marker in lowered:
            return code
    return "USD"


def detect_period(text):
    lowered = text.lower()
    if re.search(r"\b(hour|hr|hourly)\b|/h\b", lowered):
        return "hour"
    if re.search(r"\b(month|mo|monthly)\b|/m\b|pcm", lowered):
        return "month"
    if re.search(r"\b(year|yr|annual|annually|annum|pa)\b|/y\b", lowered):
        return "year"
    return None


def guess_period(amount):
    """Fallback when the text does not say: infer the period from size."""
    if amount < 500:
        return "hour"
    if amount < 25000:
        return "month"
    return "year"


def to_monthly(amount, period, hours_per_month):
    if period == "hour":
        return amount * hours_per_month
    if period == "year":
        return amount / 12
    return amount


def parse_amounts(text):
    amounts = []
    for digits, k in NUMBER.findall(text):
        value = float(digits.replace(",", ""))
        if k:
            value *= 1000
        if value > 0:
            amounts.append(value)
    return amounts


def monthly_usd(low, high=None, currency="USD", period=None, rates=None, hours_per_month=160):
    """Convert a numeric range to (min, max) monthly USD, or (None, None)."""
    rates = rates or {"USD": 1.0}
    values = [v for v in (low, high) if v]
    if not values:
        return None, None
    rate = rates.get((currency or "USD").upper())
    if rate is None:
        return None, None
    period = period or guess_period(min(values))
    monthly = [round(to_monthly(v, period, hours_per_month) * rate) for v in values]
    return min(monthly), max(monthly)


def parse_salary_text(text, rates=None, hours_per_month=160):
    """Parse free text like '$70k - $90k' or '€5,000/month'."""
    if not text:
        return None, None
    amounts = parse_amounts(text)
    if not amounts:
        return None, None
    amounts = amounts[:2]
    return monthly_usd(
        min(amounts), max(amounts),
        currency=detect_currency(text),
        period=detect_period(text),
        rates=rates,
        hours_per_month=hours_per_month,
    )
