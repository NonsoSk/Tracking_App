"""Every requirement in a job description, judged against the jobs in a candidate's CV.

The JD is read as a whole: its title, what the job involves (duties) and what it asks of the candidate
(requirements). Each experience requirement is broken into the kind of work it asks for (sales, accounting, HR…) and
the kind of business (industrial, chemicals, FMCG, banking…), see pipeline/concepts.py, and then judged job by job:

- Met: one job shows both, worded any way: "Sales Executive, Notore Chemical Industries: sold urea to blenders" meets
  "experience in industrial sales" (chemicals and fertilizer are industrial), and so does production sales.
- Partly: the right work in another kind of business (sales in a supermarket for industrial sales), related work in
  the right business (marketing at a chemicals company), or a closely related business (cement for fertilizer).
- Not met: nothing in the CV shows it.
The years the JD asks for are counted from the jobs that meet it (relevant years), not the whole career.

The JD's main experience requirements, and the job title itself ("Industrial Sales Officer" asks for industrial
sales), are key requirements for an experienced hire: when one is only partly met the score is capped at 69 (it
cannot be a strong or excellent match), and at 54 when it is not met at all. The hiring manager still decides.

Duties are compared with what the candidate did in each job by meaning (pipeline/concepts.py), not by exact words.
Soft skills ("good communication") are left to the interview and personal conditions (driving licence, travel) to
confirm with the candidate: a CV cannot show them reliably, so they never count for or against anyone.

When Claude is switched on (ANTHROPIC_API_KEY), its assessment of each requirement replaces these rules' verdicts:
see pipeline/ai_assess.py.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from functools import lru_cache

from candidates.experience import Job, blocks_in, job_from_history, jobs_in, length_text
from core.text import contains_phrase, normalize

from .concepts import (CONCEPT_GROUPS, FUNCTIONS, SETTINGS, concepts_of, function_credit, functions_in_job, functions_in_requirement,
                       overlap, setting_credit, settings_in, settings_named)

CRITERIA_VERSION = 1
MET, PARTLY = 0.85, 0.35          # the credit a requirement needs to count as met, or partly met
CAP_PARTLY, CAP_NOT_MET = 69, 54  # the highest score when a key experience requirement is partly met / not met
MAX_DUTIES, MAX_REQUIREMENTS = 12, 10
WEIGHT = {"core": 3.0, "experience": 2.0, "knowledge": 1.0, "duties": 3.0}

BULLET = re.compile(r"^\s*(?:[•*\-–▪●◦■□➢➤>·o]|\(?\d{1,2}[.)]|\(?[a-hivx]{1,4}[.)])\s+", re.I)
FIELD_LINE = re.compile(r"^\s*(?:job title|position|role|department|division|unit|location|reports? to|reporting to|"
                        r"grade|job code|job grade|level|salary|closing date|deadline|employment type|"
                        r"type of employment)\s*[:\-–]", re.I)
EXPERIENCE_RE = re.compile(r"\bexperienc\w*|track record|background in|exposure to|proven ability|history of|"
                           r"worked (?:in|with|for)|hands[- ]on|\d+\s*\+?\s*(?:-\s*\d+\s*)?years?\b", re.I)
YEARS_RE = re.compile(r"(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*)?years?", re.I)
QUALIFICATION_RE = re.compile(
    r"\b(?:b\.?\s?sc|b\.?\s?eng|b\.?\s?tech|b\.?\s?a|hnd|ond|m\.?\s?sc|mba|ph\.?\s?d|degree|diploma|graduate of|"
    r"second class|2\s*[:.]\s*[12]|nysc|certificat\w+|certified|professional (?:qualifications?|membership|body|"
    r"bodies)|member(?:ship)? of|ican|acca|cima|citn|cipm|cips|nim|apcon|nipr|pmp|nebosh|iosh|chartered|"
    r"bachelor\w*|masters?)\b", re.I)
SOFT_RE = re.compile(
    r"communication|interpersonal|team ?player|teamwork|ability to work|under pressure|minimal supervision|"
    r"self[- ]?(?:motivated|starter|driven)|attention to detail|detail[- ]oriented|integrity|honest|leadership "
    r"(?:skills|qualities)|problem[- ]solving|analytical (?:skills|thinking|mind)|organi[sz]ational skills|"
    r"time management|multi-?task|proactive|results?[- ](?:oriented|driven)|customer[- ]focused|negotiation skills|"
    r"presentation skills|writing skills|written and (?:verbal|oral)|verbal and written|initiative|flexib|adaptab|"
    r"emotional intelligence|good (?:judgement|judgment)|confident|energetic|passion|willing(?:ness)? to learn|"
    r"creative|innovative|critical thinking|decision[- ]making|people skills|persuasive|resilien|"
    r"work independently|ethic", re.I)
PERSONAL_RE = re.compile(
    r"licen[cs]e|driv(?:er's|ers|ing)|willing(?:ness)? to (?:travel|relocate|work)|\btravel|relocat|\bage\b|"
    r"years? old|not (?:older|more) than|resident|reside|live in|living in|based in|gender|\bmale\b|\bfemale\b|"
    r"shifts?\b|weekends|public holidays|own a car|available to start|immediate(?:ly)? availab|notice period", re.I)
# Words in a requirement that say nothing about what is wanted ("minimum of 5 years' proven experience in…").
FILLER = re.compile(
    r"\b(?:minimum|at least|min|of|over|about|around|more than|proven|demonstrable|demonstrated|solid|sound|good|"
    r"strong|excellent|extensive|considerable|relevant|working|hands[- ]on|practical|previous|prior|post[- ]"
    r"(?:nysc|qualification|graduation)|cognate|years?|yrs|experience[ds]?|track record|background|exposure|"
    r"knowledge|understanding|familiarity|in|with|of|a|an|the|and|or|preferably|ideally|including|such as|e\.g|"
    r"must|should|have|has|be|is|are|candidates?|applicants?|required|requirement|desirable|added advantage|"
    r"advantage|preferred|plus|ability|able|to|within|across|at|for|role|position|capacity|similar|related)\b",
    re.I)
SIMILAR_ROLE = re.compile(r"similar (?:role|position|capacity|function|job)|same (?:role|capacity|position)|"
                          r"relevant (?:work )?experience|related (?:field|role|area)|comparable role", re.I)
# "…, preferably in a petrochemical company": the part after it is a nice-to-have; the part before is required.
PREFERABLY_RE = re.compile(r"[,;(]?\s*\b(?:preferably|ideally|with preference for|preference (?:will be )?given to)\b",
                           re.I)
PREFERRED_RE = re.compile(r"desirable|added advantage|an advantage|nice[- ]to[- ]have|preferred|preferably|is a plus|"
                          r"would be a plus|will be an advantage|optional", re.I)


def _heading_kind(text: str) -> str | None:
    """What a heading line opens: 'duties', 'requirements', 'summary' or 'skip' (about the company, benefits…)."""
    s = text.strip().strip(":-–").strip()
    words = s.split()
    if not s or len(words) > 8 or s.endswith(".") or BULLET.match(text):
        return None
    if not (text.strip().endswith(":") or s.isupper()
            or sum(1 for w in words if w[:1].isupper() or w.lower() in {"and", "of", "&", "the", "to", "you"})
            >= 0.6 * len(words)):
        return None
    low = s.lower()
    if re.search(r"responsibilit|duties|accountabilit|what you(?:'ll| will) (?:do|be doing)|key result|scope of|"
                 r"tasks|the role$|role description|role profile", low):
        return "duties"
    if re.search(r"requirement|qualification|education|skill|competenc|experience|knowledge|specification|"
                 r"candidate profile|ideal candidate|looking for|who you are|what you(?:'ll)? (?:need|bring)|eligib|"
                 r"attributes", low):
        return "requirements"
    if re.search(r"about|company|who we are|benefit|what we offer|remuneration|compensation|salary|package|apply|"
                 r"application|deadline|closing|location|reports? to|reporting|equal opportunit|^note", low):
        return "skip"
    if re.search(r"summary|purpose|overview|objective|description|position|job title|^role", low):
        return "summary"
    return None


def _items(text: str):
    """(section, item) for every bullet or sentence of a JD, with the section it is under."""
    section = None
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        kind = _heading_kind(line)
        if kind:
            section = kind
            continue
        inline = re.match(r"^([A-Za-z][A-Za-z ,&/'()-]{2,45}):\s*(\S.*)$", line)
        if inline and _heading_kind(inline.group(1) + ":") and not FIELD_LINE.match(line):
            section = _heading_kind(inline.group(1) + ":")
            line = inline.group(2)
        if FIELD_LINE.match(line):
            continue
        line = BULLET.sub("", line).strip()
        parts = re.split(r"(?<=[.;])\s+(?=[A-Z])", line) if len(line) > 180 else [line]
        for part in parts:
            part = part.strip(" .;")
            if len(part) >= 8:
                yield section, part


@dataclass
class Criterion:
    id: str
    text: str
    kind: str                 # experience, knowledge, duty, interview, confirm
    origin: str               # requirements, duties, title
    subject: str = ""
    functions: tuple = ()
    settings: frozenset = frozenset()
    keywords: frozenset = frozenset()
    years: float | None = None
    preferred: bool = False
    core: bool = False


def _id(text: str) -> str:
    return hashlib.sha1(normalize(text).encode()).hexdigest()[:10]


def _subject(text: str) -> str:
    """'Minimum of 5 years' experience in industrial sales' → 'industrial sales'."""
    words = YEARS_RE.sub(" ", text)
    words = re.sub(r"['’]s?\b", " ", words)
    words = FILLER.sub(" ", words)
    words = re.sub(r"[^A-Za-z0-9&/ -]+", " ", words)
    return " ".join(words.split()).strip(" -/&")[:80]


