#!/usr/bin/env python3
"""Prepare (and optionally apply) the historical grievance import.

Reads both workbooks, normalises values, reconciles the two files and
classifies duplicates according to the decisions confirmed on 23 Sep 2026
(docs/02-architecture.md §8), then writes a single import batch:

  audit-output/import_report.md   PII-free summary for review
  audit-output/import_batch.sql   calls app.import_legacy_batch(...)  (contains PII: git-ignored)

Nothing is written to a database unless --apply is given.

  python3 import_workbooks.py --complete A.xlsx --tracker B.xlsx            # dry run
  python3 import_workbooks.py --complete A.xlsx --tracker B.xlsx --apply    # uses PG* env vars / psql

Every source row ends up in legacy_source_records with one of these roles:
  primary             becomes a grievance
  overlap_copy        same grievance in the other workbook (Complete/2025 vs Tracker)
  excluded_duplicate  removed duplicate (tracker "2024" block; exact double entries)
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import secrets
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

from audit_workbooks import COMPLETE_SHEETS, TRACKER_SHEET, is_blank, key, read_sheet

OLD_ERA = {"2018", "2019", "2020", "2021", "2022", "2023"}
MONTH_TEXT = re.compile(r"^([A-Za-z]{3})[a-z]* (\d{4})$")
NO_DESCRIPTION = "[No description recorded in the source file]"
PLACEHOLDERS = {"none", "nil", "n/a", "na", "-", "--", "nill", "null"}


def clean(v) -> str | None:
    if is_blank(v):
        return None
    s = str(v).replace("​", "").strip()
    return s or None


def clean_value(v) -> str | None:
    """Like clean(), but placeholder words such as 'Nil' or 'None' count as empty."""
    s = clean(v)
    return None if s and s.lower() in PLACEHOLDERS else s


def parse_date(v, old_era: bool) -> tuple[str | None, str | None]:
    """-> (ISO date, precision). 'Apr 2019' and old-era 1st-of-month dates are month precision."""
    if is_blank(v):
        return None, None
    if isinstance(v, (dt.datetime, dt.date)):
        d = v.date() if isinstance(v, dt.datetime) else v
        return d.isoformat(), ("month" if old_era and d.day == 1 else "day")
    m = MONTH_TEXT.match(str(v).strip())
    if m:
        d = dt.datetime.strptime(f"1 {m.group(1)} {m.group(2)}", "%d %b %Y").date()
        return d.isoformat(), "month"
    return None, None


def raw_row(rec: dict) -> dict:
    out = {}
    for k, v in rec.items():
        if k.startswith("_") or is_blank(v):
            continue
        out[k] = v.isoformat() if isinstance(v, (dt.datetime, dt.date)) else str(v)
    return out


def build_records(complete: Path, tracker: Path) -> list[dict]:
    recs: list[dict] = []

    for sheet in COMPLETE_SHEETS:
        df, _ = read_sheet(complete, sheet, "Complete 2018-2026")
        for rec in df.to_dict("records"):
            old = sheet in OLD_ERA
            f: dict = {"source_year": int(sheet[:4])}
            if old:
                f["date_received"], f["date_received_precision"] = parse_date(rec.get("Log Date"), True)
                f["review_date"], f["review_date_precision"] = parse_date(rec.get("Review Date"), True)
                f["description"] = clean(rec.get("Log Description"))
                f["officer_remarks"] = clean(rec.get("Grievance Officer's Remarks"))
                f["responsibility"] = clean(rec.get("Responsibility"))
                f["management_action"] = clean(rec.get("Management Action"))
            else:
                f["legacy_tracking_id"] = clean(rec.get("Tracking ID"))
                f["date_received"], f["date_received_precision"] = parse_date(rec.get("Date Received"), False)
                f["submitted_date"], _ = parse_date(rec.get("Date of Submission"), False)
                f["name"] = clean(rec.get("Full Name"))
                f["gender"] = clean(rec.get("Gender"))
                f["phone"] = clean_value(rec.get("Phone Number"))
                f["subcategory"] = clean(rec.get("Grievance Sub-Category"))
                f["description"] = clean(rec.get("Incident Details"))
                f["desired_resolution"] = clean(rec.get("Desired Resolution"))
                f["severity"] = clean(rec.get("Severity Level"))
                f["resolution_details"] = clean(rec.get("Resolution Details"))
            f["community"] = clean(rec.get("Community"))
            f["category"] = clean(rec.get("Grievance Category"))
            f["status"] = clean(rec.get("Status"))
            recs.append(dict(key=f"A:{sheet}:{rec['_row']}", workbook="Complete Grievance Tracker (2018-2026)",
                             sheet=sheet, row=rec["_row"], serial=clean(rec.get("S/N")), raw=raw_row(rec),
                             fields=f, role="primary", flags=[]))

    df, _ = read_sheet(tracker, TRACKER_SHEET, "Tracker 2026.1")
    for rec in df.to_dict("records"):
        f = {"source_year": int(rec["Year"]) if not is_blank(rec.get("Year")) else None,
             "legacy_tracking_id": clean(rec.get("Tracking ID")),
             "community_category": clean(rec.get("Community Category")),
             "community_type": clean(rec.get("Community Type")),
             "name": clean(rec.get("Full Name")), "gender": clean(rec.get("Gender")),
             "phone": clean_value(rec.get("Phone Number")), "community": clean(rec.get("Community")),
             "description": clean(rec.get("Grievance Details")),
             "subcategory": clean(rec.get("Grievance Sub-Category")), "category": clean(rec.get("Grievance Category")),
             "severity": clean(rec.get("Severity Level")), "status": clean(rec.get("Status")),
             "resolution_details": clean(rec.get("Resolution Details")),
             "closure_officer": clean(rec.get("Officer in-charge of closeure"))}
        f["suggestions"] = clean_value(rec.get("Suggestions"))
        f["form_issued_date"], _ = parse_date(rec.get("Form Issuance Date"), False)
        f["submitted_date"], _ = parse_date(rec.get("Date of Submission"), False)
        f["date_received"], f["date_received_precision"] = f["submitted_date"], "day"
        f["closure_date"], _ = parse_date(rec.get("Date of Closure"), False)
        recs.append(dict(key=f"B:{rec['_row']}", workbook="Indorama Grievance Tracker 2026.1",
                         sheet=TRACKER_SHEET, row=rec["_row"], serial=clean(rec.get("S/N")), raw=raw_row(rec),
                         fields=f, role="primary", flags=[]))
    return recs


def tid_norm(v) -> str:
    return re.sub(r"\s", "", v or "").upper()


def text_key(f: dict) -> str:
    return key(f.get("description"))[:200]


def reconcile(recs: list[dict]) -> None:
    A = [r for r in recs if r["key"].startswith("A:")]
    B = [r for r in recs if r["key"].startswith("B:")]
    exclude = lambda r, link, note: r.update(role="excluded_duplicate", link_key=link, note=note)

    # 1. Tracker "2024" block: duplicates of 2024 (and earlier) records -> removed (decision 5).
    a_by_text = {text_key(r["fields"]): r for r in A if text_key(r["fields"])}
    for r in B:
        if r["fields"]["source_year"] == 2024:
            match = a_by_text.get(text_key(r["fields"]))
            exclude(r, match["key"] if match else None,
                    "Tracker '2024' block: confirmed duplicate of 2024 records (decision 23 Sep 2026)"
                    + (f"; same text as {match['sheet']} row {match['row']}" if match else ""))

    # 2. Complete/2025 overlaps with the tracker: tracker row is primary (more fields).
    b_by_tid = defaultdict(list)
    for r in B:
        if r["role"] == "primary":
            b_by_tid[tid_norm(r["fields"].get("legacy_tracking_id"))].append(r)
    for r in A:
        if r["sheet"] != "2025":
            continue
        cands = b_by_tid.get(tid_norm(r["fields"].get("legacy_tracking_id")), [])
        best = next((c for c in cands if key(c["fields"]["name"]) == key(r["fields"]["name"])
                     and text_key(c["fields"]) == text_key(r["fields"])), None) \
            or next((c for c in cands if key(c["fields"]["name"]) == key(r["fields"]["name"])), None)
        if best:
            r.update(role="overlap_copy", link_key=best["key"],
                     note=f"Same grievance as tracker row {best['row']} (Complete says {r['fields']['status']!r})")
            if (r["fields"]["status"] or "").lower() == "closed" and (best["fields"]["status"] or "").lower() == "resolved":
                best["fields"]["status_override"] = "Closed"
                best["note"] = "Complete 2018-2026 records this as Closed; tracker says Resolved"

    # 3. Exact double entries in the tracker (same person, same text) -> keep the first.
    seen: dict[str, dict] = {}
    for r in sorted((r for r in B if r["role"] == "primary"), key=lambda r: r["row"]):
        k = key(r["fields"]["name"]) + "|" + text_key(r["fields"])
        if not text_key(r["fields"]):
            continue
        if k in seen:
            first = seen[k]
            exclude(r, first["key"], f"Exact double entry of tracker row {first['row']}")
            if key(r["fields"]["community"]) != key(first["fields"]["community"]):
                first["flags"].append({"flag": "needs_review", "detail": {
                    "reason": "duplicate entry recorded under another community",
                    "other_row": r["row"], "other_community": r["fields"]["community"]}})
        else:
            seen[k] = r

    # 4. Old-era rows identical in every cell except S/N -> removed; similar -> flagged.
    groups = defaultdict(list)
    for r in A:
        if r["sheet"] in OLD_ERA:
            groups[(key(r["fields"]["community"]), text_key(r["fields"]))].append(r)
    for (_, t), rows in groups.items():
        if len(rows) < 2 or not t:
            continue
        rows.sort(key=lambda r: (r["sheet"], r["row"]))
        first = rows[0]
        signature = lambda r: json.dumps({k: v for k, v in r["raw"].items() if k != "S/N"}, sort_keys=True).lower()
        for other in rows[1:]:
            if signature(other) == signature(first):
                exclude(other, first["key"], f"Identical to {first['sheet']} row {first['row']}")
            else:
                for x, y in ((first, other), (other, first)):
                    x["flags"].append({"flag": "duplicate_candidate",
                                       "detail": {"other_sheet": y["sheet"], "other_row": y["row"]}})

    # 5. Remaining ID collisions (different people under one legacy ID).
    by_tid = defaultdict(list)
    for r in recs:
        if r["role"] == "primary" and r["fields"].get("legacy_tracking_id"):
            by_tid[tid_norm(r["fields"]["legacy_tracking_id"])].append(r)
    for t, rows in by_tid.items():
        if len({key(r["fields"]["name"])[:6] for r in rows}) > 1:
            for r in rows:
                r["flags"].append({"flag": "id_collision", "detail": {"legacy_tracking_id": t, "rows": len(rows)}})

    # 6. Old open items: officer review before alerts (decision 6); missing text is explicit.
    for r in recs:
        f = r["fields"]
        if r["role"] != "primary":
            continue
        if (f.get("status") or "").upper() == "WIP":
            f["needs_review"] = True
            r["flags"].append({"flag": "needs_review", "detail": {"reason": "open since " + str(f["source_year"])}})
        if not f.get("description"):
            f["description"] = NO_DESCRIPTION
            r["flags"].append({"flag": "needs_review", "detail": {"reason": "no description in source"}})
        if not f.get("date_received") and not f.get("form_issued_date"):
            r["flags"].append({"flag": "date_suspect", "detail": {"reason": "no date in source"}})


def report(recs: list[dict], out: Path) -> str:
    roles = Counter((r["workbook"].split(" (")[0].split(" 2026.1")[0], r["role"]) for r in recs)
    prim = [r for r in recs if r["role"] == "primary"]
    by_year = Counter(int(r["fields"]["date_received"][:4]) if r["fields"].get("date_received")
                      else r["fields"]["source_year"] for r in prim)
    flags = Counter(f["flag"] for r in prim for f in r["flags"])
    status = Counter((r["fields"].get("status_override") or r["fields"].get("status") or "(blank)") for r in prim)
    lines = ["# Historical import – dry-run report", "",
             f"Source rows: **{len(recs)}** · grievances to create: **{len(prim)}**", "",
             "| Workbook | Role | Rows |", "|---|---|---|"]
    lines += [f"| {w} | {role} | {n} |" for (w, role), n in sorted(roles.items())]
    lines += ["", "| Year (date received) | Grievances |", "|---|---|"]
    lines += [f"| {y} | {n} |" for y, n in sorted(by_year.items())]
    lines += ["", "| Legacy status (after reconciliation) | Grievances |", "|---|---|"]
    lines += [f"| {s} | {n} |" for s, n in status.most_common()]
    lines += ["", "| Review flag | Grievances |", "|---|---|"]
    lines += [f"| {k} | {n} |" for k, n in flags.most_common()] or ["| – | 0 |"]
    text = "\n".join(lines) + "\n"
    (out / "import_report.md").write_text(text)
    return text


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--complete", required=True, type=Path)
    ap.add_argument("--tracker", required=True, type=Path)
    ap.add_argument("--out", default=Path("audit-output"), type=Path)
    ap.add_argument("--apply", action="store_true", help="run the batch with psql (PG* environment variables)")
    a = ap.parse_args()
    a.out.mkdir(exist_ok=True)

    recs = build_records(a.complete, a.tracker)
    reconcile(recs)
    print(report(recs, a.out))

    sha = hashlib.sha256(a.complete.read_bytes() + a.tracker.read_bytes()).hexdigest()
    batch = {"file_name": f"{a.complete.name} + {a.tracker.name}", "file_sha256": sha,
             "workbook": "Historical trackers 2018-2026",
             "report": {"generated_at": dt.datetime.now().isoformat(timespec="seconds")}}
    payload = [{k: r.get(k) for k in ("key", "workbook", "sheet", "row", "serial", "raw", "fields",
                                      "role", "link_key", "flags", "note")} for r in recs]
    tag = "imp" + secrets.token_hex(6)
    sql = (f"select app.import_legacy_batch(${tag}${json.dumps(batch, ensure_ascii=False)}${tag}$::jsonb,\n"
           f"  ${tag}${json.dumps(payload, ensure_ascii=False, default=str)}${tag}$::jsonb);\n")
    (a.out / "import_batch.sql").write_text(sql)
    print(f"Wrote {a.out / 'import_report.md'} and {a.out / 'import_batch.sql'}")

    if a.apply:
        subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-1", "-f", str(a.out / "import_batch.sql")], check=True)


if __name__ == "__main__":
    main()
