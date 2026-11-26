"""Benchmark: from a completed workbook save to the new value on two recruiters' already-open screens.

    python tools/live_benchmark.py --saves 30              (a throwaway folder is created and removed)
    python tools/live_benchmark.py --saves 30 --keep --workdir C:\\temp\\portal-bench

Everything runs on FICTIONAL data in a NEW, EMPTY folder: its own database, media folder, workbooks, web server and
worker. It refuses to run in a folder that holds anything else, and never reads the portal's own database, .env
values for the database, linked workbooks or folders. Nothing is sent anywhere: AI is off and e-mail goes nowhere.

What it does: loads fictional workbooks of the sizes given, starts the web server (runserver, as on the HR PC, or
gunicorn, as on the pilot) and the background worker, opens the same vacancy in two browsers signed in as two
recruiters, then saves the workbook N times the way Excel does (a new file written aside and swapped in), changing
one cell each time. For each save it records when the save completed, when the worker received it, when the change
was committed, and when each browser showed it. The report gives the share within the target, the worst delay and
where the time went for every miss.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import socket
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone as dt_timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MARK = ".portal-benchmark"
WORDS = ["Amber", "Basil", "Cedar", "Delta", "Ember", "Flint", "Grove", "Haven", "Indigo", "Juniper", "Kestrel",
         "Linden", "Maple", "Nova", "Onyx", "Pine", "Quill", "Raven", "Sable", "Tamar", "Umber", "Vale", "Willow",
         "Yarrow", "Zephyr"]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def prepare_folder(path: str | None) -> tuple[Path, bool]:
    if path:
        work = Path(path).resolve()
        work.mkdir(parents=True, exist_ok=True)
        if any(work.iterdir()) and not (work / MARK).exists():
            sys.exit(f"Refusing to run: {work} is not empty and was not made by this benchmark. Give a new folder.")
        if (work / MARK).exists():
            for child in work.iterdir():
                if child.name != MARK:
                    shutil.rmtree(child) if child.is_dir() else child.unlink()
        created = False
    else:
        work, created = Path(tempfile.mkdtemp(prefix="portal-benchmark-")), True
    (work / MARK).write_text("Made by tools/live_benchmark.py. Fictional data only; safe to delete.\n")
    return work, created


def child_env(work: Path, poll_ms: int) -> dict:
    env = dict(os.environ)
    for key in list(env):  # nothing of the real installation's database, AI or mail settings
        if key.startswith(("POSTGRES_", "ANTHROPIC_", "EMAIL_", "SMTP_", "IMAP_")):
            env.pop(key)
    env.update(SQLITE_PATH=str(work / "bench.sqlite3"), MEDIA_DIR=str(work / "media"), POSTGRES_DB="",
               ANTHROPIC_API_KEY="", DJANGO_DEBUG="true", DJANGO_SECRET_KEY="benchmark-only-" + os.urandom(8).hex(),
               PORTAL_INPUTS_ENABLED="true", PORTAL_REHEARSAL="false", WORKER_NAME="benchmark-worker",
               LIVE_POLL_MS=str(poll_ms), PORTAL_UPDATES_PATH=str(work / "updates"), PYTHONUNBUFFERED="1",
               DJANGO_ALLOW_ASYNC_UNSAFE="true")
    return env


def manage(env, *args, **kw):
    return subprocess.run([sys.executable, str(ROOT / "manage.py"), *args], env=env, cwd=ROOT, check=True,
                          capture_output=True, text=True, **kw)


def write_workbooks(work: Path, sizes: dict, coordinator: str, env: dict):
    # The fictional sheets use the test suite's column layout; loading it needs Django, pointed at the benchmark's
    # own throwaway database.
    sys.path.insert(0, str(ROOT))
    os.environ.update({k: v for k, v in env.items() if k in {"SQLITE_PATH", "MEDIA_DIR", "POSTGRES_DB",
                                                               "ANTHROPIC_API_KEY", "DJANGO_SECRET_KEY",
                                                               "DJANGO_DEBUG"}})
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    import django

    django.setup()
    from core.test_workbook_import import CBT_HEADERS, CV_HEADERS, IV_HEADERS, REQ_HEADERS, STAFF_HEADERS, write

    rnd = random.Random(1)
    n_req, n_iv, n_cbt, n_staff, n_cv = (sizes[k] for k in ("requisitions", "interviews", "cbt", "staff", "cvs"))

    def phone(i):
        return f"080{30000000 + i:08d}"

    reqs = [[f"Req_{1000 + i}", datetime(2025, 1 + i % 12, 1 + i % 27), "Requester Person", "IFZ",
             ["QA/QC", "Finance", "HR"][i % 3], "Ops", "Experienced_Role", "New Position", "Port Harcourt",
             f"Role {i}", "Senior Staff", 1, 3, 2, 1, 0, 1, 0, 0, 1, ["Pending", "Closed", "Ongoing"][i % 3],
             datetime(2025, 2, 1), None, None, None, coordinator if i == 1 else "Coordinator Person"]
            for i in range(n_req)]
    ivs = [[f"Req_{1000 + i % n_req}", None, "Experienced", f"Person{i} Surname{i}", "Male", phone(i),
            f"p{i}@example.com", datetime(2025, 3, 1 + i % 27), "Panel", "Panel A", None, None, None,
            0.5 + (i % 40) / 100, ["Selected", "Rejected", "On Hold"][i % 3], None, "Not Engaged"] for i in range(n_iv)]
    cbts = [[f"Surname{i}", f"Person{i}", f"p{i}@example.com", phone(i), "2024-02-26 00:00:00", "Lab_GET", 150,
             60 + i % 50, "IFL", "2024-02-01 00:00:00"] for i in range(n_cbt)]
    staff = [[datetime(2026, 8, 1), f"SR{9000 + i}", f"Staff{i} Member", "IEPL", "Port Harcourt", datetime(2006, 9, 13),
              datetime(2007, 3, 13), "QA/QC", "Staff Regular", "GRADE II D", "Technician", "Junior Staff",
              "Confirmed", None, None, 0, datetime(1970 + i % 30, 1, 1), "ND", "Mechanical", "IPL", 40, 20]
             for i in range(n_staff)]
    cvs = [[i, f"Person{i} Surname{i}", phone(i), f"p{i}@example.com", datetime(1990, 1, 1 + i % 27), 30, "Male",
            "Rivers State", "Eleme", "Yes", rnd.randint(0, 12), "B.Sc", "Chemical Engineering", 2015, "Portal", "Uni",
            "Second class upper", "", ""] for i in range(n_cv)]
    master, cvbook = work / "Recruitment Master Weekly Report.xlsx", work / "CV Dump.xlsx"
    sheets = [("Tracker", REQ_HEADERS, reqs), ("Interviews", IV_HEADERS, ivs), ("CBT", CBT_HEADERS, cbts),
              ("Staff", STAFF_HEADERS, staff)]
    write(str(master), sheets)
    if n_cv:
        write(str(cvbook), [("CV Dump", CV_HEADERS, cvs)])
    coordinator_col = REQ_HEADERS.index("Rec. Coordinator")

    def save(value):
        """Save the way Excel does: the whole workbook is written to a temporary file, then swapped in."""
        reqs[1][coordinator_col] = value
        temp = work / f"~tmp{os.getpid()}.tmp"
        write(str(temp), sheets)
        os.replace(temp, master)
        return time.time()

    return master, (cvbook if n_cv else None), save


SETUP = """
import json, sys
from django.contrib.auth import get_user_model
from django.contrib.sessions.backends.db import SessionStore
from django.contrib.auth import SESSION_KEY, BACKEND_SESSION_KEY, HASH_SESSION_KEY
User = get_user_model()
out = []
for name in ("bench.recruiter.one", "bench.recruiter.two"):
    user = User.objects.create_user(name, password=None, role="recruiter", first_name="Bench", last_name=name[-3:])
    s = SessionStore()
    s[SESSION_KEY] = str(user.pk); s[BACKEND_SESSION_KEY] = "django.contrib.auth.backends.ModelBackend"
    s[HASH_SESSION_KEY] = user.get_session_auth_hash(); s.create()
    out.append(s.session_key)
