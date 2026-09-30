from decimal import Decimal

from django import forms
from django.db.models import Q
from django.utils import timezone

from accounts.models import User
from candidates.models import CandidateDocument
from core.forms import BootstrapMixin, DateInput, DateTimeInput, validate_upload

from .models import Application, Evaluation, EvaluationCriterion, Interview, MedicalCheck, Offer, Onboarding, Stage


def panel_queryset(application=None):
    qs = User.objects.filter(is_active=True).exclude(role=User.Role.EMPLOYEE)
    if application is not None:
        qs = User.objects.filter(
            Q(is_active=True) & (~Q(role=User.Role.EMPLOYEE) | Q(department=application.requisition.department))
        )
    return qs.order_by("first_name")


class InterviewForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Interview
        fields = ["round", "scheduled_at", "duration_minutes", "mode", "location", "meeting_link", "panel", "instructions"]
        widgets = {
            "scheduled_at": DateTimeInput(),
            "panel": forms.SelectMultiple(attrs={"size": 8}),
            "instructions": forms.Textarea(attrs={"rows": 2, "placeholder": "e.g. Bring your original certificates."}),
        }
        labels = {"scheduled_at": "Date & time", "panel": "Interview panel"}

    def __init__(self, *args, application=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["panel"].queryset = panel_queryset(application)
        self.fields["panel"].help_text = "Hold Ctrl / Cmd to select several people."

    def clean_scheduled_at(self):
        value = self.cleaned_data["scheduled_at"]
        if value < timezone.now() - timezone.timedelta(minutes=5):
            raise forms.ValidationError("Choose a time in the future.")
        return value


class EvaluationForm(BootstrapMixin, forms.Form):
    """The paper Selection Report: one marks field per criterion."""

    remarks = forms.CharField(widget=forms.Textarea(attrs={"rows": 3}), required=False)
    recommendation = forms.ChoiceField(choices=Evaluation.Recommendation.choices, widget=forms.RadioSelect)

    def __init__(self, *args, criteria=(), evaluation=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.criteria = list(criteria)
        existing = {s.criterion_id: s.marks for s in evaluation.scores.all()} if evaluation else {}
        for criterion in self.criteria:
            self.fields[f"c_{criterion.pk}"] = forms.DecimalField(
                label=criterion.name, min_value=0, max_value=criterion.max_marks, decimal_places=1,
                initial=existing.get(criterion.pk),
                widget=forms.NumberInput(attrs={"class": "form-control marks-input", "step": "0.5",
                                                "data-max": criterion.max_marks}),
            )
        if evaluation:
            self.fields["remarks"].initial = evaluation.remarks
            self.fields["recommendation"].initial = evaluation.recommendation

    def criterion_fields(self):
        return [(c, self[f"c_{c.pk}"]) for c in self.criteria]


class DecisionForm(BootstrapMixin, forms.Form):
    decision = forms.ChoiceField(choices=Application.Decision.choices, widget=forms.RadioSelect)
    notes = forms.CharField(widget=forms.Textarea(attrs={"rows": 2}), required=False, label="Remarks")
    email_candidate = forms.BooleanField(required=False, initial=True,
                                         label="Email the candidate (document request or regret letter)")


class StatusForm(BootstrapMixin, forms.Form):
    status = forms.ChoiceField(choices=[c for c in Application.Status.choices if c[0] != "hired"])
    reason = forms.CharField(required=False)
    email_candidate = forms.BooleanField(required=False, label="Send the candidate a regret email")


class MoveStageForm(BootstrapMixin, forms.Form):
    stage = forms.ChoiceField(choices=Stage.choices)


class DocumentReviewForm(BootstrapMixin, forms.Form):
    status = forms.ChoiceField(choices=CandidateDocument.Status.choices)
    note = forms.CharField(required=False)


class OfferForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Offer
        fields = ["job_title", "grade", "annual_salary", "benefits", "start_date", "expires_on", "negotiation_notes", "letter"]
        widgets = {
            "start_date": DateInput(), "expires_on": DateInput(),
            "benefits": forms.Textarea(attrs={"rows": 3}),
            "negotiation_notes": forms.Textarea(attrs={"rows": 3}),
        }

    def clean_letter(self):
        letter = self.cleaned_data.get("letter")
        if letter and hasattr(letter, "size"):
            validate_upload(letter, {".pdf", ".docx"})
        return letter


class ManagementReviewForm(BootstrapMixin, forms.Form):
    decision = forms.ChoiceField(choices=Offer.ManagementDecision.choices, widget=forms.RadioSelect)
    new_salary = forms.DecimalField(required=False, min_value=Decimal("0"), label="Revised annual salary (₦)")
    new_benefits = forms.CharField(required=False, widget=forms.Textarea(attrs={"rows": 2}), label="Revised benefits")
    comment = forms.CharField(required=False, widget=forms.Textarea(attrs={"rows": 3}))

    def clean(self):
        data = super().clean()
        if data.get("decision") == Offer.ManagementDecision.REVISE and not data.get("new_salary"):
            self.add_error("new_salary", "Enter the revised salary.")
        return data


class MedicalForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = MedicalCheck
        fields = ["scheduled_for", "facility", "notes"]
        widgets = {"scheduled_for": DateTimeInput(), "notes": forms.Textarea(attrs={"rows": 2})}


class MedicalResultForm(BootstrapMixin, forms.Form):
    result = forms.ChoiceField(choices=[c for c in MedicalCheck.Result.choices if c[0] != "scheduled"])
    notes = forms.CharField(required=False, widget=forms.Textarea(attrs={"rows": 2}))
    report = forms.FileField(required=False)

    def clean_report(self):
        report = self.cleaned_data.get("report")
        return validate_upload(report, {".pdf", ".jpg", ".jpeg", ".png", ".docx"}) if report else report


class OnboardingForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Onboarding
        fields = ["start_date", "officer", "staff_id", "notes"]
        widgets = {"start_date": DateInput(), "notes": forms.Textarea(attrs={"rows": 3})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["officer"].queryset = User.objects.filter(
            is_active=True, role__in=[User.Role.ONBOARDING, User.Role.HR_ADMIN, User.Role.RECRUITER]
        )


class OnboardingTaskForm(BootstrapMixin, forms.Form):
    title = forms.CharField(max_length=200, label="", widget=forms.TextInput(attrs={"placeholder": "Add a task…"}))
