"""Is this file a CV?

CVs arrive in folders and mailboxes together with cover letters, certificates, NYSC and WAEC papers, ID cards, job
descriptions and the odd invoice. Only CVs become profiles: everything else is set aside with the reason, and
nothing is saved from it. The decision is made from what was read in the file, not from its name alone:

- a CV shows who the person is and what they have done: contact details, education, work history with dates,
  skills, the usual headings ("Work Experience", "Education", "Referees") or a "Curriculum Vitae" title;
- a cover letter is addressed to someone ("Dear Sir", "I wish to apply", "Yours faithfully") and has no CV sections
  (a letter with the CV after it in the same file is a CV);
- a certificate or result says so ("This is to certify", "Statement of Result", "Certificate of National Service");
- a job description talks about the job ("Job title:", "Key responsibilities", "The successful candidate");
- a scan or photo that could not be read cannot be told apart, so it is set aside too, with what would read it.

Also here: recognising the same CV again (the same text, whatever the file is called or saved as).
"""

from __future__ import annotations

import hashlib
import re
from collections import Counter
from dataclasses import dataclass

CV = "cv"
UNREADABLE = "unreadable"
NEEDED = 5  # the evidence a file needs to count as a CV (see _evidence)

CV_TITLE = re.compile(r"^\W*(?:curriculum\s+vitae|r[ée]sum[ée]|c\.?\s?v\.?)\W*(?:\bof\b.{0,60})?$", re.I)
CV_NAME = re.compile(r"(?<![a-z])(?:cv|resume|résumé|curriculum[ _-]*vitae)(?![a-z])", re.I)
LETTER = [r"\bdear\s+(?:sir|madam|sirs|hiring|recruit\w+|mr|mrs|ms|hr|human)\b", r"\byours\s+(?:faithfully|sincerely|truly)\b",
          r"\bi\s+(?:wish|write|am\s+writing|hereby)\s+(?:to\s+)?appl", r"\bapplication\s+for\s+(?:the\s+)?(?:post|position|"
          r"role|job|employment)\b", r"\bplease\s+find\s+(?:attached|enclosed)\b", r"\bi\s+look\s+forward\s+to\b"]
CERTIFICATE = [r"\bthis\s+is\s+to\s+certify\b", r"\bcertificate\s+of\s+(?:national\s+service|completion|attendance|"
               r"participation|incorporation|birth|(?:state\s+of\s+)?origin|membership|registration)\b",
               r"\bhas\s+(?:been\s+awarded|successfully\s+completed|satisfied\s+the)\b", r"\bstatement\s+of\s+results?\b",
               r"\bwest\s+african\s+examinations?\s+council\b", r"\bnational\s+examinations?\s+council\b",
               r"\bacademic\s+transcript\b|\btranscript\s+of\s+academic\b", r"\bdeclaration\s+of\s+age\b",
               r"\bto\s+whom\s+it\s+may\s+concern\b", r"\bnational\s+identi(?:ty|fication)\s+(?:number|card|management)\b",
               r"\bexemption\s+certificate\b", r"\bletter\s+of\s+identification\b"]
JOB_DESCRIPTION = [r"\bjob\s+description\b", r"\bjob\s+title\s*[:\-–]", r"\breport(?:s|ing)\s+to\s*[:\-–]",
                   r"\b(?:key|main|principal|major)\s+(?:responsibilities|duties|accountabilities)\b",
                   r"\bduties\s+and\s+responsibilities\b", r"\bjob\s+(?:summary|purpose|specification|requirements)\b",
                   r"\bperson\s+specification\b", r"\bthe\s+(?:successful|ideal)\s+candidate\b",
                   r"\bhow\s+to\s+apply\b|\bmethod\s+of\s+application\b", r"\bwe\s+are\s+(?:looking\s+for|seeking|recruiting)\b",
                   r"\b(?:candidates?|applicants?)\s+(?:must|should)\s+(?:have|possess|be)\b"]
OTHER = [(r"\binvoice\b|\breceipt\s+(?:no|number)\b|\bamount\s+due\b", "an invoice or receipt"),
         (r"\bpay\s?slip\b|\bnet\s+pay\b", "a payslip"),
         (r"\bminutes\s+of\s+(?:the\s+)?meeting\b", "minutes of a meeting"),
         (r"\boffer\s+of\s+(?:employment|appointment)\b|\bletter\s+of\s+(?:offer|appointment|employment)\b", "an offer letter"),
         (r"\bstatement\s+of\s+account\b|\bopening\s+balance\b", "a bank statement")]
# What a file's name says when the text cannot settle it.
NAMED_OTHER = [(r"cover[ _-]*letter|application[ _-]*letter|motivation", "a cover letter"),
               (r"(?<![a-z])(?:jd|job[ _-]*desc\w*|vacancy|advert)(?![a-z])", "a job description"),
               (r"certificate|(?<![a-z])cert(?![a-z])|nysc|waec|neco|ssce|transcript|result|testimonial|"
                r"(?<![a-z])(?:nin|id)(?![a-z])|id[ _-]*card|passport|birth|declaration|lga|origin|licen[cs]e",
                "a certificate, result or ID")]


