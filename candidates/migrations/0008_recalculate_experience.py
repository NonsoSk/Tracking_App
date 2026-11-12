from django.db import migrations


def recalculate_unchecked(apps, schema_editor):
    """Years of experience again from the job dates, for profiles read from a CV that HR has not checked yet (and
    not loaded from Excel). Their applications are scored again."""
    from candidates.experience import recalculable, recalculate
    from pipeline.matching import score_application

    Candidate = apps.get_model("candidates", "Candidate")
    Application = apps.get_model("pipeline", "Application")
    for candidate in recalculable(Candidate.objects.all()):
        result = recalculate(candidate)
        if result and (result[0] is None or float(result[0]) != float(result[1])):
            for application in Application.objects.filter(candidate_id=candidate.pk, matched_at__isnull=False) \
                    .select_related("candidate", "requisition"):
                score_application(application)


class Migration(migrations.Migration):
    dependencies = [
        ("candidates", "0007_profile_check"),
        ("pipeline", "0008_eligibility_decision"),
    ]

    operations = [migrations.RunPython(recalculate_unchecked, migrations.RunPython.noop)]
