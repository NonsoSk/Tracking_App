"""The background worker: one process, several threads, so a slow scan never holds up a workbook save.

* ``workbooks``: looks at the linked workbooks every WORKBOOK_POLL_SECONDS and receives each completed save;
* ``folders``: walks the linked CV folders (and on change events) and receives each new file;
* ``fast`` lane: reads CVs and imports workbook saves, one job at a time, in the order received;
* ``slow`` lane: OCR of scans, AI checks, re-assessing many applications;
* ``upkeep``: the heartbeat screens show, recovering jobs a stopped worker left, "Portal updates.xlsx", resumes from
  website applications, and tidying stored copies.

Only one worker reads the live inputs (the two input threads). Others still work through the queue. A worker that
stops part-way leaves its job to be picked up again, once, when it (or another) starts.
"""

from __future__ import annotations

import logging
import os
import socket
import threading
import time
import traceback
from datetime import timedelta

from django.conf import settings
from django.db import close_old_connections, connection, transaction
from django.utils import timezone

from . import process, queue
from .models import Job, Receipt, Worker
from .receive import WAKE

logger = logging.getLogger(__name__)

VERSION = "2026.11-upgrade"
HEARTBEAT_SECONDS = 3
RECOVER_SECONDS = 30
UPDATES_SECONDS = 30
CLEANUP_SECONDS = 3600


def default_name() -> str:
    return settings.WORKER_NAME or f"{socket.gethostname()}:{os.getpid()}"


