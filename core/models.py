from datetime import date

from django.conf import settings
from django.db import models
from django.utils import timezone


def add_years(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:  # 29 February
        return d.replace(year=d.year + years, day=28)


class Department(models.Model):
    name = models.CharField(max_length=150, unique=True)
    code = models.CharField(max_length=20, unique=True)
    hod = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="headed_departments",
        verbose_name="Head of department",
    )
    email = models.EmailField(blank=True, help_text="Department mailbox copied on notifications.")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def contacts(self):
        """Users who should hear about this department's hiring."""
        from accounts.models import User

        users = list(
            User.objects.filter(department=self, is_active=True, role__in=User.DEPARTMENT_ROLES)
        )
        if self.hod and self.hod not in users:
            users.append(self.hod)
        return users


class Employee(models.Model):
    """Staff record used to forecast retirements and replacements."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        RESIGNED = "resigned", "Resigned"
        RETIRED = "retired", "Retired"
        TERMINATED = "terminated", "Terminated / Dismissed"
        TRANSFERRED = "transferred", "Transferred"

    staff_id = models.CharField(max_length=30, unique=True)
    first_name = models.CharField(max_length=80)
    last_name = models.CharField(max_length=80)
    email = models.EmailField(blank=True)
    department = models.ForeignKey(Department, null=True, blank=True, on_delete=models.SET_NULL, related_name="employees")
    job_title = models.CharField(max_length=150, blank=True)
    grade = models.CharField(max_length=40, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    date_of_employment = models.DateField(null=True, blank=True)
    retirement_date = models.DateField(null=True, blank=True, editable=False, db_index=True)
    company = models.CharField(max_length=60, blank=True, help_text="E.g. IEFCL, IEPL.")
    business_unit = models.CharField(max_length=20, blank=True, db_index=True, help_text="E.g. IFZ, IPL, IFF, MMFZE.")
    location = models.CharField(max_length=120, blank=True)
    category = models.CharField(max_length=60, blank=True, help_text="E.g. Staff Regular, Trainee-DET.")
    work_status = models.CharField(max_length=40, blank=True, help_text="E.g. Confirmed, Probation, Trainee.")
    source_record = models.JSONField(default=dict, blank=True, editable=False,
                                     help_text="The staff-list row this record was imported from (salary is never stored).")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    exit_date = models.DateField(null=True, blank=True)
    replacement_notified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["last_name", "first_name"]

    def __str__(self):
        return f"{self.full_name} ({self.staff_id})"

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    def compute_retirement_date(self):
        rules = settings.RECRUITMENT
        candidates = []
        if self.date_of_birth:
            candidates.append(add_years(self.date_of_birth, rules["RETIREMENT_AGE"]))
        if self.date_of_employment and rules["RETIREMENT_MAX_SERVICE_YEARS"]:
            candidates.append(add_years(self.date_of_employment, rules["RETIREMENT_MAX_SERVICE_YEARS"]))
        return min(candidates) if candidates else None

    def save(self, *args, **kwargs):
        self.retirement_date = self.compute_retirement_date()
        super().save(*args, **kwargs)

    @property
    def months_to_retirement(self):
        if not self.retirement_date:
            return None
        today = timezone.localdate()
        return (self.retirement_date.year - today.year) * 12 + (self.retirement_date.month - today.month)

    @property
    def needs_replacement(self) -> bool:
        return self.status in {self.Status.RESIGNED, self.Status.TERMINATED, self.Status.RETIRED, self.Status.TRANSFERRED}


class Notification(models.Model):
    class Level(models.TextChoices):
        INFO = "info", "Info"
        SUCCESS = "success", "Success"
        WARNING = "warning", "Warning"
        DANGER = "danger", "Action needed"

    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    title = models.CharField(max_length=200)
    message = models.TextField(blank=True)
    url = models.CharField(max_length=500, blank=True)
    level = models.CharField(max_length=10, choices=Level.choices, default=Level.INFO)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["recipient", "is_read"])]

    def __str__(self):
        return self.title


class LinkedWorkbook(models.Model):
    """An Excel workbook the portal keeps itself in step with (see core/excel_link.py)."""

    class State(models.TextChoices):
        WAITING = "waiting", "Waiting for the first refresh"
        OK = "ok", "Up to date"
        ERROR = "error", "Could not be read"
        MISSING = "missing", "File not found"

    path = models.CharField(max_length=500, unique=True, help_text="Full path of the .xlsx file on the computer running the portal.")
    sheets = models.CharField(max_length=255, blank=True, help_text="The recruitment sheets found in it.")
    state = models.CharField(max_length=10, choices=State.choices, default=State.WAITING)
    message = models.TextField(blank=True)
    counts = models.JSONField(default=dict, blank=True)
    fingerprint = models.CharField(max_length=64, blank=True, help_text="SHA-256 of the copy last loaded.")
    file_modified_at = models.DateTimeField(null=True, blank=True)
    checked_at = models.DateTimeField(null=True, blank=True)
    synced_at = models.DateTimeField(null=True, blank=True)
    report_path = models.CharField(max_length=500, blank=True)
    refresh_requested = models.BooleanField(default=False)
    linked_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return self.name

    @property
    def name(self) -> str:
        return self.path.replace("\\", "/").rsplit("/", 1)[-1]
