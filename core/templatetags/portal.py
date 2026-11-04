from decimal import Decimal

from django import template
from django.utils.html import format_html

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


EXIT_WORDS = {"resigned": "Resigned", "retired": "Retired", "terminated": "Exited", "transferred": "Transferred"}


@register.simple_tag
def people_chip(candidate):
    """'Staff', 'Retired 2024', 'Hired': where a person in the talent database stands with IEFCL."""
    from candidates.people import staff_record

    staff = staff_record(candidate)
    if staff and staff.status == "active":
        return format_html('<span class="chip success who-chip" title="Current staff, {}">Staff</span>', staff.staff_id)
    if staff:
        year = f" {staff.exit_date:%Y}" if staff.exit_date else ""
        return format_html('<span class="chip neutral who-chip" title="Former staff, {}">{}{}</span>', staff.staff_id,
                           EXIT_WORDS.get(staff.status, "Left"), year)
    if getattr(candidate, "is_hired", False):
        return format_html('<span class="chip success-outline who-chip" title="Hired through recruitment; '
                           'not yet joined to a staff record">Hired</span>')
    return ""
