from datetime import date

from django.conf import settings
from django.db import models
from django.utils import timezone


def retirement_date_for(born, joined, retirement_age=None):
    """The staff list's own retirement age when it gives one; otherwise the rule in the settings
    (RETIREMENT_AGE, or RETIREMENT_MAX_SERVICE_YEARS of service, whichever comes first)."""
    if born and retirement_age:
        return add_years(born, retirement_age)
    rules = settings.RECRUITMENT
    dates = []
    if born:
        dates.append(add_years(born, rules["RETIREMENT_AGE"]))
    if joined and rules["RETIREMENT_MAX_SERVICE_YEARS"]:
        dates.append(add_years(joined, rules["RETIREMENT_MAX_SERVICE_YEARS"]))
    return min(dates) if dates else None


def implied_retirement_age(age, years_left):
    """Age + Years to Retirement on the staff list, when both are there and sensible."""
    if age is None or years_left is None:
        return None
    total = int(round(float(age) + float(years_left)))
    return total if 45 <= total <= 75 else None


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
    retirement_age = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="As the staff list gives it (Age + Years to Retirement). Empty: the "
                                         "retirement rule in the settings is used.")
    # The person's profile in the talent database (their applications, CBTs, interviews and resume).
    candidate = models.OneToOneField("candidates.Candidate", null=True, blank=True, on_delete=models.SET_NULL,
                                     related_name="staff_record")
    link_note = models.CharField("How the profile was found", max_length=120, blank=True)
    link_fixed = models.BooleanField(default=False, help_text="Linked or unlinked by HR: automatic linking leaves it.")

    EXITED = {Status.RESIGNED, Status.RETIRED, Status.TERMINATED, Status.TRANSFERRED}

    class Meta:
        ordering = ["last_name", "first_name"]

    def __str__(self):
        return f"{self.full_name} ({self.staff_id})"

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    def compute_retirement_date(self):
        return retirement_date_for(self.date_of_birth, self.date_of_employment, self.retirement_age)

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
    """An Excel workbook the portal keeps itself in step with (see core/excel_link.py).

    Either one file (``mode=file``: ``path`` is the file) or the newest file in a folder whose name fits a pattern
    (``mode=latest``: ``path`` is the folder, ``pattern`` e.g. ``Recruitment Master Weekly Report*.xlsx``), for a
    team that saves a new dated workbook every week. A workbook on a PC the server cannot reach is sent by that PC's
    connector (``connector``)."""

    class State(models.TextChoices):
        WAITING = "waiting", "Waiting for the first refresh"
        OK = "ok", "Up to date"
        ERROR = "error", "Could not be read"
        MISSING = "missing", "File not found"
        OFFLINE = "offline", "Source offline"
        INVALID = "invalid", "Columns not recognised"

    class Mode(models.TextChoices):
        FILE = "file", "One file"
        LATEST = "latest", "The newest file in a folder that fits a pattern"

    path = models.CharField(max_length=500, help_text="Full path of the .xlsx file (or, for the newest file in a folder, "
                                                      "the folder) as the worker sees it.")
    mode = models.CharField(max_length=10, choices=Mode.choices, default=Mode.FILE)
    pattern = models.CharField(max_length=200, blank=True, help_text="For the newest file in a folder: the file names "
                                                                     "to consider, e.g. 'Recruitment Master*.xlsx'.")
    current_file = models.CharField(max_length=700, blank=True, help_text="The file last loaded.")
    expected_sheets = models.CharField(max_length=255, blank=True, help_text="Sheet kinds every new file must hold "
                                                                             "(set when the source is linked).")
    row_hashes = models.JSONField(default=dict, blank=True, help_text="Fingerprints of the rows last loaded, per "
                                                                      "sheet, so a refresh reads only changed rows.")
    connector = models.ForeignKey("intake.Connector", null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name="workbooks")
    received_at = models.DateTimeField(null=True, blank=True, help_text="When the last changed save was received.")
    last_latency = models.FloatField(null=True, blank=True, help_text="Seconds from that save to the change being "
                                                                      "in the portal.")
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
        constraints = [models.UniqueConstraint(fields=["path", "pattern"], name="one_link_per_workbook_source")]

    def __str__(self):
        return self.name

    @property
    def name(self) -> str:
        if self.mode == self.Mode.LATEST:
            return self.pattern or self.path.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
        return self.path.replace("\\", "/").rsplit("/", 1)[-1]

    @property
    def current_name(self) -> str:
        return (self.current_file or self.path).replace("\\", "/").rsplit("/", 1)[-1]


