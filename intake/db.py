"""SQLite settings for a web app and a worker sharing one database file.

Write-ahead logging lets pages keep reading while the worker writes an import, and a busy timeout makes a writer wait
for the other instead of failing. PostgreSQL (the pilot) needs neither.
"""

from django.db.backends.signals import connection_created


def _tune(sender, connection, **kwargs):
    if connection.vendor != "sqlite":
        return
    with connection.cursor() as cursor:
        cursor.execute("PRAGMA busy_timeout = 60000")
        name = str(connection.settings_dict.get("NAME") or "")
        if name and "memory" not in name and not name.startswith("file:"):
            cursor.execute("PRAGMA journal_mode = WAL")
            cursor.execute("PRAGMA synchronous = NORMAL")


def tune_sqlite():
    connection_created.connect(_tune, dispatch_uid="intake-sqlite-tuning")
