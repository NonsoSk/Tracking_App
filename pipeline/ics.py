"""iCalendar (.ics) invites that Outlook, Google Calendar and phones understand."""

from datetime import timezone as dt_timezone

from django.conf import settings
from django.utils import timezone


def _escape(value: str) -> str:
    return (value or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line: str) -> str:
    """RFC 5545: lines longer than 75 octets are folded (never inside a character)."""
    if len(line.encode("utf-8")) <= 75:
        return line
    parts, current, size = [], "", 0
    limit = 75
    for char in line:
        width = len(char.encode("utf-8"))
        if size + width > limit:
            parts.append(current)
            current, size, limit = "", 0, 74  # continuation lines start with a space
        current += char
        size += width
    parts.append(current)
    return "\r\n ".join(parts)


def _fmt(dt) -> str:
    return dt.astimezone(dt_timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def interview_ics(interview, *, cancel: bool = False) -> bytes:
    app = interview.application
    candidate = app.candidate
    organizer_email = settings.DEFAULT_FROM_EMAIL.split("<")[-1].rstrip(">").strip()
    summary = f"Interview: {candidate.full_name} — {app.requisition.title} ({interview.get_round_display()})"
    description = (
        f"{interview.get_round_display()} for {app.requisition.title} ({app.requisition.department}).\n"
        f"Candidate: {candidate.full_name}\nMode: {interview.get_mode_display()}\n"
        f"Where: {interview.where}\n"
        + (f"\n{interview.instructions}\n" if interview.instructions else "")
    )
    lines = [
        "BEGIN:VCALENDAR",
        "PRODID:-//IEFCL//Recruitment Portal//EN",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        f"METHOD:{'CANCEL' if cancel else 'REQUEST'}",
        "BEGIN:VEVENT",
        f"UID:{interview.uid}@recruitment",
        f"SEQUENCE:{interview.sequence}",
        f"DTSTAMP:{_fmt(timezone.now())}",
        f"DTSTART:{_fmt(interview.scheduled_at)}",
        f"DTEND:{_fmt(interview.ends_at)}",
        f"SUMMARY:{_escape(summary)}",
        f"DESCRIPTION:{_escape(description)}",
        f"LOCATION:{_escape(interview.where)}",
        f"STATUS:{'CANCELLED' if cancel else 'CONFIRMED'}",
        f"ORGANIZER;CN={_escape(settings.COMPANY_SHORT_NAME + ' Recruitment')}:mailto:{organizer_email}",
    ]
    if interview.meeting_link:
        lines.append(f"URL:{interview.meeting_link}")
    attendees = [(candidate.full_name, candidate.email)] + [(u.display_name, u.email) for u in interview.panel.all()]
    for name, email in attendees:
        if email:
            lines.append(f"ATTENDEE;CN={_escape(name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:{email}")
    lines += [
        "BEGIN:VALARM",
        "TRIGGER:-PT30M",
        "ACTION:DISPLAY",
        "DESCRIPTION:Interview reminder",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return ("\r\n".join(_fold(line) for line in lines) + "\r\n").encode("utf-8")
