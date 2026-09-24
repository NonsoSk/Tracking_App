# Deployment & Operations

## 1. Components

| Part | Where it runs |
|---|---|
| Database, auth, API | Supabase project (PostgreSQL 15+). Can be Supabase Cloud or self-hosted on IPL infrastructure |
| PWA (`apps/web`) | Any static host with an SPA fallback to `index.html` (Cloudflare Pages, Netlify, Vercel, Nginx) over HTTPS |
| Edge Functions | Supabase: `notify-dispatch`, `whatsapp-webhook`, `admin-create-user`, `admin-reset-pin` |
| WhatsApp | Meta WhatsApp Cloud API (business account, phone number, approved templates) |

## 2. Supabase project

1. Create the project in a region close to Nigeria (e.g. `eu-west`). If NDPA or IPL policy requires local hosting, self-host Supabase instead; nothing in the app depends on Supabase Cloud.
2. Enable the extensions **pg_cron**, **pg_net** and **pg_trgm** (Database → Extensions).
3. Apply the migrations: `supabase link --project-ref <ref> && supabase db push`, or run `supabase/migrations/*.sql` in order.
4. **Auth settings** (Authentication → Providers → Email):
   - Email provider **on**, "Confirm email" **off**. Member logins are `<phone>@members.iplgrievance.app` addresses that never receive mail.
   - Minimum password length **6** (member PIN).
   - Leave rate limits at the defaults.
   - Enable **TOTP MFA**, and require it for Super Admin accounts in your operating procedure.
5. Create the first Super Admin. In the Supabase dashboard go to **Authentication → Users → Add user**, enter your work email and a strong password, and tick "Auto confirm". Then in the SQL editor run:
   ```sql
   select app.bootstrap_super_admin('your.email@indorama.com');
   update public.profiles set full_name = 'Your Name', job_title = 'Super Administrator'
    where id = (select id from auth.users where email = 'your.email@indorama.com');
   ```
   Sign in to the app with that email and password.
6. Add the officers **from inside the app** (no SQL needed):
   - *Either* ask each person to create an account in the app (phone + PIN), then in **Communities** click **Change** next to a community and pick them (they are given the Officer role automatically), or use **Users & officers → Community members → Manage** to give a role and a whole group of communities;
   - *or*, once the `admin-create-user` function is deployed (Supabase → Edge Functions → Deploy a new function → Via editor → paste `supabase/functions/admin-create-user/index.ts`), use **Users & officers → Add staff member** to create an email login directly.

   Default responsibility:
   - **Godpower Jaka**: All Host + All Pipeline
   - **Godwin Bebe-Okpabi**: All Indirectly Impacted
   - **Esther Walter Anga**: All Jetty

## 3. Historical import (after the officers exist, so open items get assigned)

```bash
cd scripts/migration
python3 import_workbooks.py --complete "Complete Grievance Tracker (2018-2026).xlsx" \
                            --tracker  "Indorama_Grievance Tracker_2026.1.xlsx"          # dry run: read audit-output/import_report.md
PGHOST=db.<ref>.supabase.co PGUSER=postgres PGDATABASE=postgres PGPASSWORD=… \
python3 import_workbooks.py --complete … --tracker … --apply                               # one transaction
```

Expected result: 608 source rows → 504 grievances, 63 linked copies, 41 duplicates archived, 61 review flags (`docs/03-import-report.md`). To undo, run `select app.rollback_legacy_batch('<batch id>');`. Delete `audit-output/` afterwards, because it contains personal data.

## 4. WhatsApp (Meta Cloud API)

1. In Meta Business Manager, create a WhatsApp Business account, add and verify the sending number, and create a **permanent system-user access token** with `whatsapp_business_messaging`.
2. Submit these **message templates** (category *Utility*, language *English*) and wait for approval:

   **`grievance_resolved`**
   > Hello {{1}}, your grievance with tracking ID {{2}} has been resolved.
   > Resolution: {{3}}
   > Please open the IPL Community Grievance app to review the details and acknowledge the resolution.

   **`grievance_received`** (used for paper and assisted entries)
   > Hello {{1}}, IPL Community Relations has received your grievance. Your tracking ID is {{2}}. Keep it for reference.

