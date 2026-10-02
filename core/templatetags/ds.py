"""Design-system template tags: icons, score ring, stage rail, chips, avatars, KPI tiles."""

from __future__ import annotations

import logging
import math
import re
import uuid
from decimal import Decimal
from functools import lru_cache
from pathlib import Path

from django import template
from django.conf import settings
from django.templatetags.static import static
from django.utils import timezone
from django.utils.html import escape, format_html
from django.utils.safestring import mark_safe

register = template.Library()
log = logging.getLogger(__name__)

ICON_DIR = Path(settings.BASE_DIR) / "static" / "vendor" / "lucide" / "icons"
SVG_BODY = re.compile(r"<svg[^>]*>(.*)</svg>", re.S)


# --------------------------------------------------------------------- icons
@lru_cache(maxsize=None)
def icon_body(name: str) -> str:
    """Inner markup of a vendored Lucide icon (raises FileNotFoundError if missing)."""
    path = ICON_DIR / f"{name}.svg"
    match = SVG_BODY.search(path.read_text())
    return re.sub(r"\s+", " ", match.group(1)).strip()


@register.simple_tag
def icon(name, cls="", label=""):
    """{% icon "calendar-days" "ico-16" label="Interviews" %} — inline Lucide SVG (decorative unless labelled)."""
    try:
        body = icon_body(name)
    except FileNotFoundError:
        if settings.DEBUG:
            raise template.TemplateSyntaxError(f"Icon '{name}' is not vendored in static/vendor/lucide/icons/")
        log.warning("Missing icon %s", name)
        return ""
    a11y = format_html(' role="img" aria-label="{}"', label) if label else ' aria-hidden="true"'
    return mark_safe(
        f'<svg class="ico {escape(cls)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
        f'stroke-linecap="round" stroke-linejoin="round" focusable="false"{a11y}>{body}</svg>'
    )


# ---------------------------------------------------------------- score ring
def _number(value):
    if value is None or value == "":
        return None
    try:
        return float(value if not isinstance(value, Decimal) else float(value))
    except (TypeError, ValueError):
        return None


def _fmt(value: float) -> str:
    return f"{value:.0f}" if float(value).is_integer() else f"{value:.1f}"


@register.simple_tag
def score_ring(value, size=72, gold=False, label="", animate=True):
    """Circular gauge, blue→sky stroke (gold for top matches), 800-weight number in the centre."""
    size = int(size)
    number = _number(value)
    stroke = 4 if size < 48 else 6 if size < 80 else 8 if size < 112 else 10
    radius = (size - stroke) / 2
    circumference = 2 * math.pi * radius
    pct = max(0.0, min(100.0, number or 0.0))
    offset = circumference * (1 - pct / 100)
    gid = f"rg{uuid.uuid4().hex[:8]}"
    stops = ('<stop offset="0" class="ring-g1"/><stop offset="1" class="ring-g2"/>' if gold
             else '<stop offset="0" class="ring-a"/><stop offset="1" class="ring-b"/>')
    shown = _fmt(number) if number is not None else "–"
    font = max(11, round(size * (0.28 if size >= 64 else 0.3)))
    count = f' data-count-to="{shown}"' if animate and number is not None else ""
    caption = f"<span>{escape(label)}</span>" if label and size >= 72 else ""
    aria = f"{label or 'Score'} {shown} out of 100" if number is not None else f"{label or 'Score'} not available"
    return mark_safe(
        f'<span class="ring{" is-gold" if gold else ""}"{" data-animate" if animate else ""} role="img" aria-label="{escape(aria)}" '
        f'style="width:{size}px;height:{size}px">'
        f'<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}" aria-hidden="true">'
        f'<defs><linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="1">{stops}</linearGradient></defs>'
        f'<circle class="track" cx="{size / 2}" cy="{size / 2}" r="{radius:.2f}" fill="none" stroke-width="{stroke}"/>'
        f'<circle class="arc" cx="{size / 2}" cy="{size / 2}" r="{radius:.2f}" fill="none" stroke="url(#{gid})" stroke-width="{stroke}" '
        f'stroke-linecap="round" stroke-dasharray="{circumference:.2f}" stroke-dashoffset="{offset:.2f}"/></svg>'
        f'<span class="val" aria-hidden="true"><span><b style="font-size:{font}px"{count}>{shown}</b>{caption}</span></span></span>'
    )


# ---------------------------------------------------------------- stage rail
STAGE_SHORT = {
    "applied": "Applied", "shortlisted": "Shortlisted", "interview": "Interviews", "decision": "Decision",
    "documents": "Documents", "offer": "Offer", "medical": "Medicals", "onboarding": "Onboarding", "hired": "Hired",
}


