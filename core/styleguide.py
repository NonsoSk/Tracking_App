"""Data for the living style guide at /styleguide: tokens per theme, straight from ds.css."""

from __future__ import annotations

from . import contrast

TOKEN_GROUPS = [
    ("Brand", ["brand-50", "brand-100", "brand-200", "brand-500", "brand-700", "brand-800", "brand-900"]),
    ("Signature", ["sky", "red", "gold", "gold-light"]),
    ("Ink (raw palette)", ["ink-900", "ink-700", "ink-500", "ink-400"]),
    ("Surfaces", ["canvas", "surface", "raised", "raised-2", "overlay", "sunken", "line", "line-strong", "field-line", "grid"]),
    ("Depth edges", ["edge-1", "edge-2", "primary-top", "primary-edge", "danger-edge"]),
    ("Text", ["text", "text-2", "text-3", "text-4", "link", "eyebrow"]),
    ("Actions", ["primary", "primary-hover", "on-primary", "tint", "tint-2", "tint-line", "on-tint"]),
    ("Accent (once per screen)", ["accent", "accent-ink", "accent-bg"]),
    ("Success", ["success", "success-ink", "success-bg", "success-line"]),
    ("Warning", ["warning", "warning-ink", "warning-bg", "warning-line"]),
    ("Danger", ["danger", "danger-ink", "danger-bg", "danger-line", "on-danger"]),
    ("Info", ["info", "info-ink", "info-bg", "info-line"]),
    ("Gold (success moments)", ["gold-ink", "gold-bg", "gold-line"]),
    ("Hero and avatars", ["hero-base", "on-hero", "avatar-a", "avatar-b", "on-avatar"]),
]

SPACING = [4, 8, 12, 16, 20, 24, 32, 40, 56, 72]
RADII = [("r-sm", "10px", "Inputs, chips"), ("r-md", "16px", "Cards"), ("r-lg", "22px", "Sheets, hero, modals"), ("r-full", "999px", "Avatars, pills")]
ELEVATION = [("e0", "Flat with a hairline"), ("e1", "Small parts: chips, plates"), ("e2", "Paper, hero"), ("e3", "Popover, modal"),
             ("slab-1", "Card: 2px edge"), ("slab-2", "Sheet, rail, hover: 3px edge")]
MOTION = [("t-hover", "120ms", "Hover"), ("t-press", "180ms", "Press and lift"), ("t-enter", "240ms", "Enter"), ("t-modal", "320ms", "Modals and drawers")]
TYPE_SCALE = [
    ("display", "Display", "40 / 32", "Build what moves Nigeria forward"),
    ("h1", "H1", "30 / 26", "Process Engineer"),
    ("h2", "H2", "22 / 20", "Needs you today"),
    ("h3", "H3", "18", "Upcoming interviews"),
    ("body", "Body", "16", "Chemical engineer with 6 years in ammonia and urea plant operations."),
    ("small", "Small", "14", "Applied 31 Aug 2026 · Online application"),
    ("caption", "Caption", "12.5", "Shown under fields and in table footers"),
]
OBJECTS_3D = [
    ("White HDPE hard hat with Indorama decal", "Careers hero", 280, 200),
    ("Polycarbonate safety goggles", "Sign-in", 260, 180),
    ("Staff ID badge on a navy lanyard", "Onboarding", 200, 240),
    ("Leather portfolio, offer letter, gold pen", "Offer accepted", 280, 200),
    ("Lab beaker of polymer pellets", "Empty states, reports", 200, 150),
    ("Brushed steel valve wheel", "Requisitions", 220, 220),
    ("Tablet with an interview calendar", "Interviews", 280, 200),
]
SECTIONS = [
    ("colour", "Colour", "Every colour token as it resolves in each theme. Swatches paint from the live CSS variable."),
    ("contrast", "Contrast", "Every foreground and background pair the interface uses, measured from ds.css (WCAG 2.x)."),
    ("type", "Typography", "Nunito Sans, vendored. Body 400/600, headings 800, tabular numbers for data."),
    ("space", "Space, shape, depth", "A 4/8 grid, three radii and four cool-tinted elevation levels. Higher is lighter in dark mode."),
    ("motion", "Motion", "120/180/240/320 ms on one easing curve. Everything becomes a simple fade with reduced motion."),
    ("icons", "Icons", "Lucide only, vendored locally: 1.75px stroke, 20px default."),
    ("brand", "Logo, hero, 3D", "The logo exactly as supplied, the hero band and labelled placeholders for the seven 3D renders."),
    ("buttons", "Buttons", "Primary, secondary, ghost, tint and danger in 36/44/52. On touch screens every target is at least 44px."),
    ("forms", "Forms", "48px fields, radius 10, a hairline that turns brand-500 with a halo on focus."),
    ("chips", "Chips and avatars", "One status palette for every stage, plus tags, sources and avatars."),
    ("navigation", "Navigation", "Floating rail, tabs with a sliding indicator, segmented controls and steppers."),
    ("data", "Data display", "Score rings, stage rail, KPI tiles, task cards, tables, the board and the calendar."),
    ("feedback", "Feedback", "Banners with the exact fix, toasts with undo, tooltips, skeletons and empty states."),
    ("overlays", "Overlays", "Modal, drawer, popover and the command palette (Ctrl/Cmd+K)."),
    ("cv", "CV viewer", "Page thumbnails, the paper preview and extracted fields. Low-confidence fields ask for a confirm."),
]


def _hex(name, values):
    try:
        return "#%02X%02X%02X" % contrast.resolve(name, values)
    except (KeyError, ValueError):
        return values.get(name, "")


def context() -> dict:
    from core.templatetags.ds import ICON_DIR

    themes = []
    rows = contrast.report()
    for name, values in contrast.themes().items():
        groups = [{"title": title, "tokens": [{"name": t, "hex": _hex(t, values)} for t in names]} for title, names in TOKEN_GROUPS]
        theme_rows = [r for r in rows if r["theme"] == name]
        themes.append({"name": name, "label": name.title(), "groups": groups, "contrast": theme_rows,
                       "passed": sum(r["ok"] for r in theme_rows), "total": len(theme_rows)})
    return {
        "themes": themes, "sections": SECTIONS, "spacing": SPACING, "radii": RADII, "elevation": ELEVATION,
        "motion": MOTION, "type_scale": TYPE_SCALE, "objects_3d": OBJECTS_3D,
        "icons": sorted(p.stem for p in ICON_DIR.glob("*.svg")),
        "contrast_ok": all(r["ok"] for r in rows), "contrast_total": len(rows),
        "chip_keys": ["received", "screening", "shortlisted", "interview", "on_hold", "rejected", "offer", "medical",
                      "onboarding", "hired", "decision", "documents", "withdrawn"],
        "spark_a": [3, 4, 4, 6, 5, 7, 8], "spark_b": [12, 14, 13, 17, 19, 18, 22], "spark_c": [2, 5, 3, 4, 6, 4, 6],
        "spark_d": [1, 2, 2, 1, 3, 2, 4],
        "panel": ["Adaeze Nwosu", "Tunde Bakare", "Grace Etim", "Musa Ibrahim", "Ifeoma Obi"],
    }