3. Set the function secrets:
   ```bash
   supabase secrets set WHATSAPP_TOKEN=… WHATSAPP_PHONE_NUMBER_ID=… WHATSAPP_APP_SECRET=… \
                        WHATSAPP_VERIFY_TOKEN=<random> DISPATCH_SECRET=<random> APP_ORIGIN=https://grievance.example.com
   supabase functions deploy notify-dispatch whatsapp-webhook admin-create-user admin-reset-pin
   ```
4. In the Meta app, configure the webhook URL `https://<ref>.supabase.co/functions/v1/whatsapp-webhook` with the same verify token, and subscribe to **messages**. Delivery receipts then update each message's status.
5. Schedule the dispatcher every minute:
   ```sql
   select cron.schedule('ipl-notify-dispatch', '* * * * *', $$
     select net.http_post(url := 'https://<ref>.supabase.co/functions/v1/notify-dispatch',
                          headers := jsonb_build_object('x-dispatch-secret', '<DISPATCH_SECRET>'))
   $$);
   ```
6. Turn on **Settings → Send WhatsApp notifications** in the app. Until then, messages are recorded as *skipped* and nothing is queued behind your back.

Status meanings: **queued** → **sending** → **sent** (Meta accepted it) → **delivered** / **read** (Meta confirmed it). Failed attempts retry with back-off (2, 4, 8, 16, 32 minutes), then become **failed**. The app never reports delivery that Meta has not confirmed.

## 5. Scheduled jobs

| Job | Schedule | Set by |
|---|---|---|
| `app.scan_overdue()` | hourly | migration `…0700` (when pg_cron is enabled at migration time; otherwise schedule it by hand) |
| `app.overdue_digest()` | 08:00 Lagos, Mon–Fri | same |
| `notify-dispatch` | every minute | step 4.5 |

Add Nigerian public holidays each year under **Categories & statuses → Public holidays**. The 3-working-day clock skips them.

## 6. Web app

```bash
cd apps/web
npm ci
VITE_SUPABASE_URL=https://<ref>.supabase.co VITE_SUPABASE_ANON_KEY=<anon key> \
VITE_SUPPORT_PHONE=+234… npm run build          # output: apps/web/dist
```

The anon key is public by design; all permissions are enforced by the database. Host `dist/` with:
- an SPA fallback (all routes → `/index.html`);
- `Cache-Control: no-cache` for `index.html`, `sw.js` and `manifest.webmanifest`; long-lived caching for `/assets/*`;
- security headers:
  ```
  Content-Security-Policy: default-src 'self'; connect-src 'self' https://<ref>.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  ```

Members install it from the browser menu ("Add to Home screen"). A Play Store listing can later wrap the same site as a Trusted Web Activity.

## 7. Operations

- **Backups:** enable daily backups / PITR on the Supabase project. `audit_logs` is append-only.
- **Forgotten PIN:** staff open *Users & officers → Community members → Manage → Reset PIN* after confirming identity. The reset is audited.
- **Disabled staff:** their past work stays attributed to them; reassign their open grievances from the list (filter by officer).
- **Data protection (NDPA 2023):** complainant data is personal data. Restrict exports to people who need them (`export.run`), and every export is audited.

## 8. Local development (no Docker needed)

```bash
# PostgreSQL 15+ with pgtap, pg_trgm, pgcrypto on localhost
PGHOST=/tmp PGPORT=54329 scripts/db/test-local.sh                 # database tests (pgTAP)
PGHOST=/tmp PGPORT=54329 scripts/dev/setup-dev-db.sh              # dev database with demo accounts
DATABASE_URL=postgres://postgres@localhost:54329/ipl_dev node tools/dev-api/server.mjs
cd apps/web && VITE_SUPABASE_URL=http://localhost:54321 npm run dev
npm test          # unit tests (sync engine, errors, exports, WhatsApp helpers)
npm run e2e       # browser tests against the production build, including offline
```

`tools/dev-api` is a development-only stand-in for Supabase Auth and PostgREST. **Never deploy it.**
