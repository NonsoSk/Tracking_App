"""Personal details read from a CV: the name, phone, sex, date of birth, state of origin and LGA.

Nigerian CVs give these in many shapes: a name heading in capitals ("ENGR. IFEOMA CHUKWU"), "OKAFOR, Chinedu James",
"OKAFOR Chinedu" (surname in capitals first), a personal-data table ("Name | Adaeze Nwankwo"), "Surname: ... Other
names: ..." lines, several labels on one line ("Sex: Male     Date of Birth: 4/5/1995"). When nothing in the text
names the person, the file name ("Chinedu Okafor CV.pdf") or the email address gives the name, with a note to check.
"""

from __future__ import annotations

import os
import re

LABELS = {
    "name": {"name", "names", "full name", "full names", "name in full", "names in full", "name of applicant",
             "applicant name", "applicant's name", "candidate name", "candidate's name", "name of candidate"},
    "surname": {"surname", "last name", "family name"},
    "given": {"first name", "first names", "other name", "other names", "given name", "given names", "forename",
              "forenames", "first and middle names", "first and middle name", "christian name", "christian names"},
    "middle": {"middle name", "middle names"},
    "sex": {"sex", "gender"},
    "dob": {"date of birth", "d.o.b", "dob", "birth date", "date of birth dd/mm/yyyy"},
    "state": {"state of origin", "state", "state of origin/lga", "state of origin / lga", "state/lga"},
    "lga": {"lga", "l.g.a", "lga of origin", "local government area", "local govt area", "local govt. area",
            "local government", "l.g.a of origin"},
    "phone": {"phone", "phone number", "phone numbers", "phone no", "mobile", "mobile number", "mobile no", "tel",
              "telephone", "gsm", "gsm no", "contact number", "contact phone", "phone/whatsapp", "whatsapp"},
    "email": {"email", "e-mail", "email address", "e-mail address"},
    "address": {"address", "residential address", "contact address", "home address", "permanent address"},
}
_LABEL_OF = {label: key for key, labels in LABELS.items() for label in labels}
# Where a value typed on the same line runs into the next label ("Name: John Doe Sex: Male").
_NEXT_LABEL = re.compile(r"\s(?:sex|gender|date of birth|d\.o\.b\.?|phone|mobile|e-?mail|state of origin|l\.?g\.?a\.?"
                         r"|address|nationality|marital status|religion)\s*[:\-]", re.I)

TITLES = {"mr", "mrs", "miss", "ms", "mx", "engr", "eng", "dr", "pharm", "barr", "arc", "arch", "prof", "chief",
          "rev", "hon", "sir", "alhaji", "alhaja", "mallam", "comrade", "pastor", "deacon", "deaconess", "evang",
          "surv", "tpl", "qs", "chartered", "hrh", "otunba", "oba", "nurse"}
NOT_A_NAME = re.compile(
    r"\b(curriculum|vitae|resume|résumé|cv|profile|summary|objective|career|personal|data|details|information|"
    r"contact|experience|education|educational|skills?|references?|referees?|qualifications?|certifications?|"
    r"officer|accountant|engineer|manager|analyst|assistant|executive|specialist|consultant|intern|graduate|"
    r"supervisor|technician|marketer|administrator|secretary|clerk|operator|coordinator|director|representative|"
    r"associate|trainee|auditor|developer|designer|nurse|teacher|lecturer|driver|attendant|personnel|professional|"
    r"applicant|candidate|position|application|vacancy|department|accounts?|finance|marketing|human|resources?|"
    r"sales|admin|street|road|close|avenue|estate|layout|lane|crescent|nigeria|state|lga|address|phone|email|"
    r"mobile|tel|linkedin|www|http|available|request|hobbies|interests|languages|declaration|signature|date)\b",
    re.I)
NAME_WORD = re.compile(r"^[^\W\d_](?:[^\W\d_]|['’.-](?=[^\W\d_]))*\.?$")
FILE_WORDS = re.compile(
    r"\b(curriculum|vitae|cv|resume|résumé|updated?|new|latest|final|copy|my|of|document|doc|docx|pdf|application|"
    r"cover|letter|and|for|the|file|scan|scanned|img|image|photo|version|draft|signed|edited|revised|"
    r"\d+|[a-z])\b", re.I)


def label_key(text: str) -> str | None:
    norm = re.sub(r"\s+", " ", (text or "").lower()).strip(" :-–—.\t*•")
    return _LABEL_OF.get(norm)


def _clean_value(value: str) -> str:
    value = _NEXT_LABEL.split(value, maxsplit=1)[0]
    return value.strip(" :;,|-–—\t")


