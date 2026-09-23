# Dev API (development only)

A tiny stand-in for the Supabase endpoints the PWA uses, so the whole app can run and be tested
locally against PostgreSQL without Docker. It runs every request as the caller's role with the
caller's JWT claims (like PostgREST), so RLS and function permissions are exercised for real.

**Never deploy this.** Production uses Supabase (Auth + PostgREST + Edge Functions).

```bash
../../scripts/dev/setup-dev-db.sh                 # builds ipl_dev from the migrations + demo data
DATABASE_URL=postgres://postgres@localhost:54329/ipl_dev node server.mjs
```

Demo accounts: `admin@ipl.test` / `Admin#2026` · `godpower@ipl.test` (and godwin/esther) / `Officer#2026` ·
member phone `0803 123 4567` / PIN `123456`.
