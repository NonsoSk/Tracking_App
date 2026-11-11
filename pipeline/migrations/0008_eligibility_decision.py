from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def rescore(apps, schema_editor):
    """Score every scored application again: missing a key requirement no longer zeroes the score (grade X); the
    hiring manager decides instead."""
    from pipeline.matching import score_application

    Application = apps.get_model("pipeline", "Application")
    for application in Application.objects.exclude(matched_at=None).select_related("candidate", "requisition"):
        score_application(application)


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("pipeline", "0007_broader_matching"),
    ]

    operations = [
        migrations.AddField(
            model_name="application", name="eligibility",
            field=models.CharField(blank=True, choices=[("kept", "Kept in the running"), ("not_eligible", "Not eligible")],
                                   max_length=20),
        ),
        migrations.AddField(
            model_name="application", name="eligibility_at", field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="application", name="eligibility_by",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                    related_name="+", to=settings.AUTH_USER_MODEL),
        ),
        migrations.RunPython(rescore, migrations.RunPython.noop),
    ]
