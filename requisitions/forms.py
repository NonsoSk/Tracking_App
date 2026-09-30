from django import forms
from django.db.models import Q

from accounts.models import User
from core.forms import BootstrapMixin, DateInput, TagListField
from core.models import Department, Employee

from .models import JobRole, Requisition


class RequisitionForm(BootstrapMixin, forms.ModelForm):
    required_skills = TagListField(kind="skill", label="Required skills")
    preferred_skills = TagListField(kind="skill", label="Nice-to-have skills")
    tools = TagListField(kind="tool", label="Tools / software / equipment")
    certifications = TagListField(kind="certification", label="Certifications / licences")
    courses = TagListField(kind="course", label="Accepted courses of study")

    class Meta:
        model = Requisition
        fields = [
            "department", "job_role", "title", "positions", "employment_type", "grade", "location",
            "reason", "replacing_employee",
            "min_experience_years", "max_experience_years", "education_level", "min_degree_class", "requires_nysc",
            "courses",
            "required_skills", "preferred_skills", "tools", "certifications", "other_requirements",
            "job_description", "justification", "target_start_date",
        ]
        widgets = {
            "target_start_date": DateInput(),
            "job_description": forms.Textarea(attrs={"rows": 4}),
            "justification": forms.Textarea(attrs={"rows": 3}),
            "other_requirements": forms.Textarea(attrs={"rows": 2}),
        }
        help_texts = {
            "job_role": "Pick a standard role to pre-fill requirements, or type a new title below.",
            "justification": "Why is this hire needed?",
        }

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user
        self.fields["department"].queryset = Department.objects.filter(is_active=True)
        roles = JobRole.objects.filter(is_active=True)
        employees = Employee.objects.select_related("department")
        if user and not user.sees_all_departments and user.department_id:
            self.fields["department"].queryset = Department.objects.filter(pk=user.department_id)
            self.fields["department"].initial = user.department_id
            roles = roles.filter(Q(department__isnull=True) | Q(department_id=user.department_id))
            employees = employees.filter(department_id=user.department_id)
        self.fields["job_role"].queryset = roles
        self.fields["job_role"].required = False
        self.fields["replacing_employee"].queryset = employees
        self.fields["replacing_employee"].required = False
        self.fields["job_role"].widget.attrs["data-role-select"] = "1"
        self.fields["title"].widget.attrs["data-role-title"] = "1"

    def clean(self):
        data = super().clean()
        low, high = data.get("min_experience_years"), data.get("max_experience_years")
        if high is not None and low is not None and high < low:
            self.add_error("max_experience_years", "Must be at least the minimum.")
        reason = data.get("reason")
        if reason and reason != Requisition.Reason.NEW_POSITION and reason != Requisition.Reason.TEMPORARY \
                and not data.get("replacing_employee"):
            self.add_error("replacing_employee", "Select the employee being replaced.")
        return data


class ReturnForm(BootstrapMixin, forms.Form):
    reason = forms.CharField(widget=forms.Textarea(attrs={"rows": 3}), label="What needs to change?")


class ApproveForm(BootstrapMixin, forms.Form):
    hr_owner = forms.ModelChoiceField(
        queryset=User.objects.filter(role__in=User.HR_ROLES, is_active=True), required=False,
        label="Assign recruiter",
    )


class PublishForm(BootstrapMixin, forms.Form):
    closing_date = forms.DateField(widget=DateInput(), required=False, label="Application closing date")


class NoteForm(BootstrapMixin, forms.Form):
    message = forms.CharField(widget=forms.Textarea(attrs={"rows": 2, "placeholder": "Write a message…"}), label="")


class AdvertForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Requisition
        fields = ["advert", "closing_date"]
        widgets = {"advert": forms.Textarea(attrs={"rows": 14}), "closing_date": DateInput()}
