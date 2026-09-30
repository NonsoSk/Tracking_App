"""Selection-report criteria (from the HR & A paper form) and the document checklist."""

from django.db import migrations

CRITERIA = [
    ("Job Knowledge", 15),
    ("Technical Competencies", 15),
    ("Communication Skills", 10),
    ("Team Work", 10),
    ("Analytical Skill", 10),
    ("Cost Consciousness", 10),
    ("Quality Focus", 10),
    ("HSE Consciousness", 10),
    ("Values & Attitude", 10),
]

DOCUMENTS = [
    # (doc_type, applies_to, mandatory, note)
    ("degree", "", True, "Degree / HND / OND certificate or statement of result"),
    ("ssce", "", True, "WAEC / NECO result"),
    ("nysc", "", True, "NYSC discharge certificate or exemption letter"),
    ("id", "", True, "NIN slip, international passport or driver's licence"),
    ("birth", "", True, "Birth certificate or sworn age declaration"),
    ("lga", "", False, "Local government / state of origin identification"),
    ("transcript", "trainee", False, "Academic transcript"),
    ("reference", "experienced", True, "Two reference / guarantor letters"),
    ("professional", "experienced", False, "Professional certificates listed on your CV"),
]


def seed(apps, schema_editor):
    Criterion = apps.get_model("pipeline", "EvaluationCriterion")
    Requirement = apps.get_model("pipeline", "DocumentRequirement")
    if not Criterion.objects.exists():
        for order, (name, marks) in enumerate(CRITERIA, start=1):
            Criterion.objects.create(name=name, max_marks=marks, order=order)
    if not Requirement.objects.exists():
        for doc_type, applies_to, mandatory, note in DOCUMENTS:
            Requirement.objects.create(doc_type=doc_type, applies_to=applies_to, is_mandatory=mandatory, note=note)


class Migration(migrations.Migration):
    dependencies = [("pipeline", "0001_initial")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
