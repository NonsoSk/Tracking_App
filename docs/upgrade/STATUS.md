# Upgrade status (branch `claude/portal-upgrade`)

Kept up to date while the upgrade is built. The live install (`claude/quirky-lovelace-sv5emz`) is untouched until the
owner approves the switch.

| Stage | What | State |
|---|---|---|
| 0 | Diagnosis (`DIAGNOSIS.md`) | Done |
| 1 | Receipts and a durable job queue; the background worker (`run_worker`); workbook saves picked up within a second and imported row by row; open screens refresh themselves | Built, tested; benchmark below |
| 2 | Workbook sources: weekly dated files (newest file matching a pattern), column checks, field ownership, import issues for review | Pattern links and column checks built (worker side); link screen and docs pending |
| 3 | CV folders linked from the CV intake page; connector for a PC folder | Pending |
| 4 | Defensible matching (Needs review, evidence, versions, overrides, coverage, blind evaluation) | Pending |
| 5 | Recruiter-day screens (Home, Vacancies, Candidates) | Pending |
| 6 | Pilot deployment, backup and restore, release, handover | Pending |

## Stage 1 in short

* Every file is received before anything else: a private copy under `media/receipts/` and a `Receipt` row, with its
  job, in one transaction (`intake/receive.py`). The receipt keeps the outcome and the reason (added, brought up to
  date, already in the portal, not a CV, could not be read, same person?, failed).
* Jobs (`intake/models.py: Job`) are claimed with a lease. A worker that stops leaves its job to be picked up again,
  once; a job that ran but was not marked done finds its receipt finished and does nothing.
* `python manage.py run_worker` runs the threads: workbooks (every 0.25 s), folders (every 30 s and on change
  events), a fast lane (CVs, workbook saves) and a slow lane (OCR, AI, bulk re-assessment), and upkeep (heartbeat,
  recovery, Portal updates.xlsx, resumes). Only one worker reads the live inputs (`Worker.holds_inputs`).
  `sync_workbooks --watch` now starts the same worker, so `start-portal.bat` keeps working.
* Workbook saves: a complete .xlsx is read at once (Excel swaps a new file in), a half-copied one waits; only rows
  whose content changed are imported, and the whole-database passes look only at the people those rows touched.
  A save that lost sheets it had is refused and the last good data stays. Saves made while one is importing are
  coalesced; an older save never overwrites a newer one.
* Open screens: `/intake/live/` returns change counters to signed-in staff; `static/ds/live.js` refetches the page
  through the normal view and swaps the live region, keeping unsaved edits, open dialogs, the selected tab and open
  sections.

## Measured

See the benchmark section of the final report (tools/live_benchmark.py).
