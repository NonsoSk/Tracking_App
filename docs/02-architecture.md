# Phases 2–4 · Architecture Proposal (for approval)

Read with `01-data-audit.md`. **No application code has been written yet.** This document is for review, and implementation starts once it is approved.

Guiding loop: **SUBMIT → TRACK → RESOLVE → ACKNOWLEDGE.**

---

## 1. Application architecture

### 1.1 Platform decision: installable **PWA**, one codebase

| Criterion | PWA (chosen) | React Native / Expo |
|---|---|---|
| Offline | Service worker + IndexedDB. Full offline shell and queued submissions | Equivalent |
| Data cost to install | ~300 KB first visit. No app-store download | 20–40 MB APK |
| Low-end Android | Runs in Chrome, which is already installed | Native install and storage pressure |
| Staff desktop | Same app, desktop layout | Needs a separate web build anyway |
| Deploy / update | Instant, no store review | Store releases, or OTA with limits |
| Cost | One codebase, static hosting | Two targets, developer accounts |
| Gaps | iOS: no Background Sync, so sync runs whenever the app opens | – |

Community members are overwhelmingly on Android, where Chrome PWAs install to the home screen and support Background Sync. If a Play Store listing is wanted later, the same PWA can be wrapped as a **Trusted Web Activity** with no rewrite.

### 1.2 Stack

| Layer | Choice | Why |
|---|---|---|
| UI | React + TypeScript + Vite, route-level code splitting | Mature, and community and staff bundles load separately |
| Styling | Tailwind CSS with design tokens and **system fonts** | Tiny CSS output. No web-font download for community users |
| Offline | Workbox service worker · **Dexie (IndexedDB)** | Precached shell, local drafts and outbox |
| Server state | TanStack Query (persisted to IndexedDB) | Caching, pagination, retries |
| Validation | **Zod schemas shared** by client and server functions | One definition of "valid" |
| Charts | Recharts, lazy-loaded **for staff routes only** | Community users never download it |
| Database | **PostgreSQL** (Supabase) | Relational, reporting-friendly |
| AuthZ | **Row Level Security** plus `SECURITY DEFINER` workflow functions | Enforced in the database, not the UI |
| Auth | Supabase Auth: members use **phone + 6-digit PIN**. Staff use email + password, with **TOTP MFA required for Super Admin** | |
| Files | Supabase Storage (private buckets, signed URLs) | Evidence uploads |
| Jobs | `pg_cron` for overdue scans and the notification dispatcher | No extra servers |
| Server functions | Edge Functions (Deno): notification providers, exports, Excel import parsing | Secrets never reach the browser |

**Why Supabase and not a custom Node API:** the hardest requirement is authorization that cannot be bypassed. Postgres RLS gives that at the data layer, where a custom API can only give it in application code. All business logic lives in SQL migrations and Edge Functions, which are plain Postgres and TypeScript. The stack can therefore move to **self-hosted Supabase** or any Postgres if IPL IT requires on-premises hosting or Nigerian data residency (NDPA 2023).

### 1.3 Repository layout (created at implementation time)
```
apps/web/                 PWA (community + officer + admin, role-routed)
  src/features/…          submit, track, officer, admin, import, reports
  src/offline/            dexie db, outbox, sync engine
  src/design/             tokens, components
packages/shared/          zod schemas, types, status copy, tracking-id utils
supabase/migrations/      schema, RLS, functions, triggers (versioned SQL)
supabase/seed/            community master, categories, statuses, roles
supabase/functions/       notify-dispatch, provider-webhook, export, import-parse
supabase/tests/           pgTAP: every RLS policy and workflow function
scripts/migration/        audit + import (Python, read-only audit exists)
docs/
```

---

## 2. Database design

### 2.1 Entity overview
```
roles ─┬─ role_permissions ── permissions
       └─ user_roles ── profiles (1:1 auth.users)
                          └─ officer_scopes ── community_types / clusters / communities

community_types ── community_affiliations ── communities ── community_aliases
clusters ─────────┘

grievance_categories ── grievance_subcategories
grievance_statuses, severities                    (configurable master data)

grievances (central) ─┬─ grievance_status_history
                      ├─ grievance_assignments
                      ├─ grievance_comments      (visibility: internal | complainant)
                      ├─ grievance_actions
                      ├─ grievance_resolutions
                      ├─ grievance_acknowledgements
                      ├─ attachments
                      ├─ grievance_flags         (duplicate / date_suspect / needs_review)
                      └─ legacy_source_records   (raw Excel row JSON, 1..n per grievance)

submission_windows ── submission_codes ── grievances.submission_code_id
notifications ── notification_deliveries (per channel, provider status)
audit_logs · import_batches · legacy_value_mappings · settings · tracking_counters · holidays
```

