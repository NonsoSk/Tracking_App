from django.db import migrations


class Migration(migrations.Migration):
    """The check-before-matching step is gone (0009 released the profiles that were waiting)."""

    dependencies = [("candidates", "0009_no_manual_check")]

    operations = [
        migrations.RemoveField(model_name="candidate", name="needs_check"),
        migrations.RemoveField(model_name="candidate", name="pending_requisition"),
    ]
