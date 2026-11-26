from django.urls import path

from . import views

app_name = "intake"

urlpatterns = [
    path("live/", views.live, name="live"),
    path("folders/link/", views.folder_link, name="folder_link"),
    path("folders/<int:pk>/", views.folder_action, name="folder_action"),
    path("files/<int:pk>/", views.receipt_action, name="receipt_action"),
    path("connectors/add/", views.connector_add, name="connector_add"),
    path("connectors/<int:pk>/revoke/", views.connector_revoke, name="connector_revoke"),
    path("api/connector/", views.api_config, name="api_config"),
    path("api/connector/file/", views.api_file, name="api_file"),
    path("api/connector/report/", views.api_report, name="api_report"),
]
