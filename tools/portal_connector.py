"""IEFCL Recruitment Portal connector: sends new and changed files from folders on this PC (and a workbook, if one is
linked to this PC) to the portal, for folders the portal's server cannot open itself.

    python portal_connector.py            (portal-connector.bat does this; the first run asks for the address and key)
    python portal_connector.py --once     (one look and one send, then stop)

Nothing is moved, renamed or deleted on this PC. Files found while the portal cannot be reached (no network, the PC
asleep, the server restarting) wait in a queue on this PC and are sent, once each, when the portal answers again.
The settings and the queue are kept in %LOCALAPPDATA%\\IEFCL Portal Connector (or ~/.iefcl-portal-connector).
Only the Python standard library is used.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import io
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path

VERSION = "connector-1.0"
SKIP = {"thumbs.db", "desktop.ini", ".ds_store"}
PARTIAL = (".tmp", ".crdownload", ".part", ".partial", ".download")
STABLE_SECONDS = 2.0


class Offline(Exception):
    pass


def data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA")
    folder = Path(base) / "IEFCL Portal Connector" if base else Path.home() / ".iefcl-portal-connector"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def temporary(name: str) -> bool:
    lower = name.lower()
    return lower in SKIP or name.startswith((".", "~$")) or lower.endswith(PARTIAL)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def complete_xlsx(content: bytes) -> bool:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            return archive.testzip() is None
    except (zipfile.BadZipFile, OSError, ValueError, EOFError):
        return False


class Spool:
    """What was seen and what still has to be sent, kept on disk so nothing is lost when the PC or the network stops."""

    def __init__(self, folder: Path):
        self.folder = folder
        (folder / "outbox").mkdir(exist_ok=True)
        self.db = sqlite3.connect(folder / "spool.sqlite3")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS seen (target TEXT, path TEXT, size INTEGER, mtime REAL, sha TEXT,
                                             PRIMARY KEY (target, path));
            CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY, kind TEXT, target INTEGER, path TEXT,
                                               source_path TEXT, sha TEXT, mtime REAL, copy TEXT, attempts INTEGER
                                               DEFAULT 0, error TEXT DEFAULT '');
            CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);
        """)
        self.db.commit()

    def get(self, key, default=None):
        row = self.db.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def put(self, key, value):
        self.db.execute("INSERT OR REPLACE INTO state VALUES (?, ?)", (key, json.dumps(value)))
        self.db.commit()

    def seen(self, target, path):
        return self.db.execute("SELECT size, mtime, sha FROM seen WHERE target=? AND path=?", (target, path)).fetchone()

    def mark(self, target, path, size, mtime, sha):
        self.db.execute("INSERT OR REPLACE INTO seen VALUES (?, ?, ?, ?, ?)", (target, path, size, mtime, sha))

    def queue(self, kind, target, path, source_path, sha, mtime, copy=""):
        if kind == "workbook":  # only the newest save of a workbook needs to go
            for (old,) in self.db.execute("SELECT copy FROM outbox WHERE kind='workbook' AND target=?", (target,)):
                Path(old).unlink(missing_ok=True) if old else None
            self.db.execute("DELETE FROM outbox WHERE kind='workbook' AND target=?", (target,))
        self.db.execute("INSERT INTO outbox (kind, target, path, source_path, sha, mtime, copy) VALUES (?,?,?,?,?,?,?)",
                        (kind, target, str(path), source_path, sha, mtime, copy))
        self.db.commit()

    def pending(self):
        return self.db.execute("SELECT id, kind, target, path, source_path, sha, mtime, copy, attempts FROM outbox "
                               "ORDER BY id").fetchall()

    def done(self, item_id, copy=""):
        self.db.execute("DELETE FROM outbox WHERE id=?", (item_id,))
        self.db.commit()
        if copy:
            Path(copy).unlink(missing_ok=True)

    def failed(self, item_id, error):
        self.db.execute("UPDATE outbox SET attempts=attempts+1, error=? WHERE id=?", (error[:500], item_id))
        self.db.commit()


