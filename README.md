# IPL Community Grievance Management System

Offline-first PWA for the Community Relations Department of Indorama Eleme Petrochemicals Limited.
**Submit → Track → Resolve → Acknowledge.**

## Documents

| Doc | Contents |
|---|---|
| [docs/01-data-audit.md](docs/01-data-audit.md) | Audit of the 2018–2026 workbooks: columns, counts, duplicates, overlap, naming/category/status inconsistencies, migration mapping |
| [docs/02-architecture.md](docs/02-architecture.md) | Platform, schema, roles and permissions, offline sync, screens, migration pipeline, **confirmed decisions (§8)** |
| [docs/03-import-report.md](docs/03-import-report.md) | Historical import dry run: 608 source rows → 504 grievances, review queue |
| [docs/04-deployment.md](docs/04-deployment.md) | Supabase setup, WhatsApp templates and secrets, scheduling, hosting, operations, local development |

## Build status

| Phase | Status |
|---|---|
| 1–4 Audit, architecture, design system | ✅ approved |
| 5 Auth & roles: phone + PIN (members), email + password (staff), configurable permissions, RLS | ✅ |
| 6 Community master data: 48 communities, Akpajo in two groups, 31 pipeline communities (32nd pending) | ✅ |
| 7 Submission codes + 5-step submit wizard, paper/assisted entry | ✅ |
| 8 Officer workspace: status, remarks, actions, resolve, assign, triage, acknowledgement, archive | ✅ |
| 9 Dashboards (drill-down), search, filters | ✅ |
| 10 Offline: installable PWA, on-device drafts/outbox, idempotent sync | ✅ |
| 11 Notifications: in-app + WhatsApp (Meta Cloud API) outbox, delivery receipts, overdue alerts | ✅ code · ⏳ needs Meta account + template approval |
| 12 Historical import: 608 rows → 504 grievances, verbatim source rows, review queue | ✅ |
| 13 Reports & exports: Excel, CSV, print/PDF | ✅ |
| 14 Tests: 156 pgTAP · 29 unit · 3 browser end-to-end (incl. offline) | ✅ |

Not yet done: Super Admin MFA enrolment screens (Supabase TOTP is enabled; the app UI for enrolment is next), evidence file uploads (the table and permission exist; the upload UI is not built), and an in-browser import wizard (the import runs from the command line with a dry-run report).

## Database

`supabase/migrations/` holds versioned SQL for Supabase/PostgreSQL:

| Migration | What it adds |
|---|---|
| `…0100_foundation` | settings, append-only audit log, roles/permissions, profiles, permission helpers |
| `…0200_master_data` | community types, clusters, communities + affiliations (Akpajo: Host + Pipeline C1), aliases, 8 categories / 48 sub-categories, statuses, transitions, severities, holidays |
| `…0300_grievances` | grievances table, workflow history tables, officer scopes, tracking IDs, working-day SLA clock, text-protection trigger |
| `…0400_notifications` | in-app notifications + provider-agnostic delivery outbox (WhatsApp) |
| `…0500_submission` | sign-up hook, submission codes, `submit_grievance`, `submit_grievance_assisted`, auto-assignment |
| `…0600_workflow` | officer/admin actions and the complainant read API |
| `…0700_admin_and_jobs` | user/role/scope admin, staff list view, hourly overdue scan (pg_cron) |
| `…0800_legacy_import` | import batches, verbatim source rows, legacy value mappings |
| `…0900_security` | RLS policies and grants for every table and function |
| `…1000_legacy_import_fn` | `app.import_legacy_batch` / `app.rollback_legacy_batch`, batched overdue alerts |
| `…1100_app_api` | app read API: master data, staff list/detail (search, filters, paging), dashboards, officer home, export, admin lists |
| `…1200_ops` | audit hook for PIN resets |

### Running the tests

The suite has 156 pgTAP assertions covering access control, classification, codes, idempotency, workflow, SLA, notifications and the historical import.

```bash
# needs PostgreSQL 15+ with pgtap + pg_trgm, and pg_prove
PGHOST=/tmp PGPORT=5432 scripts/db/test-local.sh
```

A small shim (`supabase/tests/_shim`) emulates Supabase's `auth` schema and roles, so the same migrations run locally and on Supabase.

### First deployment

1. `supabase db push` (or run the migrations in order).
2. Enable the `pg_cron` extension, then re-run `…0700_admin_and_jobs.sql` or schedule `select app.scan_overdue()` hourly.
3. Sign up the Super Admin account, then in the SQL editor run `select app.bootstrap_super_admin('you@example.com');`
4. Create the officer accounts and set their responsibility, e.g.
   `select admin_set_officer_scopes('<godpower-id>', '[{"community_type":"HOST"},{"community_type":"PIPELINE"}]');`

## Historical data audit

```bash
pip install -r scripts/migration/requirements.txt
python3 scripts/migration/audit_workbooks.py --complete "<Complete Grievance Tracker>.xlsx" \
                                             --tracker "<Indorama_Grievance Tracker_2026.1>.xlsx"
```

### Importing the history

```bash
cd scripts/migration
python3 import_workbooks.py --complete "<Complete…>.xlsx" --tracker "<…2026.1>.xlsx"           # dry run + report
PGHOST=… PGUSER=postgres python3 import_workbooks.py --complete … --tracker … --apply          # one transaction
```

Import after the officer accounts and scopes exist, so open items are assigned. To undo, run `select app.rollback_legacy_batch('<batch id>')`.

The source workbooks contain complainant names and phone numbers. **Do not commit them.** `.gitignore` blocks `*.xlsx`, `*.csv` and `audit-output/`.
