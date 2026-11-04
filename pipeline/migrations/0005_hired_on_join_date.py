from datetime import datetime, time

from django.db import migrations
from django.utils import timezone


def hired_on_join_date(apps, schema_editor):
    """Applications loaded from Excel were hired on the Join Date in the interview records, and on no other date."""
    Application = apps.get_model("pipeline", "Application")
    InterviewRecord = apps.get_model("pipeline", "InterviewRecord")
    changed = []
    for app in Application.objects.filter(source="import", status="hired"):
        joined = (InterviewRecord.objects.filter(application_id=app.pk).exclude(join_date=None)
                  .order_by("-interview_date", "-join_date").values_list("join_date", flat=True).first())
        value = timezone.make_aware(datetime.combine(joined, time(9, 0))) if joined else None
        if app.hired_at != value:
            app.hired_at = value
            changed.append(app)
    Application.objects.bulk_update(changed, ["hired_at"], batch_size=500)


class Migration(migrations.Migration):
    dependencies = [("pipeline", "0004_application_department_review_and_more")]

    operations = [migrations.RunPython(hired_on_join_date, migrations.RunPython.noop)]