### 2.2 Communities (fixes the Akpajo problem)

The brief places Akpajo in **both** Host and Pipeline Cluster 1, so "type" is a relationship, not a column:

| Table | Key columns |
|---|---|
| `community_types` | `id`, `code` (HOST, PIPELINE, INDIRECT, JETTY), `name`, `has_clusters` |
| `clusters` | `id`, `community_type_id`, `name` ("Cluster 1"…), `sort_order`, `active` |
| `communities` | `id uuid`, `name` unique, `active`, `notes` |
| `community_affiliations` | `community_id`, `community_type_id`, `cluster_id` (required only when the type has clusters), **`is_primary`**, unique(community, type) |
| `community_aliases` | `alias_normalised` → `community_id` (Wakohu → Nwakohu, Njuru/Akpakpan → Njuru, …) |

When a grievance is saved, the database resolves `community_id` into **`community_type_id` and `cluster_id` columns stored on the grievance**, using the primary affiliation. Staff with the right permission can switch the grievance to another affiliation, and the change is audited. Snapshotting the classification keeps past reports stable if the master changes later. Members only ever pick a community.

### 2.3 Grievances (central table)

| Group | Columns |
|---|---|
| Identity | `id uuid PK` (immutable) · `tracking_id text UNIQUE` · `client_submission_id uuid UNIQUE` (idempotency) · `origin` (app, assisted, paper, legacy_import) · `is_legacy bool` |
| Dates | `date_received date` + `date_received_precision` (day/month) · `submitted_at timestamptz` (server receipt) · `client_created_at` · `form_issued_date` · `review_date` · `first_response_at` · `resolved_at` · `closed_at` · `year int` (generated) |
| Complainant | `complainant_user_id → profiles` (null for legacy and paper records) · `complainant_name` · `complainant_gender` · `complainant_phone` · `complainant_email` · `complainant_address` |
| Community | `community_id` · `community_type_id` · `cluster_id` (snapshots, set by trigger) |
| Grievance | `title` (short, auto-derived or edited) · `category_id` · `subcategory_id` · `severity_id` · `description` · `incident_details` · `desired_resolution` · `suggestions` |
| Workflow | `status_id` · `assigned_officer_id` · `responsibility` · `closure_officer_id` · `submission_code_id` · `ack_state` (not_requested, pending, acknowledged, disputed, not_captured) |
| Overdue | `sla_started_at` · `sla_due_at` · `overdue_since` · `last_overdue_alert_at` · `sla_paused bool` |
| Legacy | `legacy_tracking_id` · `legacy_tracking_id_norm` · `legacy_category` · `legacy_subcategory` · `legacy_status` · `legacy_severity` · `legacy_community` · `legacy_community_category` · `legacy_community_type` · `legacy_responsibility` · `legacy_closure_officer` · `source_workbook` · `source_sheet` · `source_row` · `source_year` · `import_batch_id` |
| Lifecycle | `created_at` · `updated_at` · `created_by` · `archived_at` · `archived_by` · `archive_reason` |

**Original text is immutable.** A trigger blocks direct updates to `description`, `desired_resolution` and `incident_details`. Changes go through `amend_grievance_text()`, which writes the old and new values to `audit_logs` and a visible "edited" marker.

**Indexes:** `(status_id, assigned_officer_id)`, `(community_id, date_received)`, `(community_type_id, cluster_id)`, `(category_id)`, `(year)`, `(complainant_user_id, updated_at)`, `(sla_due_at) WHERE open`. Search uses trigram indexes (`pg_trgm`) on `tracking_id`, `legacy_tracking_id_norm`, `complainant_name` and `complainant_phone`, plus a full-text `tsvector` over description, title and desired resolution.

### 2.4 Tracking IDs
- New format: **`IPL-GRV-2026-000123`**. It is generated **only on the server** inside `submit_grievance()` from `tracking_counters(year)` under a row lock (`UPDATE … RETURNING`). The `UNIQUE` constraint is the final guarantee.
- Imported history gets **`IPL-GRV-2019-H00012`**. The `H` marks historical records and keeps them out of the live sequence. The original `IPL2001037` / `IFL20261617F` stays searchable.
- An offline draft **never shows a fake tracking ID.** It shows "Saved on this phone – not yet sent".

