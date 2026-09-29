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
import sys
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl

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


COMPLETE_LABEL = "Complete Grievance Tracker (2018-2026)"
TRACKER_LABEL = "Indorama Grievance Tracker 2026.1"
TOTAL_LABEL = "Total Grievance (2018-2026)"
TOTAL_TRACKER_SHEET = "2026"


def build_records(complete: Path, tracker: Path, total: bool = False) -> list[dict]:
    """total=True: one workbook holding the 2018-2025 sheets plus the tracker as sheet '2026'."""
    recs: list[dict] = []
    a_label, b_label = (TOTAL_LABEL, TOTAL_LABEL) if total else (COMPLETE_LABEL, TRACKER_LABEL)
    b_sheet = TOTAL_TRACKER_SHEET if total else TRACKER_SHEET
    present = set(openpyxl.load_workbook(complete, read_only=True).sheetnames)

    for sheet in COMPLETE_SHEETS:
        if total and sheet not in present:
            continue
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
            recs.append(dict(key=f"A:{sheet}:{rec['_row']}", workbook=a_label,
                             sheet=sheet, row=rec["_row"], serial=clean(rec.get("S/N")), raw=raw_row(rec),
                             fields=f, role="primary", flags=[]))

    df, _ = read_sheet(tracker, b_sheet, "Tracker 2026.1")
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
        recs.append(dict(key=f"B:{rec['_row']}", workbook=b_label,
                         sheet=b_sheet, row=rec["_row"], serial=clean(rec.get("S/N")), raw=raw_row(rec),
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


# Changes the update can apply to grievances already imported (anything else stops the run).
UPDATABLE = {"status": "status", "resolution_details": "resolution_details", "name": "name",
             "description": "description", "subcategory": "subcategory"}
APPLY_ORDER = ["status", "resolution_details", "subcategory", "name", "description"]


def effective(f: dict, field: str):
    return (f.get("status_override") or f.get("status")) if field == "status" else f.get(field)


def pair_with_previous(new: list[dict], old: list[dict]) -> list[str]:
    """Match each row of the total workbook to the same row of the earlier files and list what changed.

    Returns a list of problems; the run stops if there are any."""
    problems: list[str] = []
    old_by_pos = {(("A", r["sheet"]) if r["key"].startswith("A:") else ("B", None), r["row"]): r for r in old}
    seen = set()
    for r in new:
        pos = (("A", r["sheet"]) if r["key"].startswith("A:") else ("B", None), r["row"])
        o = old_by_pos.get(pos)
        if o is None:
            problems.append(f"{r['sheet']} row {r['row']} is not in the earlier files (a new record)")
            continue
        seen.add(pos)
        r["prev"] = {"workbook": o["workbook"], "sheet": o["sheet"], "row": o["row"]}
        if o["role"] != r["role"]:
            problems.append(f"{r['sheet']} row {r['row']}: classified {r['role']} now, {o['role']} before")
        changes = []
        for field in sorted(set(o["fields"]) | set(r["fields"])):
            if field in ("status_override",):
                continue
            before, after = effective(o["fields"], field), effective(r["fields"], field)
            if before == after:
                continue
            if field not in UPDATABLE:
                problems.append(f"{r['sheet']} row {r['row']}: '{field}' changed ({before!r} -> {after!r}); not supported")
                continue
            changes.append({"field": field, "old": before, "new": after})
        if changes and r["role"] == "primary":
            extra = {"closure_officer": r["fields"].get("closure_officer"),
                     "old_closure_officer": o["fields"].get("closure_officer")}
            r["changes"] = [dict(c, **extra) for c in sorted(changes, key=lambda c: APPLY_ORDER.index(c["field"]))]
        elif changes:
            r["note"] = ((r.get("note") or "") + "; values changed in the source row (kept as source only)").lstrip("; ")
            # A copy was edited but its primary row was not: ask an officer rather than choose.
            primary = next((x for x in new if x["key"] == r.get("link_key")), None)
            if primary is not None:
                primary.setdefault("review", []).append({"row": r["row"], "sheet": r["sheet"], "changes": changes})
    for pos, o in old_by_pos.items():
        if pos not in seen:
            problems.append(f"{o['sheet']} row {o['row']} of the earlier files is missing from the new workbook")
    return problems


def write_parts(out: Path, fn: str, batch: dict, payload: list[dict], limit: int) -> None:
    """The SQL Editor refuses large queries: load the records into a holding table in several
    small files, then one short file runs the import/update from there (all or nothing)."""
    key_ = batch["file_sha256"][:16]
    chunks: list[list[tuple[int, dict]]] = [[]]
    size = 0
    for i, rec in enumerate(payload):
        n = len(json.dumps(rec, ensure_ascii=False, default=str).encode())
        if chunks[-1] and size + n > limit:
            chunks.append([]); size = 0
        chunks[-1].append((i, rec)); size += n
    total = len(chunks) + 1
    head = ("-- PRIVATE: contains complainant names and phone numbers. Do not share or commit.\n"
            f"-- Part {{k}} of {total}. Run the parts in order (1 to {total}); each one separately.\n\n")
    for k, chunk in enumerate(chunks, 1):
        tag = "imp" + secrets.token_hex(6)
        rows = json.dumps([{"ord": i, "rec": r} for i, r in chunk], ensure_ascii=False, default=str)
        sql = (head.format(k=k)
               + "create table if not exists app.import_staging (batch text not null, ord int not null, rec jsonb not null,\n"
               + "  primary key (batch, ord));\n"
               + "revoke all on app.import_staging from public, anon, authenticated;\n"
               + f"insert into app.import_staging (batch, ord, rec)\n"
               + f"select '{key_}', (x ->> 'ord')::int, x -> 'rec' from jsonb_array_elements(${tag}${rows}${tag}$::jsonb) x\n"
               + "on conflict (batch, ord) do nothing;\n"
               + f"select 'Part {k} of {total} loaded' as result, count(*) as records_loaded_so_far,"
               + f" {len(payload)} as records_in_total from app.import_staging where batch = '{key_}';\n")
        (out / f"part-{k}-of-{total}.sql").write_text(sql)
    tag = "imp" + secrets.token_hex(6)
    final = (head.format(k=total)
             + "create table if not exists app.import_staging (batch text not null, ord int not null, rec jsonb not null,\n"
             + "  primary key (batch, ord));\n"
             + "do $$ declare n int; begin\n"
             + f"  select count(*) into n from app.import_staging where batch = '{key_}';\n"
             + f"  if n <> {len(payload)} then\n"
             + f"    raise exception 'Only % of {len(payload)} records are loaded. Run parts 1 to {total - 1} first, then this one.', n;\n"
             + "  end if;\nend $$;\n"
             + f"select {fn}(${tag}${json.dumps(batch, ensure_ascii=False)}${tag}$::jsonb,\n"
             + f"  (select jsonb_agg(rec order by ord) from app.import_staging where batch = '{key_}')) as result;\n"
             + f"delete from app.import_staging where batch = '{key_}';\n")
    (out / f"part-{total}-of-{total}.sql").write_text(final)
    print(f"Wrote {total} part files to {out} (largest {max(len(json.dumps(c, default=str)) for c in chunks) // 1024} KB of data)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--complete", type=Path)
    ap.add_argument("--tracker", type=Path)
    ap.add_argument("--total", type=Path, help="one workbook with sheets 2018-2025 and the tracker as '2026'")
    ap.add_argument("--previous-complete", type=Path, help="with --total: the Complete workbook imported before")
    ap.add_argument("--previous-tracker", type=Path, help="with --total: the tracker imported before")
    ap.add_argument("--out", default=Path("audit-output"), type=Path)
    ap.add_argument("--apply", action="store_true", help="run the batch with psql (PG* environment variables)")
    ap.add_argument("--parts", type=int, default=0,
                    help="also write the batch as files of about this many KB each, for the Supabase SQL Editor")
    a = ap.parse_args()
    a.out.mkdir(exist_ok=True)

    if a.total:
        recs = build_records(a.total, a.total, total=True)
        files = [a.total]
    else:
        if not (a.complete and a.tracker):
            ap.error("give --complete and --tracker, or --total")
        recs = build_records(a.complete, a.tracker)
        files = [a.complete, a.tracker]
    reconcile(recs)
    print(report(recs, a.out))

    fn = "app.import_legacy_batch"
    if a.total and a.previous_complete and a.previous_tracker:
        old = build_records(a.previous_complete, a.previous_tracker)
        reconcile(old)
        problems = pair_with_previous(recs, old)
        if problems:
            print("STOPPED: the new workbook does not line up with the earlier import:")
            print("\n".join("  - " + p for p in problems))
            sys.exit(1)
        changed = [r for r in recs if r.get("changes")]
        reviews = [r for r in recs if r.get("review")]
        lines = ["", "## Changes since the earlier import", "",
                 f"Rows compared: **{len(recs)}** (all matched) · grievances with changes: **{len(changed)}**", "",
                 "| Sheet | Row | Change |", "|---|---|---|"]
        for r in changed:
            for c in r["changes"]:
                shown = (lambda v: "blank" if v is None else (v if c["field"] == "status" else f"{len(v)} characters"))
                lines.append(f"| {r['sheet']} | {r['row']} | {c['field']}: {shown(c['old'])} → {shown(c['new'])} |")
        if reviews:
            lines += ["", "Copies edited while their primary row was not (the grievance is flagged for review):", ""]
            lines += [f"- {r['sheet']} row {r['row']}: copies in rows " + ", ".join(str(v["row"]) for v in r["review"])
                      for r in reviews]
        text = "\n".join(lines) + "\n"
        print(text)
        with (a.out / "import_report.md").open("a") as fh:
            fh.write(text)
        fn = "app.import_or_update_legacy"

    sha = hashlib.sha256(b"".join(f.read_bytes() for f in files)).hexdigest()
    batch = {"file_name": " + ".join(f.name for f in files), "file_sha256": sha,
             "workbook": "Total Grievance 2018-2026" if a.total else "Historical trackers 2018-2026",
             "report": {"generated_at": dt.datetime.now().isoformat(timespec="seconds")}}
    if a.total:
        # Oldest first, so IDs such as HC-2019-0001 follow the order grievances were received.
        when = lambda r: (r["fields"].get("date_received") or r["fields"].get("submitted_date")
                          or r["fields"].get("form_issued_date") or "9999")
        recs = sorted(recs, key=lambda r: (r["role"] != "primary", when(r)[:4], when(r)))
    payload = [{k: r.get(k) for k in ("key", "workbook", "sheet", "row", "serial", "raw", "fields",
                                      "role", "link_key", "flags", "note", "prev", "changes", "review")} for r in recs]
    tag = "imp" + secrets.token_hex(6)
    sql = (f"select {fn}(${tag}${json.dumps(batch, ensure_ascii=False)}${tag}$::jsonb,\n"
           f"  ${tag}${json.dumps(payload, ensure_ascii=False, default=str)}${tag}$::jsonb);\n")
    (a.out / "import_batch.sql").write_text(sql)
    print(f"Wrote {a.out / 'import_report.md'} and {a.out / 'import_batch.sql'}")
    if a.parts:
        write_parts(a.out, fn, batch, payload, a.parts * 1024)

    if a.apply:
        subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-1", "-f", str(a.out / "import_batch.sql")], check=True)


if __name__ == "__main__":
    main()
