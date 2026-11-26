"""Edits made at the same time by two people: the second save does not silently overwrite the first.

Each edit form carries the version of the record it was opened on (its ``updated_at``). If the record was saved by
someone else in between, the save is refused: the form comes back with the person's own changes still in it and a
note to check the latest version, and the next save goes through on purpose.
"""

FIELD = "edited_version"


def version_of(obj) -> str:
    stamp = getattr(obj, "updated_at", None)
    return stamp.isoformat() if stamp else ""


def changed_since(request, obj) -> bool:
    sent = request.POST.get(FIELD, "")
    return bool(sent) and sent != version_of(obj)


def refuse(form, what: str):
    form.add_error(None, f"Someone else saved this {what} after you opened it. Your changes are still below and "
                         "nothing was overwritten: open the latest version in another tab to compare, then save again "
                         "to keep yours.")
