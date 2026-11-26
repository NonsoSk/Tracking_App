# Upgrade status (branch `claude/portal-upgrade`)

The live install (`claude/quirky-lovelace-sv5emz`) is untouched. Nothing here reaches the HR PC, moves records or
switches the team without the owner's explicit approval.

## What is built and tested

| Area | State | Evidence |
|---|---|---|
| Diagnosis of every path | Done | `DIAGNOSIS.md` (verified in code; the running install was not observed) |
| Receipts first, durable job queue, one worker reading live inputs | Built | `intake/tests.py` (replay after a stop, a job run twice, failures with evidence, lease takeover, threads as they run) |
| Workbook saves: complete files read at once, only changed rows imported, coalesced and in order, invalid saves refused | Built | `core/test_excel_link.py`, `intake/tests.py` |
| Weekly dated workbooks (newest file fitting a pattern) | Built | `core/test_excel_link.py: WeeklyWorkbookTests` |
| Open screens refresh after each commit, keeping unsaved edits | Built | `intake/tests.py: LiveTests`; browser benchmark below |
| **2-second target** (save to two recruiters' open screens) | **Met in the benchmark** | 120/120 within 2 s; median 0.84 s, p90 1.1 s, worst 1.24 s (runserver and gunicorn, fictional workbooks of 200/2,000/2,000/1,000/5,000 rows). Real workbook sizes and the real share's behaviour are not yet measured |
| CV folders linked from the CV intake page (confirm step, status, counts, stop one) | Built | `intake/test_linking.py` |
| Connector for PC folders (offline queue, catch-up) | Built | `intake/test_linking.py: ConnectorProgramTests` |
| Needs review (never Match on an unjudged role; missing information is not a mismatch) | Built | `pipeline/test_match_verdict.py` |
| Version stamps, reviewers' judgements with reasons, re-assessment when CV or JD changes, rubric confirmation | Built | `pipeline/test_match_verdict.py` |
| Coverage: every CV in a selection read in batches, counts and reasons | Built | `candidates/test_match.py: CoverageTests` (the 1,001st) |
| Blind evaluation workflow (export, evidence, report old vs new) | Built | `pipeline/test_match_verdict.py`; **real-world quality UNVERIFIED** until reviewers label real cases |
| Home: new today, needs a person, problems; Home/Vacancies/Candidates first | Built | `core/test_upgrade_ui.py` |
| Simultaneous edits not silently overwritten | Built | `core/test_upgrade_ui.py` |
| Pilot deployment (Caddy HTTPS, web, worker, scheduler, PostgreSQL, private media, restart policies) | Files written | Not started here (no Docker daemon in this environment) |
| Backup and restore on a second installation; SQLite to PostgreSQL | Built | `core/test_backup.py`; rehearsal on fictional data: 6,000 candidates, 2,000 applications, 37 files, counts and hashes match on PostgreSQL 16 |

## Still needs people or access

* The authoritative workbook: where "Recruitment Master Weekly Report" lives, one file or weekly files, who saves it.
* Hosting access (IEFCL IT), the intranet name and certificate, the shares to mount, SMTP.
* AI for real CVs: IEFCL's authorisation of the provider and the data use.
* Hiring managers: confirm each vacancy's requirements; reviewers: the blind evaluation on real vacancies.
* Two recruiters on two devices, and the usability test.
