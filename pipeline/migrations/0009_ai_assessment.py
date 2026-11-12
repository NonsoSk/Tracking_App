from django.db import migrations, models


def rescore(apps, schema_editor):
    """Score every scored application again: each requirement in the job description is now judged against the
    candidate's jobs (pipeline/criteria.py), and the main experience the JD asks for caps the score when it is missing."""
    from pipeline.matching import score_application

    Application = apps.get_model("pipeline", "Application")
    for application in Application.objects.exclude(matched_at=None).select_related("candidate", "requisition"):
        score_application(application)


class Migration(migrations.Migration):
    dependencies = [
        ("pipeline", "0008_eligibility_decision"),
        ("candidates", "0008_recalculate_experience"),
    ]

    operations = [
        migrations.AddField(
            model_name="application",
            name="ai_assessment",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.RunPython(rescore, migrations.RunPython.noop),
    ]
