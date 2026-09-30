from django.contrib import admin

from .models import Department, Employee, Notification


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "hod", "email", "is_active")
    search_fields = ("name", "code")


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ("staff_id", "full_name", "department", "job_title", "date_of_birth", "retirement_date", "status")
    list_filter = ("status", "department")
    search_fields = ("staff_id", "first_name", "last_name", "job_title")
    readonly_fields = ("retirement_date",)


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("title", "recipient", "level", "is_read", "created_at")
    list_filter = ("level", "is_read")
