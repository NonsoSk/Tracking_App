from django.contrib import admin

from .models import JobRole, Requisition, RequisitionNote, SkillTag


@admin.register(SkillTag)
class SkillTagAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "job_family")
    list_filter = ("kind", "job_family")
    search_fields = ("name",)


@admin.register(JobRole)
class JobRoleAdmin(admin.ModelAdmin):
    list_display = ("title", "department", "job_family", "grade", "default_min_experience", "is_active")
    list_filter = ("department", "job_family", "is_active")
    search_fields = ("title",)


class NoteInline(admin.TabularInline):
    model = RequisitionNote
    extra = 0


@admin.register(Requisition)
class RequisitionAdmin(admin.ModelAdmin):
    list_display = ("reference", "title", "department", "employment_type", "positions", "status", "created_at")
    list_filter = ("status", "department", "employment_type", "reason")
    search_fields = ("reference", "title")
    inlines = [NoteInline]
