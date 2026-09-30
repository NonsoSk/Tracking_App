from django.urls import path

from . import views

app_name = "candidates"

urlpatterns = [
    path("", views.candidate_list, name="list"),
    path("new/", views.candidate_create, name="create"),
    path("intake/", views.intake, name="intake"),
    path("import/", views.import_spreadsheet, name="import"),
    path("refer/", views.refer, name="refer"),
    path("<int:pk>/", views.candidate_detail, name="detail"),
    path("<int:pk>/edit/", views.candidate_edit, name="edit"),
    path("<int:pk>/documents/upload/", views.upload_document, name="upload"),
    path("<int:pk>/apply/", views.add_to_requisition, name="add_to_requisition"),
    path("documents/<int:pk>/", views.download_document, name="document"),
    path("documents/<int:pk>/reparse/", views.reparse_document, name="reparse"),
    path("documents/<int:pk>/review/", views.review_document_view, name="review_document"),
    path("documents/<int:pk>/delete/", views.delete_document, name="delete_document"),
]
