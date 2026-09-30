from django.urls import path

from . import views

app_name = "careers"

urlpatterns = [
    path("", views.job_list, name="jobs"),
    path("jobs/<str:reference>/", views.job_detail, name="job"),
    path("jobs/<str:reference>/apply/", views.apply, name="apply"),
    path("read-cv/", views.parse_cv_preview, name="parse_cv"),
    path("status/", views.status_lookup, name="status"),
    path("my/<uuid:token>/", views.hub, name="hub"),
    path("my/<uuid:token>/interviews/<int:interview_id>/", views.hub_interview, name="hub_interview"),
    path("my/<uuid:token>/documents/", views.hub_document, name="hub_document"),
    path("my/<uuid:token>/offers/<int:offer_id>/", views.hub_offer, name="hub_offer"),
]
