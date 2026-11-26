# Diagnosis before the upgrade (reference commit 72fd87d)

Date: 2026-11-26. Everything below was **verified in code** in a clean checkout, unless marked otherwise.
**Nothing was observed on the running installation**: no computer of the team was attached to this session, so the
live portal on the HR PC, its database, its `.env`, its linked workbooks and folders were not seen. Facts that only the
running installation can confirm are listed at the end.

## Repository

| Check | Result |
|---|---|
| Remote | `https://github.com/NonsoSk/Tracking_App` |
| Portal branch | `claude/quirky-lovelace-sv5emz`, head `72fd87d68f88712a81dbd6767ea89e7f93705557` (same on the remote; nothing newer) |
| Working tree | clean, no stashes |
| Other branches | `main` is the job-search application; the other `claude/*` branches hold no portal code (`pipeline/matching.py`, `core/cv_folder.py` absent) |
| Work branch | `claude/portal-upgrade`, created from 72fd87d. The live install's `update-portal.bat` downloads `claude/quirky-lovelace-sv5emz` only, so nothing here reaches it until that branch is deliberately moved |
| Local data in the checkout | `db.sqlite3` and `media/` exist but are ignored by `.gitignore` (with `*.xlsx`, `/backups/`, `/import-reports/`) |

## How the live install runs (from `start-portal.bat`)

* `manage.py migrate`, then **Django's development server** on `127.0.0.1:8000` (only that PC can open it).
* A second, minimised window runs `manage.py sync_workbooks --watch`.
* SQLite (`db.sqlite3`) and `media/` on that PC. `update-portal.bat` replaces the code from the branch zip and keeps
  `.venv`, `media`, `db.sqlite3` and `.env`.
* When the PC sleeps or the windows are closed, nothing is imported and nobody else can reach the portal.

## The paths as they are

### A workbook save (`core/management/commands/sync_workbooks.py` → `core/excel_link.py` → `core/workbook_import.py`)
1. The watcher loop wakes every 10 s; it looks at workbooks only every `EXCEL_SYNC_MINUTES` (**5 min**) unless a
   refresh was requested on the page.
2. `excel_link.check()` skips a file modified less than **20 s** ago (`SETTLE_SECONDS`), hashes it, and loads it when
   the hash changed.
3. `load()` copies the file and runs `WorkbookImporter` on **all rows of all its sheets**, then three passes over
   **every** candidate (`link_staff`, `regions.assign_all`, `dates.assign_all`).
4. Docker: the `scheduler` service runs `sync_workbooks` once, then the reminders, summaries and mailbox, then
   **sleeps 900 s**.
5. A failed load sets the workbook to *Could not be read*; the records from the last good load stay. A missing file
   is *File not found*.
6. **Measured here** (fictional workbooks: tracker 200 rows, interviews 2,000, CBT 2,000, staff 1,000; CV dump 5,000):
   first load 10.2 s; refresh after one changed cell **2.9 s** of import alone (profile: matching every person
   again 3.3 s, `snapshot()` 1.5 s, staff 1.0 s, the three passes 1.2 s; openpyxl reading 0.5–0.7 s per file).
   An unchanged file costs 0.01 s. So today a save reaches the database **20 s to ~5 min** after it is made
   (≥ 15 min on Docker), and **never reaches an open screen** until someone reloads it.
7. Rapid saves: a file still being saved is retried at the next check; there is no job record, no coalescing and no
   protection if two processes run `sync_workbooks` at once. Weekly dated workbooks are not supported (a link is one
   fixed path). `Portal updates.xlsx` is refused by name/signature; Excel's `~$` lock files are not workbooks the
   link points at, so they are never read.

### A dropped CV (`core/cv_folder.py`, called by the same watcher loop)
1. Folders are linked **only on the Excel link page** (the CV intake page has no folder action). The link is saved
   when the *web* process can see the path; the worker never confirms it.
2. Every `CV_FOLDER_SECONDS` (**60 s**) the loop walks every folder (always including subfolders), skips files
   changed in the last **20 s**, and reads up to 50 files per check.
3. Each file is read **inline**: text extraction, OCR (Tesseract, when installed), CV filter, duplicate checks,
   profile, application. A slow OCR blocks the workbook refresh in the same loop.
4. The original bytes are stored only when the CV is accepted; a file that fails or is not a CV leaves a note on its
   `FolderFile` row but **no stored copy** (no evidence of receipt).
5. There is no job table: a crash in the middle of a file loses the step; the next pass sees the file as unchanged
   only if its row was saved.

### A manual upload (`candidates/views.py: intake` → `_ingest_upload` → `candidates/intake.py: ingest_cv`)
Runs **inside the web request**, five files per request from the browser. OCR also runs inside the request.
Outcomes (added / updated / already held / not a CV / unreadable) are shown once on the results page and kept in
the session only.

### A match request (`candidates/views.py: match_vacancies` → `pipeline/matching.py: compute_match`)
* Default CV set: **the newest intake day only**, sources other than `import`/`internal` (so Excel-loaded people are
  left out unless a recorded channel is ticked), **newest 1,000**, non-matches hidden.
* Every CV × vacancy is computed **inside the request**; nothing is saved until HR adds matches.
* A vacancy's own applicants are scored when they apply and listed on the vacancy page (all of them).
* **Defect confirmed in code:** `judge_match` treats a stage with `passed=None` ("The role: Not judged", e.g. a CV
  with no readable text or a vacancy with no job description) as passed, so a candidate can be called **Match**
  without the role being judged.
* Results record `VERSION` but not which CV text, job description or rubric produced them; there is no reviewer
  override of the verdict (only *Keep in the running* / *Not eligible* on key requirements).
* Merit inputs: qualification, course, years, skills, tools, certifications, job description criteria, relevance.
  Age, community category and recruitment source are **not** read by `compute_match` (verified by reading; a test
  is added).

### An open recruiter screen
Server-rendered pages with no live data updates. The only timer in `static/ds/ds.js` is the summary board clock.
A change made by someone else is seen only after a manual reload.

## Settings and deployment as they are (`config/settings.py`, `docker-compose.yml`, `Dockerfile`)
* `DJANGO_DEBUG` defaults to **true**; the Docker image sets it false.
* Docker: Postgres password `recruitment` in the compose file, `SECURE_COOKIES=false`, port 8000 published without
  TLS, no `restart:` policies, no worker service, workbook and CV paths not mounted into any container.
* CV downloads already go through permission-checked views (`candidates:document`, `candidates:cv`); `media/` is not
  served publicly (verified in `config/urls.py`).
* E-mail defaults to the console backend; AI is off without `ANTHROPIC_API_KEY`.

## To confirm on the running installation (not observable from here)
1. Where "Recruitment Master Weekly Report" lives, who saves it, and whether it is one file edited each week or a new
   dated file each week (the portal showed "Application Query Application Dump" modified 9 Nov and a last import on
   16 Nov, which fits a different file being the live one).
2. Whether the portal PC reads it from a local folder, a mapped network drive or a OneDrive/SharePoint sync folder.
3. The real workbook sizes (rows per sheet) — the 2-second benchmark uses fictional workbooks of the sizes above.
4. The contents of the live `.env` (no secrets needed): `DJANGO_DEBUG`, `ANTHROPIC_API_KEY` set or not, SMTP.
