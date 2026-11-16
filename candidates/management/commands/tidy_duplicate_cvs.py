import hashlib
from collections import defaultdict

from django.core.management.base import BaseCommand

from candidates.cv_filter import text_key
from candidates.models import Candidate, CandidateDocument


class Command(BaseCommand):
    help = ("Find CVs the portal holds twice from uploads made before it refused duplicates: extra copies of the same "
            "file on one profile, and profiles made from the same CV. Lists them; with --apply the extra copies and the "
            "later of two such profiles are removed (a profile with applications is never removed).")

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Remove what is listed (otherwise only list it).")

    def handle(self, *args, **options):
        apply = options["apply"]
        copies = profiles = kept = 0

        # 1. The same file filed more than once under one profile: keep the first.
        seen = set()
        for document in CandidateDocument.objects.filter(doc_type="cv").order_by("candidate_id", "uploaded_at", "pk"):
            digest = document.sha256 or self._digest(document)
            if not digest:
                continue
            key = (document.candidate_id, digest)
            if key not in seen:
                seen.add(key)
                continue
            copies += 1
            self.stdout.write(f"Extra copy: {document.original_name} ({document.candidate.full_name})")
            if apply:
                self._remove(document)

        # 2. Two profiles made from the same CV: keep the earlier, remove the later if nothing hangs on it.
        by_cv = defaultdict(list)
        for candidate in Candidate.objects.exclude(cv_text="").order_by("created_at", "pk"):
            key = candidate.cv_digest or text_key(candidate.cv_text)
            if key:
                by_cv[key].append(candidate)
        for group in by_cv.values():
            first = group[0]
            for later in group[1:]:
                if later.applications.exists():
                    kept += 1
                    self.stdout.write(f"Same CV as {first.full_name} (#{first.pk}), but #{later.pk} has applications: "
                                      "left as it is.")
                    continue
                profiles += 1
                self.stdout.write(f"Same CV twice: {later.full_name} (#{later.pk}) duplicates #{first.pk}")
                if apply:
                    for document in later.documents.all():
                        self._remove(document)
                    later.delete()

        verb = "Removed" if apply else "Would remove"
        self.stdout.write(self.style.SUCCESS(
            f"{verb} {copies} extra cop{'ies' if copies != 1 else 'y'} and {profiles} duplicate "
            f"profile{'s' if profiles != 1 else ''}." + (f" {kept} left because they have applications." if kept else "")
            + ("" if apply or not (copies or profiles) else " Run again with --apply to remove them.")))

    @staticmethod
    def _digest(document) -> str:
        try:
            with (document.original_file or document.file).open("rb") as handle:
                return hashlib.sha256(handle.read()).hexdigest()
        except (OSError, ValueError):
            return ""

    @staticmethod
    def _remove(document):
        document.file.delete(save=False)
        if document.original_file:
            document.original_file.delete(save=False)
        document.delete()