from requisitions.models import Requisition
req = Requisition.objects.get(reference="Req_1001")
print(json.dumps({"sessions": out, "url": req.get_absolute_url()}))
"""

WATCH = """
() => { window.__want = null; window.__seenAt = null;
  setInterval(() => { if (window.__want && !window.__seenAt) {
    const main = document.getElementById('main');
    if (main && main.textContent.includes(window.__want)) window.__seenAt = Date.now(); } }, 5); }
"""


def wait_up(port, seconds=60):
    end = time.time() + seconds
    while time.time() < end:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def run(args):
    work, created = prepare_folder(args.workdir)
    env = child_env(work, args.poll_ms)
    procs = []
    report = {"started": datetime.now().isoformat(timespec="seconds"), "server": args.server, "poll_ms": args.poll_ms,
              "sizes": args.sizes, "saves": []}
    try:
        print(f"Benchmark folder: {work}")
        manage(env, "migrate", "--noinput")
        coordinator = "Coordinator Start"
        master, cvbook, save = write_workbooks(work, args.sizes, coordinator, env)
        manage(env, "sync_workbooks", "--link", str(master), *([str(cvbook)] if cvbook else []))
        t = time.time()
        manage(env, "sync_workbooks", "--now")  # the first full load, before the clock starts
        report["first_load_seconds"] = round(time.time() - t, 1)
        setup = json.loads(manage(env, "shell", "-c", SETUP).stdout.strip().splitlines()[-1])
        port = free_port()
        log = open(work / "processes.log", "w")
        if args.server == "gunicorn":
            server = [sys.executable, "-m", "gunicorn", "config.wsgi:application", "--bind", f"127.0.0.1:{port}",
                      "--workers", "3", "--threads", "4"]
        else:
            server = [sys.executable, str(ROOT / "manage.py"), "runserver", f"127.0.0.1:{port}", "--noreload"]
        procs.append(subprocess.Popen(server, env=env, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT))
        procs.append(subprocess.Popen([sys.executable, str(ROOT / "manage.py"), "run_worker"], env=env, cwd=ROOT,
                                      stdout=log, stderr=subprocess.STDOUT))
        if not wait_up(port):
            raise SystemExit("The web server did not start; see processes.log")
        time.sleep(2)  # the worker's first look at the links

        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            launch = {"headless": True}
            if args.chromium:
                launch.update(executable_path=args.chromium, args=["--headless", "--no-sandbox"])
            browser = pw.chromium.launch(**launch)
            pages = []
            for key in setup["sessions"]:  # two recruiters, two separate browser profiles
                context = browser.new_context()
                context.add_cookies([{"name": "sessionid", "value": key, "domain": "127.0.0.1", "path": "/"}])
                page = context.new_page()
                page.goto(f"http://127.0.0.1:{port}{setup['url']}")
                page.wait_for_selector("#main[data-live]")
                page.evaluate(WATCH)
                pages.append(page)
            time.sleep(1.5)
            db = sqlite3.connect(f"file:{work / 'bench.sqlite3'}?mode=ro", uri=True, timeout=30)
            for n in range(args.saves):
                value = f"Coordinator {WORDS[n % len(WORDS)]} {WORDS[(n * 7 + 3) % len(WORDS)]}"
                for page in pages:
                    page.evaluate("v => { window.__want = v; window.__seenAt = null; }", value)
                saved = save(value)
                end = time.time() + args.timeout
                seen = [None] * len(pages)
                while time.time() < end and None in seen:
                    for i, page in enumerate(pages):
                        if seen[i] is None:
                            at = page.evaluate("() => window.__seenAt")
                            if at:
                                seen[i] = at / 1000
                    time.sleep(0.02)
                row = db.execute(
                    "SELECT received_at, started_at, finished_at, modified, details FROM intake_receipt "
                    "WHERE kind='workbook' AND status='done' ORDER BY id DESC LIMIT 1").fetchone()
                stage = {}
                if row:
                    received, started, finished, modified, details = row

                    def stamp(value):  # the database keeps UTC without a zone
                        if not value:
                            return None
                        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
                        if moment.tzinfo is None:
                            moment = moment.replace(tzinfo=dt_timezone.utc)
                        return moment.timestamp()

                    stage = {"detect": round(stamp(received) - saved, 3), "import": json.loads(details).get("seconds"),
                             "commit": round(stamp(finished) - saved, 3)}
                delays = [round(s - saved, 3) if s else None for s in seen]
                entry = {"save": n + 1, "value": value, "browsers": delays, **stage}
                if None in seen:  # what the screens did, to tell why
                    entry["screens"] = [page.evaluate("() => JSON.stringify(window.__live)") for page in pages]
                if all(d is not None for d in delays) and "commit" in stage:
                    entry["display_after_commit"] = round(max(delays) - stage["commit"], 3)
                report["saves"].append(entry)
                print(f"save {n + 1:>3}: browsers {delays}  detect {stage.get('detect')}  import {stage.get('import')}"
                      f"  commit {stage.get('commit')}")
                time.sleep(args.interval)
            browser.close()
    finally:
        for proc in procs:
            proc.terminate()
        for proc in procs:
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
    summarise(report, args.target)
    out = Path(args.report) if args.report else work / "live-benchmark.json"
    out.write_text(json.dumps(report, indent=2))
    print(json.dumps(report["summary"], indent=2))
    print(f"Report: {out}")
    if created and not args.keep:
        shutil.rmtree(work, ignore_errors=True)
    return report


def summarise(report, target):
    delays = [d for s in report["saves"] for d in s["browsers"]]
    seen = [d for d in delays if d is not None]
    within = [d for d in seen if d <= target]
    misses = []
    for s in report["saves"]:
        late = [d for d in s["browsers"] if d is None or d > target]
        if late:
            parts = {"detect": s.get("detect"), "import": s.get("import"),
                     "display after commit": s.get("display_after_commit")}
            known = {k: v for k, v in parts.items() if v is not None}
            misses.append({"save": s["save"], "browsers": s["browsers"], **known,
                           "largest part": max(known, key=known.get) if known else "not shown at all"})
    report["summary"] = {
        "target_seconds": target, "measurements": len(delays), "shown": len(seen),
        "within_target_percent": round(100 * len(within) / len(delays), 1) if delays else 0,
        "median_seconds": round(statistics.median(seen), 3) if seen else None,
        "p90_seconds": round(sorted(seen)[int(0.9 * (len(seen) - 1))], 3) if seen else None,
        "worst_seconds": max(seen) if seen else None, "never_shown": len(delays) - len(seen),
        "median_detect": _median(report["saves"], "detect"), "median_import": _median(report["saves"], "import"),
        "median_display_after_commit": _median(report["saves"], "display_after_commit"),
        "target_met": bool(delays) and len(within) == len(delays), "misses": misses,
    }


def _median(saves, key):
    values = [s[key] for s in saves if s.get(key) is not None]
    return round(statistics.median(values), 3) if values else None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--saves", type=int, default=30)
    parser.add_argument("--interval", type=float, default=2.5, help="Seconds between saves.")
    parser.add_argument("--target", type=float, default=2.0)
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--poll-ms", type=int, default=700, help="LIVE_POLL_MS for the screens.")
    parser.add_argument("--server", choices=["runserver", "gunicorn"], default="runserver")
    parser.add_argument("--workdir", help="A new, empty folder (default: a temporary one, removed afterwards).")
    parser.add_argument("--keep", action="store_true", help="Keep the temporary folder.")
    parser.add_argument("--report", help="Where to write the JSON report (default: in the benchmark folder).")
    parser.add_argument("--chromium", default=os.environ.get("PLAYWRIGHT_CHROMIUM", ""),
                        help="Path of a Chromium to use (default: Playwright's own).")
    parser.add_argument("--sizes", default="200,2000,2000,1000,5000",
                        help="Rows: requisitions,interviews,cbt,staff,cvs (fictional).")
    args = parser.parse_args()
    keys = ["requisitions", "interviews", "cbt", "staff", "cvs"]
    args.sizes = dict(zip(keys, (int(x) for x in args.sizes.split(","))))
    run(args)


if __name__ == "__main__":
    main()
