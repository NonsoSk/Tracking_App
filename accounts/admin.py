from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ("username", "get_full_name", "email", "role", "department", "is_active")
    list_filter = ("role", "department", "is_active")
    fieldsets = BaseUserAdmin.fieldsets + (
        ("Recruitment portal", {"fields": ("role", "department", "job_title", "phone")}),
    )
    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        ("Recruitment portal", {"fields": ("first_name", "last_name", "email", "role", "department", "job_title")}),
    )
