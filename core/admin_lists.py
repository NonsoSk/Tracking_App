"""Admin boxes for lists of words (skills, tools, courses, aliases): typed one per line or with commas."""

import json

from django import forms

from core.text import split_list

LIST_HELP = "One per line, or separated by commas."


class ListTextField(forms.CharField):
    widget = forms.Textarea(attrs={"rows": 4, "cols": 60})

    def prepare_value(self, value):
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except ValueError:
                return value
        if isinstance(value, (list, tuple)):
            return "\n".join(str(v) for v in value)
        return value or ""

    def to_python(self, value):
        text = (value or "").strip()
        try:
            parsed = json.loads(text)
        except ValueError:
            parsed = None
        if isinstance(parsed, list):
            items = [str(v) for v in parsed]
        else:
            items = split_list(text)
        # Leftover brackets or quotes from the old JSON box, e.g. "[]Communication" or "\"Excel\""
        cleaned = [item.strip().strip("[]\"'").strip() for item in items]
        return list(dict.fromkeys(item for item in cleaned if item))


class ListFieldsAdmin:
    """Mix into a ModelAdmin and name its list fields in `list_fields`."""

    list_fields: tuple = ()

    def formfield_for_dbfield(self, db_field, request, **kwargs):
        if db_field.name in self.list_fields:
            return ListTextField(required=False, label=db_field.verbose_name.capitalize(), help_text=LIST_HELP)
        return super().formfield_for_dbfield(db_field, request, **kwargs)
