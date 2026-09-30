from django.urls import path

from . import views

app_name = "requisitions"

urlpatterns = [
    path("", views.requisition_list, name="list"),
    path("new/", views.requisition_create, name="create"),
    path("<int:pk>/", views.requisition_detail, name="detail"),
    path("<int:pk>/edit/", views.requisition_edit, name="edit"),
    path("<int:pk>/action/<str:action>/", views.requisition_action, name="action"),
    path("<int:pk>/note/", views.add_note, name="note"),
    path("<int:pk>/advert/", views.edit_advert, name="advert"),
    path("<int:pk>/rescore/", views.rescore, name="rescore"),
    path("<int:pk>/auto-shortlist/", views.run_auto_shortlist, name="auto_shortlist"),
    path("<int:pk>/bulk/", views.bulk_action, name="bulk"),
    path("<int:pk>/export/", views.export_applicants, name="export"),
    path("api/suggest/", views.api_suggest, name="api_suggest"),
    path("api/terms/", views.api_terms, name="api_terms"),
    path("api/role/<int:pk>/", views.api_role, name="api_role"),
]
