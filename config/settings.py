"""
Django settings for the IEFCL Recruitment Portal.

Every deployment-specific value is read from environment variables (or a
local ``.env`` file). See ``.env.example`` for the full list.
"""

import os
import sys
import tempfile
import warnings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader so the project has no extra dependency for it."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():  # -sig: Notepad may add a byte-order mark
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


_load_dotenv(BASE_DIR / ".env")


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


def env_bool(key: str, default: bool = False) -> bool:
    value = os.environ.get(key)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, default))
    except (TypeError, ValueError):
        return default


def env_list(key: str, default: str = "") -> list[str]:
    return [item.strip() for item in env(key, default).split(",") if item.strip()]


# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------
DEBUG = env_bool("DJANGO_DEBUG", True)
SECRET_KEY = env("DJANGO_SECRET_KEY", "dev-only-insecure-key-change-me")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,0.0.0.0")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.humanize",
    "accounts",
    "core",
    "requisitions",
    "candidates",
    "pipeline",
    "careers",
    "intake",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "core.context_processors.portal",
                "intake.context_processors.live",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# ---------------------------------------------------------------------------
# Database: SQLite by default, PostgreSQL when POSTGRES_DB is set.
# ---------------------------------------------------------------------------
if env("POSTGRES_DB"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": env("POSTGRES_DB"),
            "USER": env("POSTGRES_USER", "postgres"),
            "PASSWORD": env("POSTGRES_PASSWORD"),
            "HOST": env("POSTGRES_HOST", "localhost"),
            "PORT": env("POSTGRES_PORT", "5432"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / env("SQLITE_PATH", "db.sqlite3"),
            # Pages wait for an Excel refresh to finish writing instead of failing with "database is locked". The
            # web app and the worker share the file; intake/db.py turns on write-ahead logging so pages keep reading
            # while the worker writes.
            # IMMEDIATE: a transaction takes the write lock when it starts, so a writer waits its turn instead of
            # failing half-way when another process wrote in between.
            "OPTIONS": {"timeout": 60, "transaction_mode": "IMMEDIATE"},
            # Tests use a database file too (not memory), so the worker's threads can be tested as they run.
            "TEST": {"NAME": env("SQLITE_TEST_PATH", "") or str(Path(tempfile.gettempdir()) / "iefcl-portal-tests.sqlite3")},
        }
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.User"
LOGIN_URL = "accounts:login"
LOGIN_REDIRECT_URL = "core:summary"
LOGOUT_REDIRECT_URL = "accounts:login"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-gb"
TIME_ZONE = env("TIME_ZONE", "Africa/Lagos")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": (
            "django.contrib.staticfiles.storage.StaticFilesStorage"
            if DEBUG
            else "whitenoise.storage.CompressedManifestStaticFilesStorage"
        )
    },
}

# WhiteNoise warns when collectstatic has not run yet (normal in development).
warnings.filterwarnings("ignore", message="No directory at")

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / env("MEDIA_DIR", "media")
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024
MAX_UPLOAD_MB = env_int("MAX_UPLOAD_MB", 10)

if not DEBUG:
    SESSION_COOKIE_SECURE = env_bool("SECURE_COOKIES", True)
    CSRF_COOKIE_SECURE = env_bool("SECURE_COOKIES", True)
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    # Behind the pilot's HTTPS proxy: browsers are told to come back over HTTPS only (start with an hour).
    SECURE_HSTS_SECONDS = env_int("SECURE_HSTS_SECONDS", 0)
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = "DENY"
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_AGE = env_int("SESSION_COOKIE_AGE", 12 * 3600)
    if SECRET_KEY in {"dev-only-insecure-key-change-me", "change-me-to-a-long-random-string"} \
            and "test" not in sys.argv and "collectstatic" not in sys.argv:
        raise RuntimeError("Set DJANGO_SECRET_KEY to a long random value when DJANGO_DEBUG is false.")

