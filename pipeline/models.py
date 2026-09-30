import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.urls import reverse
from django.utils import timezone

from candidates.models import CandidateDocument
from core.choices import EmploymentType


class Stage(models.TextChoices):
    APPLIED = "applied", "Applied"
    SHORTLISTED = "shortlisted", "Shortlisted"
    INTERVIEW = "interview", "Interviews"
    DECISION = "decision", "Evaluation & decision"
    DOCUMENTS = "documents", "Document review"
    OFFER = "offer", "Offer"
    MEDICAL = "medical", "Medicals"
    ONBOARDING = "onboarding", "Onboarding"
    HIRED = "hired", "Hired"


STAGE_ORDER = [s.value for s in Stage]

STAGE_ICONS = {
    "applied": "bi-inbox",
    "shortlisted": "bi-star",
    "interview": "bi-people",
    "decision": "bi-clipboard-check",
    "documents": "bi-folder-check",
    "offer": "bi-envelope-paper",
    "medical": "bi-heart-pulse",
    "onboarding": "bi-person-badge",
    "hired": "bi-trophy",
}


class Application(models.Model):
    """A candidate's application for one requisition, tracked stage by stage."""

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        ON_HOLD = "on_hold", "On hold"
        REJECTED = "rejected", "Rejected"
        WITHDRAWN = "withdrawn", "Withdrawn"
        HIRED = "hired", "Hired"

    class Decision(models.TextChoices):
        SELECT = "select", "Select"
        ON_HOLD = "on_hold", "On hold"
        REJECT = "reject", "Reject"

    reference = models.CharField(max_length=24, unique=True, blank=True)
    candidate = models.ForeignKey("candidates.Candidate", on_delete=models.CASCADE, related_name="applications")
    requisition = models.ForeignKey("requisitions.Requisition", on_delete=models.CASCADE, related_name="applications")
    source = models.CharField(max_length=20, blank=True)
    stage = models.CharField(max_length=20, choices=Stage.choices, default=Stage.APPLIED, db_index=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE, db_index=True)

    match_score = models.DecimalField(max_digits=5, decimal_places=1, default=Decimal("0"))
    match_grade = models.CharField(max_length=2, blank=True)
    match_breakdown = models.JSONField(default=dict, blank=True)
    matched_at = models.DateTimeField(null=True, blank=True)
    ai_summary = models.TextField(blank=True)

    decision = models.CharField(max_length=10, choices=Decision.choices, blank=True)
    decision_notes = models.TextField(blank=True)
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    status_reason = models.CharField(max_length=255, blank=True)

    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    applied_at = models.DateTimeField(default=timezone.now)
    stage_changed_at = models.DateTimeField(default=timezone.now)
    hired_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-match_score", "applied_at"]
        unique_together = [("candidate", "requisition")]

    def __str__(self):
        return f"{self.reference} · {self.candidate} → {self.requisition.title}"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if not self.reference:
            self.reference = f"APP-{timezone.now():%Y}-{self.pk:05d}"
            super().save(update_fields=["reference"])

    def get_absolute_url(self):
        return reverse("pipeline:application", args=[self.pk])

    def get_portal_url(self):
        return f"{settings.SITE_URL}{reverse('careers:hub', args=[self.token])}"

    # --- workflow helpers -------------------------------------------------
    @property
    def is_trainee_track(self) -> bool:
        return self.requisition.is_trainee_track

    def pipeline_stages(self) -> list[str]:
        """Stages this application passes through (trainees skip the offer)."""
        stages = list(STAGE_ORDER)
        if self.is_trainee_track:
            stages.remove(Stage.OFFER)
            if not settings.RECRUITMENT["TRAINEE_REQUIRES_MEDICALS"]:
                stages.remove(Stage.MEDICAL)
        return stages

    def next_stage(self):
        stages = self.pipeline_stages()
        try:
            idx = stages.index(self.stage)
        except ValueError:
            return None
        return stages[idx + 1] if idx + 1 < len(stages) else None

    def stage_index(self) -> int:
        stages = self.pipeline_stages()
        return stages.index(self.stage) if self.stage in stages else 0

    @property
    def is_open(self) -> bool:
        return self.status in {self.Status.ACTIVE, self.Status.ON_HOLD}

    @property
    def grade_color(self) -> str:
        return {"A": "success", "B": "primary", "C": "warning", "D": "danger"}.get(self.match_grade, "secondary")

    @property
    def status_color(self) -> str:
        return {
            "active": "primary",
            "on_hold": "warning",
            "rejected": "danger",
            "withdrawn": "secondary",
            "hired": "success",
        }.get(self.status, "secondary")

    @property
    def stage_icon(self) -> str:
        return STAGE_ICONS.get(self.stage, "bi-circle")

    def evaluation_summary(self):
        """Average of submitted panel evaluations, criterion by criterion."""
        evaluations = [e for e in self.evaluations.all() if e.submitted_at]
        if not evaluations:
            return None
        criteria = list(EvaluationCriterion.objects.filter(is_active=True))
        rows = []
        total = Decimal("0")
        max_total = Decimal("0")
        for criterion in criteria:
            marks = [
                s.marks for e in evaluations for s in e.scores.all() if s.criterion_id == criterion.id
            ]
            avg = (sum(marks) / len(marks)) if marks else Decimal("0")
            avg = Decimal(avg).quantize(Decimal("0.1"))
            total += avg
            max_total += criterion.max_marks
            rows.append({"criterion": criterion, "average": avg, "rating": rating_for(avg, criterion.max_marks)})
        pct = (total / max_total * 100) if max_total else Decimal("0")
        recommendations = {}
        for e in evaluations:
            recommendations[e.recommendation] = recommendations.get(e.recommendation, 0) + 1
        signatories = []
        for e in evaluations:
            if e.evaluator not in [s.evaluator for s in signatories]:
                signatories.append(e)
        return {
            "rows": rows,
            "signatories": signatories,
            "total": total.quantize(Decimal("0.1")),
            "max_total": max_total,
            "percentage": Decimal(pct).quantize(Decimal("0.1")),
            "rating": rating_for(total, max_total),
            "count": len(evaluations),
            "evaluations": evaluations,
            "recommendations": recommendations,
        }


