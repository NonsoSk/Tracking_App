from django.db import migrations


def rescore_strictly(apps, schema_editor):
    """Score every application that was scored before again, with the strict (ATS-style) matching."""
    from pipeline.matching import score_application

    Application = apps.get_model("pipeline", "Application")
    for application in Application.objects.exclude(matched_at=None).select_related("candidate", "requisition"):
        score_application(application)


class Migration(migrations.Migration):
    dependencies = [
        ("pipeline", "0005_hired_on_join_date"),
        ("candidates", "0006_excel_dates"),
        ("requisitions", "0004_requisition_summary_frequency_and_more"),
    ]

    operations = [migrations.RunPython(rescore_strictly, migrations.RunPython.noop)]