def wanted_settings(text: str) -> frozenset:
    """The kinds of business a requirement asks for, the most specific only: "petrochemical sales" asks for
    chemicals, not any industrial business."""
    return settings_named(text)


def _keywords(subject: str, functions, settings) -> frozenset:
    """The ideas in a requirement beyond its kind of work and kind of business."""
    wanted = set(concepts_of(subject))
    wanted = {c for c in wanted if not c.startswith("setting:")}
    for key in functions:  # the function's own words are judged as the function
        for word in re.findall(r"[a-z]+", FUNCTIONS[key].label.lower()):
            wanted -= set(concepts_of(word))
    wanted -= set(concepts_of("sales selling sell marketing accounting accounts finance procurement purchasing hr "
                              "human resources recruitment administration production maintenance safety quality "
                              "logistics supply chain environment industry sector company business work"))
    for key in settings:
        wanted -= set(concepts_of(SETTINGS[key].label))
    return frozenset(wanted)


def _requirement(text: str, origin: str, kind: str, *, track: str, title_subject: str = "", wording: str = "",
                 preferred: bool | None = None, inherit: tuple = ()) -> Criterion | None:
    """One requirement. ``wording`` is the part of the line it is read from (the line itself by default)."""
    wording = wording or text
    years = None
    found = YEARS_RE.search(wording) if kind == "experience" else None
    if found:
        years = float(found.group(1))
    subject = title_subject if SIMILAR_ROLE.search(wording) and title_subject else _subject(wording)
    functions = tuple(functions_in_requirement(subject)) or inherit
    settings = wanted_settings(subject)
    keywords = _keywords(subject, functions, settings)
    if not functions and not settings and not keywords:
        return None
    if preferred is None:
        preferred = bool(PREFERRED_RE.search(wording))
    core = (kind == "experience" and track == "experienced" and not preferred and bool(functions or settings))
    shown = subject if wording == text else _subject(wording)
    return Criterion(_id(wording), text if wording == text else wording.strip(" ,;()"), kind, origin, shown,
                     functions, settings, keywords, years, preferred, core)


