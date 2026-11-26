from pathlib import Path

from django import forms
from django.conf import settings

from candidates.forms import open_requisitions
from candidates.models import Candidate
from candidates.regions import REGION_CHOICES
from core.forms import BootstrapMixin
from core.models import WatchedFolder

from .models import Connector


class FolderLinkForm(BootstrapMixin, forms.Form):
    """Link a folder of CVs: the worker (or a PC's connector) reads what is in it and what arrives later."""

    MODES = [("existing", "Import the files already there, and watch for new ones"),
             ("new_only", "Watch for new files only (leave what is there now)")]

    label = forms.CharField(label="Name", max_length=120, help_text="A name the team will recognise, e.g. "
                                                                     "'Emailed CVs' or 'Jetty walk-ins'.")
    location = forms.ChoiceField(label="Where the folder is", choices=WatchedFolder.Location.choices,
                                 initial=WatchedFolder.Location.SERVER, widget=forms.RadioSelect)
    path = forms.CharField(label="Folder", max_length=500,
                           help_text="The full path, e.g. \\\\fileserver\\HR\\CVs or D:\\Recruitment\\CVs. Copy it from "
                                     "the File Explorer address bar.")
    connector = forms.ModelChoiceField(label="PC that sends it", required=False,
                                       queryset=Connector.objects.filter(revoked_at__isnull=True),
                                       help_text="For a folder on a PC the server cannot open: the connector on that "
                                                 "PC sends its files.")
    source = forms.ChoiceField(label="Channel", choices=[c for c in Candidate.Source.choices
                                                         if c[0] not in {"portal", "import"}],
                               initial=Candidate.Source.EMAIL, help_text="How these CVs reached IEFCL.")
    requisition = forms.ModelChoiceField(label="Vacancy", queryset=None, required=False,
                                         help_text="Optional: each CV becomes an application to this vacancy. "
                                                   "Without one, the CVs join the talent pool.")
    region = forms.ChoiceField(label="Community category", required=False,
                               choices=[("", "Not set: taken from the state in each CV")] + REGION_CHOICES)
    include_subfolders = forms.BooleanField(label="Include its subfolders", required=False, initial=True)
    mode = forms.ChoiceField(label="Files already in the folder", choices=MODES, initial="existing",
                             widget=forms.RadioSelect)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["requisition"].queryset = open_requisitions()

    def clean(self):
        data = super().clean()
        raw = (data.get("path") or "").strip().strip('"')
        location = data.get("location")
        if not raw:
            return data
        if location == WatchedFolder.Location.CONNECTOR:
            if not data.get("connector"):
                self.add_error("connector", "Choose the PC that sends this folder (add its connector first).")
            data["path"] = raw
        else:
            path = Path(raw).expanduser()
            if not path.is_absolute():
                self.add_error("path", "Give the full path, starting with the drive letter or \\\\server.")
                return data
            roots = [Path(r) for r in settings.PORTAL_INPUT_ROOTS]
            if roots and not any(_inside(path, r) for r in roots):
                self.add_error("path", "The portal may only read folders under: " +
                               ", ".join(str(r) for r in roots) + ". Ask IT to make this share available there.")
                return data
            if not path.is_dir():
                self.add_error("path", "The portal cannot open this folder. If it is on your own PC, choose "
                                       "'A folder on a PC, sent by its connector'. If it is a shared folder, ask IT "
                                       "to give the portal server access to it.")
                return data
            data["path"] = str(path.resolve())
        if WatchedFolder.objects.filter(path=data["path"]).exists():
            self.add_error("path", "This folder is already linked.")
        return data


def _inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (ValueError, OSError):
        return False


class ConnectorForm(BootstrapMixin, forms.Form):
    name = forms.CharField(label="Which PC", max_length=80, help_text="e.g. 'HR laptop (Recruitment desk)'.")
