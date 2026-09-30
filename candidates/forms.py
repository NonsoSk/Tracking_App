from django import forms

from accounts.models import User
from core.forms import (DOCUMENT_EXTENSIONS, BootstrapMixin, DateInput, MultipleFileField, TagListField,
                        validate_upload)
from requisitions.models import Requisition

from .cv_parser import SUPPORTED_EXTENSIONS
from .models import Candidate, CandidateDocument


def open_requisitions():
    return Requisition.objects.filter(status__in=[Requisition.Status.OPEN, Requisition.Status.APPROVED]).select_related("department")


class CandidateForm(BootstrapMixin, forms.ModelForm):
    skills = TagListField(kind="skill")
    tools = TagListField(kind="tool", label="Tools / software")
    certifications = TagListField(kind="certification")

    class Meta:
        model = Candidate
        fields = [
            "first_name", "last_name", "email", "phone", "gender", "date_of_birth", "location", "linkedin_url",
            "highest_qualification", "course", "institution", "graduation_year", "degree_class", "nysc_status",
            "years_experience", "current_employer", "current_job_title", "skills", "tools", "certifications",
            "summary", "source", "referred_by", "referral_note",
        ]
        widgets = {"date_of_birth": DateInput(), "summary": forms.Textarea(attrs={"rows": 3}),
                   "referral_note": forms.Textarea(attrs={"rows": 2})}


class DocumentUploadForm(BootstrapMixin, forms.Form):
    doc_type = forms.ChoiceField(choices=CandidateDocument.DocType.choices, label="Document type")
    file = forms.FileField()
    read_cv = forms.BooleanField(required=False, initial=True, label="Read this CV and fill empty profile fields")

    def clean_file(self):
        return validate_upload(self.cleaned_data["file"], DOCUMENT_EXTENSIONS)


class IntakeForm(BootstrapMixin, forms.Form):
    """Bulk upload of CVs received by email, hard copy (scanned) or referral."""

    files = MultipleFileField(label="CV files", help_text="PDF, Word, text or scanned images. Select many at once.")
    source = forms.ChoiceField(
        choices=[c for c in Candidate.Source.choices if c[0] not in {"portal", "import"}],
        initial=Candidate.Source.EMAIL,
    )
    requisition = forms.ModelChoiceField(
        queryset=Requisition.objects.none(), required=False,
        help_text="Optional: apply every CV to this vacancy and score it straight away.",
    )
    referred_by = forms.ModelChoiceField(queryset=User.objects.filter(is_active=True), required=False,
                                         label="Referred by (employee)")
    note = forms.CharField(required=False, widget=forms.Textarea(attrs={"rows": 2}))

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["requisition"].queryset = open_requisitions()

    def clean_files(self):
        files = self.cleaned_data["files"]
        if not files:
            raise forms.ValidationError("Choose at least one file.")
        return [validate_upload(f, SUPPORTED_EXTENSIONS) for f in files]


class ReferralForm(BootstrapMixin, forms.Form):
    requisition = forms.ModelChoiceField(queryset=Requisition.objects.none(), label="Vacancy")
    cv = forms.FileField(label="Candidate's CV")
    candidate_email = forms.EmailField(required=False, help_text="Used if the CV has no email address.")
    note = forms.CharField(label="Why is this person a good fit?", widget=forms.Textarea(attrs={"rows": 3}),
                           required=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["requisition"].queryset = open_requisitions()

    def clean_cv(self):
        return validate_upload(self.cleaned_data["cv"], SUPPORTED_EXTENSIONS)


class AddToRequisitionForm(BootstrapMixin, forms.Form):
    requisition = forms.ModelChoiceField(queryset=Requisition.objects.none())

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["requisition"].queryset = open_requisitions()


class SpreadsheetImportForm(BootstrapMixin, forms.Form):
    file = forms.FileField(help_text="Your existing Excel database (.xlsx) or a CSV. The first row must be headers.")
    requisition = forms.ModelChoiceField(queryset=Requisition.objects.none(), required=False,
                                         help_text="Optional: apply everyone in the sheet to this vacancy.")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["requisition"].queryset = open_requisitions()

    def clean_file(self):
        return validate_upload(self.cleaned_data["file"], {".xlsx", ".csv"})
