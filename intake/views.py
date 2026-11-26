"""The live-update endpoint: open screens ask, about once a second, whether anything they show has changed.

It answers only with counters (no recruitment data), and only to signed-in staff. A screen that sees a counter move
fetches its own page again through the usual view, with the usual permission checks."""

from __future__ import annotations

import hashlib
import json as _json
import os
import time
from pathlib import Path

from django.conf import settings
from django.contrib import messages
from django.db import transaction
from django.http import HttpResponseBadRequest, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from core.models import LinkedWorkbook, WatchedFolder
from core.permissions import hr_required, safe_next


from .forms import ConnectorForm, FolderLinkForm
from .live import TOPICS, state
from .models import Connector, Receipt


@require_GET
def live(request):
    if not request.user.is_authenticated or not request.user.is_active:
        return JsonResponse({"error": "signed out"}, status=401)
    wanted = [t for t in request.GET.get("t", "").split(",") if t in TOPICS] or list(TOPICS)
    response = JsonResponse({"seq": state(wanted), "at": round(time.time(), 3)})
    response["Cache-Control"] = "no-store"
    return response


# --------------------------------------------------------------------------- linking folders (CV intake page)
PREVIEW_LIMIT = 20000  # files looked at for the preview count


def _back():
    return reverse("candidates:intake") + "#folders"


def _preview(data) -> dict:
    """What the worker will find: for a server folder, a count of the files and of those it reads as possible CVs."""
    from candidates.cv_parser import SUPPORTED_EXTENSIONS

    from .watch import folder_files

    if data["location"] != WatchedFolder.Location.SERVER:
        return {"counted": False}
    total = readable = 0
    for name, _full in folder_files(Path(data["path"]), subfolders=data["include_subfolders"]):
        total += 1
        readable += os.path.splitext(name)[1].lower() in SUPPORTED_EXTENSIONS
        if total >= PREVIEW_LIMIT:
            break
    return {"counted": True, "total": total, "readable": readable, "capped": total >= PREVIEW_LIMIT}


@hr_required
def folder_link(request):
    """Link a folder in two steps: fill in, then confirm what will happen (the preview)."""
    form = FolderLinkForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        data = form.cleaned_data
        if request.POST.get("confirm") != "1":
            return render(request, "intake/folder_confirm.html", {
                "form": form, "data": data, "preview": _preview(data),
                "source_label": dict(form.fields["source"].choices).get(data["source"], data["source"]),
                "region_label": dict(form.fields["region"].choices).get(data["region"], "")})
        with transaction.atomic():
            folder = WatchedFolder.objects.create(
                path=data["path"], label=data["label"], location=data["location"],
                connector=data["connector"] if data["location"] == WatchedFolder.Location.CONNECTOR else None,
                source=data["source"], requisition=data["requisition"], region=data["region"] or "",
                include_subfolders=data["include_subfolders"], import_existing=data["mode"] == "existing",
                baseline_done=False, state=WatchedFolder.State.PENDING, linked_by=request.user,
                check_requested=True,
                message="Waiting for the worker to open it." if data["location"] == WatchedFolder.Location.SERVER
                else "Waiting for the PC's connector to open it.")
        messages.success(request, f"'{folder.name}' is linked. It shows as Linked once "
                                  f"{'the worker' if folder.location == 'server' else 'the PC'} has opened it.")
        return redirect(_back())
    return render(request, "intake/folder_link.html", {"form": form})


@hr_required
@require_POST
def folder_action(request, pk):
    from core import cv_folder

    folder = get_object_or_404(WatchedFolder, pk=pk)
    action = request.POST.get("action")
    if action == "check":
        WatchedFolder.objects.filter(pk=pk).update(check_requested=True)
        messages.info(request, f"'{folder.name}' will be looked at in a moment.")
    elif action == "retry":
        count = cv_folder.retry_unread(folder)
        messages.info(request, f"{count} file{'s' if count != 1 else ''} will be read again.")
    elif action == "stop":
        name = folder.name
        folder.delete()  # its receipts and the profiles made from it stay
        messages.success(request, f"Stopped watching '{name}'. The candidates already imported from it stay, and the "
                                  "files in the folder were not touched.")
    else:
        return HttpResponseBadRequest("Unknown action")
    return redirect(_back())