# ---------------------------------------------------------------------------
# Email (console by default so nothing is sent while testing)
# ---------------------------------------------------------------------------
EMAIL_BACKEND = env("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", "localhost")
EMAIL_PORT = env_int("EMAIL_PORT", 587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", "IEFCL Recruitment <recruitment@example.com>")

# Mailbox the fetch_cv_emails command reads CVs from (optional).
CV_INBOX = {
    "HOST": env("CV_INBOX_HOST"),
    "PORT": env_int("CV_INBOX_PORT", 993),
    "USER": env("CV_INBOX_USER"),
    "PASSWORD": env("CV_INBOX_PASSWORD"),
    "FOLDER": env("CV_INBOX_FOLDER", "INBOX"),
    "USE_SSL": env_bool("CV_INBOX_USE_SSL", True),
}

# ---------------------------------------------------------------------------
# Branding
# ---------------------------------------------------------------------------
COMPANY_NAME = env("COMPANY_NAME", "Indorama Eleme Fertilizer & Chemicals Ltd.")
COMPANY_SHORT_NAME = env("COMPANY_SHORT_NAME", "IEFCL")
PORTAL_NAME = env("PORTAL_NAME", "Recruitment Portal")
COMPANY_LOCATION = env("COMPANY_LOCATION", "Eleme, Rivers State, Nigeria")
# Absolute base URL used to build links inside emails.
SITE_URL = env("SITE_URL", "http://localhost:8000").rstrip("/")

# ---------------------------------------------------------------------------
# AI (Claude). Everything works without a key; AI improves CV extraction,
# scanned-CV reading and skill suggestions when a key is configured.
# ---------------------------------------------------------------------------
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY")
# Candidates' CVs are sent to the AI provider (reading scans, the AI check against the JD, fit summaries) only when the
# company has authorised the provider and the use of the data. An API key alone does not.
AI_CV_PROCESSING_AUTHORISED = env_bool("AI_CV_PROCESSING_AUTHORISED", False)
ANTHROPIC_MODEL = env("ANTHROPIC_MODEL", "claude-opus-5-5")
AI_ENABLED = env_bool("AI_ENABLED", True)
# Server-side refusal fallback (Claude API only). Disable if you route
# requests through a platform that does not support it.
AI_SERVER_FALLBACK = env_bool("AI_SERVER_FALLBACK", True)

# Optional OCR for scanned CVs when AI is not configured.
TESSERACT_CMD = env("TESSERACT_CMD")

# LibreOffice, when it is not in the usual place, for turning Word resumes into PDF (Microsoft Word is used first).
LIBREOFFICE_PATH = env("LIBREOFFICE_PATH", "")

# Minutes between checks of the linked Excel workbooks (python manage.py sync_workbooks --watch).
EXCEL_SYNC_MINUTES = env_int("EXCEL_SYNC_MINUTES", 5)
# Years of experience are worked out from the job dates in a CV (candidates/experience.py). NYSC counts as work.
EXPERIENCE_COUNTS_NYSC = env_bool("EXPERIENCE_COUNTS_NYSC", True)
# With AI on, Claude also reads each open application's CV against the job description and judges every requirement
# (pipeline/ai_assess.py). Set to false to keep AI for CV reading only.
AI_MATCH_ASSESSMENT = env_bool("AI_MATCH_ASSESSMENT", True)
# ---------------------------------------------------------------------------
# The background worker (python manage.py run_worker; start-portal.bat and the pilot's "worker" service run it)
# ---------------------------------------------------------------------------
# How often it looks at the linked workbooks (seconds). A save is picked up once the file stops changing for
# WORKBOOK_STABLE_SECONDS, so Excel's save-to-temporary-file-then-rename is never read half-written.
WORKBOOK_POLL_SECONDS = float(env("WORKBOOK_POLL_SECONDS", "0.25"))
WORKBOOK_STABLE_SECONDS = float(env("WORKBOOK_STABLE_SECONDS", "0.3"))
# A full comparison of every linked workbook (content hash), to recover saves a network share did not report.
WORKBOOK_RECHECK_SECONDS = env_int("WORKBOOK_RECHECK_SECONDS", 60)
# CV folders: changes are noticed at once where the system reports them (local disks); every CV_FOLDER_SECONDS the
# whole folder is compared as well (network shares, missed events). A CV is read once it stops changing.
CV_FOLDER_SECONDS = env_int("CV_FOLDER_SECONDS", 30)
CV_STABLE_SECONDS = float(env("CV_STABLE_SECONDS", "1.0"))
# A worker or connector not heard from for this long is shown as offline.
WORKER_OFFLINE_SECONDS = env_int("WORKER_OFFLINE_SECONDS", 20)
CONNECTOR_OFFLINE_SECONDS = env_int("CONNECTOR_OFFLINE_SECONDS", 60)
WORKER_NAME = env("WORKER_NAME", "")
# Only one worker may read the live folders and workbooks. Set to false on a rehearsal or second instance.
PORTAL_INPUTS_ENABLED = env_bool("PORTAL_INPUTS_ENABLED", True)
# Folders the "Link a folder" screen may browse (the paths the worker can read; on the pilot, the mounted shares).
# Empty: any path typed in is checked by the worker.
PORTAL_INPUT_ROOTS = env_list("PORTAL_INPUT_ROOTS")
# Open screens ask for changes this often (milliseconds) and refresh themselves after a committed change.
LIVE_POLL_MS = env_int("LIVE_POLL_MS", 700)
# Received files are kept privately (media/receipts). A CV that became a profile is filed with it, so its receipt copy
# is removed after this many days; files that failed, need review or could not be read keep theirs.
RECEIPT_KEEP_DAYS = env_int("RECEIPT_KEEP_DAYS", 30)
# Where "Portal updates.xlsx" is written (a folder or a full file path). Empty: beside the linked workbook that holds
# the requisition tracker.
PORTAL_UPDATES_PATH = env("PORTAL_UPDATES_PATH", "")

# ---------------------------------------------------------------------------
# Recruitment rules
# ---------------------------------------------------------------------------
RECRUITMENT = {
    # Retirement policy: whichever comes first.
    "RETIREMENT_AGE": env_int("RETIREMENT_AGE", 60),
    "RETIREMENT_MAX_SERVICE_YEARS": env_int("RETIREMENT_MAX_SERVICE_YEARS", 35),
    "RETIREMENT_ALERT_MONTHS": env_int("RETIREMENT_ALERT_MONTHS", 12),
    # Requisitions need a management sign-off after HR review.
    "REQUISITION_NEEDS_MANAGEMENT_APPROVAL": env_bool("REQUISITION_NEEDS_MANAGEMENT_APPROVAL", False),
    # Score (0-100) at or above which "Auto-shortlist" picks a candidate.
    "AUTO_SHORTLIST_THRESHOLD": env_int("AUTO_SHORTLIST_THRESHOLD", 70),
    # Matching: the share of the required skills below which "Required skills" shows as a key requirement not met
    # (for the hiring manager to judge; it never sets the score to 0).
    "MATCH_MIN_REQUIRED_SKILLS_PERCENT": env_int("MATCH_MIN_REQUIRED_SKILLS_PERCENT", 50),
    # A candidate is called a match only when every requirement is met, the CV shows the work the job description
    # asks for, and the score is at least this (70 = a strong match; 85 keeps only excellent ones).
    "MATCH_MIN_SCORE": env_int("MATCH_MIN_SCORE", 70),
    # Treat HND as equal to a Bachelor's degree when matching.
    "HND_EQUIVALENT_TO_BSC": env_bool("HND_EQUIVALENT_TO_BSC", False),
    # Trainees go straight from document review to onboarding unless enabled.
    "TRAINEE_REQUIRES_MEDICALS": env_bool("TRAINEE_REQUIRES_MEDICALS", False),
    # Days a candidate has to respond to an offer.
    "OFFER_VALIDITY_DAYS": env_int("OFFER_VALIDITY_DAYS", 7),
    # Base URL for auto-generated video meeting rooms when HR does not paste
    # a Teams/Zoom link. Jitsi rooms need no account or API key.
    "MEETING_ROOM_BASE_URL": env("MEETING_ROOM_BASE_URL", "https://meet.jit.si"),
    # Automatic candidate summaries to departments go out from this hour (local time).
    "SUMMARY_EMAIL_HOUR": env_int("SUMMARY_EMAIL_HOUR", 8),
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
    "loggers": {"django": {"handlers": ["console"], "level": "WARNING", "propagate": False}},
}


# ---------------------------------------------------------------------------
# Rehearsal: a restored copy used to try an upgrade or train staff. It never e-mails anyone, never calls the AI
# provider and never reads the live folders or workbooks.
# ---------------------------------------------------------------------------
PORTAL_REHEARSAL = env_bool("PORTAL_REHEARSAL", False)
if PORTAL_REHEARSAL:
    EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    AI_ENABLED = False
    AI_CV_PROCESSING_AUTHORISED = False
    PORTAL_INPUTS_ENABLED = False
