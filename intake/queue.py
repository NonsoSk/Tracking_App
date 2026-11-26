"""The job queue: enqueue, claim with a lease, finish, and recover jobs left behind by a stopped worker."""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from .models import Job, Receipt

SLOW_KINDS = {Job.Kind.OCR, Job.Kind.RESCORE_VACANCY, Job.Kind.RESCORE_CANDIDATE, Job.Kind.AI_ASSESS}
LEASE_SECONDS = {Job.Lane.FAST: 120, Job.Lane.SLOW: 900}


def enqueue(kind, *, receipt=None, payload=None, key="", lane=None, run_after=None, max_attempts=3) -> Job:
    """Add a job. A job with the same ``key`` still waiting is reused (duplicate notifications become one job)."""
    lane = lane or (Job.Lane.SLOW if kind in SLOW_KINDS else Job.Lane.FAST)
    if key:
        waiting = Job.objects.filter(key=key, status=Job.Status.QUEUED).first()
        if waiting:
            if payload is not None:
                waiting.payload = payload
            if receipt is not None:
                waiting.receipt = receipt
            if run_after is not None and run_after < waiting.run_after:
                waiting.run_after = run_after
            waiting.save(update_fields=["payload", "receipt", "run_after"])
            return waiting
    return Job.objects.create(kind=kind, lane=lane, receipt=receipt, payload=payload or {}, key=key,
                              run_after=run_after or timezone.now(), max_attempts=max_attempts)


def claim(lane, worker: str, kinds=None) -> Job | None:
    """The next job of this lane (of these kinds), marked as running for this worker. Safe with several workers: a job
    is claimed by one conditional update, so two workers never run the same job."""
    now = timezone.now()
    waiting = Job.objects.filter(lane=lane, status=Job.Status.QUEUED, run_after__lte=now)
    if kinds:
        waiting = waiting.filter(kind__in=list(kinds))
    for job_id in waiting.order_by("run_after", "pk").values_list("pk", flat=True)[:10]:
        taken = Job.objects.filter(pk=job_id, status=Job.Status.QUEUED).update(
            status=Job.Status.RUNNING, locked_by=worker[:80], started_at=now, attempts=F("attempts") + 1,
            locked_until=now + timedelta(seconds=LEASE_SECONDS.get(lane, 300)))
        if taken:
            return Job.objects.select_related("receipt").get(pk=job_id)
    return None


def claim_job(job: Job, owner: str, lease_seconds: float = 600) -> bool:
    """Take this one job (a web request reading an upload itself), so no worker starts it at the same time."""
    now = timezone.now()
    taken = Job.objects.filter(pk=job.pk, status=Job.Status.QUEUED).update(
        status=Job.Status.RUNNING, locked_by=owner[:80], started_at=now, attempts=F("attempts") + 1,
        locked_until=now + timedelta(seconds=lease_seconds))
    if taken:
        job.refresh_from_db()
    return bool(taken)


def finish(job: Job, *, error: str = "", retry_in: float | None = None):
    """Mark a job done or failed. A failed job is tried again later until ``max_attempts``."""
    job.finished_at = timezone.now()
    job.locked_by, job.locked_until = "", None
    if not error:
        job.status, job.error = Job.Status.DONE, ""
    elif job.attempts < job.max_attempts and retry_in is not None:
        job.status, job.error = Job.Status.QUEUED, error[:2000]
        job.run_after = timezone.now() + timedelta(seconds=retry_in)
    else:
        job.status, job.error = Job.Status.FAILED, error[:2000]
    job.save(update_fields=["status", "error", "finished_at", "locked_by", "locked_until", "run_after"])


def recover(worker: str | None = None) -> int:
    """Put back the jobs a stopped worker was running: those whose lease ran out, and (at start-up) those this worker
    held before it stopped. A job that already failed ``max_attempts`` times is marked failed, with its receipt."""
    now = timezone.now()
    stale = Job.objects.filter(status=Job.Status.RUNNING)
    stale = stale.filter(locked_until__lt=now) | (stale.filter(locked_by=worker) if worker else Job.objects.none())
    count = 0
    for job in stale.distinct():
        with transaction.atomic():
            if job.attempts >= job.max_attempts:
                job.status, job.error = Job.Status.FAILED, (job.error or "Stopped part-way too many times.")
                if job.receipt_id:
                    Receipt.objects.filter(pk=job.receipt_id, status__in=["received", "processing"]).update(
                        status=Receipt.Status.FAILED, outcome=Receipt.Outcome.ERROR,
                        message="Reading this file stopped part-way several times. Try again from the intake page.")
            else:
                job.status = Job.Status.QUEUED
            job.locked_by, job.locked_until = "", None
            job.save(update_fields=["status", "error", "locked_by", "locked_until"])
            if job.receipt_id and job.status == Job.Status.QUEUED:
                Receipt.objects.filter(pk=job.receipt_id, status=Receipt.Status.PROCESSING).update(
                    status=Receipt.Status.RECEIVED)
            count += 1
    return count


def backlog() -> dict:
    """How much is waiting, per lane, and how old the oldest waiting job is (seconds)."""
    now = timezone.now()
    out = {}
    for lane in Job.Lane.values:
        waiting = Job.objects.filter(lane=lane, status=Job.Status.QUEUED)
        oldest = waiting.order_by("created_at").values_list("created_at", flat=True).first()
        out[lane] = {"waiting": waiting.count(), "running": Job.objects.filter(lane=lane, status="running").count(),
                     "oldest_seconds": round((now - oldest).total_seconds(), 1) if oldest else 0}
    return out