### 2.5 Workflow tables (abridged)
- `grievance_statuses`: `code`, `staff_label`, **`public_label`**, **`public_message`**, `is_open`, `stops_sla`, `sort_order`, `active`. Seeded with Submitted, Under Review, Assigned, In Progress, Awaiting Action, Resolved, Closed, Reopened. Plus `status_transitions(from, to, permission)` so the Super Admin can configure the workflow.
- `grievance_status_history`: `from_status`, `to_status`, `changed_by`, `changed_at`, `note`, **`visible_to_complainant`**. This table drives the timeline.
- `grievance_assignments`: `officer_id`, `assigned_by`, `assigned_at`, `unassigned_at`, `reason`.
- `grievance_comments`: `body`, `kind` (remark, question, reply), **`visibility`** (internal, complainant).
- `grievance_actions`: `action_type` (management_action, field_visit, …), `description`, `action_date`.
- `grievance_resolutions`: `details`, `resolved_by`, `resolved_at`, `public_summary`.
- `grievance_acknowledgements`: `response` (acknowledged, disputed), `reason`, `user_id`, `channel`, `recorded_by` (for assisted cases), `created_at`. A dispute moves the grievance to **Reopened** and alerts the officer.
- `attachments`: `storage_path`, `mime`, `bytes`, `sha256`, `uploaded_by`, `visibility`. Files go to private storage with an allowed-type list and size cap; images are compressed on the client first.

### 2.6 Submission control

| Table | Columns |
|---|---|
| `submission_windows` | `id`, `name`, `scope_type` (all, community_type, cluster, community), `scope_id`, `opens_at`, `closes_at`, `max_submissions`, `status` (draft, active, closed), `created_by`, `closed_by`, `closed_at` |
| `submission_codes` | `code` unique (e.g. `AGB-2026-0923-X7P4`, ambiguity-free alphabet), `window_id`, `created_by`, `created_at`, `released_at`, `released_by`, `expires_at`, `max_submissions`, `submission_count`, `status`, `deactivated_by`, `deactivated_at` |

- **Get Code:** the member's home screen shows *Open* or *Closed* for **their** community. When a window is open, "Get Code" reveals the code and the submit flow fills it in automatically. The same code can also be read out at community meetings for assisted entry.
- A code is **never** a login credential.
- **Offline edge case:** the server accepts a queued grievance if the code was valid at the draft's `client_created_at` **and** it arrives within a configurable grace period after expiry (default **72 h**). The device clock cannot be trusted, so the draft must also carry the window data the app cached the last time it was online. Anything else is rejected with a plain-language message, and the draft stays on the phone.

### 2.7 Notifications (provider-agnostic outbox)
- `notifications`: in-app item (`user_id`, `type`, `title`, `body`, `grievance_id`, `read_at`).
- `notification_deliveries`: `notification_id`, `channel` (in_app, whatsapp, sms, email), `provider`, `template`, `status` (**queued → sending → sent → delivered → read**, or failed), `provider_message_id`, `attempts`, `next_attempt_at`, `last_error`.
- The `notify-dispatch` Edge Function runs every minute through `pg_cron` and calls a **`NotificationProvider` interface**. Adapters: WhatsApp Cloud API (Meta), Twilio and Termii. Only config selects the provider.
- **Delivery honesty:** status becomes `delivered` only when the provider's signed webhook says so. The UI shows "Sent" or "Delivered" exactly as reported. Failures retry with exponential backoff.
- WhatsApp note: business-initiated messages must use a **Meta-approved template**. The resolution summary goes in as a template variable (truncated to a safe length) with "open the app for full details".

### 2.8 Audit, archive, settings
- `audit_logs`: `actor_id`, `action`, `entity`, `entity_id`, `old jsonb`, `new jsonb`, `at`, `ip`, `user_agent`. Written by triggers on sensitive tables and by every workflow function. Rows are **append-only**, with no update or delete even for the Super Admin.
- **Delete = archive** (`archived_at`). Archived rows are hidden by RLS from everyone but the Super Admin. Permanent deletion is a separate Super Admin function that requires typing the tracking ID, and it leaves an audit tombstone. Officers can only call `request_deletion()`.
- `settings`: overdue threshold (default **3**), clock mode, grace period, notification toggles, WhatsApp template names. `holidays` supports the working-day clock mode.

