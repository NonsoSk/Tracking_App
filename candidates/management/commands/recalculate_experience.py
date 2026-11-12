from django.core.management.base import BaseCommand

from candidates.experience import recalculable, recalculate
from candidates.models import Candidate


class Command(BaseCommand):
    help = ("Work out the years of experience again from each profile's CV: from the job dates only, gaps between "
            "jobs left out. By default only profiles read from a CV that HR has not checked; nothing is saved "
            "without --apply.")

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Save the new figures (otherwise only list them).")
        parser.add_argument("--include-checked", action="store_true",
                            help="Also profiles HR has checked (HR may have corrected the years by hand).")
        parser.add_argument("--include-excel", action="store_true",
                            help="Also profiles loaded from the Excel workbooks (their years come from the workbook).")

    def handle(self, *args, **options):
        from pipeline.matching import rescore_candidate

        changed = 0
        for candidate in recalculable(Candidate.objects.all(), include_checked=options["include_checked"],
                                      include_excel=options["include_excel"]):
            result = recalculate(candidate, save=options["apply"])
            if not result:
                continue
            old, new, note = result
            if old is not None and float(old) == float(new):
                continue
            changed += 1
            self.stdout.write(f"{candidate.full_name}: {old if old is not None else '-'} -> {new}  ({note})")
            if options["apply"]:
                rescore_candidate(candidate)
        verb = "Updated" if options["apply"] else "Would update"
        self.stdout.write(self.style.SUCCESS(f"{verb} {changed} profile(s)."
                                             + ("" if options["apply"] else " Run again with --apply to save.")))
