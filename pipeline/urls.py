from django.urls import path

from . import views

app_name = "pipeline"

urlpatterns = [
    path("applications/", views.application_list, name="applications"),
    path("applications/<int:pk>/", views.application_detail, name="application"),
    path("applications/<int:pk>/move/", views.move_stage, name="move"),
    path("applications/<int:pk>/shortlist/", views.shortlist, name="shortlist"),
    path("applications/<int:pk>/status/", views.change_status, name="status"),
    path("applications/<int:pk>/rescore/", views.rescore, name="rescore"),
    path("applications/<int:pk>/ai-summary/", views.ai_summary, name="ai_summary"),
    path("applications/<int:pk>/interviews/new/", views.schedule_interview, name="schedule_interview"),
    path("applications/<int:pk>/evaluate/", views.evaluate, name="evaluate"),
    path("applications/<int:pk>/selection-report/", views.selection_report, name="selection_report"),
    path("applications/<int:pk>/decision/", views.record_decision, name="decision"),
    path("applications/<int:pk>/documents/request/", views.request_documents, name="request_documents"),
    path("applications/<int:pk>/documents/clear/", views.clear_documents, name="clear_documents"),
    path("applications/<int:pk>/offers/new/", views.create_offer, name="create_offer"),
    path("applications/<int:pk>/medicals/new/", views.schedule_medical, name="schedule_medical"),
    path("interviews/", views.my_interviews, name="interviews"),
    path("interviews/<int:pk>/edit/", views.edit_interview, name="edit_interview"),
    path("interviews/<int:pk>/cancel/", views.cancel_interview, name="cancel_interview"),
    path("interviews/<int:pk>/complete/", views.complete_interview, name="complete_interview"),
    path("interviews/<int:pk>/invite.ics", views.download_ics, name="ics"),
    path("offers/reviews/", views.offer_reviews, name="offer_reviews"),
    path("offers/<int:pk>/review/", views.offer_review, name="offer_review"),
    path("offers/<int:pk>/send/", views.send_offer, name="send_offer"),
    path("offers/<int:pk>/close/", views.offer_declined_close, name="offer_close"),
    path("offers/<int:pk>/letter/", views.offer_letter, name="offer_letter"),
    path("medicals/<int:pk>/result/", views.medical_result, name="medical_result"),
    path("medicals/<int:pk>/report/", views.medical_report, name="medical_report"),
    path("onboarding/", views.onboarding_list, name="onboarding_list"),
    path("onboarding/<int:pk>/", views.onboarding_detail, name="onboarding"),
    path("onboarding/<int:pk>/tasks/", views.onboarding_task, name="onboarding_add_task"),
    path("onboarding/<int:pk>/tasks/<int:task_id>/toggle/", views.onboarding_task, name="onboarding_task"),
    path("onboarding/<int:pk>/complete/", views.complete_onboarding, name="onboarding_complete"),
]