class Portal:
    def __init__(self, url: str, token: str, timeout: float = 60):
        self.url, self.token, self.timeout = url.rstrip("/"), token, timeout

    def _call(self, path, *, data=None, headers=None):
        request = urllib.request.Request(self.url + path, data=data, headers={
            "Authorization": f"Bearer {self.token}", "X-Connector-Version": VERSION, **(headers or {})})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as exc:
            body = exc.read()[:500].decode("utf-8", "replace")
            if exc.code in (401, 403):
                raise SystemExit(f"The portal refused this connector's key ({body}). Add the PC again in the portal "
                                 "and run the connector with --setup.")
            if exc.code >= 500 or exc.code in (408, 429):
                raise Offline(f"The portal answered {exc.code}") from exc
            raise ValueError(f"{exc.code}: {body}") from exc
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            raise Offline(str(exc)) from exc

    def config(self):
        return self._call("/intake/api/connector/")

    def report(self, body):
        return self._call("/intake/api/connector/report/", data=json.dumps(body).encode(),
                          headers={"Content-Type": "application/json"})

    def send(self, fields: dict, name: str, content: bytes):
        boundary = uuid.uuid4().hex
        parts = []
        for key, value in fields.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
        safe = name.replace('"', "'")
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{safe}"\r\n'
                     f"Content-Type: application/octet-stream\r\n\r\n".encode() + content + b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        return self._call("/intake/api/connector/file/", data=b"".join(parts),
                          headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})


def walk(root: Path, subfolders: bool):
    if not subfolders:
        for entry in os.scandir(root):
            if entry.is_file() and not temporary(entry.name):
                yield entry.name, Path(entry.path)
        return
    for directory, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in names:
            if not temporary(name):
                full = Path(directory) / name
                yield str(full.relative_to(root)).replace("\\", "/"), full


def scan_folder(spool: Spool, folder: dict, max_mb: int) -> dict:
    """Queue every new or changed file of one folder. Returns what to report to the portal."""
    root, target = Path(folder["path"]), f"folder:{folder['id']}"
    if not root.is_dir():
        return {"id": folder["id"], "ok": False, "message": f"This PC cannot open {root}."}
    first = not folder["import_existing"] and not spool.get(f"baseline:{folder['id']}")
    queued = waiting = 0
    try:
        for name, full in walk(root, folder["subfolders"]):
            try:
                stat = full.stat()
            except OSError:
                continue
            known = spool.seen(target, name)
            if known and known[0] == stat.st_size and abs(known[1] - stat.st_mtime) < 1:
                continue
            if first:  # "watch new files only": what is there now is left alone
                spool.mark(target, name, stat.st_size, stat.st_mtime, "")
                continue
            if time.time() - stat.st_mtime < STABLE_SECONDS or stat.st_size > max_mb * 1024 * 1024:
                waiting += stat.st_size <= max_mb * 1024 * 1024
                continue
            try:
                sha = sha256_of(full)
            except OSError:
                waiting += 1
                continue
            if not known or known[2] != sha:
                spool.queue("cv", folder["id"], full, name, sha, stat.st_mtime)
                queued += 1
            spool.mark(target, name, stat.st_size, stat.st_mtime, sha)
        spool.db.commit()
    except OSError as exc:
        return {"id": folder["id"], "ok": False, "message": f"This PC could not list the folder: {exc}"}
    if first:
        spool.put(f"baseline:{folder['id']}", True)
    return {"id": folder["id"], "ok": True, "complete": waiting == 0, "baseline_done": True,
            "message": f"{waiting} file(s) still being copied." if waiting else "", "queued": queued}


def current_workbook(book: dict) -> Path | None:
    path = Path(book["path"])
    if not book.get("pattern"):
        return path if path.is_file() else None
    best = None
    try:
        for entry in os.scandir(path):
            if entry.is_file() and not temporary(entry.name) and fnmatch.fnmatch(entry.name.lower(),
                                                                                  book["pattern"].lower()):
                if best is None or entry.stat().st_mtime > best.stat().st_mtime:
                    best = Path(entry.path)
    except OSError:
        return None
    return best


def poll_workbook(spool: Spool, book: dict) -> dict:
    path = current_workbook(book)
    if path is None:
        return {"id": book["id"], "ok": False, "message": "This PC cannot find the workbook."}
    target = f"workbook:{book['id']}"
    stat = path.stat()
    known = spool.seen(target, str(path))
    if known and known[0] == stat.st_size and abs(known[1] - stat.st_mtime) < 0.001:
        return {"id": book["id"], "ok": True}
    try:
        content = path.read_bytes()
    except OSError:
        return {"id": book["id"], "ok": True}  # open and locked for a moment: next look
    if not complete_xlsx(content):
        return {"id": book["id"], "ok": True}
    sha = hashlib.sha256(content).hexdigest()
    if sha != (known[2] if known else "") and sha != book.get("fingerprint"):
        copy = spool.folder / "outbox" / f"{book['id']}-{sha[:16]}.xlsx"
        copy.write_bytes(content)  # this save, as it was: a later save does not change what is sent
        spool.queue("workbook", book["id"], path, str(path), sha, stat.st_mtime, str(copy))
    spool.mark(target, str(path), stat.st_size, stat.st_mtime, sha)
    spool.db.commit()
    return {"id": book["id"], "ok": True}


