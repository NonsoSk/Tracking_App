from django.apps import AppConfig


class IntakeConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "intake"
    verbose_name = "Intake and background work"

    def ready(self):
        from . import live  # noqa: F401 - connects the signals that tell open screens something changed
        from .db import tune_sqlite

        tune_sqlite()