def _requirements(text: str, kind: str, *, track: str, title_subject: str = "") -> list[Criterion]:
    """A requirement line, split where it says "preferably": "5 years in industrial sales, preferably in a
    petrochemical company" is required industrial sales plus nice-to-have petrochemical experience."""
    split = PREFERABLY_RE.search(text)
    if split and split.start() > 15:
        head, tail = text[:split.start()], text[split.start():]
        main = _requirement(text, "requirements", kind, track=track, title_subject=title_subject, wording=head,
                            preferred=False)
        if main:
            extra = _requirement(text, "requirements", kind, track=track, wording=tail, preferred=True,
                                 inherit=main.functions)
            if extra and (extra.settings or extra.functions != main.functions):
                extra.text, extra.years = f"{_subject(head)}, {tail.strip(' ,;(')}", None
                return [main, extra]
            return [main]
    found = _requirement(text, "requirements", kind, track=track, title_subject=title_subject)
    return [found] if found else []


def _implies(have: frozenset, wanted: frozenset) -> bool:
    """Whether asking for ``have`` already asks for ``wanted`` (chemicals implies industrial)."""
    return all(w in have or any(child in have for child in SETTINGS[w].children) for w in wanted)


@lru_cache(maxsize=256)
def _parse(title: str, description: str, other: str, track: str, covered: tuple) -> tuple:
    criteria: list[Criterion] = []
    duties = requirements = 0
    title_subject = _subject(re.sub(r"\b(?:officer|assistant|manager|senior|junior|executive|lead|head|intern|"
                                    r"trainee|graduate|staff|supervisor|specialist|associate|principal|chief|deputy|"
                                    r"general|ii|iii|i)\b", " ", title or "", flags=re.I))
    text = (description or "") + ("\n\nRequirements:\n" + other if (other or "").strip() else "")
    seen = {normalize(title or "")}
    for section, item in _items(text):
        key = normalize(item)
        if key in seen or section == "skip" or (item.isupper() and len(item.split()) <= 6):
            continue  # the document's title, or a heading the reader did not know
        seen.add(key)
        is_experience = bool(EXPERIENCE_RE.search(item)) and section != "duties" or (
            section == "duties" and YEARS_RE.search(item) and re.search(r"experienc", item, re.I))
        if is_experience:
            if requirements >= MAX_REQUIREMENTS:
                continue
            found = _requirements(item, "experience", track=track, title_subject=title_subject)
            criteria += found
            requirements += bool(found)
            continue
        if QUALIFICATION_RE.search(item) and section != "duties":
            continue  # scored under Qualification, Course and Certifications
        if PERSONAL_RE.search(item) and not (section == "duties" and len(item.split()) > 8):
            criteria.append(Criterion(_id(item), item, "confirm", section or "requirements"))
            continue
        if SOFT_RE.search(item) and not functions_in_requirement(item) and not settings_in(item):
            criteria.append(Criterion(_id(item), item, "interview", section or "requirements"))
            continue
        if section == "requirements":
            if any(contains_phrase(normalize(item), normalize(term)) for term in covered if term):
                continue  # a skill or tool the requisition already scores
            if requirements >= MAX_REQUIREMENTS:
                continue
            found = _requirements(item, "knowledge", track=track)
            criteria += found
            requirements += bool(found)
            continue
        # A duty: what the job involves (also a summary sentence, or a line under no heading).
        if duties >= MAX_DUTIES:
            continue
        wanted = frozenset(c for c in concepts_of(item))
        if len([c for c in wanted if not c.startswith("setting:")]) >= 2:
            criteria.append(Criterion(_id(item), item, "duty", section or "duties", keywords=wanted))
            duties += 1
    # The job title says what kind of experience the job needs ("Industrial Sales Officer": industrial sales), when
    # no requirement already asks for exactly that.
    functions = tuple(functions_in_requirement(title_subject)) if title_subject else ()
    settings = wanted_settings(title_subject) if title_subject else frozenset()
    if track == "experienced" and (functions or settings):
        duplicate = any(c.kind == "experience" and c.core and set(functions) <= set(c.functions)
                        and _implies(c.settings, settings) for c in criteria)
        if not duplicate:
            criteria.insert(0, Criterion(_id("title:" + title), f"Experience as {title}", "experience", "title",
                                         title_subject, functions, settings, frozenset(), None, False, True))
    return tuple(criteria)