class PortalWorker:
    def __init__(self, name: str | None = None, *, inputs: bool | None = None, log=None, lanes=("fast", "slow")):
        self.name = (name or default_name())[:80]
        self.want_inputs = settings.PORTAL_INPUTS_ENABLED if inputs is None else inputs
        self.lanes = tuple(lanes)
        self.stopping = threading.Event()
        self.holds_inputs = False
        self.status = {lane: "idle" for lane in self.lanes}
        self.status.update(workbooks="off", folders="off")
        self.threads: list[threading.Thread] = []
        self._log = log or logger.info

    def log(self, message: str):
        self._log(f"[{timezone.localtime().strftime('%H:%M:%S')}] {message}")

    # ------------------------------------------------------------------ lifecycle
    def start(self):
        now = timezone.now()
        Worker.objects.update_or_create(name=self.name, defaults={
            "host": socket.gethostname()[:120], "pid": os.getpid(), "version": VERSION, "started_at": now,
            "beat_at": now, "holds_inputs": False, "lanes": self.status})
        back = queue.recover(worker=self.name)
        if back:
            self.log(f"Picked up {back} job(s) left unfinished when the worker last stopped.")
        if self.want_inputs:
            self.holds_inputs = self.take_inputs()
            if not self.holds_inputs:
                self.log("Another worker is reading the folders and workbooks; this one only works through the queue.")
        for lane in self.lanes:
            self._thread(f"lane-{lane}", self.lane_loop, lane)
        self._thread("workbooks", self.inputs_loop, "workbooks")
        self._thread("folders", self.inputs_loop, "folders")
        self._thread("upkeep", self.upkeep_loop)

    def _thread(self, name, target, *args):
        thread = threading.Thread(target=self._guard, args=(target, *args), name=f"worker-{name}", daemon=True)
        thread.start()
        self.threads.append(thread)

    def _guard(self, target, *args):
        try:
            target(*args)
        except Exception:  # noqa: BLE001
            logger.exception("Worker thread %s stopped", threading.current_thread().name)
        finally:
            connection.close()

    def stop(self):
        self.stopping.set()
        WAKE.set()
        for thread in self.threads:
            thread.join(timeout=15)
        Worker.objects.filter(name=self.name).update(holds_inputs=False, beat_at=timezone.now() - timedelta(
            seconds=settings.WORKER_OFFLINE_SECONDS + 1))
        connection.close()

    def run_forever(self):
        self.start()
        self.log(f"Worker {self.name} running" + (" (reading the linked workbooks and folders)" if self.holds_inputs
                                                  else "") + ". Ctrl+C stops it.")
        try:
            while not self.stopping.wait(1):
                pass
        except KeyboardInterrupt:
            self.log("Stopping...")
        finally:
            self.stop()

    # ------------------------------------------------------------------ inputs lease
    def take_inputs(self) -> bool:
        """Become the worker that reads the live inputs, unless another one that is running holds them."""
        cutoff = timezone.now() - timedelta(seconds=settings.WORKER_OFFLINE_SECONDS)
        with transaction.atomic():
            others = Worker.objects.select_for_update().filter(holds_inputs=True).exclude(name=self.name)
            if others.filter(beat_at__gte=cutoff).exists():
                return False
            others.update(holds_inputs=False)
            Worker.objects.filter(name=self.name).update(holds_inputs=True)
        return True

    # ------------------------------------------------------------------ loops
    def lane_loop(self, lane: str):
        fast = lane == Job.Lane.FAST
        while not self.stopping.is_set():
            close_old_connections()
            try:
                job = queue.claim(lane, self.name)
            except Exception:  # noqa: BLE001 - the database busy or restarting: wait and look again
                logger.exception("Could not look at the queue")
                self.stopping.wait(2)
                continue
            if job is None:
                self.status[lane] = "idle"
                if fast:
                    WAKE.wait(0.2)
                    WAKE.clear()
                else:
                    self.stopping.wait(1)
                    self.idle_slow_work()
                continue
            self.status[lane] = f"{job.get_kind_display()} #{job.pk}"
            self.do(job)

    def do(self, job: Job):
        started = time.time()
        try:
            process.run(job, slow_lane_running="slow" in self.lanes)
        except Exception as exc:  # noqa: BLE001
            message = f"{type(exc).__name__}: {exc}"
            logger.warning("Job %s failed: %s\n%s", job.pk, message, traceback.format_exc(limit=5))
            retry_in = min(600, 15 * 2 ** max(0, job.attempts - 1))
            queue.finish(job, error=message, retry_in=retry_in)
            if job.receipt_id:
                if job.status == Job.Status.FAILED:
                    Receipt.objects.filter(pk=job.receipt_id).exclude(status__in=["done", "needs_review"]).update(
                        status=Receipt.Status.FAILED, outcome=Receipt.Outcome.ERROR, finished_at=timezone.now(),
                        message=f"Could not be read after {job.attempts} tries ({exc}). Retry it from the intake "
                                "page, or open the file to check it.")
                else:
                    Receipt.objects.filter(pk=job.receipt_id, status=Receipt.Status.PROCESSING).update(
                        status=Receipt.Status.RECEIVED,
                        message=f"Try {job.attempts} failed ({exc}); trying again in {retry_in:.0f} seconds.")
            return
        queue.finish(job)
        if job.kind in {Job.Kind.WORKBOOK, Job.Kind.CV}:
            logger.debug("Job %s (%s) done in %.2fs", job.pk, job.kind, time.time() - started)

    def idle_slow_work(self):
        """With nothing queued: with AI on, Claude reads a few open applications against the job description."""
        now = time.monotonic()
        if now < getattr(self, "_next_assess", 0):
            return
        self._next_assess = now + 60
        try:
            from pipeline.ai_assess import assess_pending, enabled

            if enabled():
                done = assess_pending(limit=1)
                if done:
                    self.log(f"Claude read {done} application(s) against the job description.")
        except Exception:  # noqa: BLE001
            logger.exception("AI assessment failed")

    def inputs_loop(self, which: str):
        from .watch import FolderWatch, WorkbookWatch

        watcher = WorkbookWatch(log=self.log) if which == "workbooks" else FolderWatch(log=self.log)
        pause = settings.WORKBOOK_POLL_SECONDS if which == "workbooks" else 0.5
        try:
            while not self.stopping.is_set():
                if not self.holds_inputs:
                    self.status[which] = "standby" if self.want_inputs else "off"
                    self.stopping.wait(2)
                    continue
                close_old_connections()
                self.status[which] = "watching"
                try:
                    watcher.poll()
                except Exception:  # noqa: BLE001
                    logger.exception("Watching the %s failed", which)
                    self.stopping.wait(2)
                self.stopping.wait(pause)
        finally:
            if which == "folders":
                watcher.stop()

    def upkeep_loop(self):
        next_recover = next_updates = next_cleanup = 0.0
        last_seq = None
        while not self.stopping.is_set():
            close_old_connections()
            now = time.monotonic()
            try:
                self.beat()
                if now >= next_recover:
                    next_recover = now + RECOVER_SECONDS
                    queue.recover()
                if self.holds_inputs and now >= next_updates:
                    next_updates = now + UPDATES_SECONDS
                    last_seq = self.write_updates(last_seq)
                if now >= next_cleanup:
                    next_cleanup = now + CLEANUP_SECONDS
                    removed = process.cleanup_stored()
                    if removed:
                        self.log(f"Removed {removed} stored cop{'ies' if removed != 1 else 'y'} no longer needed.")
            except Exception:  # noqa: BLE001
                logger.exception("Worker upkeep failed")
            self.stopping.wait(HEARTBEAT_SECONDS)

    def beat(self):
        holder = Worker.objects.filter(name=self.name).values_list("holds_inputs", flat=True).first()
        if self.holds_inputs and holder is False:
            self.holds_inputs = False  # another worker took over while this one was stalled
            self.log("Another worker now reads the folders and workbooks.")
        elif self.want_inputs and not self.holds_inputs:
            self.holds_inputs = self.take_inputs()
            if self.holds_inputs:
                self.log("This worker now reads the folders and workbooks.")
        Worker.objects.update_or_create(name=self.name, defaults={
            "beat_at": timezone.now(), "lanes": dict(self.status), "version": VERSION, "pid": os.getpid(),
            "host": socket.gethostname()[:120]})

    def write_updates(self, last_seq):
        """Rewrite "Portal updates.xlsx" when the portal's data changed (and something is linked)."""
        from core import excel_updates
        from core.models import LinkedWorkbook, PortalUpdatesFile, WatchedFolder

        from .live import state

        seq = state()
        state_row = PortalUpdatesFile.objects.filter(pk=1).first()
        if seq == last_seq and not (state_row and state_row.write_requested):
            return seq
        if LinkedWorkbook.objects.exists() or WatchedFolder.objects.exists() or (state_row and
                                                                                 state_row.write_requested):
            excel_updates.write(log=self.log)
        if settings.PORTAL_INPUTS_ENABLED:
            self.fetch_resumes()
        return seq

    def fetch_resumes(self):
        """Resumes of applicants new in the website applications, a few at a time."""
        from candidates.resumes import Fetcher, acquire_lock, pending, release_lock

        waiting = pending()[:100]
        if waiting and acquire_lock():
            try:
                Fetcher(log=lambda msg: None).run(waiting)
            finally:
                release_lock()


def status() -> dict:
    """What screens show about the background worker."""
    workers = list(Worker.objects.all())
    online = [w for w in workers if w.online]
    holder = next((w for w in online if w.holds_inputs), None)
    return {"online": bool(online), "workers": workers, "holder": holder, "backlog": queue.backlog(),
            "last_beat": max((w.beat_at for w in workers), default=None)}
