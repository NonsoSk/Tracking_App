"""Backups that can be restored on another machine, and checked by restoring them.

A backup is one .zip:

* ``data.json``: every record (accounts and roles, candidates, applications and their history, recruiter edits,
  receipts…) in Django's portable format, so it restores into SQLite or PostgreSQL alike;
* ``media/``: every stored file (CVs as received and as PDF, documents, offer letters, medical reports, received
  files), byte for byte;
* ``manifest.json``: how many records of each kind, and the SHA-256 of every file, so a restore can be checked.

Backups hold personal data: keep them in private storage only (never in Git, e-mail or a shared drive open to all).
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from django.apps import apps
from django.conf import settings
from django.core import management
from django.db import connection, models
from django.utils import timezone

EXCLUDE = ["contenttypes", "auth.permission", "sessions", "admin.logentry", "intake.livetopic", "intake.worker"]
SKIP_COUNT = {"contenttypes", "auth", "sessions", "admin"}


class BackupError(Exception):
    pass


def _counted_models():
    for model in apps.get_models():
        label = model._meta.label_lower
        if model._meta.app_label in SKIP_COUNT and label != "auth.group":
            continue
        if any(label == e or model._meta.app_label == e for e in EXCLUDE):
            continue
        if model._meta.proxy or not model._meta.managed:
            continue
        yield model


def counts() -> dict:
    return {m._meta.label: m.objects.count() for m in _counted_models()}


def file_fields():
    for model in _counted_models():
        for field in model._meta.get_fields():
            if isinstance(field, models.FileField):
                yield model, field.name


def referenced_files() -> list[str]:
    names = set()
    for model, name in file_fields():
        names.update(n for n in model.objects.exclude(**{name: ""}).values_list(name, flat=True) if n)
    return sorted(names)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create(out_dir, *, log=print) -> Path:
    """Write a backup .zip into out_dir and return its path."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    media = Path(settings.MEDIA_ROOT)
    stamp = timezone.localtime().strftime("%Y%m%d-%H%M%S")
    target = out_dir / f"portal-backup-{stamp}.zip"
    data = io.StringIO()
    management.call_command("dumpdata", "--natural-foreign", "--natural-primary", *sum([["-e", e] for e in EXCLUDE], []),
                            "--indent", "0", stdout=data)
    referenced = referenced_files()
    files, missing = {}, []
    for name in referenced:
        path = media / name
        if path.is_file():
            files[name] = sha256(path)
        else:
            missing.append(name)
    manifest = {"created": timezone.now().isoformat(), "engine": connection.vendor, "counts": counts(),
                "files": files, "missing_before_backup": missing,
                "migrations": _migrations(), "format": 1}
    temp = target.with_suffix(".partial")
    with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        archive.writestr("data.json", data.getvalue())
        for name in files:
            archive.write(media / name, f"media/{name}")
        archive.writestr("manifest.json", json.dumps(manifest, indent=1))
    os.replace(temp, target)
    log(f"Backup written: {target} ({sum(manifest['counts'].values()):,} records, {len(files):,} files"
        + (f"; {len(missing)} file(s) the records point to were already missing" if missing else "") + ")")
    return target


def _migrations() -> dict:
    from django.db.migrations.recorder import MigrationRecorder

    latest = {}
    for app, name in MigrationRecorder(connection).applied_migrations():
        latest[app] = max(latest.get(app, ""), name)
    return latest


def _empty() -> bool:
    from accounts.models import User
    from candidates.models import Candidate

    return not User.objects.exists() and not Candidate.objects.exists()


def restore(archive_path, *, log=print) -> dict:
    """Load a backup into this (empty, migrated) installation and check it. Returns the check's findings."""
    archive_path = Path(archive_path)
    media = Path(settings.MEDIA_ROOT)
    if not _empty():
        raise BackupError("This installation already holds accounts or candidates. Restore only into a new, empty "
                          "database (run migrate on it first).")
    if media.exists() and any(media.rglob("*")):
        raise BackupError(f"The media folder {media} is not empty. Restore into an empty media folder.")
    with zipfile.ZipFile(archive_path) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data.json"
            data.write_bytes(archive.read("data.json"))
            management.call_command("loaddata", str(data), verbosity=0)
        for name in manifest["files"]:
            target = media / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(f"media/{name}") as source, open(target, "wb") as out:
                out.write(source.read())
    findings = check(manifest)
    log(json.dumps(findings, indent=1))
    return findings


def check(manifest: dict) -> dict:
    """Compare this installation with a backup's manifest: record counts, and every stored file opened and hashed."""
    media = Path(settings.MEDIA_ROOT)
    now = counts()
    differences = {label: {"backup": n, "here": now.get(label)} for label, n in manifest["counts"].items()
                   if now.get(label) != n}
    unreadable, mismatched = [], []
    for name, digest in manifest["files"].items():
        path = media / name
        if not path.is_file():
            unreadable.append(name)
        elif sha256(path) != digest:
            mismatched.append(name)
    dangling = [n for n in referenced_files() if not (media / n).is_file()]
    from django.contrib.auth import get_user_model

    User = get_user_model()
    return {"checked": datetime.now().isoformat(timespec="seconds"), "counts_match": not differences,
            "differences": differences, "files_checked": len(manifest["files"]), "files_missing": unreadable[:20],
            "files_changed": mismatched[:20], "records_pointing_to_missing_files": dangling[:20],
            "users": User.objects.count(), "staff_who_can_sign_in": User.objects.filter(is_active=True).exclude(
                password__startswith="!").count(),
            "ok": not differences and not unreadable and not mismatched and len(dangling) <= len(
                manifest.get("missing_before_backup", []))}
