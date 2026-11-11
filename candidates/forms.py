from django import forms
from django.conf import settings

from accounts.models import User
from core.forms import (DOCUMENT_EXTENSIONS, BootstrapMixin, DateInput, MultipleFileField, MultipleFileInput,
                        TagListField, validate_upload)
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
            "summary", "source", "referred_by", "referral_note", "state_of_origin", "lga", "country", "region",
        ]
        widgets = {"date_of_birth": DateInput(), "summary": forms.Textarea(attrs={"rows": 3}),
                   "referral_note": forms.Textarea(attrs={"rows": 2})}
        help_texts = {"region": "Leave empty to take it from the recruitment records (the community column, or the "
                                "state). A group chosen here is kept when the workbooks are loaded again."}

    def save(self, commit=True):
        if "region" in self.changed_data:
            self.instance.region_fixed = bool(self.instance.region)
            self.instance.region_note = "Set by HR" if self.instance.region else ""
        return super().save(commit)


CHECK_GROUPS = [
    ("Person", ["first_name", "last_name", "email", "phone", "gender", "date_of_birth", "state_of_origin", "lga",
                "location"]),
    ("Education", ["highest_qualification", "course", "institution", "graduation_year", "degree_class", "nysc_status"]),
    ("Experience", ["years_experience", "current_job_title", "current_employer", "summary"]),
    ("Skills", ["skills", "tools", "certifications"]),
]


class ProfileCheckForm(CandidateForm):
    """What HR checks against the CV before a profile read from it can be matched or put forward."""

    # Shown as "not found in the CV" when empty, so HR looks for them.
    KEY_FIELDS = ["first_name", "last_name", "email", "phone", "highest_qualification", "course", "years_experience",
                  "nysc_status", "date_of_birth", "state_of_origin"]

    class Meta(CandidateForm.Meta):
        fields = [name for _, names in CHECK_GROUPS for name in names]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["first_name"].required = True
        self.fields["last_name"].required = True
        self.fields["summary"].widget.attrs["rows"] = 4

    def clean(self):
        data = super().clean()
        email, phone = data.get("email"), data.get("phone")
        if not email and not phone:
            raise forms.ValidationError("Give an email address or a phone number, so the candidate can be contacted.")
        others = Candidate.objects.exclude(pk=self.instance.pk)
        if email:
            other = others.filter(email__iexact=email).first()
            if other:
                self.add_error("email", f"{other.full_name} already has this email address. If it is the same "
                                        "person, delete this copy and add the CV to their profile.")
        return data

    def grouped(self):
        return [(title, [self[name] for name in names]) for title, names in CHECK_GROUPS]

    def missing(self):
        return [self.fields[name].label for name in self.KEY_FIELDS
                if self.initial.get(name) in (None, "", [], 0) and not self.is_bound]


class DocumentUploadForm(BootstrapMixin, forms.Form):
    doc_type = forms.ChoiceField(choices=CandidateDocument.DocType.choices, label="Document type")
    file = forms.FileField()
    read_cv = forms.BooleanField(required=False, initial=True, label="Read this CV and fill empty profile fields")

    def clean_file(self):
        return validate_upload(self.cleaned_data["file"], DOCUMENT_EXTENSIONS)


class IntakeForm(BootstrapMixin, forms.Form):
    """Bulk upload of CVs received by email, hard copy (scanned) or referral."""

    files = MultipleFileField(label="CV files", help_text="PDF, Word, text or scanned images. Select many at once.",
                              widget=MultipleFileInput(attrs={
                                  "accept": ",".join(sorted(SUPPORTED_EXTENSIONS)),
                                  "data-max-mb": settings.MAX_UPLOAD_MB}))
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
        # Each file is checked on its own when it is read (a stray spreadsheet or a file that is too large is
        # reported and skipped), so one bad file never stops the others.
        files = self.cleaned_data["files"]
        if not files:
            raise forms.ValidationError("Choose at least one file.")
        return files


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
