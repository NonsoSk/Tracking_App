"""Choice lists shared by several apps."""

from django.db import models


class EducationLevel(models.TextChoices):
    SSCE = "ssce", "SSCE / WAEC / NECO"
    OND = "ond", "OND / ND"
    NCE = "nce", "NCE"
    HND = "hnd", "HND"
    BSC = "bsc", "Bachelor's (BSc / BEng / BA / LLB)"
    PGD = "pgd", "Postgraduate Diploma"
    MSC = "msc", "Master's (MSc / MEng / MBA)"
    PHD = "phd", "Doctorate (PhD)"


# Used to compare a candidate's qualification with the minimum required.
EDUCATION_RANK = {
    EducationLevel.SSCE: 1,
    EducationLevel.OND: 2,
    EducationLevel.NCE: 2,
    EducationLevel.HND: 3,
    EducationLevel.BSC: 4,
    EducationLevel.PGD: 5,
    EducationLevel.MSC: 6,
    EducationLevel.PHD: 7,
}


class EmploymentType(models.TextChoices):
    TRAINEE = "trainee", "Graduate Trainee"
    EXPERIENCED = "experienced", "Experienced Hire"
    CONTRACT = "contract", "Contract / Temporary"
    INTERN = "intern", "Intern / IT Student"


# Employment types that skip the offer stage and go straight to onboarding.
TRAINEE_TYPES = {EmploymentType.TRAINEE, EmploymentType.INTERN}


class DegreeClass(models.TextChoices):
    FIRST = "first", "First Class / Distinction"
    SECOND_UPPER = "2_1", "Second Class Upper / Upper Credit"
    SECOND_LOWER = "2_2", "Second Class Lower / Lower Credit"
    THIRD = "third", "Third Class"
    PASS = "pass", "Pass"
    NA = "na", "Not applicable"


DEGREE_CLASS_RANK = {
    DegreeClass.FIRST: 5,
    DegreeClass.SECOND_UPPER: 4,
    DegreeClass.SECOND_LOWER: 3,
    DegreeClass.THIRD: 2,
    DegreeClass.PASS: 1,
}


class NyscStatus(models.TextChoices):
    COMPLETED = "completed", "Completed"
    EXEMPTED = "exempted", "Exempted"
    ONGOING = "ongoing", "Ongoing"
    NOT_YET = "not_yet", "Not yet"
    NA = "na", "Not applicable"
