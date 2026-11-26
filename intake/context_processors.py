import json

from django.conf import settings


def live(request):
    """For the page layout: how often open screens ask for changes, and the counters as the page was drawn."""

    def seq():
        from .live import state

        try:
            return json.dumps(state())
        except Exception:  # noqa: BLE001 - before the first migration
            return "{}"

    return {"LIVE_POLL_MS": settings.LIVE_POLL_MS, "live_seq": seq}
