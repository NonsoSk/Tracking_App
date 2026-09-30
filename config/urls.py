from django.conf import settings
from django.contrib import admin
from django.urls import include, path

admin.site.site_header = f"{settings.COMPANY_SHORT_NAME} {settings.PORTAL_NAME} — Administration"
admin.site.site_title = f"{settings.COMPANY_SHORT_NAME} Recruitment Admin"
admin.site.index_title = "Master data & settings"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("accounts/", include("accounts.urls")),
    path("careers/", include("careers.urls")),
    path("requisitions/", include("requisitions.urls")),
    path("candidates/", include("candidates.urls")),
    path("pipeline/", include("pipeline.urls")),
    path("", include("core.urls")),
]

# Uploaded files (CVs, certificates, medical reports) are personal data and are
# never served publicly; views check permissions and stream them.
