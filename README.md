# IPL Community Grievance Management System

Offline-first PWA for the Community Relations Department of Indorama Eleme Petrochemicals Limited.
**Submit → Track → Resolve → Acknowledge.**

## Status: architecture review (no application code yet)

| Doc | Contents |
|---|---|
| [docs/01-data-audit.md](docs/01-data-audit.md) | Audit of the 2018–2026 workbooks: columns, counts, duplicates, overlap, naming/category/status inconsistencies, migration mapping |
| [docs/02-architecture.md](docs/02-architecture.md) | Platform choice, database schema, roles and permissions, offline sync, screens, migration pipeline, open decisions |

## Reproducing the data audit

```bash
pip install -r scripts/migration/requirements.txt
python3 scripts/migration/audit_workbooks.py --complete "<Complete Grievance Tracker>.xlsx" \
                                             --tracker "<Indorama_Grievance Tracker_2026.1>.xlsx"
```

The source workbooks contain complainant names and phone numbers. **Do not commit them.** `.gitignore` blocks `*.xlsx`, `*.csv` and `audit-output/`.
