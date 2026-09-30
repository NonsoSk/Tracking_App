from django.urls import path

from . import views

app_name = "core"

urlpatterns = [
    path("", views.dashboard, name="dashboard"),
    path("notifications/", views.notifications, name="notifications"),
    path("notifications/<int:pk>/open/", views.open_notification, name="open_notification"),
    path("notifications/read-all/", views.read_all_notifications, name="read_all"),
    path("staff/", views.employees, name="employees"),
    path("staff/import/", views.import_employees, name="import_employees"),
    path("staff/<int:pk>/notify/", views.notify_replacement, name="notify_replacement"),
    path("staff/<int:pk>/exit/", views.record_exit, name="record_exit"),
]
