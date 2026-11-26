import json

from django.core.management.base import BaseCommand, CommandError

from pipeline import evaluation
from requisitions.models import Requisition


class Command(BaseCommand):
    help = ("Check the matcher against reviewers: export a blind review sheet for a vacancy, then an evidence sheet, "
            "then report how the old and new matcher compare with the reviewers' judgement. The sheets hold "
            "candidates' names: keep them in private storage.")

    def add_arguments(self, parser):
        parser.add_argument("step", choices=["blind", "evidence", "report"])
        parser.add_argument("vacancy", help="The vacancy's reference (e.g. Req_901).")
        parser.add_argument("--out", help="Where to write the sheet (blind, evidence).")
        parser.add_argument("--blind", help="The blind review sheet, filled in (report).")
        parser.add_argument("--evidence", help="The evidence sheet, filled in (report; optional).")

    def handle(self, *args, **options):
        requisition = Requisition.objects.filter(reference__iexact=options["vacancy"]).first()
        if requisition is None:
            raise CommandError(f"No vacancy with the reference {options['vacancy']}.")
        if options["step"] == "blind":
            path = evaluation.export_blind(requisition, options["out"] or f"blind-{requisition.reference}.xlsx")
            self.stdout.write(f"Blind review sheet: {path} (the old matcher's results are kept beside it).")
        elif options["step"] == "evidence":
            path = evaluation.export_evidence(requisition, options["out"] or f"evidence-{requisition.reference}.xlsx")
            self.stdout.write(f"Evidence sheet: {path}")
        else:
            self.stdout.write(json.dumps(evaluation.report(requisition, options["blind"], options["evidence"]),
                                         indent=1))
