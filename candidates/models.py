import os
import uuid

from django.conf import settings
from django.db import models
from django.urls import reverse

from core.choices import DegreeClass, EducationLevel, NyscStatus


class Candidate(models.Model):
    class Source(models.TextChoices):
        PORTAL = "portal", "Online application (careers page)"
        REFERRAL = "referral", "Employee referral"
        EMAIL = "email", "CV sent by email"
        HARD_COPY = "hard_copy", "Hard copy / walk-in"
        AGENCY = "agency", "Recruitment agency"
        INTERNAL = "internal", "Internal candidate"
        IMPORT = "import", "Imported from spreadsheet"

    class ParseMethod(models.TextChoices):
        NONE = "", "Not parsed"
        AI = "ai", "AI extraction"
        HEURISTIC = "heuristic", "Rule-based extraction"
        FORM = "form", "Candidate form"

    first_name = models.CharField(max_length=80, blank=True)
    last_name = models.CharField(max_length=80, blank=True)
    email = models.EmailField(blank=True, db_index=True)
    phone = models.CharField(max_length=40, blank=True, db_index=True)
    gender = models.CharField(max_length=10, blank=True, choices=[("male", "Male"), ("female", "Female")])
    date_of_birth = models.DateField(null=True, blank=True)
    location = models.CharField("Current location", max_length=120, blank=True)
    linkedin_url = models.URLField(blank=True)

    highest_qualification = models.CharField(max_length=10, choices=EducationLevel.choices, blank=True)
    course = models.CharField("Course of study", max_length=150, blank=True)
    institution = models.CharField(max_length=200, blank=True)
    graduation_year = models.PositiveSmallIntegerField(null=True, blank=True)
    degree_class = models.CharField(max_length=10, choices=DegreeClass.choices, blank=True)
    nysc_status = models.CharField("NYSC status", max_length=10, choices=NyscStatus.choices, blank=True)

    years_experience = models.DecimalField(max_digits=4, decimal_places=1, default=0)
    current_employer = models.CharField(max_length=150, blank=True)
    current_job_title = models.CharField(max_length=150, blank=True)

    skills = models.JSONField(default=list, blank=True)
    tools = models.JSONField(default=list, blank=True)
    certifications = models.JSONField(default=list, blank=True)
    education_history = models.JSONField(default=list, blank=True)
    work_history = models.JSONField(default=list, blank=True)
    summary = models.TextField(blank=True)

    source = models.CharField(max_length=20, choices=Source.choices, default=Source.PORTAL)
    referred_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="referrals"
    )
    referral_note = models.TextField(blank=True)

    cv_text = models.TextField(blank=True, help_text="Text read from the CV; used for keyword matching.")
    parse_method = models.CharField(max_length=10, choices=ParseMethod.choices, blank=True)
    parse_notes = models.TextField(blank=True)
    parsed_at = models.DateTimeField(null=True, blank=True)

    consent_given = models.BooleanField(default=False, help_text="Candidate agreed to data processing (NDPA 2023).")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.full_name

    def get_absolute_url(self):
        return reverse("candidates:detail", args=[self.pk])

    @property
    def full_name(self) -> str:
        name = f"{self.first_name} {self.last_name}".strip()
        return name or self.email or f"Candidate #{self.pk}"

    @property
    def qualification_short(self) -> str:
        return {"ssce": "SSCE", "ond": "OND", "nce": "NCE", "hnd": "HND", "bsc": "BSc / BEng", "pgd": "PGD",
                "msc": "MSc / MBA", "phd": "PhD"}.get(self.highest_qualification, "—")

    @property
    def degree_class_short(self) -> str:
        return {"first": "1st", "2_1": "2:1", "2_2": "2:2", "third": "3rd", "pass": "Pass"}.get(self.degree_class, "")

    @property
    def source_short(self) -> str:
        return {"portal": "Careers page", "referral": "Referral", "email": "Emailed CV", "hard_copy": "Hard copy",
                "agency": "Agency", "internal": "Internal", "import": "Spreadsheet"}.get(self.source, self.source)

    @property
    def initials(self) -> str:
        parts = [p for p in (self.first_name, self.last_name) if p]
        return "".join(p[0] for p in parts).upper() or "?"

    @property
    def latest_cv(self):
        return self.documents.filter(doc_type=CandidateDocument.DocType.CV).order_by("-uploaded_at").first()

    @property
    def profile_completeness(self) -> int:
        checks = [
            self.first_name, self.last_name, self.email, self.phone, self.highest_qualification,
            self.course, self.institution, self.skills, self.years_experience is not None, self.location,
        ]
        return round(100 * sum(1 for c in checks if c) / len(checks))


def document_upload_path(instance, filename):
    ext = os.path.splitext(filename)[1].lower()
    return f"candidates/{instance.candidate_id or 'new'}/{uuid.uuid4().hex}{ext}"


class CandidateDocument(models.Model):
    """Every file in a candidate's folder: CV, certificates, IDs, reports."""

    class DocType(models.TextChoices):
        CV = "cv", "CV / Résumé"
        COVER_LETTER = "cover_letter", "Cover letter"
        DEGREE = "degree", "Degree / Diploma certificate"
        TRANSCRIPT = "transcript", "Academic transcript"
        SSCE = "ssce", "WAEC / NECO result"
        NYSC = "nysc", "NYSC certificate / exemption"
        PROFESSIONAL = "professional", "Professional certificate"
        ID = "id", "Means of identification"
        BIRTH = "birth", "Birth certificate / age declaration"
        LGA = "lga", "Local government / state of origin letter"
        REFERENCE = "reference", "Reference / guarantor letter"
        MEDICAL = "medical", "Medical report"
        SIGNED_OFFER = "signed_offer", "Signed offer letter"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending review"
        VERIFIED = "verified", "Verified"
        REJECTED = "rejected", "Rejected"

    candidate = models.ForeignKey(Candidate, on_delete=models.CASCADE, related_name="documents")
    application = models.ForeignKey(
        "pipeline.Application", null=True, blank=True, on_delete=models.SET_NULL, related_name="documents"
    )
    doc_type = models.CharField(max_length=20, choices=DocType.choices, default=DocType.CV)
    file = models.FileField(upload_to=document_upload_path)
    original_name = models.CharField(max_length=255, blank=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    uploaded_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.CharField(max_length=255, blank=True)
    is_parsed = models.BooleanField(default=False)

    class Meta:
        ordering = ["doc_type", "-uploaded_at"]

    def __str__(self):
        return f"{self.get_doc_type_display()} — {self.original_name or self.file.name}"

    @property
    def extension(self) -> str:
        return os.path.splitext(self.original_name or self.file.name)[1].lower().lstrip(".")

    @property
    def icon(self) -> str:
        return {
            "pdf": "bi-file-earmark-pdf",
            "doc": "bi-file-earmark-word",
            "docx": "bi-file-earmark-word",
            "jpg": "bi-file-earmark-image",
            "jpeg": "bi-file-earmark-image",
            "png": "bi-file-earmark-image",
            "tif": "bi-file-earmark-image",
            "tiff": "bi-file-earmark-image",
        }.get(self.extension, "bi-file-earmark-text")
