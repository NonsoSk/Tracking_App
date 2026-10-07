"""Run each Semgrep rule set over the cases and score it against the ground-truth labels.

Label: the `vulnerable` variant of each case is a true finding; `fixed` and
`negative` are not. A file counts as flagged if any rule in the set fires on it.
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULESETS = ["naive", "refined"]
VARIANTS = ["vulnerable", "fixed", "negative"]


def flagged_files(ruleset: str) -> set[str]:
    out = subprocess.run(
        ["semgrep", "--config", f"semgrep/{ruleset}.yml", "--json", "--metrics=off", "--quiet", "cases"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout
    return {r["path"] for r in json.loads(out)["results"]}


def main() -> int:
    cases = sorted(p.name for p in (ROOT / "cases").iterdir() if p.is_dir() and not p.name.startswith("_"))
    print("| Rule set | Case | " + " | ".join(VARIANTS) + " |")
    print("|---|---|" + "---|" * len(VARIANTS))
    totals = {}
    for ruleset in RULESETS:
        hits = flagged_files(ruleset)
        counts = {"TP": 0, "FP": 0, "FN": 0, "TN": 0}
        for case in cases:
            cells = []
            for variant in VARIANTS:
                truth = variant == "vulnerable"
                found = f"cases/{case}/{variant}.py" in hits
                outcome = {(True, True): "TP", (False, True): "FP",
                           (True, False): "FN", (False, False): "TN"}[(truth, found)]
                counts[outcome] += 1
                cells.append(outcome)
            print(f"| {ruleset} | {case} | " + " | ".join(cells) + " |")
        totals[ruleset] = counts
    print()
    print("| Rule set | TP | FP | FN | TN | Precision | Recall |")
    print("|---|---|---|---|---|---|---|")
    for ruleset, c in totals.items():
        precision = c["TP"] / (c["TP"] + c["FP"]) if c["TP"] + c["FP"] else 0.0
        recall = c["TP"] / (c["TP"] + c["FN"]) if c["TP"] + c["FN"] else 0.0
        print(f"| {ruleset} | {c['TP']} | {c['FP']} | {c['FN']} | {c['TN']} | {precision:.0%} | {recall:.0%} |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
