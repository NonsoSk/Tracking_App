"""Tell open screens that something changed, after it is committed.

Every committed change to the data a recruiter looks at raises a counter for its topic (``people``, ``hiring``,
``intake``). Each open page asks ``/live/`` for the counters about once a second (``static/ds/live.js``) and, when
one of its topics moved, fetches itself again and swaps in its live regions — through the same view and the same
permission checks as a normal page load, so nobody sees more than they may. Bulk writes that send no signals (the
workbook importer) call ``touch()`` themselves.
"""

from __future__ import annotations

import threading

from django.db import DatabaseError, transaction
from django.db.models import F
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver
from django.utils import timezone

TOPICS = ("people", "hiring", "intake")
MODEL_TOPICS = {
    "candidates.Candidate": "people", "candidates.CandidateDocument": "people", "candidates.CBTResult": "people",
    "pipeline.Application": "hiring", "pipeline.Interview": "hiring", "pipeline.InterviewRecord": "hiring",
    "pipeline.Offer": "hiring", "pipeline.Evaluation": "hiring", "pipeline.Activity": "hiring",
    "pipeline.MatchReview": "hiring",
    "requisitions.Requisition": "hiring",
    "intake.Receipt": "intake", "intake.Connector": "intake", "core.WatchedFolder": "intake",
    "core.LinkedWorkbook": "intake",
}
_local = threading.local()


def _flush(topics):
    from .models import LiveTopic

    now = timezone.now()
    for name in sorted(topics):
        try:
            if not LiveTopic.objects.filter(name=name).update(seq=F("seq") + 1, changed_at=now):
                LiveTopic.objects.get_or_create(name=name, defaults={"seq": 1, "changed_at": now})
        except DatabaseError:  # the table is not there yet (a migration in progress)
            return


def touch(*topics):
    """Raise these topics (all when none given) once the current transaction commits."""
    topics = set(topics) or set(TOPICS)
    connection = transaction.get_connection()
    if not connection.in_atomic_block:
        _flush(topics)
        return
    pending = getattr(_local, "pending", None)
    # After a rollback Django drops the callback: start again rather than adding to a set nobody will flush.
    if pending is None or not any(item[1] is getattr(_local, "flush", None) for item in connection.run_on_commit):
        _local.pending = set(topics)

        def flush():
            todo, _local.pending = _local.pending, None
            _flush(todo or ())

        _local.flush = flush
        transaction.on_commit(flush)
    else:
        pending.update(topics)


def state(topics=None) -> dict:
    from .models import LiveTopic

    wanted = [t for t in (topics or TOPICS) if t in TOPICS]
    seqs = dict(LiveTopic.objects.filter(name__in=wanted).values_list("name", "seq"))
    return {t: seqs.get(t, 0) for t in wanted}


@receiver(post_save)
@receiver(post_delete)
def _changed(sender, **kwargs):
    if kwargs.get("raw") or sender.__module__ == "__fake__":  # fixtures, and models inside migrations
        return
    topic = MODEL_TOPICS.get(sender._meta.label)
    if topic:
        touch(topic)