def label_pairs(lines: list[str]) -> list[tuple[str, str]]:
    """(label, value) for every 'Label: value', 'Label | value' and 'Label<wide gap>value' found, in order."""
    pairs = []
    for line in lines:
        if "|" in line:
            segments = [c.strip() for c in line.split("|")]
            for i in range(len(segments) - 1):
                key = label_key(segments[i])
                if key and segments[i + 1]:
                    pairs.append((key, _clean_value(segments[i + 1])))
        else:
            segments = [s for s in re.split(r"\t+|\s{3,}", line) if s.strip()]
            for i in range(len(segments) - 1):
                key = label_key(segments[i])
                if key and (segments[i].strip().endswith(":") or len(segments) == 2):
                    pairs.append((key, _clean_value(segments[i + 1])))
        for segment in segments:
            match = re.match(r"^\s*[•*\-]?\s*([A-Za-z][A-Za-z .'’/()&]{0,40}?)\s*(?::|–|—|\s-\s)\s*(\S.*)$", segment)
            if match:
                key = label_key(match.group(1))
                if key:
                    pairs.append((key, _clean_value(match.group(2))))
    return [(k, v) for k, v in pairs if v]


def tidy_word(word: str) -> str:
    if word.isupper() or word.islower():
        word = "-".join("'".join(p.capitalize() for p in part.split("'")) for part in word.split("-"))
    return word


def split_name(value: str, surname_first: bool | None = None) -> tuple[str, str]:
    """('Chinedu James', 'Okafor') from 'Chinedu James Okafor', 'OKAFOR, Chinedu James', 'OKAFOR Chinedu James' or
    'Engr. (Mrs) Chinedu Okafor'; ('', '') when it does not look like a person's name."""
    value = re.sub(r"\((?:mrs?|miss|ms|nee|née)[^)]*\)|\(.*?\)", " ", value or "", flags=re.I)
    value = value.replace(",", " , ").replace("’", "'")
    words = value.split()
    while words and words[0].lower().strip(".()") in TITLES:
        words.pop(0)
    while words and words[-1] in {",", "-"}:
        words.pop()
    names = [w for w in words if w != ","]
    if not 2 <= len(names) <= 5 or not all(NAME_WORD.match(w) for w in names):
        return "", ""
    if all(len(w.rstrip(".")) <= 1 for w in names) or sum(len(w.rstrip(".")) > 1 for w in names) < 2:
        return "", ""  # initials only
    if "," in words:
        cut = words.index(",")
        surname, given = words[:cut], [w for w in words[cut + 1:] if w != ","]
    elif surname_first or (surname_first is None and names[0].isupper() and len(names[0]) > 2
                           and not all(w.isupper() for w in names)):
        surname, given = names[:1], names[1:]
    else:
        surname, given = names[-1:], names[:-1]
    if not surname or not given:
        return "", ""
    return " ".join(tidy_word(w) for w in given), " ".join(tidy_word(w) for w in surname)


def written_as_a_name(text: str) -> bool:
    """Each word capitalised ('Chinedu Okafor') or in capitals ('OKAFOR Chinedu'), at most one comma: not a list of
    skills ('Recruitment, onboarding, payroll') or a sentence."""
    words = [w for w in re.split(r"[\s,]+", text) if w]
    return text.count(",") <= 1 and bool(words) and all(w[0].isupper() for w in words if w[0].isalpha())


def heading_name(lines: list[str]) -> tuple[str, str]:
    """The name written as a heading near the top, above the first section (summary, experience, skills...)."""
    from .cv_parser import HEADING_RE, LOCATIONS

    places = re.compile(r"\b(?:" + "|".join(re.escape(p) for p in LOCATIONS) + r")\b", re.I)
    for line in lines[:25]:
        bare = line.strip().strip("•*-_=#:").strip()
        if any(pattern.match(bare) for key, pattern in HEADING_RE.items() if key != "personal") and len(bare) <= 60:
            break  # the CV's sections have started: a name would have come before
        for part in re.split(r"\s+[|–—]\s+|\s+-\s+|\t", line.strip()):
            part = part.strip(" •*:")
            if not part or re.search(r"\d|@", part) or NOT_A_NAME.search(part) or places.search(part) \
                    or part.endswith(":") or not written_as_a_name(part):
                continue
            first, last = split_name(part)
            if first:
                return first, last
            break  # only the first part of a line can be the name
    return "", ""


def name_from_filename(filename: str) -> tuple[str, str]:
    stem = os.path.splitext(os.path.basename(filename or ""))[0]
    stem = re.sub(r"[_.()\[\]+]+|(?<=\w)-(?=\w)|\s-\s", " ", stem)
    stem = FILE_WORDS.sub(" ", stem)
    if NOT_A_NAME.search(stem):
        stem = NOT_A_NAME.sub(" ", stem)
    return split_name(" ".join(stem.split()))