class Activity(models.Model):
    """Timeline entry shown on requisitions, candidates and applications."""

    application = models.ForeignKey(Application, null=True, blank=True, on_delete=models.CASCADE, related_name="activities")
    requisition = models.ForeignKey("requisitions.Requisition", null=True, blank=True, on_delete=models.CASCADE, related_name="activities")
    candidate = models.ForeignKey("candidates.Candidate", null=True, blank=True, on_delete=models.CASCADE, related_name="activities")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    verb = models.CharField(max_length=40)
    message = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "activities"

    def __str__(self):
        return self.message


# ---------------------------------------------------------------------------
# Interviews
# ---------------------------------------------------------------------------
class Interview(models.Model):
    class Round(models.TextChoices):
        TECHNICAL = "technical", "Phase 1 — Technical / practical"
        BEHAVIOURAL = "behavioural", "Phase 2 — Behavioural / general"
        HOD = "hod", "Phase 3 — HOD interview"

    class Mode(models.TextChoices):
        IN_PERSON = "in_person", "In person"
        VIDEO = "video", "Video call"
        PHONE = "phone", "Phone call"

    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
        NO_SHOW = "no_show", "Candidate did not attend"

    application = models.ForeignKey(Application, on_delete=models.CASCADE, related_name="interviews")
    round = models.CharField(max_length=20, choices=Round.choices, default=Round.TECHNICAL)
    scheduled_at = models.DateTimeField()
    duration_minutes = models.PositiveSmallIntegerField(default=45)
    mode = models.CharField(max_length=20, choices=Mode.choices, default=Mode.IN_PERSON)
    location = models.CharField(max_length=200, blank=True, help_text="Room / building for in-person interviews.")
    meeting_link = models.URLField(blank=True, help_text="Teams / Zoom / Meet link. Left empty, a video room is created.")
    panel = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name="interview_panels", blank=True)
    organizer = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    instructions = models.TextField(blank=True, help_text="Shown to the candidate, e.g. what to bring.")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SCHEDULED)
    candidate_response = models.CharField(
        max_length=20, blank=True,
        choices=[("confirmed", "Confirmed"), ("reschedule", "Asked to reschedule")],
    )
    candidate_note = models.CharField(max_length=500, blank=True)
    uid = models.UUIDField(default=uuid.uuid4, editable=False)
    sequence = models.PositiveIntegerField(default=0)
    invite_sent_at = models.DateTimeField(null=True, blank=True)
    reminder_sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["scheduled_at"]

    def __str__(self):
        return f"{self.get_round_display()} — {self.application.candidate} ({self.scheduled_at:%d %b %Y %H:%M})"

    @property
    def round_short(self) -> str:
        return {"technical": "Phase 1", "behavioural": "Phase 2", "hod": "Phase 3"}.get(self.round, self.round)

    @property
    def ends_at(self):
        return self.scheduled_at + timezone.timedelta(minutes=self.duration_minutes)

    @property
    def where(self) -> str:
        if self.mode == self.Mode.VIDEO:
            return self.meeting_link or "Video call"
        if self.mode == self.Mode.PHONE:
            return "Phone call"
        return self.location or settings.COMPANY_LOCATION

    @property
    def status_color(self) -> str:
        return {"scheduled": "primary", "completed": "success", "cancelled": "secondary", "no_show": "danger"}.get(
            self.status, "secondary"
        )


