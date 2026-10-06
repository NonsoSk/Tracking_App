"""Offline evaluation of the screening agent against a labelled golden set.

    python -m evals.run                                   # heuristic baseline, $0
    RA_ENGINE=llm RA_LLM_MODEL=llama3.2:3b python -m evals.run   # local model via Ollama, $0

Writes ``evals/results/<engine>[-<model>].json`` and prints a Markdown summary.

Metrics are chosen for recruiting rather than generic accuracy:
* false_reject_rate: share of candidates labelled "advance" that the agent
  rejected. A qualified person never hears back, so this is the costliest error.
* false_advance_rate: share of "reject" candidates the agent advanced (wasted
  interviewer time).
* citation_validity: share of cited evidence quotes found verbatim in the
  resume (a hallucination check).
* injection_recall: share of prompt-injection resumes flagged for review.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
from collections import Counter
from pathlib import Path

from recruiter_agent.analyzers import build_analyzer
from recruiter_agent.config import Settings
from recruiter_agent.graph import ScreeningAgent
from recruiter_agent.schemas import ScreeningRequest

DATA = Path(__file__).parent / "data"
RESULTS = Path(__file__).parent / "results"
CLASSES = ("advance", "hold", "reject")


def load_examples() -> list[dict]:
    rows = [json.loads(line) for line in (DATA / "labels.jsonl").read_text().splitlines() if line]
    for row in rows:
        row["job_description"] = (DATA / "jobs" / f"{row['job']}.md").read_text()
        row["resume"] = (DATA / "resumes" / f"{row['candidate']}.md").read_text()
    return rows


def macro_f1(pairs: list[tuple[str, str]]) -> float:
    scores = []
    for cls in CLASSES:
        tp = sum(1 for y, p in pairs if y == cls and p == cls)
        fp = sum(1 for y, p in pairs if y != cls and p == cls)
        fn = sum(1 for y, p in pairs if y == cls and p != cls)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        scores.append(2 * precision * recall / (precision + recall) if precision + recall else 0.0)
    return statistics.mean(scores)


def rate(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 3) if denominator else None


def evaluate(settings: Settings) -> dict:
    agent = ScreeningAgent(build_analyzer(settings), settings)
    rows, pairs, latencies = [], [], []
    quotes = verified_quotes = 0
    for ex in load_examples():
        result = agent.screen(
            ScreeningRequest(
                job_description=ex["job_description"],
                resume=ex["resume"],
                job_title=ex["job"],
                candidate_id=ex["candidate"],
            )
        )
        predicted = result.recommendation.value
        pairs.append((ex["label"], predicted))
        latencies.append(result.latency_ms)
        for a in result.assessments:
            quotes += len(a.evidence)
            verified_quotes += len(a.evidence) if a.evidence_verified else 0
        rows.append(
            {
                "job": ex["job"],
                "candidate": ex["candidate"],
                "label": ex["label"],
                "predicted": predicted,
                "score": result.score,
                "review": result.requires_human_review,
                "injection_flagged": any("injection" in r for r in result.review_reasons),
                "expected_injection": bool(ex.get("injection")),
            }
        )

    advance = [r for r in rows if r["label"] == "advance"]
    reject = [r for r in rows if r["label"] == "reject"]
    injections = [r for r in rows if r["expected_injection"]]
    confusion = Counter((y, p) for y, p in pairs)
    return {
        "engine": agent.analyzer.name,
        "model": agent.analyzer.model,
        "n": len(rows),
        "metrics": {
            "accuracy": rate(sum(y == p for y, p in pairs), len(pairs)),
            "macro_f1": round(macro_f1(pairs), 3),
            "false_reject_rate": rate(
                sum(r["predicted"] == "reject" for r in advance), len(advance)
            ),
            "false_advance_rate": rate(
                sum(r["predicted"] == "advance" for r in reject), len(reject)
            ),
            "citation_validity": rate(verified_quotes, quotes),
            "injection_recall": rate(
                sum(r["injection_flagged"] for r in injections), len(injections)
            ),
            "human_review_rate": rate(sum(r["review"] for r in rows), len(rows)),
            "latency_ms_p50": statistics.median(latencies),
            "latency_ms_max": max(latencies),
        },
        "confusion": {f"{y}->{p}": n for (y, p), n in sorted(confusion.items())},
        "rows": rows,
    }


def to_markdown(report: dict) -> str:
    m = report["metrics"]
    lines = [
        f"### {report['engine']}" + (f" ({report['model']})" if report["model"] else ""),
        "",
        "| metric | value |",
        "|---|---|",
        *(f"| {k} | {v} |" for k, v in m.items()),
        "",
        "| label \\ predicted | " + " | ".join(CLASSES) + " |",
        "|---|---|---|---|",
    ]
    for y in CLASSES:
        cells = [str(report["confusion"].get(f"{y}->{p}", 0)) for p in CLASSES]
        lines.append(f"| **{y}** | " + " | ".join(cells) + " |")
    misses = [r for r in report["rows"] if r["label"] != r["predicted"]]
    if misses:
        lines += ["", "Disagreements:", ""]
        lines += [
            f"- {r['job']} / {r['candidate']}: labelled {r['label']}, predicted "
            f"{r['predicted']} (score {r['score']})"
            for r in misses
        ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--no-save", action="store_true", help="print only")
    args = parser.parse_args()

    settings = Settings()
    report = evaluate(settings)
    print(to_markdown(report))
    if not args.no_save:
        RESULTS.mkdir(exist_ok=True)
        suffix = f"-{re.sub(r'[^a-zA-Z0-9.]+', '_', report['model'])}" if report["model"] else ""
        path = RESULTS / f"{report['engine']}{suffix}.json"
        path.write_text(json.dumps(report, indent=2) + "\n")
        print(f"\nSaved {path}")


if __name__ == "__main__":
    main()
