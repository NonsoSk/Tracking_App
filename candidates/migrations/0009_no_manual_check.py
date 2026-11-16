from django.db import migrations, models
from django.utils import timezone


def release_and_fingerprint(apps, schema_editor):
    """CVs are no longer checked by hand before they can be matched: the profiles that were waiting are released,
    and those uploaded for a vacancy that is still open are applied to it now and scored. Every CV on file also gets
    its fingerprint, so the same CV is not added a second time."""
    from candidates.cv_filter import text_key
    from pipeline.matching import score_application

    Candidate = apps.get_model("candidates", "Candidate")
    Application = apps.get_model("pipeline", "Application")
    for candidate in Candidate.objects.exclude(cv_text="").only("pk", "cv_text").iterator():
        key = text_key(candidate.cv_text)
        if key:
            Candidate.objects.filter(pk=candidate.pk).update(cv_digest=key)
    waiting = Candidate.objects.filter(needs_check=True, pending_requisition__isnull=False)
    for candidate in waiting.select_related("pending_requisition"):
        vacancy = candidate.pending_requisition
        if vacancy.status not in {"open", "approved"}:
            continue
        if Application.objects.filter(candidate_id=candidate.pk, requisition_id=vacancy.pk).exists():
            continue
        application = Application.objects.create(candidate=candidate, requisition=vacancy, source=candidate.source)
        application.reference = f"APP-{timezone.now():%Y}-{application.pk:05d}"
        application.save(update_fields=["reference"])
        score_application(application)
    Candidate.objects.filter(needs_check=True).update(needs_check=False)


class Migration(migrations.Migration):
    dependencies = [
        ("candidates", "0008_recalculate_experience"),
        ("pipeline", "0009_ai_assessment"),
    ]

    operations = [
        migrations.AddField(
            model_name="candidate", name="cv_digest",
            field=models.CharField(blank=True, db_index=True, max_length=40),
        ),
        migrations.RunPython(release_and_fingerprint, migrations.RunPython.noop),
    ]