@register.inclusion_tag("ds/components/stage_rail.html")
def stage_rail(application=None, stage=None, status="active", stages=None):
    """Hiring-stage progress rail. Pass an Application, or stage/status strings for previews."""
    if application is not None:
        stage, status = application.stage, application.status
        stages = application.pipeline_stages()
    stages = list(stages or STAGE_SHORT)
    current = stages.index(stage) if stage in stages else 0
    halted = status in ("rejected", "withdrawn")
    hired = stage == "hired" or status == "hired"
    items = []
    for i, key in enumerate(stages):
        if hired:
            state = "gold" if key == "hired" else "done"
        elif i < current:
            state = "done"
        elif i == current:
            state = "halted" if halted else "now"
        else:
            state = "todo"
        items.append({"key": key, "label": STAGE_SHORT.get(key, key.title()), "state": state})
    label = STAGE_SHORT.get(stage, "")
    return {
        "items": items, "position": current + 1, "total": len(stages), "label": label, "halted": halted,
        "status_label": {"rejected": "Rejected", "withdrawn": "Withdrawn"}.get(status, ""),
    }


# --------------------------------------------------------------- status chip
CHIP_TONES = {
    "received": ("neutral", "Received"),
    "screening": ("", "Screening"),
    "shortlisted": ("brand", "Shortlisted"),
    "interview": ("solid", "Interview"),
    "decision": ("", "Decision"),
    "documents": ("", "Documents"),
    "on_hold": ("warning", "On hold"),
    "rejected": ("danger", "Rejected"),
    "withdrawn": ("neutral", "Withdrawn"),
    "offer": ("outline", "Offer"),
    "medical": ("success-outline", "Medicals"),
    "onboarding": ("success", "Onboarding"),
    "hired": ("gold", "Hired"),
}
STAGE_CHIP = {"applied": "received"}


@register.simple_tag
def status_chip(application=None, stage=None, status=None, key=None):
    """One palette for every status. {% status_chip app %} or {% status_chip key="on_hold" %}."""
    if application is not None:
        stage, status = application.stage, application.status
    if key is None:
        key = status if status in ("on_hold", "rejected", "withdrawn", "hired") else STAGE_CHIP.get(stage, stage)
    tone, label = CHIP_TONES.get(key, ("neutral", str(key or "").replace("_", " ").capitalize()))
    return format_html('<span class="chip {}">{}</span>', tone, label)


# -------------------------------------------------------------------- avatars
def _name(who) -> str:
    for attr in ("display_name", "full_name"):
        value = getattr(who, attr, None)
        if value:
            return str(value)
    return str(who or "")


def initials_of(name: str) -> str:
    parts = [p for p in re.split(r"[\s.]+", name) if p and p[0].isalnum()]
    return "".join(p[0] for p in parts[:2]).upper() or "?"


@register.simple_tag
def avatar(who, size="md", photo=None):
    name = _name(who)
    inner = format_html('<img src="{}" alt="" loading="lazy">', photo) if photo else initials_of(name)
    return format_html('<span class="avatar {}" title="{}" aria-label="{}" role="img">{}</span>', size, name, name, inner)


@register.simple_tag
def avatar_stack(people, max=3, size="sm"):
    people = list(people or [])
    shown = "".join(str(avatar(p, size)) for p in people[:int(max)])
    extra = len(people) - int(max)
    more = f'<span class="more">+{extra}</span>' if extra > 0 else ""
    names = ", ".join(_name(p) for p in people)
    return mark_safe(f'<span class="avatars" title="{escape(names)}">{shown}{more}</span>')


# ------------------------------------------------------------------ sparkline
@register.simple_tag
def sparkline(values, width=120, height=32):
    nums = [_number(v) or 0.0 for v in (values or [])]
    if len(nums) < 2:
        return ""
    lo, hi = min(nums), max(nums)
    span = (hi - lo) or 1.0
    step = width / (len(nums) - 1)
    points = [(i * step, height - 3 - (v - lo) / span * (height - 6)) for i, v in enumerate(nums)]
    line = " ".join(f"{'M' if i == 0 else 'L'}{x:.1f} {y:.1f}" for i, (x, y) in enumerate(points))
    area = f"{line} L{width} {height} L0 {height} Z"
    return mark_safe(
        f'<svg class="spark" viewBox="0 0 {width} {height}" preserveAspectRatio="none" aria-hidden="true">'
        f'<path class="ar" d="{area}" opacity=".7"/><path class="ln" d="{line}"/></svg>'
    )


# -------------------------------------------------------------- composites
@register.inclusion_tag("ds/components/kpi.html")
def kpi(label, value, icon_name="", delta="", tone="", spark=None, href=None, tile=""):
    number = _number(value)
    return {"label": label, "value": value, "count_to": _fmt(number) if number is not None else None,
            "icon": icon_name, "delta": delta, "tone": tone, "spark": spark, "href": href, "tile": tile}


