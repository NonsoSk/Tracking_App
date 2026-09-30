"""
Django settings for the IEFCL Recruitment Portal.

Every deployment-specific value is read from environment variables (or a
local ``.env`` file). See ``.env.example`` for the full list.
"""

import os
import warnings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader so the project has no extra dependency for it."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
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
        }
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.User"
LOGIN_URL = "accounts:login"
LOGIN_REDIRECT_URL = "core:dashboard"
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
ANTHROPIC_MODEL = env("ANTHROPIC_MODEL", "claude-opus-5-5")
AI_ENABLED = env_bool("AI_ENABLED", True)
# Server-side refusal fallback (Claude API only). Disable if you route
# requests through a platform that does not support it.
AI_SERVER_FALLBACK = env_bool("AI_SERVER_FALLBACK", True)

# Optional OCR for scanned CVs when AI is not configured.
TESSERACT_CMD = env("TESSERACT_CMD")

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
    # Treat HND as equal to a Bachelor's degree when matching.
    "HND_EQUIVALENT_TO_BSC": env_bool("HND_EQUIVALENT_TO_BSC", False),
    # Trainees go straight from document review to onboarding unless enabled.
    "TRAINEE_REQUIRES_MEDICALS": env_bool("TRAINEE_REQUIRES_MEDICALS", False),
    # Days a candidate has to respond to an offer.
    "OFFER_VALIDITY_DAYS": env_int("OFFER_VALIDITY_DAYS", 7),
    # Base URL for auto-generated video meeting rooms when HR does not paste
    # a Teams/Zoom link. Jitsi rooms need no account or API key.
    "MEETING_ROOM_BASE_URL": env("MEETING_ROOM_BASE_URL", "https://meet.jit.si"),
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
    "loggers": {"django": {"handlers": ["console"], "level": "WARNING", "propagate": False}},
}
