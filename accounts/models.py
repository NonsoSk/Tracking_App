from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Portal user. The role decides what each person can see and do."""

    class Role(models.TextChoices):
        HR_ADMIN = "hr_admin", "HR Admin"
        RECRUITER = "recruiter", "Hiring Team / Recruiter"
        HOD = "hod", "Head of Department"
        MANAGER = "manager", "Department Manager"
        INTERVIEWER = "interviewer", "Interviewer / Panel Member"
        MANAGEMENT = "management", "Management"
        ONBOARDING = "onboarding", "Onboarding Team"
        EMPLOYEE = "employee", "Employee (referrals)"

    HR_ROLES = {Role.HR_ADMIN, Role.RECRUITER}
    DEPARTMENT_ROLES = {Role.HOD, Role.MANAGER}

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.EMPLOYEE)
    department = models.ForeignKey(
        "core.Department", null=True, blank=True, on_delete=models.SET_NULL, related_name="users"
    )
    job_title = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=30, blank=True)

    class Meta:
        ordering = ["first_name", "last_name", "username"]

    def __str__(self):
        return self.display_name

    @property
    def display_name(self) -> str:
        return self.get_full_name() or self.username

    @property
    def is_hr(self) -> bool:
        return self.is_superuser or self.role in self.HR_ROLES

    @property
    def is_department_user(self) -> bool:
        return self.role in self.DEPARTMENT_ROLES

    @property
    def is_management(self) -> bool:
        return self.role == self.Role.MANAGEMENT

    @property
    def is_onboarding(self) -> bool:
        return self.role == self.Role.ONBOARDING or self.is_hr

    @property
    def can_raise_requisition(self) -> bool:
        return self.is_hr or self.is_department_user

    @property
    def sees_all_departments(self) -> bool:
        return self.is_hr or self.is_management
