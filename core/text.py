"""String normalisation and fuzzy term matching used by CV parsing and matching."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from functools import lru_cache

_PUNCT = re.compile(r"[^a-z0-9+#./ ]+")
_SPACES = re.compile(r"\s+")
STOPWORDS = {"and", "of", "in", "the", "&", "for", "with", "to", "a", "an"}


def normalize(value: str) -> str:
    value = (value or "").lower().replace("&", " and ")
    value = _PUNCT.sub(" ", value)
    return _SPACES.sub(" ", value).strip()


def tokens(value: str) -> set[str]:
    return {t for t in normalize(value).replace("/", " ").split() if t not in STOPWORDS}


def clean_list(values) -> list[str]:
    """Trim, drop blanks and de-duplicate (case-insensitive) while keeping order."""
    seen = set()
    result = []
    for value in values or []:
        value = re.sub(r"\s+", " ", str(value)).strip(" ,;•-\t")
        key = value.lower()
        if value and key not in seen:
            seen.add(key)
            result.append(value)
    return result


def split_list(value: str) -> list[str]:
    """Split free text typed by users (commas, semicolons, new lines, bullets)."""
    return clean_list(re.split(r"[,;\n\r•|]+", value or ""))


@lru_cache(maxsize=1)
def _alias_index() -> dict[str, set[str]]:
    from requisitions.knowledge_base import ALIASES

    index: dict[str, set[str]] = {}
    for canonical, alts in ALIASES.items():
        group = {normalize(canonical), *(normalize(a) for a in alts)}
        for term in group:
            index.setdefault(term, set()).update(group)
    return index


def db_aliases() -> dict[str, set[str]]:
    """Aliases HR added from the admin (SkillTag.aliases)."""
    from requisitions.models import SkillTag

    index: dict[str, set[str]] = {}
    for name, aliases in SkillTag.objects.exclude(aliases=[]).values_list("name", "aliases"):
        group = {normalize(name), *(normalize(a) for a in aliases or [])}
        for term in group:
            index.setdefault(term, set()).update(group)
    return index


def variants(term: str, extra_aliases: dict[str, set[str]] | None = None) -> set[str]:
    norm = normalize(term)
    result = {norm}
    result |= _alias_index().get(norm, set())
    if extra_aliases:
        result |= extra_aliases.get(norm, set())
    # "Siemens S7 / TIA Portal" style entries: each side is a variant too.
    if "/" in term:
        result |= {normalize(part) for part in term.split("/") if len(part.split()) >= 2}
    return {v for v in result if v}


def contains_phrase(haystack_norm: str, phrase_norm: str) -> bool:
    if not phrase_norm:
        return False
    return re.search(rf"(?<![a-z0-9]){re.escape(phrase_norm)}(?![a-z0-9])", haystack_norm) is not None


def term_similarity(a: str, b: str) -> float:
    """1.0 for same term / alias, partial credit for close spellings."""
    na, nb = normalize(a), normalize(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    va, vb = variants(a), variants(b)
    if va & vb:
        return 1.0
    # One term fully contained in the other ("sap" vs "sap pm" is not enough;
    # require the shorter one to have 4+ characters).
    short, long_ = sorted((na, nb), key=len)
    if len(short) >= 4 and contains_phrase(long_, short):
        return 0.9
    ta, tb = tokens(a), tokens(b)
    if ta and tb:
        jaccard = len(ta & tb) / len(ta | tb)
        if jaccard >= 0.6:
            return 0.8
    ratio = SequenceMatcher(None, na, nb).ratio()
    return ratio if ratio >= 0.88 else 0.0


def merge_unique(existing: list[str], new: list[str], threshold: float = 0.9) -> list[str]:
    """Append items from ``new`` that are not near-duplicates of what is already there."""
    result = clean_list(existing)
    for item in clean_list(new):
        if not any(term_similarity(item, current) >= threshold for current in result):
            result.append(item)
    return result


def best_match(term: str, candidates: list[str], threshold: float = 0.8) -> tuple[str | None, float]:
    best, best_score = None, 0.0
    for c in candidates:
        score = term_similarity(term, c)
        if score > best_score:
            best, best_score = c, score
            if score == 1.0:
                break
    return (best, best_score) if best_score >= threshold else (None, best_score)


def find_in_text(term: str, text_norm: str, extra_aliases=None) -> bool:
    """True when the term (or an alias) appears as a phrase in normalised text."""
    return any(len(v) >= 2 and contains_phrase(text_norm, v) for v in variants(term, extra_aliases))
