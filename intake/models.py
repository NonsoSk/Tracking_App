"""What arrives and the work it causes, kept in the database so nothing is lost when a process stops.

* ``Receipt``: every file the portal received (a CV from a linked folder, the connector, an upload or the mailbox; a
  workbook from a link). The original is stored privately first, then processed; the receipt keeps the outcome and
  the reason, so every file has a visible result even when reading it failed.
* ``Job``: one piece of background work (read a CV, import a workbook, OCR a scan, re-score a vacancy). Jobs are
  claimed with a lease, so a worker that stops part-way leaves the job to be picked up again, once.
* ``Worker``: the background worker's heartbeat, so screens can say whether intake is running, and which worker holds
  the live inputs (only one may).
* ``LiveTopic``: a counter per kind of data, raised after every committed change; open screens compare it to know
  when to refresh themselves.
* ``Connector``: a small program on a PC the server cannot reach, sending files from folders on that PC.
"""

from __future__ import annotations

import hashlib
import os
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone


def receipt_path(instance, filename):
    ext = os.path.splitext(filename)[1].lower()[:10]
    stamp = timezone.now()
    return f"receipts/{instance.kind}/{stamp:%Y/%m}/{instance.sha256 or 'file'}{ext}"


class Receipt(models.Model):
    class Kind(models.TextChoices):
        CV = "cv", "CV"
        WORKBOOK = "workbook", "Workbook"

    class Channel(models.TextChoices):
        FOLDER = "folder", "Linked folder"
        CONNECTOR = "connector", "Connector (a PC)"
        UPLOAD = "upload", "Uploaded once"
        MAILBOX = "mailbox", "Recruitment mailbox"
        WORKBOOK = "workbook", "Linked workbook"

    class Status(models.TextChoices):
        RECEIVED = "received", "Received"
        PROCESSING = "processing", "Processing"
        DONE = "done", "Completed"
        NEEDS_REVIEW = "needs_review", "Needs review"
        FAILED = "failed", "Failed"
        SUPERSEDED = "superseded", "Replaced by a newer save"

    class Outcome(models.TextChoices):
        PENDING = "", "Not finished"
        ADDED = "added", "New profile"
        UPDATED = "updated", "Profile brought up to date"
        DUPLICATE = "duplicate", "Already in the portal"
        NOT_CV = "not_cv", "Not a CV"
        UNREADABLE = "unreadable", "Could not be read"
        IDENTITY = "identity", "Same person? Needs review"
        IMPORTED = "imported", "Imported"
        UNCHANGED = "unchanged", "No changes"
        INVALID = "invalid", "Columns not recognised"
        ERROR = "error", "Error"

    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.CV, db_index=True)
    channel = models.CharField(max_length=10, choices=Channel.choices, db_index=True)
    folder = models.ForeignKey("core.WatchedFolder", null=True, blank=True, on_delete=models.SET_NULL,
                               related_name="receipts")
    workbook = models.ForeignKey("core.LinkedWorkbook", null=True, blank=True, on_delete=models.SET_NULL,
                                 related_name="receipts")
    connector = models.ForeignKey("intake.Connector", null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name="receipts")
    requisition = models.ForeignKey("requisitions.Requisition", null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name="+", help_text="The vacancy the file was sent for, if any.")
    original_name = models.CharField(max_length=255)
    source_path = models.CharField(max_length=700, blank=True, help_text="Where it came from (path in the folder).")
    size = models.BigIntegerField(default=0)
    modified = models.FloatField(null=True, blank=True, help_text="When the file was last saved at its source.")
    sha256 = models.CharField(max_length=64, db_index=True)
    stored = models.FileField(upload_to=receipt_path, max_length=300, blank=True)
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name="+")
    options = models.JSONField(default=dict, blank=True, help_text="How to read it (source, referral, region…).")

    status = models.CharField(max_length=15, choices=Status.choices, default=Status.RECEIVED, db_index=True)
    outcome = models.CharField(max_length=12, choices=Outcome.choices, blank=True, default="")
    message = models.TextField(blank=True)
    details = models.JSONField(default=dict, blank=True)
    candidate = models.ForeignKey("candidates.Candidate", null=True, blank=True, on_delete=models.SET_NULL,
                                  related_name="receipts")
    application = models.ForeignKey("pipeline.Application", null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name="+")
    attempts = models.PositiveSmallIntegerField(default=0)

    received_at = models.DateTimeField(default=timezone.now, db_index=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name="+")

    class Meta:
        ordering = ["-received_at", "-pk"]
        constraints = [
            # The same content from the same place is received once, however often it is seen or sent.
            models.UniqueConstraint(fields=["folder", "source_path", "sha256"], condition=models.Q(folder__isnull=False),
                                    name="one_receipt_per_folder_file_version"),
        ]

    def __str__(self):
        return f"{self.original_name} ({self.get_status_display()})"

    @property
    def is_open(self) -> bool:
        return self.status in {self.Status.RECEIVED, self.Status.PROCESSING}

    @property
    def can_retry(self) -> bool:
        return self.status in {self.Status.FAILED} or self.outcome in {self.Outcome.UNREADABLE, self.Outcome.ERROR}

    @property
    def tone(self) -> str:
        if self.status == self.Status.DONE:
            return {"added": "success", "updated": "success", "imported": "success"}.get(self.outcome, "neutral")
        return {"received": "brand", "processing": "brand", "needs_review": "warning", "failed": "danger",
                "superseded": "neutral"}.get(self.status, "neutral")

    @property
    def save_to_commit_seconds(self) -> float | None:
        """From the save at the source to the change being in the database."""
        if self.modified and self.finished_at and self.status == self.Status.DONE:
            return round(self.finished_at.timestamp() - self.modified, 2)
        return None