@hr_required
@require_POST
def receipt_action(request, pk):
    """HR's answer about one received file: read it again, same person, someone else, or leave it out."""
    from candidates.models import Candidate

    from .receive import requeue
    from .worker import status

    receipt = get_object_or_404(Receipt, pk=pk)
    action = request.POST.get("action")
    if action == "leave":
        receipt.status, receipt.resolved_by = Receipt.Status.DONE, request.user
        receipt.message = (receipt.message + f" Left out by {request.user.display_name}.").strip()
        receipt.finished_at = timezone.now()
        receipt.save(update_fields=["status", "resolved_by", "message", "finished_at"])
        messages.info(request, f"{receipt.original_name} is left out.")
        return redirect(safe_next(request, reverse("candidates:intake") + "#review", request.POST.get("next")))
    if not receipt.stored:
        messages.error(request, "This file was not kept, so it cannot be read again. Add it again.")
        return redirect(reverse("candidates:intake") + "#review")
    options = {}
    if action == "same":
        person = get_object_or_404(Candidate, pk=request.POST.get("candidate") or receipt.candidate_id)
        options = {"same_as": person.pk, "new_person": False}
    elif action == "different":
        options = {"new_person": True, "same_as": None}
    elif action != "retry":
        return HttpResponseBadRequest("Unknown action")
    requeue(receipt, options=options, user=request.user)
    if not status()["online"]:  # no worker running: read it now, in this request
        from .process import read_now

        read_now(receipt, owner=f"web:{request.user.pk}")
    messages.success(request, f"{receipt.original_name}: done." if action != "retry" else
                     f"{receipt.original_name} will be read again.")
    return redirect(safe_next(request, reverse("candidates:intake") + "#review", request.POST.get("next")))


@hr_required
def connector_add(request):
    form = ConnectorForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        connector, token = Connector.issue(form.cleaned_data["name"], request.user)
        return render(request, "intake/connector_token.html", {"connector": connector, "token": token,
                                                               "portal_url": request.build_absolute_uri("/")})
    return render(request, "intake/connector_add.html", {"form": form})


@hr_required
@require_POST
def connector_revoke(request, pk):
    connector = get_object_or_404(Connector, pk=pk, revoked_at__isnull=True)
    connector.revoked_at = timezone.now()
    connector.save(update_fields=["revoked_at"])
    messages.success(request, f"{connector.name} can no longer send files. Its folders show as unavailable.")
    return redirect(_back())


