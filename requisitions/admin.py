from django.contrib import admin

from core.admin_lists import ListFieldsAdmin

from .models import JobRole, Requisition, RequisitionNote, SkillTag


@admin.register(SkillTag)
class SkillTagAdmin(ListFieldsAdmin, admin.ModelAdmin):
    list_fields = ("aliases",)
    list_display = ("name", "kind", "job_family")
    list_filter = ("kind", "job_family")
    search_fields = ("name",)


@admin.register(JobRole)
class JobRoleAdmin(ListFieldsAdmin, admin.ModelAdmin):
    list_fields = ("default_skills", "default_tools", "default_certifications", "default_courses")
    list_display = ("title", "department", "job_family", "grade", "default_min_experience", "is_active")
    list_filter = ("department", "job_family", "is_active")
    search_fields = ("title",)


class NoteInline(admin.TabularInline):
    model = RequisitionNote
    extra = 0


@admin.register(Requisition)
class RequisitionAdmin(ListFieldsAdmin, admin.ModelAdmin):
    list_fields = ("courses", "certifications", "required_skills", "preferred_skills", "tools")
    list_display = ("reference", "title", "department", "employment_type", "positions", "status", "created_at")
    list_filter = ("status", "department", "employment_type", "reason")
    search_fields = ("reference", "title")
    inlines = [NoteInline]