def send_pending(spool: Spool, portal: Portal, log) -> int:
    sent = 0
    for item_id, kind, target, path, source_path, sha, mtime, copy, attempts in spool.pending():
        source = Path(copy or path)
        try:
            content = source.read_bytes()
        except OSError:
            if not source.exists():
                spool.done(item_id, copy)  # removed from the folder before it could be sent
            continue
        if not copy and hashlib.sha256(content).hexdigest() != sha:
            sha = hashlib.sha256(content).hexdigest()  # changed since it was seen: send it as it is now
        fields = {"kind": kind, "source_path": source_path, "sha256": sha, "modified": mtime,
                  ("workbook" if kind == "workbook" else "folder"): target}
        try:
            answer = portal.send(fields, Path(source_path).name, content)
        except ValueError as exc:  # refused for this file (too large, unknown folder): not tried for ever
            spool.failed(item_id, str(exc))
            if attempts + 1 >= 5:
                log(f"Gave up on {source_path}: {exc}")
                spool.done(item_id, copy)
            continue
        spool.done(item_id, copy)
        sent += 1
        log(f"Sent {source_path}{'' if answer.get('new', True) else ' (already received)'}")
    return sent


def setup(path: Path) -> dict:
    print("First run: the portal's address and this PC's key (from the portal: CV intake > Add a PC).")
    url = input("Portal address (e.g. https://recruitment.iefcl.example): ").strip()
    token = input("Key: ").strip()
    settings = {"url": url, "token": token}
    path.write_text(json.dumps(settings, indent=2))
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return settings


def main():
    parser = argparse.ArgumentParser(description="Send files from folders on this PC to the recruitment portal.")
    parser.add_argument("--once", action="store_true", help="One look and one send, then stop.")
    parser.add_argument("--setup", action="store_true", help="Enter the portal's address and key again.")
    parser.add_argument("--data", help="Where to keep the settings and the queue.")
    args = parser.parse_args()
    folder = Path(args.data) if args.data else data_dir()
    folder.mkdir(parents=True, exist_ok=True)
    settings_path = folder / "settings.json"
    settings = setup(settings_path) if args.setup or not settings_path.exists() else json.loads(settings_path.read_text())
    portal, spool = Portal(settings["url"], settings["token"]), Spool(folder)

    def log(message):
        print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)

    config = spool.get("config", {"folders": [], "workbooks": [], "max_mb": 10})
    next_config = next_scan = 0.0
    delay, online = 1.0, None
    log(f"Connector running from {folder}. Ctrl+C stops it; files found meanwhile are sent next time.")
    while True:
        try:
            now = time.monotonic()
            if now >= next_config:
                config = portal.config()
                spool.put("config", config)
                next_config = now + 30
            books = [poll_workbook(spool, b) for b in config.get("workbooks", [])]
            folders = []
            if now >= next_scan:
                folders = [scan_folder(spool, f, config.get("max_mb", 10)) for f in config.get("folders", [])]
                next_scan = now + 10
            send_pending(spool, portal, log)
            if folders or any(not b["ok"] for b in books):
                portal.report({"folders": folders, "workbooks": books})
            if online is not True:
                log("Connected to the portal." if online is None else "Back online: catching up.")
            online, delay = True, 1.0
            if args.once:
                return
            time.sleep(0.5)
        except Offline as exc:
            if online is not False:
                log(f"The portal cannot be reached ({exc}). Files found meanwhile wait here and are sent later.")
            online = False
            # Keep noticing new files while offline, so nothing is missed.
            for f in config.get("folders", []):
                scan_folder(spool, f, config.get("max_mb", 10))
            for b in config.get("workbooks", []):
                poll_workbook(spool, b)
            if args.once:
                sys.exit(1)
            time.sleep(delay)
            delay = min(60.0, delay * 2)
        except KeyboardInterrupt:
            log("Stopped.")
            return


if __name__ == "__main__":
    main()
