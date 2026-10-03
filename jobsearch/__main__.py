"""Run the job search: python -m jobsearch [--fixtures DIR] [--dry-run]"""

import argparse
import datetime
import json
import os

from . import filters, sources, tracker

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_fixtures(directory):
    """Read saved API responses instead of calling the network (for tests)."""
    parsers = {"remotive": sources.remotive, "remoteok": sources.remoteok,
               "himalayas": sources.himalayas, "jobicy": sources.jobicy}
    jobs = []
    for name, parser in parsers.items():
        path = os.path.join(directory, f"{name}.json")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as handle:
                jobs += parser(json.load(handle))
    return jobs


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=os.path.join(ROOT, "config.json"))
    parser.add_argument("--tracker", default=os.path.join(ROOT, "data", "jobs.csv"))
    parser.add_argument("--report", default=os.path.join(ROOT, "JOBS.md"))
    parser.add_argument("--fixtures", help="read saved API responses from this folder")
    parser.add_argument("--dry-run", action="store_true", help="print matches, write nothing")
    args = parser.parse_args(argv)

    with open(args.config, encoding="utf-8") as handle:
        config = json.load(handle)
    today = datetime.date.today().isoformat()

    print("Searching job boards...")
    jobs = load_fixtures(args.fixtures) if args.fixtures else sources.fetch_all(config["title_keywords"])
    found, rejected = filters.matches(jobs, config)
    print(f"{len(jobs)} listings checked, {len(found)} matches. Skipped: {rejected}")

    rows = tracker.load(args.tracker)
    added = tracker.merge(rows, found, today)
    for row in added:
        print(f"  + {row['title']} at {row['company']} "
              f"({tracker.money(row['monthly_usd_max'])}/mo) {row['url']}")
    if args.dry_run:
        return 0
    tracker.save(args.tracker, rows)
    with open(args.report, "w", encoding="utf-8") as handle:
        handle.write(tracker.render_markdown(rows, today))
    print(f"{len(added)} new matches recorded in {os.path.relpath(args.tracker, ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