# ---------------------------------------------------------------------------
# Selection report (the paper "Selection Report" form, digitised)
# ---------------------------------------------------------------------------
RATING_BANDS = [
    # (upper bound in %, code, label)
    (30, "P", "Poor"),
    (50, "S", "Satisfactory"),
    (70, "G", "Good"),
    (90, "VG", "Very Good"),
    (100, "E", "Excellent"),
]


def rating_for(marks, max_marks):
    """Legend from the form: P 0-30%, S 31-50%, G 51-70%, VG 71-90%, E 91%+."""
    if not max_marks:
        return {"code": "", "label": "", "pct": 0}
    pct = float(marks) / float(max_marks) * 100
    for upper, code, label in RATING_BANDS:
        if pct <= upper:
            return {"code": code, "label": label, "pct": round(pct, 1)}
    return {"code": "E", "label": "Excellent", "pct": round(pct, 1)}


class EvaluationCriterion(models.Model):
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=255, blank=True)
    max_marks = models.PositiveSmallIntegerField()
    order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["order", "id"]
        verbose_name_plural = "evaluation criteria"

    def __str__(self):
        return f"{self.name} ({self.max_marks})"


class Evaluation(models.Model):
    """One panel member's scoring of a candidate."""

    class Recommendation(models.TextChoices):
        SELECT = "select", "Select"
        REJECT = "reject", "Reject"
        ON_HOLD = "on_hold", "On hold"

    application = models.ForeignKey(Application, on_delete=models.CASCADE, related_name="evaluations")
    interview = models.ForeignKey(Interview, null=True, blank=True, on_delete=models.SET_NULL, related_name="evaluations")
    evaluator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="evaluations")
    remarks = models.TextField(blank=True)
    recommendation = models.CharField(max_length=10, choices=Recommendation.choices, blank=True)
    total = models.DecimalField(max_digits=6, decimal_places=1, default=Decimal("0"))
    submitted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        unique_together = [("application", "evaluator", "interview")]

    def __str__(self):
        return f"Evaluation of {self.application.candidate} by {self.evaluator}"

    @property
    def max_total(self):
        return sum(s.criterion.max_marks for s in self.scores.all())

    @property
    def rating(self):
        return rating_for(self.total, self.max_total)


class EvaluationScore(models.Model):
    evaluation = models.ForeignKey(Evaluation, on_delete=models.CASCADE, related_name="scores")
    criterion = models.ForeignKey(EvaluationCriterion, on_delete=models.PROTECT)
    marks = models.DecimalField(max_digits=5, decimal_places=1)

    class Meta:
        ordering = ["criterion__order"]
        unique_together = [("evaluation", "criterion")]

    @property
    def rating(self):
        return rating_for(self.marks, self.criterion.max_marks)


# ---------------------------------------------------------------------------
# Document review
# ---------------------------------------------------------------------------
class DocumentRequirement(models.Model):
    """Documents a selected candidate must provide before moving on."""

    doc_type = models.CharField(max_length=20, choices=CandidateDocument.DocType.choices)
    applies_to = models.CharField(
        max_length=20, blank=True, choices=EmploymentType.choices, help_text="Leave empty for all hires."
    )
    is_mandatory = models.BooleanField(default=True)
    note = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["doc_type"]

    def __str__(self):
        scope = self.get_applies_to_display() if self.applies_to else "All hires"
        return f"{self.get_doc_type_display()} ({scope})"