def jd_criteria(requisition) -> list[Criterion]:
    from core.choices import TRAINEE_TYPES

    track = "trainee" if requisition.employment_type in TRAINEE_TYPES else "experienced"
    covered = tuple(list(requisition.required_skills or []) + list(requisition.preferred_skills or [])
                    + list(requisition.tools or []) + list(requisition.certifications or []))
    return list(_parse(requisition.title or "", requisition.job_description or "",
                       requisition.other_requirements or "", track, covered))


def fingerprint_text(requisition) -> str:
    """What the requirements are read from (changes when the JD changes)."""
    return "\n".join([str(CRITERIA_VERSION), requisition.title or "", requisition.job_description or "",
                      requisition.other_requirements or "", requisition.employment_type or ""])


# --------------------------------------------------------------------------- the candidate's jobs
@dataclass
class CvJob:
    job: Job
    name: str
    functions: dict
    settings: frozenset
    concepts: frozenset
    weight: float = 1.0      # 0.9 for what the summary claims (no dated job shows it)


def _job_name(job: Job) -> str:
    from candidates.experience import RANGE_RE, SINCE_RE

    lines = []
    for line in job.title.splitlines():
        line = SINCE_RE.sub(" ", RANGE_RE.sub(" ", line))
        line = re.sub(r"\s+(?:-|–|—|to|till|until|from|since)\s*$", " ", line)
        line = " ".join(line.replace(" | ", " · ").split()).strip(" |,-–—:()")
        if line:
            lines.append(line)
    name = " · ".join(lines[:2]) or (job.body.splitlines()[0] if job.body else "")
    return name if len(name) <= 70 else name[:67] + "…"