### 2.9 Historical import tables
- `import_batches`: file name, **sha256**, uploaded by, status, counters (total, valid, invalid, duplicates, imported, skipped), `report jsonb`.
- `legacy_source_records`: `batch_id`, `workbook`, `sheet`, `row_number`, `source_serial`, **`raw jsonb` (every original cell)**, `grievance_id`, `match_role` (primary, overlap_copy).
- `legacy_value_mappings`: `field` (category, status, community, severity), `legacy_value_norm`, `target_id`, `approved_by`. These are editable in the import UI.

---

## 3. Roles and permissions

Permissions are rows (`permissions`), so they are configurable and not hard-coded. Roles are bundles of permissions. **Scope** (which grievances an officer sees) comes from `officer_scopes`, which can hold a community type, a cluster or a single community.

| Permission | Super Admin | Officer | CR Staff | Supervisor | Data Entry | Viewer | Community Member |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| grievance.read | all | **own scope + assigned** | all | all | own entries | all (masked PII) | **own only** |
| grievance.create | ✓ | ✓ | ✓ | – | ✓ (assisted / paper) | – | ✓ (valid code) |
| grievance.update_status | ✓ | scope | ✓ | ✓ | – | – | – |
| grievance.assign / reassign | ✓ | – | ✓ | ✓ | – | – | – |
| grievance.comment_internal | ✓ | scope | ✓ | ✓ | – | – | – |
| grievance.resolve / close | ✓ | scope | – | ✓ | – | – | – |
| grievance.amend_text (audited) | ✓ | – | – | – | – | – | – |
| grievance.acknowledge | ✓ (record on behalf) | ✓ (record on behalf) | – | – | – | – | ✓ own |
| grievance.archive | ✓ | request only | – | request only | – | – | – |
| grievance.hard_delete | ✓ (confirm) | – | – | – | – | – | – |
| codes.release / deactivate | ✓ | ✓ (scope) | ✓ | – | – | – | – |
| dashboard.view | all | own scope | ✓ | ✓ | – | ✓ | – |
| export | ✓ | own scope | ✓ | ✓ | – | – | – |
| masterdata.manage | ✓ | – | – | – | – | – | – |
| users.manage / roles.assign | ✓ | – | – | – | – | – | – |
| import.run | ✓ | – | – | – | – | – | – |
| audit.view · settings.manage | ✓ | – | – | – | – | – | – |

The Officer, CR Staff, Supervisor, Data Entry and Viewer columns are defaults that you can edit.

**Initial officer scopes** (names to confirm, see §8):
- Godspower Jaka: HOST, PIPELINE
- Jima Bebe: INDIRECT
- Esther Walter Anga: JETTY

New grievances are auto-assigned to the officer whose scope matches.

**Enforcement.** RLS on every table uses the helpers `has_perm(text)`, `in_officer_scope(grievance)` and `is_super_admin()`. Community members have **no direct INSERT or UPDATE** on `grievances`. They can only call `submit_grievance()` and `acknowledge_resolution()`. pgTAP tests in the suite cover the key attacks: a member fetching another member's grievance by id, and a Host/Pipeline officer reading a Jetty grievance. Both must return zero rows.

Complainant-facing reads go through a `my_grievances` view that **exposes only public columns**: public status label, public comments, resolution summary. Internal remarks never leave the database for a member.

---

## 4. Workflow rules

- **SLA clock** starts at `submitted_at`, the time the server receives the grievance, since an officer cannot act on something still sitting on a phone. It stops at a status with `stops_sla` (Resolved or Closed). Default is **calendar days**. A setting switches to **working days** using the `holidays` table (see §8).
- **Overdue job** (`pg_cron`, hourly): open grievances with `now() > sla_due_at` get `overdue_since` set, plus an in-app and optional WhatsApp alert to the assigned officer. The alert repeats daily, not hourly, and admins get a daily digest. **Due soon** means within 24 h of the threshold. Legacy-open records (`is_legacy`) appear on dashboards but do not trigger alerts until an officer reviews them. This prevents an alert flood on import day.
- **Resolve** (`resolve_grievance()`): requires resolution details. It sets Resolved, sets `ack_state = pending`, writes the timeline entry, and queues in-app and WhatsApp notifications.
- **Acknowledge**: "Yes" records the acknowledgement, and the grievance becomes closable (auto-close after N days if configured). "No" requires a short reason, then goes to Reopened with an officer alert. Resolved never implies agreement.

