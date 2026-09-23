#!/usr/bin/env python3
"""Read-only audit of the historical IPL grievance workbooks.

Nothing is imported or modified. The script reads both workbooks, locates the
header row of every grievance worksheet, and reports record counts, schema
differences, duplicate candidates, cross-workbook overlap, naming
inconsistencies and data-quality anomalies.

Output:
  - a PII-free summary printed to stdout (safe to paste into docs)
  - audit-output/*.csv with row-level candidates for human review
    (contains names/phones; the folder is git-ignored)

Usage:
  python3 audit_workbooks.py --complete "Complete Grievance Tracker.xlsx" \
                             --tracker "Indorama_Grievance Tracker_2026.1.xlsx"
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import warnings
from pathlib import Path

import openpyxl
import pandas as pd

warnings.filterwarnings("ignore", module="openpyxl")

COMPLETE_SHEETS = ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026A"]
TRACKER_SHEET = "Grievance Tracker"

# Canonical community master as supplied by the business (not by the workbooks).
HOST = ["Okerewa", "Njuru", "Nwakohu", "Agbonchia", "Aleto", "Akpajo"]
CLUSTERS = {
    1: ["Akpajo", "Rumuokruoshi", "Atali", "Elelenwo"],
    2: ["Abara", "Umuecheme", "Chokocho", "Umuakuru", "Edegelem", "Imeh", "Umuogodo"],
    3: ["Ipo", "Omadame", "Ozuoha", "Ubima", "Omerelu", "Omuanwa"],
    4: ["Awarra (1)", "Awarra (11)", "Akanu", "Assa", "Ochia"],
    5: ["Omoku I", "Omoku II", "Obor", "Okprukpuali", "Obrikom", "Uju", "Okansu", "Egbogoro", "Egbeda"],
}
INDIRECT = ["Rumuokwurusi", "Alesa", "Alode", "Ogale", "Iriebe", "Umuebule", "Ebubu", "Okujagu", "Abam-ama", "Woji"]
JETTY = ["Onne", "Ogu"]

# Legacy spelling -> canonical community. Only unambiguous aliases belong here.
COMMUNITY_ALIASES = {
    "wakohu": "Nwakohu",
    "wakohufamily": "Nwakohu",  # a family/clan within Nwakohu; original value preserved
    "njuruakpakpan": "Njuru",
    "onne": "Onne",
}
NON_COMMUNITY_VALUES = {"individual", "pac"}
SUBSTANTIVE_FIELDS = ["Tracking ID", "Full Name", "Community", "Log Description", "Incident Details", "Grievance Details"]


def key(s) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower()) if s is not None and not pd.isna(s) else ""


def is_blank(v) -> bool:
    if isinstance(v, str):
        return not v.strip()
    return v is None or bool(pd.isna(v))  # also catches NaT introduced by concat


def read_sheet(path: Path, sheet: str, source: str) -> pd.DataFrame:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows = list(wb[sheet].iter_rows(values_only=True))
    hdr_i = next(i for i, r in enumerate(rows) if r and r[0] == "S/N")
    header = [str(h).strip() if h is not None else f"_unnamed_{j}" for j, h in enumerate(rows[hdr_i])]
    out = []
    for offset, r in enumerate(rows[hdr_i + 1 :]):
        rec = dict(zip(header, r))
        # Trailing template rows carry only an S/N and formula output (e.g. Month="Jan"
        # from an empty date), so a record needs at least one substantive field.
        if all(is_blank(rec.get(k)) for k in SUBSTANTIVE_FIELDS):
            continue
        rec.update(_source=source, _sheet=sheet, _row=hdr_i + 2 + offset)
        out.append(rec)
    return pd.DataFrame(out), header


def canonical_master() -> dict[str, list[str]]:
    m: dict[str, list[str]] = {}
    for c in HOST:
        m.setdefault(c, []).append("Host")
    for n, cs in CLUSTERS.items():
        for c in cs:
            m.setdefault(c, []).append(f"Pipeline / Cluster {n}")
    for c in INDIRECT:
        m.setdefault(c, []).append("Indirectly Impacted")
    for c in JETTY:
        m.setdefault(c, []).append("Jetty")
    return m


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--complete", required=True, type=Path)
    ap.add_argument("--tracker", required=True, type=Path)
    ap.add_argument("--out", default=Path("audit-output"), type=Path)
    a = ap.parse_args()
    a.out.mkdir(exist_ok=True)

    frames, headers = [], {}
    for s in COMPLETE_SHEETS:
        df, h = read_sheet(a.complete, s, "Complete 2018-2026")
        headers[f"Complete/{s}"] = h
        frames.append(df)
    df, h = read_sheet(a.tracker, TRACKER_SHEET, "Tracker 2026.1")
    headers[f"Tracker/{TRACKER_SHEET}"] = h
    frames.append(df)
    all_ = pd.concat(frames, ignore_index=True)

    all_["tid"] = all_["Tracking ID"].map(lambda v: None if is_blank(v) else re.sub(r"\s", "", str(v)).upper())
    all_["k_name"] = all_["Full Name"].map(key)
    text = all_["Grievance Details"].fillna(all_["Incident Details"]).fillna(all_["Log Description"])
    all_["k_text"] = text.map(key)
    C = all_[all_._source.str.startswith("Complete")]
    T = all_[all_._source.str.startswith("Tracker")]

    print("== Headers per worksheet")
    for k, v in headers.items():
        print(f"{k}: {v}")
    print("\n== Records per source/sheet")
    print(all_.groupby(["_source", "_sheet"]).size().to_string())
    print("\n== Tracker records per 'Year' column")
    print(T["Year"].value_counts(dropna=False).sort_index().to_string())

    # --- cross-workbook overlap
    both = C[C.tid.notna()].merge(T, on="tid", suffixes=("_complete", "_tracker"))
    print(f"\n== Cross-workbook overlap: {both.tid.nunique()} tracking IDs / {len(both)} row pairs")
    both[["tid", "_sheet_complete", "_row_complete", "_row_tracker"]].to_csv(a.out / "overlap.csv", index=False)

    # --- duplicate tracking IDs inside the tracker
    dup = T[T.tid.duplicated(keep=False)].copy()
    def classify(g: pd.DataFrame) -> str:
        if g.k_name.map(lambda s: s[:6]).nunique() > 1:
            return "ID collision (different people)"
        return "exact duplicate" if g.k_text.nunique() == 1 else "same person, different grievance"
    dup["dup_class"] = dup.groupby("tid", group_keys=False).apply(lambda g: pd.Series(classify(g), index=g.index))
    print(f"\n== Tracker duplicate tracking IDs: {dup.tid.nunique()} IDs across {len(dup)} rows")
    print(dup.drop_duplicates("tid").dup_class.value_counts().to_string())
    dup[["tid", "_row", "Full Name", "Community", "dup_class"]].sort_values("tid").to_csv(a.out / "duplicate_ids.csv", index=False)

    content = T.k_name + "|" + T.k_text.str[:80]
    print(f"Tracker rows sharing name+text with another row: {content.duplicated(keep=False).sum()} "
          f"({content.duplicated().sum()} surplus copies)")
    old = C[C._sheet.isin(["2018", "2019", "2020", "2021", "2022", "2023"])]
    oc = old.Community.map(key) + "|" + old.k_text.str[:80]
    print(f"Complete 2018-2023 rows sharing community+text: {oc.duplicated(keep=False).sum()}")
    old[oc.duplicated(keep=False)][["_sheet", "_row", "Community"]].to_csv(a.out / "duplicate_text_2018_2023.csv", index=False)

    # --- communities
    master = canonical_master()
    mkeys = {key(c): c for c in master}
    print("\n== Community values (raw -> canonical)")
    for raw, n in all_["Community"].fillna("<blank>").astype(str).str.strip().value_counts().items():
        k = key(raw)
        if k in mkeys:
            canon = mkeys[k] + ("" if raw == mkeys[k] else "  [case/spacing]")
        elif k in COMMUNITY_ALIASES:
            canon = COMMUNITY_ALIASES[k] + "  [alias]"
        elif k in NON_COMMUNITY_VALUES:
            canon = "<not a community - manual review>"
        else:
            canon = "<unrecognised>"
        print(f"  {raw!r:18} {n:4}  -> {canon}")
    print("  Multi-classified communities:", {c: v for c, v in master.items() if len(v) > 1})
    pipeline = sum(len(v) for v in CLUSTERS.values())
    print(f"  Pipeline communities listed: {pipeline} (stated: 32)")

    print("\n== Tracker 'Community Category' vs canonical master (mismatches)")
    tc = T.assign(comm=T.Community.astype(str).str.strip(), cat=T["Community Category"].astype(str).str.strip())
    for (comm, cat), n in tc.groupby(["comm", "cat"]).size().items():
        canon = master.get(mkeys.get(key(comm), COMMUNITY_ALIASES.get(key(comm), "")), [])
        want = ["Host" if x == "Host" else x.split(" / ")[-1] for x in canon]
        if cat not in want:
            print(f"  {comm:14} recorded as {cat:10} x{n:<3} expected one of {want}")

    # --- categories, statuses, severities
    for col, frame, name in [("Grievance Category", C, "Complete"), ("Grievance Category", T, "Tracker"),
                             ("Status", C, "Complete"), ("Status", T, "Tracker"),
                             ("Severity Level", all_, "all")]:
        print(f"\n== {col} ({name})")
        print(frame[col].map(repr).value_counts().to_string())

    # --- dates
    def dkind(v):
        if is_blank(v):
            return "blank"
        if isinstance(v, (dt.datetime, dt.date)):
            return "date"
        if re.fullmatch(r"[A-Za-z]{3} \d{4}", str(v).strip()):
            return "text 'Mon YYYY'"
        return "other text"
    print("\n== Date cell types")
    for col in ["Log Date", "Review Date", "Date Received", "Date of Submission", "Form Issuance Date", "Date of Closure"]:
        for src, frame in all_.groupby("_source"):
            if col in frame and frame[col].map(lambda v: not is_blank(v)).any():
                print(f"  {src:20} {col:20}", frame[col].map(dkind).value_counts().to_dict())
    y24 = T[T.Year == 2024]
    print(f"  Tracker rows dated 2024 but carrying 2026-style IDs: {y24.tid.str.contains('2026').sum()} of {len(y24)}")

    # --- phones
    ph = T["Phone Number"].map(lambda v: "" if is_blank(v) else re.sub(r"\D", "", str(v)))
    valid = ph.str.fullmatch(r"0[789][01]\d{8}")
    print(f"\n== Phones (tracker): blank={(ph == '').sum()} valid={valid.sum()} invalid={((ph != '') & ~valid).sum()} "
          f"phones shared by >1 row={ph[valid].duplicated().sum()}")

    print("\n== Missing-value % by column (tracker)")
    cols = [c for c in T.columns if not c.startswith(("_", "k_")) and c != "tid" and T[c].notna().any()]
    print((T[cols].map(lambda v: is_blank(v) or str(v).strip() in {"None", "N/A"}).mean() * 100).round(0).to_string())


if __name__ == "__main__":
    main()
