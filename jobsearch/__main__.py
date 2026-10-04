"""Job search automation.

python -m jobsearch              search, record matches, draft applications
python -m jobsearch send         send outreach for jobs you marked Approved
"""

import argparse
import datetime
import json
import os

from . import filters, outreach, packages, sources, tailor, tracker

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


def draft_applications(args, config, rows, found, client):
    """Write an application package for each new match, up to the per-run limit."""
    resume = tailor.load_resume(args.root)
    if client is None or resume is None:
        missing = "ANTHROPIC_API_KEY" if client is None else "your resume (RESUME_TEXT or profile/resume.md)"
        print(f"Skipping application drafts: {missing} is not set.")
        return
    by_id = {item["id"]: item for item in found}
    pending = [row for row in rows if not row.get("package") and row["status"] in ("New", "Interested")
               and row["id"] in by_id]
    for row in pending[: config.get("max_drafts_per_run", 10)]:
        item = by_id[row["id"]]
        try:
            docs = tailor.tailor(client, resume, item, research=config.get("research_companies", False),
                                 turnaround=config.get("deal_turnaround", "48 hours"))
        except Exception as error:  # one failed draft should not stop the rest
            print(f"  ! drafting {row['title']} at {row['company']} failed: {error}")
            continue
        if docs is None:
            print(f"  ! drafting {row['title']} at {row['company']} was declined")
            continue
        row["package"], row["contact"] = packages.build(args.root, item, docs, config.get("profile"))
        row["fit"] = str(docs["fit_score"])
        print(f"  drafted {row['package']} (fit {row['fit']}/10)")


def search(args, config, client=None):
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
    if not args.no_drafts:
        draft_applications(args, config, rows, found, client if client is not None else tailor.make_client())
    tracker.save(args.tracker, rows)
    with open(args.report, "w", encoding="utf-8") as handle:
        handle.write(tracker.render_markdown(rows, today))
    print(f"{len(added)} new matches recorded in {os.path.relpath(args.tracker, args.root)}")
    return 0


def send(args, config, sender=outreach.send):
    rows = tracker.load(args.tracker)
    approved = [row for row in rows if row["status"] == "Approved" and not row.get("sent")]
    if not approved:
        print("No approved jobs to send.")
        return 0
    settings = outreach.smtp_settings()
    if settings is None and not args.dry_run:
        print("Not sending: SMTP_USER and SMTP_PASSWORD are not set.")
        return 1
    today = datetime.date.today().isoformat()
    for row in approved:
        label = f"{row['title']} at {row['company']}"
        folder = os.path.join(args.root, row.get("package") or "")
        draft = os.path.join(folder, "deal.md" if row.get("style", "").strip().lower() == "deal" else "outreach.md")
        if not row.get("package") or not os.path.exists(draft):
            print(f"  ! {label}: no drafts yet, apply via {row['url']}")
            continue
        to, subject, body = outreach.read_email_draft(draft)
        if not to:
            print(f"  ! {label}: no contact email in the post. Add one on the To: line of "
                  f"{os.path.relpath(draft, args.root)}, or apply via {row['url']}")
            continue
        if args.dry_run:
            print(f"  would send to {to}: {subject}")
            continue
        sender(settings, to, subject, body, packages.attachments(folder))
        row["status"], row["sent"], row["contact"] = "Applied", today, to
        print(f"  sent {label} to {to}")
    if not args.dry_run:
        tracker.save(args.tracker, rows)
        with open(args.report, "w", encoding="utf-8") as handle:
            handle.write(tracker.render_markdown(rows, today))
    return 0


def main(argv=None, client=None, sender=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", nargs="?", default="search", choices=["search", "send"])
    parser.add_argument("--root", default=ROOT, help="where applications/ is written")
    parser.add_argument("--config", default=os.path.join(ROOT, "config.json"))
    parser.add_argument("--tracker", default=os.path.join(ROOT, "data", "jobs.csv"))
    parser.add_argument("--report", default=os.path.join(ROOT, "JOBS.md"))
    parser.add_argument("--fixtures", help="read saved API responses from this folder")
    parser.add_argument("--no-drafts", action="store_true", help="search only, skip application drafts")
    parser.add_argument("--dry-run", action="store_true", help="show what would happen, write nothing")
    args = parser.parse_args(argv)

    with open(args.config, encoding="utf-8") as handle:
        config = json.load(handle)
    if args.command == "send":
        return send(args, config, sender or outreach.send)
    return search(args, config, client)


if __name__ == "__main__":
    raise SystemExit(main())