---

## 5. Offline architecture

```
┌──────────────── phone ────────────────┐                 ┌────────── server ──────────┐
│ Service worker: precached app shell   │                 │                            │
│ IndexedDB (Dexie)                     │   HTTPS (small  │ submit_grievance(          │
│  • master: communities, categories,   │    JSON RPCs)   │   client_submission_id,…)  │
│    statuses, window/code cache        │ ─────────────▶  │  ├ validate (zod + SQL)    │
│  • outbox: local drafts & submissions │                 │  ├ ON CONFLICT(client id)  │
│  • my_grievances + timelines cache    │ ◀─────────────  │  │   → return existing     │
│  • notifications cache                │   tracking_id   │  └ tracking_id             │
│ Sync engine                           │                 │ changes since ?since=ts    │
└───────────────────────────────────────┘                 └────────────────────────────┘
```

**Outbox record:** `local_id (uuid = idempotency key)`, `server_id`, `tracking_id`, `payload`, `state`, `attempts`, `last_error`, `created_at`, `updated_at`, `code_snapshot`.

| State | Shown to the user |
|---|---|
| DRAFT | "Draft – saved on this phone" |
| QUEUED | **"Saved on this phone. It will be sent automatically when you're back online."** |
| SYNCING | "Sending your grievance…" |
| SYNCED | ✓ "Received by IPL" + tracking ID |
| FAILED (permanent) | Plain-language reason plus a fix-it action. The draft is kept. |

- **Triggers:** the `online` event, app focus, Background Sync (Android), and a backoff timer (5 s → 5 min cap).
- **No duplicates:** the same `local_id` is sent on every retry. The server's `UNIQUE(client_submission_id)` returns the original record. The outbox item is locked while in flight so two tabs cannot both send it.
- **Pull:** `my_grievances?since=<ts>` returns only changed rows (a few hundred bytes). Master data is fetched only when `master_data_version` changes.
- **Auth offline:** the session is persisted, so drafting works offline even with an expired token. Sending waits for re-authentication.
- **Shared phones:** signing out wipes the local cache and warns first if unsent drafts exist.

**Data budget targets:** first load under 300 KB. A repeat open costs about 0 KB (cached). A submission is under 5 KB. Community routes load no chart library, no web fonts and no large images. Illustrations are optimised WebP/SVG under 30 KB each and lazy-loaded.

---

## 6. Screen hierarchy

**Community (mobile-first, bottom nav: Home · My Grievances · Notifications · Profile)**
```
Splash → Welcome (first run only) → Sign up [name, phone, community, PIN] → Home
Returning: "Welcome back" [phone + PIN] → Home
Home: greeting · community · OPEN/CLOSED banner · [Submit a Grievance] · My Grievances · Track · Notifications
Submit: Get code → 1 Community (confirm) → 2 Your concern → 3 Type (big icon tiles) → 4 What should we do? → 5 Review → Sent / Saved-on-phone
My Grievances → Detail (timeline) → Resolution → Acknowledge (Yes / I have a concern)
Notifications · Profile · Help
```
**Officer** (desktop sidebar, mobile bottom nav)
```
Dashboard [Overdue · Due soon · New · In progress · Awaiting acknowledgement] → filtered list
Assigned list → Grievance workspace (details, days outstanding, timeline, tabs: Remark · Action · Status · Resolve · Evidence)
Overdue · Submission codes (scope) · Notifications · Profile
```
**Super Admin** (sidebar: Overview · Grievances · Communities · Officers & Users · Submission Codes · Categories · Reports · Notifications · Data Import · Audit Log · Settings)
```
Overview dashboard (KPIs → drill-down) · Grievances (search, filters, bulk assign, export)
Master data: communities / affiliations / clusters / aliases, categories / sub-categories, statuses / transitions, severities
Import wizard: Upload → Sheets → Preview → Map columns → Map values → Validate / duplicates → Import → Report
Reports: annual, community, cluster, category, resolution, outstanding, overdue, officer workload, monthly (Excel / CSV / PDF)
```