def _cv_job(job: Job, weight: float = 1.0) -> CvJob:
    text = f"{job.title}\n{job.body}"
    return CvJob(job, _job_name(job) if job.source != "summary" else "Profile summary",
                 functions_in_job(job.title, job.body), settings_in(text), concepts_of(text), weight)


def cv_jobs(candidate) -> list[CvJob]:
    """The candidate's jobs (as the CV gives them), plus the profile summary judged as a claim."""
    key = (candidate.pk, getattr(candidate, "updated_at", None), len(candidate.cv_text or ""),
           len(candidate.work_history or []))
    cached = getattr(candidate, "_cv_jobs", None)
    if cached and cached[0] == key:
        return cached[1]
    from candidates.cv_parser import _split_sections

    jobs: list[Job] = []
    sections = _split_sections((candidate.cv_text or "").splitlines()) if candidate.cv_text else {}
    described = [w for w in candidate.work_history or [] if (w or {}).get("description")]
    if described:  # the AI reader's jobs, with what the candidate did in each
        jobs = [j for j in (job_from_history(w) for w in described) if j]
    elif candidate.cv_text:
        experience = sections.get("experience", "")
        if experience.strip():
            jobs = jobs_in(experience, in_experience_section=True)
        else:
            experience = "\n".join(v for k, v in sections.items() if k not in {
                "education", "references", "certifications", "skills", "summary", "training", "personal", "other"})
            jobs = jobs_in(experience, in_experience_section=False)
        if not jobs:
            jobs = blocks_in(experience)
    if not jobs:  # a profile with only past roles typed in
        for entry in candidate.work_history or []:
            job = job_from_history(entry)
            if job:
                jobs.append(job)
        if candidate.current_job_title and not jobs:
            jobs.append(Job(title=candidate.current_job_title, body="", months=None, source="profile"))
    found = [_cv_job(j) for j in jobs if j.is_work]
    summary = "\n".join(filter(None, [candidate.summary or "", sections.get("summary", "")]))
    if summary.strip():
        found.append(_cv_job(Job(title="", body=summary, months=None, source="summary"), weight=0.9))
    candidate._cv_jobs = (key, found)
    return found


# --------------------------------------------------------------------------- judging
def _function_words(keys) -> str:
    return " or ".join(FUNCTIONS[k].label for k in keys)


def _setting_words(keys) -> str:
    return " or ".join(SETTINGS[k].label.split(" (")[0] for k in sorted(keys))


def _job_settings_text(job: CvJob) -> str:
    shown = [k for k in job.settings if k != "industrial" or not (job.settings & set(SETTINGS["industrial"].children))]
    return _setting_words(shown[:2]) if shown else ""