@dataclass
class Verdict:
    is_cv: bool
    kind: str     # "cv", "unreadable", or what the file is instead ("a cover letter", "a job description"…)
    reason: str   # for the person who added the file


def _count(patterns, text: str) -> int:
    return sum(1 for pattern in patterns if re.search(pattern, text, re.I))


def _evidence(parsed: dict, text: str, filename: str) -> tuple[int, dict]:
    """How much the file looks like a CV, and what was found."""
    from .cv_parser import _split_sections

    lines = [line for line in text.splitlines() if line.strip()]
    sections = {k for k, v in _split_sections(text.splitlines()).items() if v.strip()} if text.strip() else set()
    found = {
        "title": any(CV_TITLE.match(line) for line in lines[:15]),
        "experience": "experience" in sections, "education": "education" in sections,
        "jobs": bool(parsed.get("work_history")), "schooling": bool(parsed.get("education_history")),
        "email": bool(parsed.get("email")), "phone": bool(parsed.get("phone")),
        "qualification": bool(parsed.get("highest_qualification")),
        "named": bool(CV_NAME.search(filename or "")),
    }
    score = (3 * found["title"] + 2 * found["experience"] + 2 * found["education"] + 2 * found["email"]
             + found["phone"] + found["qualification"] + 2 * found["named"]
             + 2 * found["jobs"] + 2 * (found["schooling"] and not found["education"])
             + len(sections & {"skills", "summary", "references", "personal", "certifications"}))
    found["sections"] = sections
    return score, found


def judge(parsed: dict, filename: str = "") -> Verdict:
    """Whether what was read from a file is a CV. ``parsed`` is what parse_cv returned for it."""
    text = parsed.get("text") or ""
    words = len(re.findall(r"[A-Za-z]{2,}", text))
    by_ai = parsed.get("method") == "ai"
    if by_ai and parsed.get("is_cv") is False:
        return Verdict(False, "another kind of document", "Not a CV: the reader found no candidate's CV in it.")
    if not text.strip() or (words < 25 and not by_ai):
        notes = " ".join(str(n) for n in parsed.get("notes") or [] if "OCR" in str(n) or "AI" in str(n)
                         or "Could not read" in str(n) or "Old Word" in str(n))
        what = "It is a scan or a photo" if parsed.get("scanned") else "No text could be read from it"
        return Verdict(False, UNREADABLE, f"Could not be read, so it was not added. {what}. {notes}".strip())
    score, found = _evidence(parsed, text, filename)
    has_sections = found["experience"] or found["education"]
    personal = found["title"] or found["phone"] or found["jobs"] or "personal" in found["sections"]
    jd = _count(JOB_DESCRIPTION, text)
    if (jd >= 3 or (jd >= 2 and re.search(NAMED_OTHER[1][0], filename or "", re.I))) and not personal:
        return Verdict(False, "a job description", "Not a CV: it reads as a job description.")
    if not has_sections and not found["jobs"]:
        if _count(CERTIFICATE, text) and words < 400:
            return Verdict(False, "a certificate, result or ID", "Not a CV: it reads as a certificate, result or letter "
                                                                 "of identification.")
        if _count(LETTER, text) >= 2 and words < 700:
            return Verdict(False, "a cover letter", "Not a CV: it reads as a cover or application letter.")
        for pattern, what in OTHER:
            if re.search(pattern, text, re.I):
                return Verdict(False, what, f"Not a CV: it reads as {what}.")
    if score >= NEEDED:
        return Verdict(True, CV, "")
    for pattern, what in NAMED_OTHER:
        if re.search(pattern, filename or "", re.I) and not found["named"]:
            return Verdict(False, what, f"Not a CV: it looks like {what}.")
    return Verdict(False, "another kind of document",
                   "Not a CV: no work history, education or contact details were found in it.")


# --------------------------------------------------------------------------- the same CV again
def text_key(text: str) -> str:
    """A fingerprint of a CV's words, the same whatever the file is called and however it is laid out."""
    letters = re.sub(r"[^a-z0-9]+", "", (text or "").lower())
    return hashlib.sha1(letters.encode()).hexdigest() if len(letters) >= 200 else ""


def same_cv(first: str, second: str, threshold: float = 0.97) -> bool:
    """Whether two texts are the same CV read slightly differently (saved as Word and as PDF, say): all but a few
    of their words are shared. A CV with a line added or changed is a newer CV, not the same one."""
    a = Counter(re.findall(r"[a-z0-9]{2,}", (first or "").lower()))
    b = Counter(re.findall(r"[a-z0-9]{2,}", (second or "").lower()))
    total = sum((a | b).values())
    return bool(total) and sum((a & b).values()) / total >= threshold