# ---------------------------------------------------------------------------
# Offers
# ---------------------------------------------------------------------------
class Offer(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent — awaiting candidate"
        ACCEPTED = "accepted", "Accepted"
        DECLINED = "declined", "Declined"
        REVIEW_REQUESTED = "review_requested", "Candidate requested review"
        SUPERSEDED = "superseded", "Replaced by revised offer"
        WITHDRAWN = "withdrawn", "Withdrawn"

    class ManagementDecision(models.TextChoices):
        REVISE = "revise", "Revise the offer"
        MAINTAIN = "maintain", "Maintain current offer"
        WITHDRAW = "withdraw", "Withdraw offer / move to next candidate"

    application = models.ForeignKey(Application, on_delete=models.CASCADE, related_name="offers")
    version = models.PositiveSmallIntegerField(default=1)
    job_title = models.CharField(max_length=150)
    grade = models.CharField(max_length=40, blank=True)
    annual_salary = models.DecimalField("Annual gross salary (₦)", max_digits=14, decimal_places=2)
    benefits = models.TextField(blank=True, help_text="Allowances, housing, transport, HMO, etc.")
    start_date = models.DateField("Proposed date of joining", null=True, blank=True)
    expires_on = models.DateField(null=True, blank=True)
    letter = models.FileField(upload_to="offers/", blank=True, help_text="Optional signed offer letter (PDF).")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    negotiation_notes = models.TextField("Salary negotiation notes", blank=True)
    candidate_comment = models.TextField(blank=True)
    counter_salary = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    management_decision = models.CharField(max_length=10, choices=ManagementDecision.choices, blank=True)
    management_comment = models.TextField(blank=True)
    management_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    management_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-version"]

    def __str__(self):
        return f"Offer v{self.version} to {self.application.candidate}"

    @property
    def monthly_salary(self):
        return (self.annual_salary / 12).quantize(Decimal("0.01"))

    @property
    def status_color(self) -> str:
        return {
            "draft": "secondary",
            "sent": "primary",
            "accepted": "success",
            "declined": "danger",
            "review_requested": "warning",
            "superseded": "secondary",
            "withdrawn": "dark",
        }.get(self.status, "secondary")


# ---------------------------------------------------------------------------
# Medicals and onboarding
# ---------------------------------------------------------------------------
class MedicalCheck(models.Model):
    class Result(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        FIT = "fit", "Fit for work"
        CONDITIONAL = "conditional", "Fit with conditions"
        UNFIT = "unfit", "Not fit"

    application = models.ForeignKey(Application, on_delete=models.CASCADE, related_name="medicals")
    scheduled_for = models.DateTimeField()
    facility = models.CharField(max_length=200, default="Company clinic")
    result = models.CharField(max_length=20, choices=Result.choices, default=Result.SCHEDULED)
    report = models.FileField(upload_to="medicals/", blank=True)
    notes = models.TextField(blank=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-scheduled_for"]


DEFAULT_ONBOARDING_TASKS = [
    "Collect signed offer / acceptance letter",
    "Assign staff ID and create employee record",
    "Create email, network and system accounts",
    "Issue ID card and access pass",
    "HSE induction and PPE issuance",
    "Enrol on HMO / pension / payroll",
    "Assign workstation and equipment",
    "Department orientation with line manager",
]


class Onboarding(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        IN_PROGRESS = "in_progress", "In progress"
        COMPLETED = "completed", "Completed"

    application = models.OneToOneField(Application, on_delete=models.CASCADE, related_name="onboarding")
    start_date = models.DateField("Date of joining", null=True, blank=True)
    officer = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="onboardings")
    staff_id = models.CharField(max_length=30, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    notes = models.TextField(blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Onboarding — {self.application.candidate}"

    @property
    def progress(self) -> int:
        tasks = list(self.tasks.all())
        if not tasks:
            return 0
        return round(100 * sum(1 for t in tasks if t.done) / len(tasks))


class OnboardingTask(models.Model):
    onboarding = models.ForeignKey(Onboarding, on_delete=models.CASCADE, related_name="tasks")
    title = models.CharField(max_length=200)
    done = models.BooleanField(default=False)
    done_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    done_at = models.DateTimeField(null=True, blank=True)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]