class Job(models.Model):
    class Kind(models.TextChoices):
        CV = "cv", "Read a CV"
        OCR = "ocr", "Read a scan (OCR)"
        WORKBOOK = "workbook", "Import a workbook"
        RESCORE_VACANCY = "rescore_vacancy", "Re-assess a vacancy's applicants"
        RESCORE_CANDIDATE = "rescore_candidate", "Re-assess a candidate's applications"
        AI_ASSESS = "ai_assess", "AI check against the JD"

    class Lane(models.TextChoices):
        FAST = "fast", "Fast (arrivals and imports)"
        SLOW = "slow", "Slow (OCR, AI, bulk re-assessment)"

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        DONE = "done", "Done"
        FAILED = "failed", "Failed"
        SUPERSEDED = "superseded", "Superseded"

    kind = models.CharField(max_length=20, choices=Kind.choices)
    lane = models.CharField(max_length=5, choices=Lane.choices, default=Lane.FAST, db_index=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.QUEUED, db_index=True)
    receipt = models.ForeignKey(Receipt, null=True, blank=True, on_delete=models.CASCADE, related_name="jobs")
    payload = models.JSONField(default=dict, blank=True)
    key = models.CharField(max_length=120, blank=True, db_index=True,
                           help_text="Jobs with the same key are coalesced while queued.")
    attempts = models.PositiveSmallIntegerField(default=0)
    max_attempts = models.PositiveSmallIntegerField(default=3)
    run_after = models.DateTimeField(default=timezone.now, db_index=True)
    locked_by = models.CharField(max_length=80, blank=True)
    locked_until = models.DateTimeField(null=True, blank=True)
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["run_after", "pk"]
        indexes = [models.Index(fields=["lane", "status", "run_after"])]

    def __str__(self):
        return f"{self.get_kind_display()} #{self.pk} ({self.status})"


class Worker(models.Model):
    """The background worker's heartbeat. ``holds_inputs`` marks the one worker allowed to read live inputs."""

    name = models.CharField(max_length=80, primary_key=True)
    host = models.CharField(max_length=120, blank=True)
    pid = models.PositiveIntegerField(default=0)
    version = models.CharField(max_length=40, blank=True)
    started_at = models.DateTimeField(default=timezone.now)
    beat_at = models.DateTimeField(default=timezone.now)
    holds_inputs = models.BooleanField(default=False)
    lanes = models.JSONField(default=dict, blank=True, help_text="What each lane is doing.")

    def __str__(self):
        return self.name

    @property
    def online(self) -> bool:
        return (timezone.now() - self.beat_at) < timedelta(seconds=settings.WORKER_OFFLINE_SECONDS)


class LiveTopic(models.Model):
    """Raised after each committed change, per kind of data (people, hiring, intake)."""

    name = models.CharField(max_length=20, primary_key=True)
    seq = models.BigIntegerField(default=0)
    changed_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"{self.name}={self.seq}"


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Connector(models.Model):
    """A program on a PC the server cannot reach, sending the files of chosen folders to the portal."""

    name = models.CharField(max_length=80, help_text="Which PC, e.g. 'HR laptop (Ada)'.")
    token_hash = models.CharField(max_length=64, unique=True)
    token_hint = models.CharField(max_length=8, blank=True, help_text="The last characters, to tell tokens apart.")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name="+")
    created_at = models.DateTimeField(default=timezone.now)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    last_address = models.CharField(max_length=64, blank=True)
    version = models.CharField(max_length=40, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    @classmethod
    def issue(cls, name: str, user=None) -> tuple["Connector", str]:
        """A new connector and its token. The token is shown once and only its hash is kept."""
        token = "pc_" + secrets.token_urlsafe(32)
        connector = cls.objects.create(name=name[:80], token_hash=_hash_token(token), token_hint=token[-6:],
                                       created_by=user)
        return connector, token

    @classmethod
    def for_token(cls, token: str) -> "Connector | None":
        if not token:
            return None
        return cls.objects.filter(token_hash=_hash_token(token), revoked_at__isnull=True).first()

    @property
    def online(self) -> bool:
        return bool(self.last_seen_at) and (timezone.now() - self.last_seen_at) < timedelta(
            seconds=settings.CONNECTOR_OFFLINE_SECONDS)
