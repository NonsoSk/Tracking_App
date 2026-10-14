from django.contrib import admin

from .models import Candidate, CandidateDocument, CBTResult


class DocumentInline(admin.TabularInline):
    model = CandidateDocument
    extra = 0
    fields = ("doc_type", "original_name", "status", "uploaded_at")
    readonly_fields = ("uploaded_at",)


@admin.register(Candidate)
class CandidateAdmin(admin.ModelAdmin):
    list_display = ("full_name", "email", "phone", "highest_qualification", "course", "years_experience", "source_detail")
    list_filter = ("source", "source_detail", "highest_qualification", "community_status")
    search_fields = ("first_name", "last_name", "email", "phone", "other_contacts")
    inlines = [DocumentInline]


@admin.register(CBTResult)
class CBTResultAdmin(admin.ModelAdmin):
    list_display = ("candidate", "test_date", "category", "score", "total", "company")
    list_filter = ("company",)
    search_fields = ("candidate__first_name", "candidate__last_name", "candidate__email", "category")
    raw_id_fields = ("candidate",)
