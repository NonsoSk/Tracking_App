"""
WCAG 2.x contrast helpers and the design-token pairs that must pass AA.

The token values are read straight from static/ds/ds.css, so the style guide
and the test suite always check what is actually shipped.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

from django.conf import settings

CSS_PATH = Path(settings.BASE_DIR) / "static" / "ds" / "ds.css"

# (foreground token, background token, minimum ratio, what it is used for)
# Text must reach 4.5:1 (WCAG AA). Muted --text-4 is only used for disabled or
# decorative marks and is deliberately not listed.
TEXT_PAIRS = [
    ("text", "canvas", 4.5, "Body text on the page"),
    ("text", "surface", 4.5, "Body text on cards"),
    ("text", "raised", 4.5, "Body text on sheets"),
    ("text", "overlay", 4.5, "Text in dialogs, menus and toasts"),
    ("text-2", "surface", 4.5, "Secondary text on cards"),
    ("text-2", "canvas", 4.5, "Secondary text on the page"),
    ("text-2", "sunken", 4.5, "Neutral chips and tags"),
    ("text-3", "surface", 4.5, "Muted text on cards"),
    ("text-3", "canvas", 4.5, "Muted text on the page"),
    ("text-3", "sunken", 4.5, "Muted text in trays"),
    ("text-3", "raised", 4.5, "Rail labels and sheet captions"),
    ("text-3", "overlay", 4.5, "Muted text in dialogs and toasts"),
    ("link", "surface", 4.5, "Links on cards"),
    ("link", "canvas", 4.5, "Links on the page"),
    ("eyebrow", "canvas", 4.5, "Eyebrow captions on the page"),
    ("eyebrow", "raised", 4.5, "Sheet titles"),
    ("on-primary", "primary", 4.5, "Primary button label"),
    ("on-primary", "primary-hover", 4.5, "Primary button label (hover)"),
    ("on-tint", "tint", 4.5, "Tint button, active filters"),
    ("on-tint", "tint-2", 4.5, "Brand chip"),
    ("info-ink", "info-bg", 4.5, "Info chip and banner"),
    ("success-ink", "success-bg", 4.5, "Success chip and banner"),
    ("warning-ink", "warning-bg", 4.5, "Warning chip, ageing task"),
    ("danger-ink", "danger-bg", 4.5, "Danger chip and banner"),
    ("success-ink", "raised", 4.5, "Positive KPI change"),
    ("warning-ink", "raised", 4.5, "KPI change needing attention"),
    ("danger-ink", "surface", 4.5, "Form error message"),
    ("gold-ink", "gold-bg", 4.5, "Gold chip (success moments)"),
    ("gold-ink", "surface", 4.5, "Top-match score, Confirm pill"),
    ("accent-ink", "surface", 4.5, "Indorama red text (urgent)"),
    ("accent-ink", "accent-bg", 4.5, "Urgent chip, overdue task"),
    ("on-danger", "danger-ink", 4.5, "Destructive button label"),
    ("on-hero", "hero-base", 4.5, "Text on the hero band"),
    ("on-avatar", "mix(avatar-a,avatar-b,.75)", 4.5, "Avatar initials (lightest point under the letters)"),
]

# Borders, focus rings and state markers must reach 3:1 against what they sit on (WCAG 1.4.11).
UI_PAIRS = [
    ("field-line", "surface", 3.0, "Input, select and checkbox borders"),
    ("brand-500", "surface", 3.0, "Keyboard focus ring"),
    ("primary", "surface", 3.0, "Checked boxes, selected chips"),
    ("primary", "sunken", 3.0, "Score bars and completed stages in a tray"),
    ("accent", "sunken", 3.0, "Current-stage marker"),
    ("accent", "raised", 3.0, "Urgent task edge"),
]

HEX_RE = re.compile(r"#([0-9a-fA-F]{6})\b")
RGBA_RE = re.compile(r"rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*/\s*([\d.]+)\s*\)")


def _channel(c: float) -> float:
    c /= 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def luminance(rgb) -> float:
    r, g, b = rgb
    return 0.2126 * _channel(r) + 0.7152 * _channel(g) + 0.0722 * _channel(b)


def ratio(fg, bg) -> float:
    a, b = sorted((luminance(fg), luminance(bg)), reverse=True)
    return round((a + 0.05) / (b + 0.05), 2)


def hex_to_rgb(value: str):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def blend(top, alpha: float, bottom):
    return tuple(round(t * alpha + b * (1 - alpha)) for t, b in zip(top, bottom))


def _block(css: str, selector: str) -> str:
    start = css.index(selector)
    open_ = css.index("{", start)
    depth, i = 0, open_
    while True:
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
            if depth == 0:
                return css[open_ + 1:i]
        i += 1


def _parse_vars(block: str) -> dict[str, str]:
    return {m.group(1): m.group(2).strip() for m in re.finditer(r"--([\w-]+)\s*:\s*([^;]+);", block)}


@lru_cache(maxsize=1)
def themes() -> dict[str, dict[str, str]]:
    css = CSS_PATH.read_text(encoding="utf-8")
    light = _parse_vars(_block(css, "/* @tokens light */"))
    dark = {**light, **_parse_vars(_block(css, "/* @tokens dark */"))}
    return {"light": light, "dark": dark}


def resolve(name: str, values: dict[str, str], depth: int = 0):
    """Resolve a token to an RGB triple; translucent colours are composited on the surface.

    ``mix(a,b,w)`` resolves to token a blended over token b with weight w (used for gradients).
    """
    mix = re.fullmatch(r"mix\(([\w-]+),([\w-]+),([\d.]+)\)", name)
    if mix:
        a, b, weight = mix.groups()
        return blend(resolve(a, values, depth + 1), float(weight), resolve(b, values, depth + 1))
    raw = values[name]
    ref = re.fullmatch(r"var\(--([\w-]+)\)", raw)
    if ref and depth < 8:
        return resolve(ref.group(1), values, depth + 1)
    hex_match = HEX_RE.search(raw)
    if hex_match:
        return hex_to_rgb(hex_match.group(1))
    rgba = RGBA_RE.search(raw)
    if rgba:
        r, g, b, a = rgba.groups()
        return blend((int(r), int(g), int(b)), float(a), resolve("surface", values, depth + 1))
    raise ValueError(f"Cannot resolve --{name}: {raw}")


def report() -> list[dict]:
    rows = []
    for theme, values in themes().items():
        for kind, pairs in (("text", TEXT_PAIRS), ("ui", UI_PAIRS)):
            for fg, bg, minimum, usage in pairs:
                value = ratio(resolve(fg, values), resolve(bg, values))
                rows.append({"theme": theme, "kind": kind, "fg": fg, "bg": bg, "ratio": value, "min": minimum,
                             "ok": value >= minimum, "usage": usage,
                             "fg_hex": "#%02X%02X%02X" % resolve(fg, values),
                             "bg_hex": "#%02X%02X%02X" % resolve(bg, values)})
    return rows