def name_from_email(email: str) -> tuple[str, str]:
    local = (email or "").split("@")[0]
    parts = [p for p in re.split(r"[._-]+", re.sub(r"\d+", "", local)) if p]
    if 2 <= len(parts) <= 3 and all(len(p) >= 2 and p.isalpha() for p in parts):
        return " ".join(p.capitalize() for p in parts[:-1]), parts[-1].capitalize()
    return "", ""


def read_name(lines: list[str], pairs: list[tuple[str, str]], *, filename: str = "", email: str = "") -> tuple[str, str, str]:
    """(first name, last name, note): from labelled fields, then a heading, then the file name, then the email."""
    found = dict(reversed(pairs))  # the first value for each label
    if found.get("surname") and (found.get("given") or found.get("middle")):
        given = " ".join(v for v in (found.get("given"), found.get("middle")) if v)
        first, last = split_name(f"{found['surname']}, {given}")
        if first:
            return first, last, ""
    if found.get("name"):
        first, last = split_name(found["name"])
        if first:
            return first, last, ""
    first, last = heading_name(lines)
    if first:
        return first, last, ""
    first, last = name_from_filename(filename)
    if first:
        return first, last, "Name taken from the file name: check it."
    first, last = name_from_email(email)
    if first:
        return first, last, "Name taken from the email address: check it."
    return "", "", "No name found in the CV: type it in."


PHONE_CHUNK = re.compile(r"\+?\(?\d[\d\s().-]{7,20}\d")


def nigerian_mobile(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("234"):
        rest = digits[3:]
        rest = rest[1:] if rest.startswith("0") else rest
        if len(rest) == 10 and rest[0] in "789":
            return "+234" + rest
    if len(digits) == 11 and digits.startswith("0") and digits[1] in "789":
        return digits
    return ""


def find_phone(text: str, labelled: list[str]) -> str:
    """A Nigerian mobile number in any grouping ('0803 123 4567', '08031 234 567', '+234 (0) 803...'); else a number
    given under a phone label. Year ranges ('2015 - 2019') are never taken for a phone number."""
    for source in [*labelled, text]:
        for match in PHONE_CHUNK.finditer(source):
            raw = match.group(0)
            number = nigerian_mobile(raw)
            if number:
                return number
            # Two numbers written side by side: try each run of digits on its own.
            for piece in re.split(r"\s{2,}|\s/\s|,", raw):
                number = nigerian_mobile(piece)
                if number:
                    return number
    for value in labelled:
        digits = re.sub(r"[^\d+]", "", value.split(",")[0].split("/")[0])
        if 10 <= len(digits.lstrip("+")) <= 15:
            return digits
    return ""


def read_details(lines: list[str], text: str, *, filename: str = "") -> dict:
    """The personal details found, plus 'notes' for HR to check."""
    from .regions import canonical_state

    cut = next((i for i, line in enumerate(lines)
                if re.match(r"^\s*(references?|referees?)\s*:?\s*$", line.strip(), re.I)), len(lines))
    pairs = label_pairs(lines[:cut])
    first_of = {}
    for key, value in pairs:
        first_of.setdefault(key, value)
    details: dict = {"notes": []}

    email = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", first_of.get("email", "") or text)
    details["email"] = email.group(0).lower() if email else ""
    details["phone"] = find_phone(text, [v for k, v in pairs if k == "phone"])

    first, last, note = read_name(lines, pairs, filename=filename, email=details["email"])
    details["first_name"], details["last_name"] = first, last
    if note:
        details["notes"].append(note)

    sex = (first_of.get("sex") or "").strip().lower()
    if sex[:1] in {"m", "f"} and sex in {"m", "f", "male", "female", "m.", "f."}:
        details["gender"] = "male" if sex.startswith("m") else "female"

    state_value = first_of.get("state", "")
    lga_value = first_of.get("lga", "")
    if state_value and "/" in state_value and not lga_value:
        state_value, lga_value = state_value.split("/", 1)
    state = canonical_state(re.split(r"[,;]", state_value)[0]) if state_value else ""
    details["state_of_origin"] = state
    if not lga_value:
        match = re.search(r"\bl\.?\s?g\.?\s?a\.?(?:\s+of\s+origin)?\s*[:\-|]\s*([A-Za-z' /-]{2,60})", text, re.I)
        lga_value = match.group(1) if match else ""
    lga = re.split(r"[,;|\n]|\s{2,}|\bstate\b", lga_value, flags=re.I)[0].strip(" .-/")
    details["lga"] = lga.title() if lga.isupper() or lga.islower() else lga
    details["dob_text"] = first_of.get("dob", "")
    details["address"] = first_of.get("address", "")
    return details