def _judge_job(criterion: Criterion, job: CvJob) -> tuple[float, str]:
    """(credit for the kind of experience, why) for one job."""
    fc = fhow = None
    if criterion.functions:
        fc, fkey, fhow = function_credit(list(criterion.functions), job.functions)
    sc = skey = None
    if criterion.settings:
        sc, skey = setting_credit(criterion.settings, job.settings)
    where = _job_settings_text(job)
    wanted_f, wanted_s = _function_words(criterion.functions), _setting_words(criterion.settings)
    if fc is not None and sc is not None:
        credit = fc * (0.4 + 0.6 * sc) if fc > 0 else 0.2 * sc
        if fc >= 1 and sc >= 1:
            why = f"{FUNCTIONS[fkey].label} in {SETTINGS[skey].label.split(' (')[0]}" + (
                f", which counts as {wanted_s}" if skey not in criterion.settings else "")
        elif fc >= 1 and sc > 0:
            why = (f"{FUNCTIONS[fkey].label} in {SETTINGS[skey].label.split(' (')[0]}, close to {wanted_s} "
                   f"but not the same")
        elif fc >= 1:
            why = f"{FUNCTIONS[fkey].label}, but not in {wanted_s}" + (f": this job reads as {where}" if where
                                                                     else ": nothing shows the kind of business")
        elif fc > 0 and fhow == "related":
            why = f"{FUNCTIONS[fkey].label}, related to {wanted_f}" + (
                f", in {SETTINGS[skey].label.split(' (')[0]}" if sc else "")
        elif fc > 0:
            why = f"some {FUNCTIONS[fkey].label} duties" + (f" in {SETTINGS[skey].label.split(' (')[0]}" if sc else "")
        elif sc > 0:
            why = f"worked in {SETTINGS[skey].label.split(' (')[0]}, but not in {wanted_f}"
        else:
            why = ""
        return credit, why
    if fc is not None:
        if fc >= 1:
            return 1.0, FUNCTIONS[fkey].label + (" (from the job title)" if fhow == "title" else " (from the duties)")
        if fhow == "related" and fc > 0:
            return fc, f"{FUNCTIONS[fkey].label}, related to {wanted_f}"
        return fc, f"some {FUNCTIONS[fkey].label} duties" if fc > 0 else ""
    if sc is not None:
        if sc >= 1:
            return 1.0, f"worked in {SETTINGS[skey].label.split(' (')[0]}"
        return sc, f"worked in {SETTINGS[skey].label.split(' (')[0]}, close to {wanted_s}" if sc else ""
    share, strong = overlap(criterion.keywords, job.concepts)
    credit = 1.0 if share >= 0.8 else share * 0.9 if share >= 0.5 else share * 0.5
    return credit, ("shows " + ", ".join(strong[:4])) if strong else ""


def _place(job: CvJob) -> str:
    if job.job.source == "summary":
        return "Profile summary"
    return job.name + (f" ({job.job.label})" if job.job.label else "")


def judge_experience(criterion: Criterion, jobs: list[CvJob]) -> dict:
    scored = []
    for job in jobs:
        credit, why = _judge_job(criterion, job)
        scored.append((credit * job.weight, why, job))
    scored.sort(key=lambda s: -s[0])
    best = scored[0] if scored and scored[0][0] > 0 else None
    kind_credit = best[0] if best else 0.0
    relevant = sum(j.job.months for c, _, j in scored if c >= MET and j.job.months)
    # Similar work counts in part towards the years: 4 years of retail sales at 40% for industrial sales.
    weighted = round(sum(j.job.months * min(c, 1.0) for c, _, j in scored if c >= PARTLY and j.job.months))
    dated = any(j.job.months for c, _, j in scored if c >= PARTLY)
    needed = (criterion.years or 0) * 12
    unknown = False
    if needed:
        if dated:
            credit, left = 0.0, needed
            for c, _, j in scored:
                if left <= 0 or c <= 0 or not j.job.months:
                    continue
                used = min(j.job.months, left)
                credit += c * used / needed
                left -= used
        else:
            credit, unknown = kind_credit * 0.75, kind_credit >= MET
    else:
        credit = kind_credit
    years_short = bool(needed) and dated and relevant < needed
    if kind_credit >= MET and not years_short:
        verdict = "met"
    elif kind_credit >= PARTLY or (kind_credit >= MET and years_short):
        verdict = "partly"
    else:
        verdict = "not_met"
    if best:
        evidence = f"{_place(best[2])}: {best[1]}" if best[1] else _place(best[2])
    else:
        evidence = "Nothing in the CV shows it"
    if needed and dated:
        counted = length_text(relevant) if relevant else "no time"
        evidence += f" · {counted} in jobs that fully count, {criterion.years:g}+ yrs asked"
    elif needed and unknown:
        evidence += " · the years are not shown: confirm"
    return {"credit": round(min(1.0, credit), 3), "kind_credit": round(kind_credit, 3), "verdict": verdict,
            "evidence": evidence, "relevant_months": relevant if dated else None,
            "weighted_months": weighted if dated else None, "unknown": unknown}