### 6.1 Design system (summary)
- **Tone:** warm and trustworthy for communities, calm and dense-but-clear for staff.
- **Colour:** a deep teal/green primary (trust, environment), a warm amber accent for calls to action, warm neutral greys, and semantic success, warning and danger colours. **Status is always icon + word**, never colour alone (✓ Resolved, ! Overdue).
- **Type:** system font stack. Base size 17 px for community screens and 15 px for staff screens. Minimum touch target 48 px.
- **Components:** Button, Card, KPI tile, Stepper, Input, Select sheet, Status badge, Timeline, Toast, Modal / confirm, Empty state, Skeleton, Offline banner, Sync chip.
- **Motion:** 150–200 ms, transform and opacity only. One success animation, and `prefers-reduced-motion` is respected.
- **3D:** only a soft-3D community illustration on Welcome and a few empty-state visuals.

---

## 7. Historical migration pipeline

```
Upload (sha256, reject re-upload of same file unless forced)
 → Detect sheets & header rows (handles title rows above headers, as in 2023/24/25)
 → Map columns (pre-filled from 01-data-audit §8.1, editable)
 → Normalise (trim, zero-width chars, "None"→empty, "Mon YYYY"→date+precision, phones→E.164)
 → Map values (community aliases, category/status/severity via legacy_value_mappings)
 → Validate (unknown community/category/status, invalid dates/phones, missing text)
 → Duplicate detection (same legacy ID; same name+text; same community+text; cross-workbook overlap)
 → Dry-run report  [TOTAL · VALID · INVALID · DUPLICATES · WILL IMPORT · SKIPPED]  ← you approve
 → Import in one transaction per batch; raw row JSON → legacy_source_records; flags → grievance_flags
 → Audit report (downloadable) + audit_logs entry per batch
```

Rules: nothing is auto-deleted, every original cell is preserved, re-running is idempotent (keyed on file hash + sheet + row), and a batch can be rolled back as a whole.

Expected result for the supplied files: **545 grievances**, plus 63 overlap source records linked to their tracker twins. Duplicate candidates are flagged for review.

---

## 8. Decisions needed before implementation

1. **Akpajo (Host + Pipeline Cluster 1).** Should its grievances default to **Host** (primary affiliation, changeable by staff), or should staff decide per grievance? *Recommendation: default Host, staff can change.*
2. **The 32nd pipeline community.** What is its name? Until you confirm it, the master holds 31.
3. **Officer names.** Is it "Godspower" or "Godpower" Jaka? Is "Jima Bebe" the same person as "Jima Ngofa" or "Godwin Bebe-Okpabi" in the workbook, or someone else?
4. **Overdue clock.** Calendar days or working days (Mon–Fri excluding holidays)? *Recommendation: working days, which is fairer to officers and avoids weekend false alarms.*
5. **Tracker "2024" block (25 rows).** Are these really 2024, or 2026 forms with a typing error? They will be imported as recorded and flagged until you answer.
6. **The 177 open tracker grievances and 3 open WIPs from 2020–21.** Should they be imported as open and worked in the new app? *Recommendation: yes. The 2020–21 WIPs go to an officer review queue.*
7. **Hosting and WhatsApp provider.** Supabase cloud or self-hosted on IPL infrastructure? Which WhatsApp provider (Meta Cloud API directly, Twilio or Termii)? The app works without one; messages queue until a provider is configured.
8. **Missing reference files.** Please attach the grievance form (.docx), Host Communities (.docx) and the Pipeline and Jetty PDFs so the master data can be checked against them.

---

## 9. Build phases (after approval)

| # | Deliverable | Exit test |
|---|---|---|
| 5 | Monorepo, schema migrations, RLS, roles, auth (member PIN, staff MFA) | pgTAP authz suite green |
| 6 | Community master + admin CRUD + seed | classification tests |
| 7 | Submission codes/windows + member submit flow | code expiry / limit tests |
| 8 | Officer workspace, workflow functions, SLA job | overdue trigger tests |
| 9 | Admin dashboard + drill-down + search/filters | dashboard calculation tests |
| 10 | Offline outbox + sync engine | Playwright offline/throttled e2e, duplicate-prevention |
| 11 | Notification outbox + provider adapters (+ mock provider) | delivery-state tests |
| 12 | Import wizard; import the two workbooks (dry-run first) | reconciliation = 545 + 63 links |
| 13 | Reports + exports (permission-scoped) | export permission tests |
| 14 | Full test pass, low-end device + 3G throttling review | acceptance criteria 1–25 |
