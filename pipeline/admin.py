from django.contrib import admin

from .models import (Activity, Application, DocumentRequirement, Evaluation, EvaluationCriterion, EvaluationScore,
                     Interview, MedicalCheck, Offer, Onboarding, OnboardingTask)


@admin.register(EvaluationCriterion)
class EvaluationCriterionAdmin(admin.ModelAdmin):
    list_display = ("name", "max_marks", "order", "is_active")
    list_editable = ("max_marks", "order", "is_active")


@admin.register(DocumentRequirement)
class DocumentRequirementAdmin(admin.ModelAdmin):
    list_display = ("doc_type", "applies_to", "is_mandatory", "note")
    list_editable = ("is_mandatory",)


@admin.register(Application)
class ApplicationAdmin(admin.ModelAdmin):
    list_display = ("reference", "candidate", "requisition", "stage", "status", "match_score", "match_grade")
    list_filter = ("stage", "status", "match_grade")
    search_fields = ("reference", "candidate__first_name", "candidate__last_name")


class ScoreInline(admin.TabularInline):
    model = EvaluationScore
    extra = 0


@admin.register(Evaluation)
class EvaluationAdmin(admin.ModelAdmin):
    list_display = ("application", "evaluator", "total", "recommendation", "submitted_at")
    inlines = [ScoreInline]


@admin.register(Interview)
class InterviewAdmin(admin.ModelAdmin):
    list_display = ("application", "round", "scheduled_at", "mode", "status")
    list_filter = ("round", "status", "mode")


@admin.register(Offer)
class OfferAdmin(admin.ModelAdmin):
    list_display = ("application", "version", "annual_salary", "status", "sent_at")
    list_filter = ("status",)


class TaskInline(admin.TabularInline):
    model = OnboardingTask
    extra = 0


@admin.register(Onboarding)
class OnboardingAdmin(admin.ModelAdmin):
    list_display = ("application", "start_date", "officer", "status")
    inlines = [TaskInline]


admin.site.register(MedicalCheck)
admin.site.register(Activity)
