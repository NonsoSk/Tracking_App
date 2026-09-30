from django.contrib import admin

from .models import Candidate, CandidateDocument


class DocumentInline(admin.TabularInline):
    model = CandidateDocument
    extra = 0
    fields = ("doc_type", "original_name", "status", "uploaded_at")
    readonly_fields = ("uploaded_at",)


@admin.register(Candidate)
class CandidateAdmin(admin.ModelAdmin):
    list_display = ("full_name", "email", "phone", "highest_qualification", "course", "years_experience", "source")
    list_filter = ("source", "highest_qualification")
    search_fields = ("first_name", "last_name", "email", "phone")
    inlines = [DocumentInline]
