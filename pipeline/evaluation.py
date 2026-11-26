"""Checking the matcher against people: reviewers judge a vacancy's candidates blind (no scores, no verdicts), then
the old and the new matcher are compared on the same candidates.

    python manage.py match_evaluation blind REQ_REF --out review.xlsx      (also writes review.matcher.json)
    ... reviewers fill in the "Interview-worthy" column, without opening the portal's scores ...
    python manage.py match_evaluation evidence REQ_REF --out evidence.xlsx  (after the blind review)
    python manage.py match_evaluation report REQ_REF --blind review.xlsx [--evidence evidence.xlsx]

The report gives, for each matcher, how many of its top 10 the reviewers called interview-worthy, which candidates
the reviewers approved that it missed, and how many evidence lines reviewers found wrong. Without reviewers' labels
the real-world quality stays UNVERIFIED, and the report says so.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from openpyxl import Workbook, load_workbook

YES = {"yes", "y", "1", "true", "x"}
TOP = 10


def _applications(requisition):
    return list(requisition.applications.select_related("candidate").order_by("pk"))


def export_blind(requisition, out: Path) -> Path:
    """The reviewers' sheet (random order, no scores) and, beside it, the old matcher's results kept for the report."""
    apps = _applications(requisition)
    order = apps[:]
    random.Random(requisition.pk).shuffle(order)
    wb = Workbook()
    ws = wb.active
    ws.title = "Blind review"
    ws.append([f"{requisition.reference} {requisition.title}: judge each CV against the job description. Do not "
               "look at the portal's scores until you have finished."])
    ws.append(["Application", "Candidate", "Open the CV in the portal", "Interview-worthy? (yes/no)",
               "Must-haves met? (yes/no/unclear)", "Notes"])
    for app in order:
        ws.append([app.pk, app.candidate.full_name, f"/candidates/{app.candidate.pk}/", "", "", ""])
    out = Path(out)
    wb.save(out)
    old = {str(a.pk): {"score": float(a.match_score or 0),
                       "verdict": (a.match_breakdown or {}).get("match", {}).get("verdict")
                       or ("match" if (a.match_breakdown or {}).get("match", {}).get("is_match") else "no_match"),
                       "matcher": (a.match_breakdown or {}).get("version")} for a in apps}
    out.with_suffix(".matcher.json").write_text(json.dumps({"requisition": requisition.pk, "old": old}, indent=1))
    return out


def export_evidence(requisition, out: Path) -> Path:
    """For each candidate, the evidence lines the matcher used, for reviewers to mark right or wrong."""
    from .matching import compute_match

    wb = Workbook()
    ws = wb.active
    ws.title = "Evidence check"
    ws.append(["Application", "Candidate", "Requirement", "What the matcher found in the CV", "Correct? (yes/no)"])
    for app in _applications(requisition):
        result = compute_match(requisition, app.candidate)
        for row in (result.get("components", {}).get("jd") or {}).get("criteria", [])[:8]:
            ws.append([app.pk, app.candidate.full_name, row.get("text", "")[:200], str(row.get("evidence", ""))[:300],
                       ""])
    wb.save(out)
    return Path(out)


def _labels(path: Path) -> dict:
    ws = load_workbook(path, read_only=True, data_only=True).worksheets[0]
    labels = {}
    for row in ws.iter_rows(min_row=3, values_only=True):
        if row and row[0] and row[3] not in (None, ""):
            labels[int(row[0])] = str(row[3]).strip().lower() in YES
    return labels


def _evidence_errors(path: Path) -> tuple[int, int]:
    ws = load_workbook(path, read_only=True, data_only=True).worksheets[0]
    judged = wrong = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row and row[4] not in (None, ""):
            judged += 1
            wrong += str(row[4]).strip().lower() not in YES
    return judged, wrong


def report(requisition, blind: Path | None, evidence: Path | None = None) -> dict:
    from .matching import compute_match

    apps = _applications(requisition)
    saved = {}
    if blind and Path(blind).with_suffix(".matcher.json").exists():
        saved = json.loads(Path(blind).with_suffix(".matcher.json").read_text()).get("old", {})
    new = {}
    for app in apps:
        result = compute_match(requisition, app.candidate)
        new[app.pk] = {"score": result["score"], "verdict": (result.get("match") or {}).get("verdict", "")}
    old = {int(k): v for k, v in saved.items()}
    labels = _labels(Path(blind)) if blind else {}
    out = {"requisition": f"{requisition.reference} {requisition.title}", "candidates": len(apps),
           "reviewed": len(labels), "interview_worthy": sum(labels.values())}

    def judge(results, name):
        if not results:
            return None
        ranked = sorted(results, key=lambda pk: -results[pk]["score"])
        top = ranked[:TOP]
        approved = [pk for pk, ok in labels.items() if ok]
        return {"matcher": name, f"top_{TOP}_interview_worthy": sum(1 for pk in top if labels.get(pk)),
                f"top_{TOP}_reviewed": sum(1 for pk in top if pk in labels),
                "approved_missed_from_top": [pk for pk in approved if pk not in top],
                "approved_called_not_a_match": [pk for pk in approved if results.get(pk, {}).get("verdict")
                                                == "no_match"],
                "matches": sum(1 for r in results.values() if r["verdict"] == "match"),
                "to_review": sum(1 for r in results.values() if r["verdict"] == "review")}

    out["old"] = judge(old, "before the upgrade (as stored)")
    out["new"] = judge(new, "after the upgrade")
    if evidence:
        judged, wrong = _evidence_errors(Path(evidence))
        out["evidence_lines_checked"], out["evidence_errors"] = judged, wrong
    out["quality"] = ("measured against reviewers' labels" if labels else
                      "UNVERIFIED: no reviewer has judged these candidates yet")
    return out