class WatchedFolder(models.Model):
    """A folder the portal reads CVs from on its own: every new or changed file in it becomes a receipt, then a profile
    (see core/cv_folder.py and intake/). Files in the folder are never moved, renamed or deleted.

    A folder is *Linked* only once the worker (or, for a folder on a PC, that PC's connector) has opened it; until then
    it is *Waiting for the worker*."""

    class State(models.TextChoices):
        PENDING = "pending", "Waiting for the worker to confirm access"
        OK = "ok", "Linked"
        MISSING = "missing", "Unavailable"
        ERROR = "error", "Could not be read"

    class Location(models.TextChoices):
        SERVER = "server", "A folder the portal's worker can open"
        CONNECTOR = "connector", "A folder on a PC, sent by its connector"

    path = models.CharField(max_length=500, unique=True,
                            help_text="Full path of the folder as the worker (or the connector's PC) sees it.")
    label = models.CharField("Name", max_length=120, blank=True, help_text="A name for the folder, e.g. 'Emailed CVs'.")
    location = models.CharField(max_length=10, choices=Location.choices, default=Location.SERVER)
    connector = models.ForeignKey("intake.Connector", null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name="folders")
    include_subfolders = models.BooleanField(default=True)
    import_existing = models.BooleanField("Import the files already there", default=True,
                                          help_text="Unticked: only files added after the link are read.")
    baseline_done = models.BooleanField(default=False, help_text="The first look at the folder has been made.")
    verified_at = models.DateTimeField(null=True, blank=True, help_text="When the worker last opened it.")
    last_success_at = models.DateTimeField(null=True, blank=True, help_text="Last complete check without errors.")
    source = models.CharField("Channel", max_length=20, default="email",
                              help_text="How these CVs reached IEFCL (recorded on each profile).")
    requisition = models.ForeignKey("requisitions.Requisition", null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name="+", help_text="Optional: apply each CV to this vacancy.")
    region = models.CharField("Community category", max_length=20, blank=True,
                              help_text="Optional: every CV read from this folder is put in this group.")
    state = models.CharField(max_length=10, choices=State.choices, default=State.OK)
    message = models.CharField(max_length=500, blank=True)
    files_read = models.PositiveIntegerField(default=0)
    checked_at = models.DateTimeField(null=True, blank=True)
    last_read_at = models.DateTimeField(null=True, blank=True)
    check_requested = models.BooleanField(default=False)
    linked_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return self.path

    @property
    def name(self) -> str:
        return self.label or self.path.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1] or self.path

    @property
    def linked(self) -> bool:
        return self.state == self.State.OK


class FolderFile(models.Model):
    """A file seen in a watched folder, so each one is read once (and again only when its content changes)."""

    folder = models.ForeignKey(WatchedFolder, on_delete=models.CASCADE, related_name="files")
    name = models.CharField(max_length=500, help_text="Path inside the folder.")
    size = models.BigIntegerField(default=0)
    modified = models.FloatField(default=0)
    digest = models.CharField(max_length=64, blank=True, db_index=True)
    candidate = models.ForeignKey("candidates.Candidate", null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name="+")
    skipped = models.CharField(max_length=255, blank=True, help_text="Why the file was not read (if it was not).")
    seen_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-seen_at"]
        constraints = [models.UniqueConstraint(fields=["folder", "name"], name="unique_file_in_folder")]

    def __str__(self):
        return self.name


class PortalUpdatesFile(models.Model):
    """The 'Portal updates.xlsx' workbook the portal keeps beside the linked workbooks (see core/excel_updates.py)."""

    path = models.CharField(max_length=500, blank=True)
    signature = models.CharField(max_length=64, blank=True, help_text="What the portal held when it was last written.")
    written_at = models.DateTimeField(null=True, blank=True)
    rows = models.JSONField(default=dict, blank=True)
    message = models.CharField(max_length=500, blank=True)
    write_requested = models.BooleanField(default=False)

    def __str__(self):
        return self.path or "Portal updates.xlsx"

    @classmethod
    def current(cls) -> "PortalUpdatesFile":
        return cls.objects.get_or_create(pk=1)[0]
