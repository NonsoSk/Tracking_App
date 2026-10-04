"""The tracker: data/jobs.csv is the source of truth, JOBS.md is a readable view.

Re-running the search adds new matches and never overwrites the status or
notes you have filled in by hand.
"""

import csv
import os

COLUMNS = [
    "status", "title", "company", "monthly_usd_min", "monthly_usd_max",
    "location", "url", "fit", "contact", "package", "sent",
    "source", "posted", "first_seen", "notes", "id",
]
STATUSES = ["New", "Interested", "Approved", "Applied", "Interviewing", "Offer", "Rejected", "Skipped"]


def load(path):
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def save(path, rows):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS, extrasaction="ignore", restval="")
        writer.writeheader()
        writer.writerows(rows)


def merge(rows, matches, today):
    """Add matches not yet tracked. Returns the new rows only."""
    known_ids = {row["id"] for row in rows}
    known_urls = {row["url"] for row in rows if row["url"]}
    added = []
    for item in matches:
        if item["id"] in known_ids or (item["url"] and item["url"] in known_urls):
            continue
        row = {column: item.get(column, "") for column in COLUMNS}
        row.update(status="New", first_seen=today, notes="", fit="", contact="", package="", sent="")
        for key in ("monthly_usd_min", "monthly_usd_max"):
            row[key] = "" if item.get(key) is None else str(item[key])
        rows.append(row)
        added.append(row)
        known_ids.add(item["id"])
        known_urls.add(item["url"])
    rows.sort(key=lambda row: (row["first_seen"], row["posted"]), reverse=True)
    return added


def money(value):
    return f"${int(float(value)):,}" if value else "?"


def drafts(row):
    if not row.get("package"):
        return ""
    sent = f" (sent {row['sent']})" if row.get("sent") else ""
    return f"[open]({row['package']}){sent}"


def render_markdown(rows, today):
    lines = [
        "# Job matches",
        "",
        f"Remote data analyst roles paying at least $5k a month. Last search: {today}.",
        "Edit `status` and `notes` in [data/jobs.csv](data/jobs.csv); the next search keeps your edits.",
        "Set a job's status to `Approved` to send its outreach email with the tailored resume on the next run.",
        "",
    ]
    for status in STATUSES:
        group = [row for row in rows if row["status"] == status]
        if not group:
            continue
        lines += [f"## {status} ({len(group)})", "",
                  "| Role | Company | Monthly USD | Location | Fit | Drafts | Found |",
                  "|---|---|---|---|---|---|---|"]
        for row in group:
            pay = f"{money(row['monthly_usd_min'])} to {money(row['monthly_usd_max'])}"
            if row["monthly_usd_min"] == row["monthly_usd_max"]:
                pay = money(row["monthly_usd_max"])
            title = row["title"].replace("|", "/")
            lines.append(f"| [{title}]({row['url']}) | {row['company'].replace('|', '/')} | "
                         f"{pay} | {row['location'].replace('|', '/') or 'Remote'} | "
                         f"{row.get('fit') or ''} | {drafts(row)} | {row['first_seen']} |")
        lines.append("")
    return "\n".join(lines)
