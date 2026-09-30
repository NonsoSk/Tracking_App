from django import forms

from candidates.cv_parser import SUPPORTED_EXTENSIONS
from candidates.models import Candidate, CandidateDocument
from core.choices import DegreeClass, EducationLevel, NyscStatus
from core.forms import DOCUMENT_EXTENSIONS, BootstrapMixin, DateInput, TagListField, validate_upload


class ApplicationForm(BootstrapMixin, forms.Form):
    """Public application form. Uploading a CV first fills most fields automatically."""

    cv = forms.FileField(label="Your CV", help_text="PDF, Word or a clear photo/scan. We read it to fill this form for you.")
    first_name = forms.CharField(max_length=80)
    last_name = forms.CharField(max_length=80)
    email = forms.EmailField()
    phone = forms.CharField(max_length=40)
    location = forms.CharField(max_length=120, required=False, label="Current location (city/state)")
    gender = forms.ChoiceField(choices=[("", "Prefer not to say"), ("male", "Male"), ("female", "Female")], required=False)
    date_of_birth = forms.DateField(required=False, widget=DateInput())
    highest_qualification = forms.ChoiceField(choices=[("", "Select…")] + list(EducationLevel.choices))
    course = forms.CharField(max_length=150, label="Course of study")
    institution = forms.CharField(max_length=200, required=False)
    graduation_year = forms.IntegerField(required=False, min_value=1960, max_value=2100)
    degree_class = forms.ChoiceField(choices=[("", "Select…")] + list(DegreeClass.choices), required=False,
                                     label="Class of degree / grade")
    nysc_status = forms.ChoiceField(choices=[("", "Select…")] + list(NyscStatus.choices), required=False,
                                    label="NYSC status")
    years_experience = forms.DecimalField(min_value=0, max_value=50, decimal_places=1, initial=0,
                                          label="Years of work experience")
    current_employer = forms.CharField(max_length=150, required=False)
    current_job_title = forms.CharField(max_length=150, required=False)
    skills = TagListField(kind="skill", label="Key skills")
    tools = TagListField(kind="tool", label="Tools / software / equipment you use")
    certifications = TagListField(kind="certification", label="Certifications / licences")
    linkedin_url = forms.URLField(required=False, label="LinkedIn profile")
    cover_letter = forms.CharField(required=False, widget=forms.Textarea(attrs={"rows": 4}),
                                   label="Why are you a good fit? (optional)")
    other_documents = forms.FileField(required=False, label="Other document (optional)",
                                      help_text="e.g. certificate or cover letter")
    consent = forms.BooleanField(
        label="I consent to the processing of my personal data for recruitment purposes in line with the "
              "Nigeria Data Protection Act 2023.",
    )
    website = forms.CharField(required=False, widget=forms.TextInput(attrs={"autocomplete": "off", "tabindex": "-1"}))

    def clean_cv(self):
        return validate_upload(self.cleaned_data["cv"], SUPPORTED_EXTENSIONS)

    def clean_other_documents(self):
        doc = self.cleaned_data.get("other_documents")
        return validate_upload(doc, DOCUMENT_EXTENSIONS) if doc else doc

    def clean_website(self):
        # Honeypot: real people never see or fill this field.
        if self.cleaned_data.get("website"):
            raise forms.ValidationError("Invalid submission.")
        return ""


class StatusLookupForm(BootstrapMixin, forms.Form):
    reference = forms.CharField(label="Application reference", help_text="e.g. APP-2026-00012")
    email = forms.EmailField(label="Email used to apply")


class CandidateDocumentForm(BootstrapMixin, forms.Form):
    doc_type = forms.ChoiceField(
        choices=[c for c in CandidateDocument.DocType.choices if c[0] not in {"medical"}], label="Document"
    )
    file = forms.FileField()

    def clean_file(self):
        return validate_upload(self.cleaned_data["file"], DOCUMENT_EXTENSIONS)


class OfferResponseForm(BootstrapMixin, forms.Form):
    response = forms.ChoiceField(choices=[("accept", "Accept the offer"), ("review", "Request a review"),
                                          ("decline", "Decline the offer")], widget=forms.RadioSelect)
    counter_salary = forms.DecimalField(required=False, min_value=0, label="Your expected annual salary (₦)",
                                        help_text="Only if requesting a review.")
    comment = forms.CharField(required=False, widget=forms.Textarea(attrs={"rows": 3}), label="Comments")


class InterviewResponseForm(BootstrapMixin, forms.Form):
    response = forms.ChoiceField(choices=[("confirmed", "I will attend"), ("reschedule", "I need another time")])
    note = forms.CharField(required=False, max_length=500, label="Message (optional)")


CANDIDATE_FIELDS = [
    "first_name", "last_name", "email", "phone", "location", "gender", "date_of_birth", "highest_qualification",
    "course", "institution", "graduation_year", "degree_class", "nysc_status", "years_experience",
    "current_employer", "current_job_title", "skills", "tools", "certifications", "linkedin_url",
]


def form_to_candidate(form, candidate: Candidate):
    for name in CANDIDATE_FIELDS:
        value = form.cleaned_data.get(name)
        if value in (None, "", []) and name not in {"skills", "tools", "certifications"}:
            continue
        setattr(candidate, name, value)
    return candidate
