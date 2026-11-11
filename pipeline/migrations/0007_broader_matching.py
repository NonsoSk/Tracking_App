from django.db import migrations


def rescore(apps, schema_editor):
    """Score every application that was scored before again: broader term matching (synonyms, what a broader term
    covers, similar wording), related courses, unstated details to confirm, and fit with the job."""
    from pipeline.matching import score_application

    Application = apps.get_model("pipeline", "Application")
    for application in Application.objects.exclude(matched_at=None).select_related("candidate", "requisition"):
        score_application(application)


class Migration(migrations.Migration):
    dependencies = [
        ("pipeline", "0006_strict_matching"),
        ("candidates", "0007_profile_check"),
    ]

    operations = [migrations.RunPython(rescore, migrations.RunPython.noop)]