# --------------------------------------------------------------------------- the connector's API
def _connector(request):
    header = request.headers.get("Authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    connector = Connector.for_token(token)
    if connector:
        Connector.objects.filter(pk=connector.pk).update(
            last_seen_at=timezone.now(), last_address=(request.META.get("REMOTE_ADDR") or "")[:64],
            version=(request.headers.get("X-Connector-Version") or "")[:40])
    return connector


def _refused():
    return JsonResponse({"error": "This connector is not known or was switched off. Add it again in the portal."},
                        status=401)


@csrf_exempt
@require_GET
def api_config(request):
    """What this PC should send: its folders and workbooks."""
    connector = _connector(request)
    if not connector:
        return _refused()
    folders = [{"id": f.pk, "name": f.name, "path": f.path, "subfolders": f.include_subfolders,
                "import_existing": f.import_existing, "baseline_done": f.baseline_done}
               for f in WatchedFolder.objects.filter(connector=connector, location=WatchedFolder.Location.CONNECTOR)]
    workbooks = [{"id": w.pk, "path": w.path, "pattern": w.pattern, "fingerprint": w.fingerprint}
                 for w in LinkedWorkbook.objects.filter(connector=connector)]
    return JsonResponse({"folders": folders, "workbooks": workbooks, "max_mb": settings.MAX_UPLOAD_MB,
                         "time": time.time()})


@csrf_exempt
@require_POST
def api_file(request):
    """One file from the PC. Sent again after a lost connection, it is received once."""
    from .receive import receive

    connector = _connector(request)
    if not connector:
        return _refused()
    upload = request.FILES.get("file")
    if upload is None:
        return JsonResponse({"error": "No file"}, status=400)
    content = upload.read()
    if request.POST.get("sha256") and hashlib.sha256(content).hexdigest() != request.POST["sha256"]:
        return JsonResponse({"error": "The file changed or was cut off on the way; send it again."}, status=409)
    try:
        modified = float(request.POST.get("modified") or 0) or None
    except ValueError:
        modified = None
    source_path = (request.POST.get("source_path") or upload.name)[:700]
    if request.POST.get("kind") == "workbook":
        workbook = LinkedWorkbook.objects.filter(pk=request.POST.get("workbook"), connector=connector).first()
        if workbook is None:
            return JsonResponse({"error": "Unknown workbook"}, status=404)
        receipt, new = receive(content, Path(source_path).name, kind=Receipt.Kind.WORKBOOK,
                               channel=Receipt.Channel.CONNECTOR, workbook=workbook, connector=connector,
                               source_path=source_path, modified=modified,
                               options={"full": bool(workbook.refresh_requested)})
        LinkedWorkbook.objects.filter(pk=workbook.pk).update(received_at=timezone.now(), checked_at=timezone.now(),
                                                             refresh_requested=False)
    else:
        folder = WatchedFolder.objects.filter(pk=request.POST.get("folder"), connector=connector).first()
        if folder is None:
            return JsonResponse({"error": "Unknown folder"}, status=404)
        if len(content) > settings.MAX_UPLOAD_MB * 1024 * 1024:
            return JsonResponse({"error": f"Larger than {settings.MAX_UPLOAD_MB} MB"}, status=413)
        receipt, new = receive(content, Path(source_path).name, channel=Receipt.Channel.CONNECTOR, folder=folder,
                               connector=connector, requisition=folder.requisition, source_path=source_path,
                               modified=modified, options={"source": folder.source, "region": folder.region})
    return JsonResponse({"receipt": receipt.pk, "new": new, "status": receipt.status})


@csrf_exempt
@require_POST
def api_report(request):
    """The PC says which folders and workbooks it could open."""
    connector = _connector(request)
    if not connector:
        return _refused()
    try:
        body = _json.loads(request.body or b"{}")
    except ValueError:
        return JsonResponse({"error": "Not JSON"}, status=400)
    now = timezone.now()
    for item in body.get("folders", []):
        folder = WatchedFolder.objects.filter(pk=item.get("id"), connector=connector).first()
        if folder is None:
            continue
        fields = {"checked_at": now}
        if item.get("ok"):
            fields.update(state=WatchedFolder.State.OK, verified_at=now, message=str(item.get("message", ""))[:500])
            if item.get("complete"):
                fields["last_success_at"] = now
            if item.get("baseline_done"):
                fields["baseline_done"] = True
        else:
            fields.update(state=WatchedFolder.State.MISSING,
                          message=(str(item.get("message") or "The PC cannot open this folder.")[:400]
                                   + " Imported candidates are kept."))
        WatchedFolder.objects.filter(pk=folder.pk).update(**fields)
    for item in body.get("workbooks", []):
        workbook = LinkedWorkbook.objects.filter(pk=item.get("id"), connector=connector).first()
        if workbook is None:
            continue
        fields = {"checked_at": now}
        if not item.get("ok"):
            fields.update(state=LinkedWorkbook.State.MISSING,
                          message=str(item.get("message") or "The PC cannot open this file.")[:400])
        elif workbook.state in {LinkedWorkbook.State.MISSING, LinkedWorkbook.State.OFFLINE}:
            fields.update(state=LinkedWorkbook.State.OK, message="The PC can open the file again.")
        LinkedWorkbook.objects.filter(pk=workbook.pk).update(**fields)
    return JsonResponse({"ok": True})
