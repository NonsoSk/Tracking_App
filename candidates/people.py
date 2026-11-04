"""Applicants and staff as one list of people.

Each staff record (``Employee``) is joined to the person's profile in the talent database, so a staff member's
page shows their applications, CBTs, interviews and resume. A staff record joins a profile only when it clearly is
the same person: the same date of birth and the same name (in any order, a middle name may be missing), or the
same email and name, or the same name and a hire through recruitment that started on the day they joined. Staff with no profile get one of
their own (source "Staff list"), so everyone has a page; HR can link or unlink a staff number by hand.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from django.db.models import Exists, OuterRef, Q

from core.workbook_import import full_name_key, name_tokens

STAFF_LIST = "Staff list"
APPLICANTS, STAFF, FORMER = "applicants", "staff", "former"
WHO_CHOICES = [(APPLICANTS, "Applicants not hired yet"), (STAFF, "Current staff"), (FORMER, "Exited or retired")]


def same_name(a: str, b: str) -> bool:
    """The same person's name, written in another order or without a middle name."""
    key_a, key_b = full_name_key(a), full_name_key(b)
    if key_a and key_a == key_b:
        return True
    ta, tb = name_tokens(a), name_tokens(b)
    return len(ta & tb) >= 2 and (ta <= tb or tb <= ta)


def link_staff(*, Candidate=None, Employee=None, Application=None, log=None) -> Counter:
    """Join every staff record not yet joined to its person's profile (creating one when there is none)."""
    if Candidate is None:
        from candidates.models import Candidate
        from core.models import Employee
        from pipeline.models import Application
    stats = Counter()
    staff = list(Employee.objects.filter(candidate__isnull=True, link_fixed=False))
    if not staff:
        return stats
    taken = set(Employee.objects.exclude(candidate=None).values_list("candidate_id", flat=True))
    by_birth = defaultdict(list)
    by_email = defaultdict(list)
    for c in Candidate.objects.filter(~Q(date_of_birth=None) | ~Q(email="")).only(
            "id", "first_name", "last_name", "date_of_birth", "email"):
        if c.date_of_birth:
            by_birth[c.date_of_birth].append(c)
        if c.email:
            by_email[c.email.strip().lower()].append(c)
    by_start = defaultdict(list)
    for app in Application.objects.filter(status="hired").select_related("candidate").only(
            "candidate__id", "candidate__first_name", "candidate__last_name", "candidate__email", "hired_at"):
        if app.hired_at:
            by_start[app.hired_at.date()].append(app.candidate)

    def name(person):  # works on the models used in migrations too
        return f"{person.first_name} {person.last_name}".strip()

    linked, missing = [], []
    for employee in staff:
        found, basis = [], ""
        if employee.date_of_birth:
            found = [c for c in by_birth.get(employee.date_of_birth, []) if same_name(name(employee), name(c))]
            basis = "Same name and date of birth"
        if not found and employee.email:
            found = [c for c in by_email.get(employee.email.strip().lower(), []) if same_name(name(employee), name(c))]
            basis = "Same name and email"
        if not found and employee.date_of_employment:
            found = [c for c in by_start.get(employee.date_of_employment, []) if same_name(name(employee), name(c))]
            basis = "Same name, hired through recruitment the day they joined"
        found = list({c.pk: c for c in found if c.pk not in taken}.values())
        if len(found) == 1:
            employee.candidate, employee.link_note = found[0], basis
            taken.add(found[0].pk)
            linked.append(employee)
            stats["staff joined to their profile"] += 1
        else:
            # None found, or more than one that fits (never guess): a profile of their own, which lists the
            # profiles with the same name so HR can join the right one.
            missing.append((employee, "More than one profile fits: join the right one by hand" if found
                            else "No matching application: profile made from the staff list"))
            if found:
                stats["staff with more than one possible profile (join them by hand)"] += 1
    created = [own_profile(employee, Candidate) for employee, _ in missing]
    Candidate.objects.bulk_create(created, batch_size=500)
    for (employee, note), person in zip(missing, created):
        employee.candidate, employee.link_note = person, note
    Employee.objects.bulk_update(linked + [employee for employee, _ in missing], ["candidate", "link_note"],
                                 batch_size=500)
    stats["staff given a profile of their own"] += len(created)
    if log and (linked or created):
        log(f"Staff joined to their profiles: {len(linked):,}; staff with a profile of their own: {len(created):,}.")
    return stats


def own_profile(employee, Candidate=None):
    """A new (unsaved) profile holding just what the staff list says about someone."""
    if Candidate is None:
        from candidates.models import Candidate
    return Candidate(first_name=employee.first_name[:80], last_name=employee.last_name[:80], email=employee.email,
                     date_of_birth=employee.date_of_birth, source="internal", source_detail=STAFF_LIST,
                     consent_given=False, years_experience=None)


def staff_record(candidate):
    """The person's staff record, or None."""
    from django.core.exceptions import ObjectDoesNotExist

    try:
        return candidate.staff_record
    except ObjectDoesNotExist:
        return None


def hired():
    from pipeline.models import Application

    return Exists(Application.objects.filter(candidate=OuterRef("pk"), status="hired"))


def who_filter(who: str) -> Q:
    """For a queryset annotated with is_hired=hired()."""
    from core.models import Employee

    if who == STAFF:
        return Q(staff_record__status=Employee.Status.ACTIVE) | Q(staff_record__isnull=True, is_hired=True)
    if who == FORMER:
        return Q(staff_record__status__in=Employee.EXITED)
    return Q(staff_record__isnull=True, is_hired=False)


def is_empty_staff_profile(candidate) -> bool:
    """A profile made only to hold a staff record, with nothing else on it (safe to replace when HR links)."""
    return (candidate.source_detail == STAFF_LIST and not candidate.resume_url and not candidate.applications.exists()
            and not candidate.documents.exists() and not candidate.cbt_results.exists()
            and not candidate.interview_records.exists())


def possible_profiles(employee, limit=8):
    """Other profiles with the same name as a staff member, for HR to link by hand."""
    from candidates.models import Candidate
    from core.models import Employee

    tokens = sorted(name_tokens(employee.full_name), key=len, reverse=True)
    if not tokens:
        return []
    word = tokens[0]
    taken = Employee.objects.exclude(candidate=None).values("candidate_id")
    found = (Candidate.objects.filter(Q(first_name__icontains=word) | Q(last_name__icontains=word))
             .exclude(pk__in=taken).order_by("-created_at")[:400])
    return [c for c in found if same_name(employee.full_name, c.full_name)][:limit]

