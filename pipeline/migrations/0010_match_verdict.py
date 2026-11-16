from django.db import migrations


def rescore(apps, schema_editor):
    """Score every scored application again: each now carries its verdict (a match or not: the requirements, then
    the role, then the score) and the note on why."""
    from pipeline.matching import score_application

    Application = apps.get_model("pipeline", "Application")
    for application in Application.objects.exclude(matched_at=None).select_related("candidate", "requisition"):
        score_application(application)


class Migration(migrations.Migration):
    dependencies = [
        ("pipeline", "0009_ai_assessment"),
        ("candidates", "0010_remove_check_fields"),
    ]

    operations = [migrations.RunPython(rescore, migrations.RunPython.noop)]
