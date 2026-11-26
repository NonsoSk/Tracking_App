"""One pass of everything the worker does, in this process: for the scheduler's run (``sync_workbooks`` without
``--watch``), the "Refresh now" buttons when no worker is running, and the tests. Uses the same receipts and jobs as
the worker, so a file is never read twice whichever of them saw it first."""

from __future__ import annotations

import logging

from . import process, queue
from .models import Job, Receipt

logger = logging.getLogger(__name__)

OWNER = "this-process"


def drain(*, kinds=None, log=logger.info, limit: int = 10000) -> list[Job]:
    """Work through the queued jobs (both lanes; OCR inline) until none is due. Returns the jobs done."""
    done = []
    while len(done) < limit:
        job = queue.claim(Job.Lane.FAST, OWNER, kinds) or queue.claim(Job.Lane.SLOW, OWNER, kinds)
        if job is None:
            return done
        try:
            process.run(job, slow_lane_running=False)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Job %s failed", job.pk)
            queue.finish(job, error=f"{type(exc).__name__}: {exc}", retry_in=None)
            if job.receipt_id:
                Receipt.objects.filter(pk=job.receipt_id).exclude(status__in=["done", "needs_review"]).update(
                    status=Receipt.Status.FAILED, outcome=Receipt.Outcome.ERROR,
                    message=f"Could not be read ({exc}). Retry it from the intake page.")
            continue
        queue.finish(job)
        done.append(job)
    return done


def workbooks(*, force: bool = False, log=logger.info) -> dict:
    """Look at every linked workbook once and import the saves found. Returns {workbook: counts} of those imported."""
    from core.models import LinkedWorkbook

    from .watch import WorkbookWatch

    if force:
        LinkedWorkbook.objects.update(refresh_requested=True)
    watcher = WorkbookWatch(log=log)
    watcher.poll()
    jobs = drain(kinds={Job.Kind.WORKBOOK}, log=log)
    receipts = Receipt.objects.filter(pk__in=[j.payload.get("receipt") or j.receipt_id for j in jobs],
                                      status=Receipt.Status.DONE).select_related("workbook")
    return {r.workbook: r.details.get("counts", {}) for r in receipts if r.workbook}


def folders(*, log=logger.info) -> list:
    """Look in every linked server folder once and read the new files. Returns the profiles added or updated."""
    from candidates.models import Candidate
    from core.models import WatchedFolder

    from .watch import scan_folder

    start = Receipt.objects.order_by("-pk").values_list("pk", flat=True).first() or 0
    for folder in WatchedFolder.objects.filter(location=WatchedFolder.Location.SERVER).select_related("requisition"):
        try:
            scan_folder(folder, log=log)
        except Exception:  # noqa: BLE001
            logger.exception("Scanning %s failed", folder.path)
    drain(kinds={Job.Kind.CV, Job.Kind.OCR}, log=log)
    ids = Receipt.objects.filter(pk__gt=start, channel=Receipt.Channel.FOLDER, outcome__in=[
        Receipt.Outcome.ADDED, Receipt.Outcome.UPDATED]).values_list("candidate_id", flat=True)
    people = list(Candidate.objects.filter(pk__in=set(ids)))
    if people:
        from core.cv_folder import tell_hr

        tell_hr(people)
    return people
