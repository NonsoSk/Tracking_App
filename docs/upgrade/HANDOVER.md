# Handover: running the upgraded portal

For the owner and IEFCL IT. Everything here is on the branch `claude/portal-upgrade`. The live install on the HR PC
(`claude/quirky-lovelace-sv5emz`) is unchanged until the owner approves the switch.

## 1. Where data comes from

| Source | How it reaches the portal | Who keeps it | Shown on |
|---|---|---|---|
| Recruitment workbooks (tracker, interviews, CBT, staff list, CV list, website applications) | Linked once; the worker reads each save within a second. One fixed file, or the newest file in a folder fitting a pattern (a new dated file each week) | The recruitment team, in Excel | Excel link page (state, last checked, last loaded, last save's delay, rows held for review) |
| CV folders | Linked on the CV intake page; the worker reads files already there (or only new ones) and each new file | Whoever saves CVs there | CV intake page (per folder: status, last checked, last complete check, counts, issues) |
| Folders or a workbook on a PC the server cannot reach | The connector on that PC (`portal-connector.bat`) sends new and changed files; it keeps a queue while offline | That PC's user | CV intake page (the PC shows online or offline) |
| One-off uploads | CV intake page, "Upload files once" | HR | CV intake page, Recent files |
| Recruitment mailbox | `fetch_cv_emails` every 15 minutes (scheduler) | HR | Candidates |

Every file received has a receipt with its outcome and reason: added, brought up to date, already in the portal, not
a CV, could not be read, "same person?" (waiting for HR), or failed (with Try again). The originals are never moved,
renamed or deleted.

## 2. Who owns which fields

Excel is where the team records the recruitment trail; the portal is where people are assessed and moved through
the stages. On each save:

| Field | Owner | On a workbook save |
|---|---|---|
| Requisition reference, title, department, positions, coordinator, requester, dates | Excel | Follows Excel |
| Requisition status | Both | Follows Excel when the tracker closes or re-opens it; otherwise the portal's status stays |
| Requisition minimum qualification | Portal once set | Kept |
| Job description, required and preferred skills, courses, tools, certifications | Portal (hiring manager confirms them) | Not touched |
| Candidate names and contacts | Excel or the CV, whichever came first | Filled when empty; a profile HR corrected by hand is not overwritten |
| Interview records and CBT results | Excel | Added or updated by the same event (person, date, panel or test) |
| Application stage, status, notes, eligibility decisions, match judgements | Portal | Never changed by a save |
| Rows deleted from Excel | — | Stay in the portal |

A row that might be someone already in the portal but does not clearly match (same email, different date of birth)
is **held**, not merged: it is listed under the workbook on the Excel link page. A save that lost sheets it had (or
whose headings changed) is not loaded at all, and the last good data stays.

For time-critical updates (a stage move, a decision), use the portal directly: it is instant for everyone, and Excel
receives it through "Portal updates.xlsx".

## 3. The background worker

`python manage.py run_worker` (started by `start-portal.bat` on the HR PC, and the `worker` service on the pilot).

* It reads the linked workbooks and folders, works through the queue (CVs, workbook saves, OCR of scans, re-assessing
  applications whose CV or job description changed), writes "Portal updates.xlsx", and fetches website resumes.
* Only one worker reads the live inputs. A second one (or a rehearsal copy with `PORTAL_INPUTS_ENABLED=false`) only
  works through the queue.
* If it stops, nothing is lost: files that arrive meanwhile are read when it starts, and a job it was doing is done
  again once. Home and the CV intake page say when the worker is not running.

## 4. Backups and restore

* `python manage.py portal_backup --out <private folder> --verify` writes one .zip with every record and every stored
  file, then restores it into a throwaway second installation and checks record counts and every file (SHA-256).
  The pilot's scheduler does this every night into `PORTAL_BACKUPS_HOST_PATH`.
* `python manage.py portal_restore <zip>` loads a backup into a NEW, EMPTY installation (migrated database, empty
  media folder) and prints the same check. It refuses to run on a portal that holds data.
* Backups hold personal data: keep them in private storage (never Git, e-mail or an open share). Delete old ones
  according to IEFCL's retention rule.

## 5. Moving from the HR PC to the pilot (needs the owner's approval first)

1. On the HR PC: `update-portal.bat` is NOT used for this. Instead stop the portal, then
   `python manage.py portal_backup --out <private folder> --verify` and check it says the restore matches.
2. On the server: set up `deploy/pilot/.env` (see section 7), `docker compose up -d db web`, then
   `docker compose exec web python manage.py portal_restore /path/to/backup.zip`. It must print `"ok": true`.
3. Open a few profiles and CVs on the pilot, sign in as two recruiters on two devices, and compare a few counts with
   the HR PC.
4. Start `worker` and `scheduler`. On the HR PC, from now on start the portal without its worker (or not at all), so
   only the pilot's worker reads the inputs.
5. Tell the team the new address. Keep the HR PC's database and backup unchanged for at least two weeks (rollback).

## 6. Rollback

* Code: the HR PC keeps running `claude/quirky-lovelace-sv5emz` until the owner decides; nothing on this branch
  reaches it by itself. On the pilot, `git checkout` the previous commit and `docker compose up -d --build`.
* Data: restore the last good backup into a new, empty database (`portal_restore`). Migrations on this branch only
  add tables and columns (intake, match reviews, rubric confirmation, link settings); the old code ignores them.
* Matching: the matcher's verdicts are re-made on the first run (version 7). People's judgements (match reviews) are
  separate records and are never changed by re-assessment.

## 7. Hosting (IEFCL IT)

* One Linux host (2 vCPU, 4 GB RAM, 50 GB disk is plenty for the pilot) with Docker, inside IEFCL's network.
* An intranet name (e.g. `recruitment.iefcl.local`) pointing at it. Caddy makes its certificate (`PORTAL_TLS=internal`;
  IT installs Caddy's root certificate on staff PCs, or supplies the company certificate).
* The shared folders the portal reads, mounted on the host under `PORTAL_INPUTS_HOST_PATH` (read-only in the
  containers). Paths typed in the portal are then `/inputs/...`.
* SMTP through Microsoft 365 for e-mails; optional: the recruitment mailbox (IMAP).
* Start: `cd deploy/pilot && cp .env.pilot.example .env` (fill in) `&& docker compose up -d --build`.
  Update: `git pull && docker compose up -d --build`. Status: `docker compose ps`, logs: `docker compose logs -f worker`.
* Cost: no paid service is needed beyond the host itself (on IEFCL's existing virtualisation, or a small cloud VM).
  AI is off for real CVs until IEFCL authorises it (`AI_CV_PROCESSING_AUTHORISED`), and then billed per use by
  Anthropic. Nothing has been provisioned or bought.

## 8. On the HR PC (Windows), until the pilot

* `start-portal.bat` now starts the background worker in a minimised window (instead of the old Excel watcher).
* `update-portal.bat` installs the two new optional packages (python-calamine, watchdog) from requirements.txt.
* `portal-connector.bat` is only for other PCs whose folders the portal cannot reach.