def judge_duty(criterion: Criterion, jobs: list[CvJob]) -> dict:
    best = (0.0, [], None)
    for job in jobs:
        share, strong = overlap(criterion.keywords, job.concepts)
        share *= job.weight
        if share > best[0]:
            best = (share, strong, job)
    share, strong, job = best
    strong_wanted = [c for c in criterion.keywords if c not in {"grow", "manage", "prepare", "schedule", "report"}]
    enough = len(strong) >= min(2, len(strong_wanted))
    if share >= 0.6 and enough:
        verdict, credit = "met", 1.0
    elif share >= 0.4 and strong:
        verdict, credit = "partly", 0.5
    else:
        verdict, credit = "not_met", 0.0
    shown = [c for c in strong if c in CONCEPT_GROUPS]
    evidence = (_place(job) + (f": {', '.join(shown[:4])}" if shown else "")) if job and verdict != "not_met" \
        else "Not found in the CV"
    return {"credit": credit, "kind_credit": credit, "verdict": verdict, "evidence": evidence,
            "relevant_months": None, "unknown": False}


def judge_knowledge(criterion: Criterion, jobs: list[CvJob], everything: frozenset) -> dict:
    if criterion.functions or criterion.settings:
        result = judge_experience(criterion, jobs)
        return dict(result, relevant_months=None)
    share, strong = overlap(criterion.keywords, everything)
    if share >= 0.7:
        verdict, credit = "met", 1.0
    elif share >= 0.4:
        verdict, credit = "partly", 0.5
    else:
        verdict, credit = "not_met", 0.0
    return {"credit": credit, "kind_credit": credit, "verdict": verdict,
            "evidence": ("The CV mentions " + ", ".join(strong[:5])) if strong else "Not found in the CV",
            "relevant_months": None, "unknown": False}


AI_CREDIT = {"met": (1.0, 1.0), "partly": (0.5, 0.6), "not_met": (0.0, 0.0), "unclear": (0.5, 0.6)}
VERDICT_LABELS = {"met": "Met", "partly": "Partly", "not_met": "Not met", "unclear": "Confirm",
                  "confirm": "Confirm", "interview": "At interview"}


