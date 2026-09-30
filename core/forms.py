import os

from django import forms
from django.conf import settings

from core.text import split_list


class BootstrapMixin:
    """Adds Bootstrap classes to every widget so templates stay simple."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            widget = field.widget
            css = widget.attrs.get("class", "")
            if isinstance(widget, (forms.CheckboxInput,)):
                widget.attrs["class"] = f"{css} form-check-input".strip()
            elif isinstance(widget, (forms.Select, forms.SelectMultiple)):
                widget.attrs["class"] = f"{css} form-select".strip()
            elif isinstance(widget, forms.RadioSelect):
                widget.attrs["class"] = f"{css} form-check-input".strip()
            else:
                widget.attrs["class"] = f"{css} form-control".strip()


class DateInput(forms.DateInput):
    input_type = "date"

    def __init__(self, **kwargs):
        kwargs.setdefault("format", "%Y-%m-%d")
        super().__init__(**kwargs)


class DateTimeInput(forms.DateTimeInput):
    input_type = "datetime-local"

    def __init__(self, **kwargs):
        kwargs.setdefault("format", "%Y-%m-%dT%H:%M")
        super().__init__(**kwargs)


class TagListField(forms.CharField):
    """A list of short strings edited as chips in the browser (see static/js/app.js)."""

    def __init__(self, *, kind: str = "skill", **kwargs):
        kwargs.setdefault("required", False)
        kwargs.setdefault("widget", forms.Textarea(attrs={"rows": 2}))
        super().__init__(**kwargs)
        self.widget.attrs.update({"data-tags": kind, "placeholder": "Type and press Enter"})

    def prepare_value(self, value):
        if isinstance(value, (list, tuple)):
            return "\n".join(value)
        return value

    def to_python(self, value):
        return split_list(super().to_python(value) or "")


class MultipleFileInput(forms.ClearableFileInput):
    allow_multiple_selected = True


class MultipleFileField(forms.FileField):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault("widget", MultipleFileInput())
        super().__init__(*args, **kwargs)

    def clean(self, data, initial=None):
        single = super().clean
        if isinstance(data, (list, tuple)):
            return [single(d, initial) for d in data]
        return [single(data, initial)] if data else []


def validate_upload(uploaded, allowed_extensions):
    ext = os.path.splitext(uploaded.name)[1].lower()
    if ext not in allowed_extensions:
        raise forms.ValidationError(
            f"{uploaded.name}: file type not allowed. Allowed: {', '.join(sorted(allowed_extensions))}"
        )
    if uploaded.size > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise forms.ValidationError(f"{uploaded.name}: larger than {settings.MAX_UPLOAD_MB} MB.")
    return uploaded


DOCUMENT_EXTENSIONS = {".pdf", ".doc", ".docx", ".odt", ".rtf", ".txt", ".jpg", ".jpeg", ".png", ".tif", ".tiff",
                       ".webp", ".bmp", ".gif"}


class EmployeeImportForm(BootstrapMixin, forms.Form):
    file = forms.FileField(help_text="Excel (.xlsx) or CSV with columns: staff_id, first_name, last_name, email, "
                                     "department, job_title, grade, date_of_birth, date_of_employment, status")

    def clean_file(self):
        return validate_upload(self.cleaned_data["file"], {".xlsx", ".csv"})
