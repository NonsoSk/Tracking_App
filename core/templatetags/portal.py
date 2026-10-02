from decimal import Decimal

from django import template

register = template.Library()


@register.filter
def get_item(mapping, key):
    if mapping is None:
        return None
    try:
        return mapping.get(key)
    except AttributeError:
        return None


@register.filter
def naira(value):
    try:
        return f"₦{Decimal(value):,.0f}"
    except Exception:
        return value


@register.filter
def pct(value, total):
    try:
        return round(float(value) / float(total) * 100) if float(total) else 0
    except (TypeError, ValueError):
        return 0


@register.filter
def times100(value):
    try:
        return round(float(value) * 100)
    except (TypeError, ValueError):
        return 0


@register.filter
def initials(user):
    name = getattr(user, "display_name", str(user))
    parts = [p for p in name.split() if p]
    return "".join(p[0] for p in parts[:2]).upper() or "?"