def assess(requisition, candidate, ai: dict | None = None) -> dict | None:
    """Each JD requirement with its verdict, the share of the JD met (for the score), the cap on the score when a
    key experience requirement is not met, and the relevant years. None when the JD gives nothing to judge or the
    candidate has no CV text or past roles to judge it by."""
    criteria = jd_criteria(requisition)
    scorable = [c for c in criteria if c.kind in {"experience", "knowledge", "duty"}]
    if not scorable:
        return None
    jobs = cv_jobs(candidate)
    if not jobs:
        return None
    everything = frozenset().union(*(j.concepts for j in jobs)) | concepts_of(
        " ".join(list(candidate.skills or []) + list(candidate.tools or []) + list(candidate.certifications or [])))
    ai_verdicts = (ai or {}).get("criteria") or {}
    rows = []
    for c in criteria:
        row = {"id": c.id, "text": c.text, "kind": c.kind, "origin": c.origin, "core": c.core,
               "preferred": c.preferred, "years": c.years, "subject": c.subject, "source": "rules"}
        if c.kind == "experience":
            row.update(judge_experience(c, jobs))
        elif c.kind == "duty":
            row.update(judge_duty(c, jobs))
        elif c.kind == "knowledge":
            row.update(judge_knowledge(c, jobs, everything))
        else:
            row.update(verdict=c.kind, credit=None, kind_credit=None,
                       evidence="Confirm with the candidate" if c.kind == "confirm" else "Judge at the interview",
                       relevant_months=None, unknown=False)
        found = ai_verdicts.get(c.id)
        if found and c.kind in {"experience", "knowledge", "duty"} and found.get("verdict") in AI_CREDIT:
            credit, kind_credit = AI_CREDIT[found["verdict"]]
            years = found.get("relevant_years")
            row.update(verdict=found["verdict"], credit=credit, kind_credit=kind_credit, source="AI",
                       evidence=(found.get("evidence") or "").strip()[:300] or row["evidence"],
                       unknown=found["verdict"] == "unclear",
                       relevant_months=round(years * 12) if isinstance(years, (int, float)) and years >= 0
                       else row.get("relevant_months"))
            if c.years and found["verdict"] == "met" and isinstance(years, (int, float)) and 0 <= years < c.years:
                row.update(verdict="partly", credit=round(years / c.years, 3))
        row["label"] = VERDICT_LABELS.get(row["verdict"], row["verdict"])
        rows.append(row)

    # The share of the JD met, for the score.
    total = got = 0.0
    duties = [r for r in rows if r["kind"] == "duty"]
    for r in rows:
        if r["kind"] == "experience":
            w = WEIGHT["core"] if r["core"] else WEIGHT["experience"] * (0.5 if r["preferred"] else 1)
        elif r["kind"] == "knowledge":
            w = WEIGHT["knowledge"] * (0.5 if r["preferred"] else 1)
        elif r["kind"] == "duty":
            w = WEIGHT["duties"] / len(duties)
        else:
            continue
        total += w
        got += w * (r["credit"] or 0)
    share = got / total if total else 0.0

    # A key experience requirement that is not met caps the score.
    cap = None
    for r in rows:
        if not r["core"]:
            continue
        if r["source"] == "AI":
            limit = None if r["verdict"] in {"met", "unclear"} else CAP_PARTLY if r["verdict"] == "partly" \
                else CAP_NOT_MET
        else:
            k = r["kind_credit"] or 0
            limit = None if k >= MET else CAP_PARTLY if k >= PARTLY else CAP_NOT_MET
        if limit and (cap is None or limit < cap["limit"]):
            what = r["subject"] or r["text"]
            cap = {"limit": limit, "requirement": r["text"],
                   "reason": (f"the JD asks for experience in {what}, and the CV "
                              + ("only partly shows it" if limit == CAP_PARTLY else "does not show it"))}

    core = [r for r in rows if r["core"]]
    main = max(core, key=lambda r: (r["years"] or 0, r["origin"] == "title"), default=None)
    experience_rows = [r for r in rows if r["kind"] in {"experience", "knowledge"}]
    met = sum(1 for r in experience_rows if r["verdict"] == "met")
    partly = sum(1 for r in experience_rows if r["verdict"] in {"partly", "unclear"})
    done = sum(1 for r in duties if r["verdict"] == "met")
    found_parts = []
    if experience_rows:
        found_parts.append(f"{met} of {len(experience_rows)} requirements met" + (f", {partly} partly" if partly else ""))
    if duties:
        found_parts.append(f"{done} of {len(duties)} duties done before")
    asked_parts = []
    if experience_rows:
        asked_parts.append(f"{len(experience_rows)} requirement{'s' if len(experience_rows) != 1 else ''}")
    if duties:
        asked_parts.append(f"{len(duties)} dut{'ies' if len(duties) != 1 else 'y'}")
    return {
        "version": CRITERIA_VERSION, "share": share, "criteria": rows, "cap": cap,
        "asked": " and ".join(asked_parts) + " from the JD, read job by job",
        "found": " · ".join(found_parts),
        "relevant_months": main["relevant_months"] if main else None,
        "weighted_months": main.get("weighted_months") if main else None,
        "relevant_years_asked": (main["years"] or None) if main else None,
        "relevant_subject": (main["subject"] or "") if main else "",
        "ai": bool(ai_verdicts),
    }
