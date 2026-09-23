# IPL Community Grievance Management System

Offline-first PWA for the Community Relations Department of Indorama Eleme Petrochemicals Limited.
**Submit → Track → Resolve → Acknowledge.**

## Documents

| Doc | Contents |
|---|---|
| [docs/01-data-audit.md](docs/01-data-audit.md) | Audit of the 2018–2026 workbooks: columns, counts, duplicates, overlap, naming/category/status inconsistencies, migration mapping |
| [docs/02-architecture.md](docs/02-architecture.md) | Platform, schema, roles and permissions, offline sync, screens, migration pipeline, **confirmed decisions (§8)** |
| [docs/03-import-report.md](docs/03-import-report.md) | Historical import dry run: 608 source rows → 504 grievances, review queue |

## Build status

| Phase | Status |
|---|---|
| 1–4 Audit, architecture, design system plan | ✅ approved |
| 5 Auth & roles (database: RBAC, RLS, profiles, sign-up hook) | ✅ database · ⏳ app screens |
| 6 Community master data (48 communities, affiliations, aliases, categories) | ✅ database · ⏳ admin screens |
| 7 Submission codes + submission (self-service, assisted/paper, idempotent) | ✅ database · ⏳ app screens |
| 8 Officer workflow (assign, status, remarks, resolve, acknowledge, archive) | ✅ database · ⏳ app screens |
| 12 Historical import (reconcile, de-duplicate, verbatim source rows, rollback) | ✅ script + database · ⏳ admin wizard |
| 9 Dashboards · 10 Offline sync · 11 WhatsApp dispatch · 13 Reports | ⏳ next |

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
