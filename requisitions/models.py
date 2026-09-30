from django.conf import settings
from django.db import models
from django.urls import reverse
from django.utils import timezone

from core.choices import DegreeClass, EducationLevel, EmploymentType, TRAINEE_TYPES


class SkillTag(models.Model):
    """Catalogue of skills, tools, certifications and courses used for
    auto-complete, AI suggestions and CV keyword detection."""

    class Kind(models.TextChoices):
        SKILL = "skill", "Skill"
        TOOL = "tool", "Tool / Software / Equipment"
        CERTIFICATION = "certification", "Certification / Licence"
        COURSE = "course", "Course of study"

    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.SKILL)
    job_family = models.CharField(max_length=60, blank=True)
    aliases = models.JSONField(default=list, blank=True, help_text="Other spellings, e.g. [\"MS Excel\", \"Excel\"].")

    class Meta:
        ordering = ["kind", "name"]
        unique_together = [("name", "kind")]

    def __str__(self):
        return self.name


class JobRole(models.Model):
    """Standard roles a department can pick when raising a requisition."""

    title = models.CharField(max_length=150)
    department = models.ForeignKey(
        "core.Department", null=True, blank=True, on_delete=models.SET_NULL, related_name="job_roles",
        help_text="Leave empty if any department can use this role.",
    )
    job_family = models.CharField(max_length=60, blank=True)
    grade = models.CharField(max_length=40, blank=True)
    description = models.TextField(blank=True)
    default_min_experience = models.PositiveSmallIntegerField(default=0)
    default_education = models.CharField(max_length=10, choices=EducationLevel.choices, blank=True)
    default_skills = models.JSONField(default=list, blank=True)
    default_tools = models.JSONField(default=list, blank=True)
    default_certifications = models.JSONField(default=list, blank=True)
    default_courses = models.JSONField(default=list, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["title"]

    def __str__(self):
        return f"{self.title} — {self.department}" if self.department else self.title


class Requisition(models.Model):
    class Reason(models.TextChoices):
        NEW_POSITION = "new", "New position / team expansion"
        RESIGNATION = "resignation", "Replacement — resignation"
        RETIREMENT = "retirement", "Replacement — retirement"
        TERMINATION = "termination", "Replacement — termination / dismissal"
        TRANSFER = "transfer", "Replacement — transfer / promotion"
        TEMPORARY = "temporary", "Temporary / project need"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Awaiting HR review"
        RETURNED = "returned", "Returned for changes"
        PENDING_MANAGEMENT = "pending_management", "Awaiting management approval"
        APPROVED = "approved", "Approved"
        OPEN = "open", "Open — accepting applications"
        ON_HOLD = "on_hold", "On hold"
        FILLED = "filled", "Filled"
        CLOSED = "closed", "Closed"
        CANCELLED = "cancelled", "Cancelled"

    ACTIVE_STATUSES = {Status.APPROVED, Status.OPEN, Status.ON_HOLD}

    reference = models.CharField(max_length=20, unique=True, blank=True)
    department = models.ForeignKey("core.Department", on_delete=models.PROTECT, related_name="requisitions")
    job_role = models.ForeignKey(JobRole, null=True, blank=True, on_delete=models.SET_NULL, related_name="requisitions")
    title = models.CharField("Position title", max_length=150)
    positions = models.PositiveSmallIntegerField("Number of positions", default=1)
    reason = models.CharField(max_length=20, choices=Reason.choices, default=Reason.NEW_POSITION)
    replacing_employee = models.ForeignKey(
        "core.Employee", null=True, blank=True, on_delete=models.SET_NULL, related_name="replacement_requisitions"
    )
    employment_type = models.CharField(max_length=20, choices=EmploymentType.choices, default=EmploymentType.EXPERIENCED)
    grade = models.CharField(max_length=40, blank=True)
    location = models.CharField(max_length=120, default="Eleme, Rivers State")

    # Requirements used by the matching engine
    min_experience_years = models.PositiveSmallIntegerField(default=0)
    max_experience_years = models.PositiveSmallIntegerField(null=True, blank=True)
    education_level = models.CharField(
        "Minimum qualification", max_length=10, choices=EducationLevel.choices, default=EducationLevel.BSC
    )
    min_degree_class = models.CharField(
        "Minimum class of degree", max_length=10, blank=True,
        choices=[c for c in DegreeClass.choices if c[0] != DegreeClass.NA],
    )
    requires_nysc = models.BooleanField("NYSC must be completed / exempted", default=False)
    courses = models.JSONField("Accepted courses / disciplines", default=list, blank=True)
    certifications = models.JSONField(default=list, blank=True)
    required_skills = models.JSONField(default=list, blank=True)
    preferred_skills = models.JSONField("Nice-to-have skills", default=list, blank=True)
    tools = models.JSONField("Tools / software / equipment", default=list, blank=True)
    other_requirements = models.TextField(blank=True, help_text="E.g. NYSC completed, willingness to work shifts.")

    justification = models.TextField(blank=True)
    job_description = models.TextField("Job description / responsibilities", blank=True)
    advert = models.TextField("Public job advert", blank=True, help_text="Shown on the careers page.")
    target_start_date = models.DateField(null=True, blank=True)
    closing_date = models.DateField("Application closing date", null=True, blank=True)

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT, db_index=True)
    raised_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="requisitions_raised")
    hr_owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="requisitions_owned",
        verbose_name="Assigned recruiter",
    )
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    approved_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.reference} · {self.title}"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if not self.reference:
            self.reference = f"REQ-{timezone.now():%Y}-{self.pk:04d}"
            super().save(update_fields=["reference"])

    def get_absolute_url(self):
        return reverse("requisitions:detail", args=[self.pk])

    @property
    def is_trainee_track(self) -> bool:
        return self.employment_type in TRAINEE_TYPES

    @property
    def is_accepting_applications(self) -> bool:
        if self.status != self.Status.OPEN:
            return False
        return not self.closing_date or self.closing_date >= timezone.localdate()

    @property
    def is_editable_by_department(self) -> bool:
        return self.status in {self.Status.DRAFT, self.Status.RETURNED}

    @property
    def hired_count(self) -> int:
        return self.applications.filter(stage="hired").count()

    @property
    def status_color(self) -> str:
        return {
            "draft": "secondary",
            "submitted": "warning",
            "returned": "danger",
            "pending_management": "warning",
            "approved": "info",
            "open": "success",
            "on_hold": "secondary",
            "filled": "primary",
            "closed": "dark",
            "cancelled": "dark",
        }.get(self.status, "secondary")


class RequisitionNote(models.Model):
    """Message thread between the hiring team and the department."""

    requisition = models.ForeignKey(Requisition, on_delete=models.CASCADE, related_name="notes")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