@register.inclusion_tag("ds/components/empty_state.html")
def empty_state(title, body="", action_url=None, action_label=None, object_name="Lab beaker of polymer pellets", action_icon="plus"):
    return {"title": title, "body": body, "action_url": action_url, "action_label": action_label,
            "object_name": object_name, "action_icon": action_icon}


@register.simple_tag
def ph3d(name, width, height, cls=""):
    """Labelled grey placeholder for a 3D render that has not been supplied yet (never fake 3D)."""
    return format_html(
        '<div class="ph3d {}" style="width:{}px;height:{}px" role="img" aria-label="Placeholder for 3D render: {}">'
        '<span>3D · {}<small>{}×{} · render pending</small></span></div>',
        cls, width, height, name, name, width, height,
    )


@register.simple_tag
def logo(height=22):
    """The Indorama logo exactly as supplied, on its white plate."""
    return format_html('<span class="logo-plate"><img src="{}" alt="Indorama" height="{}" width="{}"></span>',
                       static("img/brand/indorama-logo.jpg"), height, round(int(height) * 358 / 73))


CALM_NOTES = {
    "staff": [
        "One task at a time. Good hiring is never rushed.",
        "A quick reply today saves someone a long wait.",
        "Clear notes now make fair decisions later.",
        "Every name here is someone's next chapter.",
        "Small steps, done well, make a great hire.",
        "Thank you for giving each candidate a fair look.",
        "Nothing here needs to be perfect, only fair and clear.",
    ],
    "candidate": [
        "Take your time. Every application is read by a person.",
        "Tell us what you have done, in your own words.",
        "No need to be perfect. Be clear and be yourself.",
        "We will keep you updated at every step.",
        "Your details are only used for recruitment.",
    ],
}


@register.simple_tag
def calm_note(audience="staff"):
    """A quiet line under the page title that changes once a day."""
    notes = CALM_NOTES.get(audience, CALM_NOTES["staff"])
    return notes[timezone.localdate().toordinal() % len(notes)]


# ----------------------------------------------------------------- navigation
def _nav(user):
    """Role-aware destinations, shared by the rail and the command palette."""
    from django.urls import reverse

    hiring = user.is_hr or user.is_department_user or user.is_management
    items = [
        {"label": "My tasks", "long": "My tasks", "url": reverse("core:dashboard"), "icon": "list-checks", "exact": True},
    ]
    if hiring:
        items += [
            {"label": "Roles", "long": "Requisitions", "url": reverse("requisitions:list"), "icon": "clipboard-list"},
            {"label": "Pipeline", "long": "Candidate pipeline", "url": reverse("pipeline:applications"), "icon": "square-kanban"},
        ]
    if user.is_hr:
        items += [
            {"label": "Talent", "long": "Talent database", "url": reverse("candidates:list"), "icon": "users",
             "exclude": [reverse("candidates:intake"), reverse("candidates:refer")]},
            {"label": "CV intake", "long": "CV intake", "url": reverse("candidates:intake"), "icon": "cloud-upload", "extra": True},
        ]
    items.append({"label": "Interviews", "long": "Interviews", "url": reverse("pipeline:interviews"), "icon": "calendar-days"})
    if user.is_management or user.is_hr:
        items.append({"label": "Offers", "long": "Offer reviews", "url": reverse("pipeline:offer_reviews"), "icon": "banknote"})
    if user.is_onboarding:
        items.append({"label": "Onboard", "long": "Onboarding", "url": reverse("pipeline:onboarding_list"), "icon": "id-card"})
    items.append({"sep": True})
    if hiring:
        items.append({"label": "Retiring", "long": "Retirements & exits", "url": reverse("core:employees"), "icon": "hourglass", "extra": True})
    items.append({"label": "Refer", "long": "Refer a candidate", "url": reverse("candidates:refer"), "icon": "user-plus", "extra": True})
    items.append({"label": "Careers", "long": "Careers page", "url": reverse("careers:jobs"), "icon": "globe", "extra": True, "external": True})
    if user.is_superuser or getattr(user, "role", "") == "hr_admin":
        items.append({"label": "Admin", "long": "Master data & users", "url": "/admin/", "icon": "settings", "extra": True, "external": True})
    return items


@register.simple_tag(takes_context=True)
def nav_items(context):
    request = context["request"]
    path = request.path
    items = _nav(request.user)
    for item in items:
        if item.get("sep") or item.get("external"):
            continue
        url = item["url"]
        hit = path == url if item.get("exact") else path.startswith(url)
        item["current"] = hit and not any(path.startswith(x) for x in item.get("exclude", []))
    return items
