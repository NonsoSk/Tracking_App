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
| 14 Tests: 165 pgTAP · 29 unit · 4 browser end-to-end (incl. offline) | ✅ |
| Visual design: royal blue / white with #C00000 accents, separate navy dark theme | ✅ |

Not yet done: Super Admin MFA enrolment screens (Supabase TOTP is enabled; the app UI for enrolment is next), evidence file uploads (the table and permission exist; the upload UI is not built), and an in-browser import wizard (the import runs from the command line with a dry-run report).

## Design

Styled like a mobile banking app: royal blue does the work, gold rewards good outcomes, and red / orange / green
appear only when something needs attention (with #C00000 accents). Font: Nunito Sans, self-hosted (no Google request).

- **Tokens** live in `apps/web/src/index.css` as CSS variables: a light palette and a separately designed navy dark
  palette (`#0B1224` background, not black). The theme follows the phone until the person uses the switch; the choice
  is kept on that device (`public/theme-init.js` applies it before the first paint).
- **Layout**: desktop has a solid blue sidebar (white pill for the active page, progress ring card, dark-mode switch);
  phones get a blue top bar and a bottom tab bar with 4 tabs + **More**. Forms open as a drawer from the right on
  desktop and a bottom sheet on phones.
- **Components** (`src/design/ui.tsx`): pill buttons and sub-tabs with counts, stat tiles, progress rings, quick
  actions, people cards, "Next step" boxes, on-page delete confirmation (`InlineConfirm`) and toasts with **Undo**.
- **Illustrations** (`src/design/art.tsx`): small floating 3D objects in page headers, drawn in SVG (no images to
  download). All motion stops when the phone asks for reduced motion.
- Charts take their colours from the theme: received `#0A4FD1` / resolved `#B0700E` (dark: `#5B8CFF` / `#B7802A`).

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

The suite has 165 pgTAP assertions covering access control, classification, codes, idempotency, workflow, SLA, notifications and the historical import.

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

## Quick setup on Supabase (no command line)

1. SQL Editor → run [`supabase/setup/all-in-one.sql`](supabase/setup/all-in-one.sql) once on the empty project
   (if you ran an earlier version, run [`03-update-2026-09-24.sql`](supabase/setup/03-update-2026-09-24.sql) instead).
2. Authentication → Users → Add user (Auto Confirm) **for yourself only**, then run
   [`01-make-me-super-admin.sql`](supabase/setup/01-make-me-super-admin.sql) with your email.
3. Deploy `apps/web` on Netlify from this repository ([`netlify.toml`](netlify.toml)) with `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (the publishable key).
4. Everything else happens in the app: **Communities → Change** puts anyone in charge of a community;
   **Users & officers** manages roles. Optional: paste `supabase/functions/admin-create-user/index.ts` and
   `admin-reset-pin/index.ts` into Supabase → Edge Functions → Deploy a new function → Via editor, so you can also
   create staff logins and reset PINs from the app.
