"""
Load realistic demo data so the hiring team can click through every stage.

    python manage.py seed_demo            # password for all demo users: Demo@2026
    python manage.py seed_demo --password "S0mething!"

CVs are generated as real PDF / Word files and go through the same intake,
CV reading and matching code as live uploads.
"""

import random
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.test import override_settings
from django.utils import timezone

from accounts.models import User
from candidates.intake import ingest_cv, save_document
from candidates.models import Candidate, CandidateDocument
from core.demo_files import cv_lines, simple_docx, simple_pdf
from core.models import Department, Employee
from pipeline import services
from pipeline.models import (Application, Evaluation, EvaluationCriterion, EvaluationScore, Interview, MedicalCheck,
                             Offer, Stage)
from requisitions import services as req_services
from requisitions.knowledge_base import JOB_FAMILIES
from requisitions.models import JobRole, Requisition
from requisitions.suggestions import draft_job_advert

DEPARTMENTS = [
    ("PROD", "Production (Ammonia & Urea)"), ("MMD", "Mechanical Maintenance"), ("ELE", "Electrical Maintenance"),
    ("INS", "Instrumentation & Control"), ("HSE", "Health, Safety & Environment"), ("LAB", "Laboratory & Quality Control"),
    ("ICT", "Information Technology"), ("FIN", "Finance & Accounts"), ("HRA", "Human Resources & Administration"),
    ("SCM", "Procurement & Supply Chain"), ("LOG", "Logistics & Shipping"), ("SAL", "Sales & Marketing"),
]

USERS = [
    # username, first, last, role, dept, title
    ("hr.admin", "Adaeze", "Nwosu", User.Role.HR_ADMIN, "HRA", "HR Manager"),
    ("recruiter", "Tunde", "Bakare", User.Role.RECRUITER, "HRA", "Talent Acquisition Lead"),
    ("hod.production", "Emeka", "Obi", User.Role.HOD, "PROD", "Head of Production"),
    ("hod.maintenance", "Ibrahim", "Musa", User.Role.HOD, "MMD", "Head of Mechanical Maintenance"),
    ("hod.ict", "Ngozi", "Eze", User.Role.HOD, "ICT", "Head of IT"),
    ("hod.hse", "Blessing", "Akpan", User.Role.HOD, "HSE", "HSE Manager"),
    ("manager.lab", "Halima", "Sani", User.Role.MANAGER, "LAB", "Laboratory Manager"),
    ("interviewer", "Samuel", "Adeyemi", User.Role.INTERVIEWER, "PROD", "Senior Process Engineer"),
    ("management", "Olumide", "Johnson", User.Role.MANAGEMENT, None, "General Manager"),
    ("onboarding", "Grace", "Udoh", User.Role.ONBOARDING, "HRA", "Onboarding Officer"),
    ("staff.referrer", "Chidi", "Nnamdi", User.Role.EMPLOYEE, "LAB", "Laboratory Technologist"),
]

ROLES = [
    ("Process Engineer", "PROD", "process_engineering", "M5", 3),
    ("Panel Operator", "PROD", "process_operations", "S3", 2),
    ("Graduate Trainee — Process Operations", "PROD", "process_operations", "GT", 0),
    ("Rotating Equipment Engineer", "MMD", "mechanical_maintenance", "M5", 5),
    ("Instrumentation Technician", "INS", "instrumentation_control", "S2", 3),
    ("Electrical Engineer", "ELE", "electrical", "M4", 4),
    ("HSE Officer", "HSE", "hse", "S4", 3),
    ("Laboratory Analyst", "LAB", "laboratory_qc", "S2", 2),
    ("Network Administrator", "ICT", "it", "S4", 4),
    ("Accountant", "FIN", "finance", "S4", 3),
    ("HR Officer", "HRA", "hr", "S3", 3),
    ("Procurement Officer", "SCM", "procurement", "S3", 3),
]

EMPLOYEES = [
    # staff id, first, last, dept, title, dob, employed
    ("IE0112", "Joseph", "Ekanem", "PROD", "Process Engineer", date(1966, 12, 14), date(1996, 3, 1)),
    ("IE0140", "Mary", "Okoro", "LAB", "Senior Chemist", date(1967, 2, 20), date(1998, 6, 1)),
    ("IE0156", "Sunday", "Ibe", "MMD", "Maintenance Supervisor", date(1967, 6, 2), date(1994, 1, 10)),
    ("IE0171", "Aliyu", "Garba", "ELE", "Electrical Technician", date(1967, 8, 30), date(2001, 5, 3)),
    ("IE0198", "Patience", "Amadi", "HRA", "Admin Officer", date(1968, 4, 11), date(2003, 9, 1)),
    ("IE0203", "Godwin", "Etim", "INS", "Instrument Technician", date(1972, 1, 5), date(1992, 1, 6)),
    ("IE0310", "Florence", "Nwachukwu", "FIN", "Accountant", date(1980, 7, 7), date(2010, 2, 1)),
    ("IE0411", "Daniel", "Okafor", "ICT", "Systems Analyst", date(1985, 11, 23), date(2014, 8, 4)),
    ("IE0522", "Rita", "Obiora", "PROD", "Panel Operator", date(1988, 3, 14), date(2015, 1, 12)),
    ("IE0533", "Kingsley", "Uko", "LOG", "Shipping Officer", date(1990, 9, 9), date(2016, 7, 1)),
]

CANDIDATES = [
    # key, profile, source, requisition key, file type
    ("okafor", dict(first="Chinedu", last="Okafor", email="chinedu.okafor@example.com", phone="0803 123 4567",
                    summary="Chemical engineer with 6 years of experience in ammonia and urea plant operations, process optimisation and HAZOP studies.",
                    jobs=[dict(title="Process Engineer", company="Notore Chemical Industries Plc", start="March 2020", end="Present",
                               bullets=["Optimised CO2 removal and steam reforming performance using Aspen HYSYS",
                                        "Led HAZOP reviews and management of change (MOC)", "Root cause analysis of reformer trips"]),
                          dict(title="Panel Operator", company="Indorama Eleme Petrochemicals Ltd", start="Jan 2018", end="Feb 2020",
                               bullets=["Operated Honeywell Experion DCS", "Plant start-up and shutdown"])],
                    nysc="Ministry of Works, Enugu 2017 - 2018", degree="B.Eng (Hons)", course="Chemical Engineering",
                    school="University of Port Harcourt", year=2016, **{"class": "Second Class Upper Division"},
                    skills=["Process simulation", "Process optimisation", "Root cause analysis", "Team leadership", "Microsoft Excel"],
                    certs=["COREN Registered Engineer", "NEBOSH IGC", "HSE Level 2"]), Candidate.Source.PORTAL, "pe", "pdf"),
    ("uche", dict(first="Amaka", last="Uche", email="amaka.uche@example.com", phone="0816 555 2211",
                  summary="Process engineer with 5 years in fertilizer and gas processing, strong in simulation and catalyst management.",
                  jobs=[dict(title="Process Engineer", company="Dangote Fertiliser Ltd", start="Feb 2021", end="Present",
                             bullets=["Aspen Plus and Aspen HYSYS modelling of urea synthesis loop", "Catalyst management and reformer optimisation",
                                      "HAZOP facilitator"]),
                        dict(title="Graduate Engineer", company="Nigeria LNG Limited", start="2019", end="2021", bullets=["Process troubleshooting"])],
                  nysc="Bonny, Rivers State 2018 - 2019", degree="B.Sc.", course="Chemical Engineering", school="University of Lagos",
                  year=2017, **{"class": "First Class"}, skills=["HAZOP", "Process simulation", "Catalyst management", "Steam reforming"],
                  certs=["COREN", "Six Sigma Green Belt"]), Candidate.Source.REFERRAL, "pe", "docx"),
    ("danjuma", dict(first="Musa", last="Danjuma", email="musa.danjuma@example.com", phone="0705 432 1098",
                     summary="Process engineer with 4 years of experience in refinery operations.",
                     jobs=[dict(title="Process Engineer", company="Kaduna Refining and Petrochemical Company", start="June 2022", end="Present",
                                bullets=["Process optimisation of crude distillation", "Root cause analysis", "Used DCS and Microsoft Excel"])],
                     degree="B.Eng", course="Petroleum Engineering", school="Ahmadu Bello University", year=2019,
                     skills=["Process optimisation", "Root cause analysis"], certs=["NSE Membership"]), Candidate.Source.EMAIL, "pe", "pdf"),
    ("omoregie", dict(first="Efe", last="Omoregie", email="efe.omoregie@example.com", phone="0809 876 5432",
                      summary="Industrial chemist with 3 years in quality control and plant support.",
                      jobs=[dict(title="Quality Control Chemist", company="Lafarge Africa Plc", start="Jan 2023", end="Present",
                                 bullets=["Instrumental analysis", "Process troubleshooting support"])],
                      degree="B.Sc.", course="Industrial Chemistry", school="University of Benin", year=2020,
                      skills=["Instrumental analysis", "Root cause analysis"], certs=[]), Candidate.Source.PORTAL, "pe", "docx"),
    ("adeyemi", dict(first="Funke", last="Adeyemi", email="funke.adeyemi@example.com", phone="0812 345 6789",
                     summary="Chemical engineer with 7 years in petrochemical process engineering and energy efficiency.",
                     jobs=[dict(title="Senior Process Engineer", company="Eleme Petrochemicals Company Ltd", start="Apr 2019", end="Present",
                                bullets=["Aspen HYSYS simulations", "HAZOP and MOC", "Energy efficiency projects"]),
                           dict(title="Process Engineer", company="Total Energies EP Nigeria", start="2017", end="2019", bullets=["Process optimisation"])],
                     degree="M.Sc.", course="Chemical Engineering", school="University of Ibadan", year=2016,
                     skills=["Process simulation", "Energy efficiency", "Steam reforming"], certs=["COREN", "NEBOSH IGC"]),
     Candidate.Source.AGENCY, "pe", "pdf"),
    ("ogbu", dict(first="Kelechi", last="Ogbu", email="kelechi.ogbu@example.com", phone="0703 111 2233",
                  summary="Accountant with 4 years of experience in audit and financial reporting.",
                  jobs=[dict(title="Audit Associate", company="KPMG Nigeria", start="2021", end="Present", bullets=["Financial reporting (IFRS)"])],
                  degree="B.Sc.", course="Accounting", school="Nnamdi Azikiwe University", year=2019,
                  skills=["Financial reporting (IFRS)", "Microsoft Excel"], certs=["ICAN"]), Candidate.Source.PORTAL, "pe", "pdf"),
    ("bello", dict(first="Yusuf", last="Bello", email="yusuf.bello@example.com", phone="0802 999 8888",
                   summary="Mechanical engineer with 8 years maintaining compressors, steam turbines and pumps in fertilizer plants.",
                   jobs=[dict(title="Rotating Equipment Engineer", company="Notore Chemical Industries Plc", start="2018", end="Present",
                              bullets=["Compressor overhaul and steam turbine maintenance", "Vibration analysis and laser alignment",
                                       "Root cause failure analysis", "SAP PM work orders"]),
                         dict(title="Maintenance Engineer", company="Nigerian Breweries Plc", start="2016", end="2018", bullets=["Pump alignment"])],
                   degree="B.Eng", course="Mechanical Engineering", school="Federal University of Technology Owerri", year=2015,
                   skills=["Rotating equipment maintenance", "Preventive maintenance"], certs=["COREN", "Vibration Analyst Cat II"]),
     Candidate.Source.PORTAL, "rot", "pdf"),
    ("okon", dict(first="Peter", last="Okon", email="peter.okon@example.com", phone="0806 777 1212",
                  summary="Mechanical engineer with 5 years in oil and gas rotating equipment.",
                  jobs=[dict(title="Mechanical Engineer", company="Shell Petroleum Development Company", start="2020", end="Present",
                             bullets=["Pump alignment", "Preventive maintenance", "IBM Maximo"])],
                  degree="B.Eng", course="Mechanical Engineering", school="University of Uyo", year=2018,
                  skills=["Preventive maintenance", "Pump alignment"], certs=["NSE Membership"]), Candidate.Source.EMAIL, "rot", "docx"),
    ("ibekwe", dict(first="Tobechi", last="Ibekwe", email="tobechi.ibekwe@example.com", phone="0814 222 3344",
                    summary="Fresh chemical engineering graduate, first class, passionate about process plants.",
                    jobs=[dict(title="NYSC Corps Member", company="Rivers State Ministry of Energy", start="2024", end="2025", bullets=["Data analysis in Microsoft Excel"])],
                    degree="B.Eng", course="Chemical Engineering", school="Federal University of Technology Owerri", year=2023,
                    **{"class": "First Class"}, skills=["Process simulation", "Microsoft Excel", "Team leadership"], certs=["HSE Level 1"]),
     Candidate.Source.PORTAL, "gt", "pdf"),
    ("hassan", dict(first="Aisha", last="Hassan", email="aisha.hassan@example.com", phone="0810 444 5566",
                    summary="Graduate mechanical engineer with industrial training at a fertilizer plant.",
                    jobs=[dict(title="NYSC Corps Member", company="Indorama Eleme Fertilizer (IT placement)", start="2024", end="2025", bullets=["Plant start-up and shutdown support"])],
                    degree="B.Eng", course="Mechanical Engineering", school="Ahmadu Bello University", year=2023,
                    **{"class": "Second Class Upper Division"}, skills=["AutoCAD", "Microsoft Excel"], certs=["HSE Level 1"]),
     Candidate.Source.REFERRAL, "gt", "docx"),
    ("etuk", dict(first="Victor", last="Etuk", email="victor.etuk@example.com", phone="0818 666 7788",
                  summary="Industrial chemistry graduate.", jobs=[],
                  degree="B.Sc.", course="Industrial Chemistry", school="University of Calabar", year=2024,
                  **{"class": "Second Class Lower Division"}, skills=["Microsoft Excel"], certs=[]), Candidate.Source.PORTAL, "gt", "pdf"),
    ("nwankwo", dict(first="Chiamaka", last="Nwankwo", email="chiamaka.nwankwo@example.com", phone="0817 888 9900",
                     summary="Electrical/electronics engineering graduate with PLC project experience.",
                     jobs=[dict(title="NYSC Corps Member", company="PHED", start="2024", end="2025", bullets=["PLC programming project"])],
                     degree="B.Eng", course="Electrical/Electronics Engineering", school="University of Nigeria Nsukka", year=2023,
                     **{"class": "Second Class Upper Division"}, skills=["PLC programming", "Microsoft Excel"], certs=[]),
     Candidate.Source.HARD_COPY, "gt", "pdf"),
    ("lawal", dict(first="Rukayat", last="Lawal", email="rukayat.lawal@example.com", phone="0813 101 2020",
                   summary="Laboratory analyst with 3 years in fertilizer quality testing.",
                   jobs=[dict(title="Laboratory Analyst", company="Golden Penny Flour Mills", start="2022", end="2025",
                              bullets=["Wet chemical analysis", "Gas chromatography (GC)", "Karl Fischer titrator"])],
                   degree="B.Sc.", course="Industrial Chemistry", school="Lagos State University", year=2020,
                   skills=["Wet chemical analysis", "Fertilizer quality testing"], certs=["ISO/IEC 17025"]), Candidate.Source.PORTAL, "lab", "pdf"),
]


class Command(BaseCommand):
    help = "Load demo departments, users, staff, requisitions and candidates at every stage."

    def add_arguments(self, parser):
        parser.add_argument("--password", default="Demo@2026")

    def handle(self, *args, **options):
        if Department.objects.exists():
            self.stdout.write(self.style.WARNING("Data already exists — skipping. Use a fresh database for the demo."))
            return
        random.seed(7)
        with override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"):
            self._seed(options["password"])

    # ------------------------------------------------------------------
    def _seed(self, password):
        now = timezone.now()
        depts = {code: Department.objects.create(code=code, name=name, email="") for code, name in DEPARTMENTS}
        users = {}
        for username, first, last, role, dept, title in USERS:
            user = User.objects.create_user(username=username, password=password, first_name=first, last_name=last,
                                            email=f"{username}@example.com", role=role, job_title=title,
                                            department=depts.get(dept))
            users[username] = user
        admin = User.objects.create_superuser("admin", "admin@example.com", password, first_name="System",
                                              last_name="Administrator", role=User.Role.HR_ADMIN, department=depts["HRA"])
        users["admin"] = admin
        for code, username in (("PROD", "hod.production"), ("MMD", "hod.maintenance"), ("ICT", "hod.ict"), ("HSE", "hod.hse")):
            depts[code].hod = users[username]
            depts[code].save()

        for title, dept, family, grade, exp in ROLES:
            fam = JOB_FAMILIES[family]
            JobRole.objects.create(
                title=title, department=depts[dept], job_family=family, grade=grade, default_min_experience=exp,
                default_education="bsc", default_skills=fam["skills"][:6], default_tools=fam["tools"][:4],
                default_certifications=fam["certifications"][:2], default_courses=fam["courses"][:3],
            )

        employees = {}
        for staff_id, first, last, dept, title, dob, employed in EMPLOYEES:
            employees[staff_id] = Employee.objects.create(staff_id=staff_id, first_name=first, last_name=last,
                                                          department=depts[dept], job_title=title, grade="S4",
                                                          date_of_birth=dob, date_of_employment=employed)
        employees["IE0411"].status = Employee.Status.RESIGNED
        employees["IE0411"].exit_date = timezone.localdate() - timedelta(days=20)
        employees["IE0411"].save()

        hr, rec = users["hr.admin"], users["recruiter"]

        def requisition(key, **kw):
            req = Requisition.objects.create(**kw)
            return key, req

        reqs = dict([
            requisition("pe", department=depts["PROD"], job_role=JobRole.objects.get(title="Process Engineer"),
                        title="Process Engineer", positions=2, reason=Requisition.Reason.RETIREMENT,
                        replacing_employee=employees["IE0112"], employment_type="experienced", grade="M5",
                        min_experience_years=3, max_experience_years=10, education_level="bsc",
                        courses=["Chemical Engineering", "Petroleum Engineering"],
                        required_skills=["HAZOP", "Process simulation", "Process optimisation", "Root cause analysis", "Steam reforming"],
                        preferred_skills=["Management of change (MOC)", "Catalyst management"],
                        tools=["Aspen HYSYS", "DCS", "Microsoft Excel"], certifications=["COREN", "NEBOSH IGC"],
                        other_requirements="Willingness to work in a 24/7 plant environment.",
                        justification="Replacement for Joseph Ekanem (retiring Dec 2026) and one additional engineer for the urea expansion.",
                        job_description="Support ammonia and urea plant performance, lead HAZOP/MOC reviews, optimise energy use.",
                        raised_by=users["hod.production"], closing_date=timezone.localdate() + timedelta(days=21)),
            requisition("rot", department=depts["MMD"], job_role=JobRole.objects.get(title="Rotating Equipment Engineer"),
                        title="Rotating Equipment Engineer", positions=1, reason=Requisition.Reason.RESIGNATION,
                        replacing_employee=employees["IE0156"], employment_type="experienced", grade="M5",
                        min_experience_years=5, education_level="bsc", courses=["Mechanical Engineering"],
                        required_skills=["Rotating equipment maintenance", "Vibration analysis", "Compressor overhaul",
                                         "Root cause failure analysis", "Pump alignment"],
                        tools=["SAP PM", "Vibration analyser"], certifications=["COREN"],
                        justification="Critical role for the syngas compressor and steam turbines.",
                        raised_by=users["hod.maintenance"]),
            requisition("gt", department=depts["PROD"], job_role=JobRole.objects.get(title="Graduate Trainee — Process Operations"),
                        title="Graduate Trainee — Process Operations", positions=4, reason=Requisition.Reason.NEW_POSITION,
                        employment_type="trainee", grade="GT", min_experience_years=0, education_level="bsc",
                        min_degree_class="2_1", requires_nysc=True,
                        courses=["Chemical Engineering", "Mechanical Engineering", "Industrial Chemistry",
                                 "Electrical/Electronics Engineering"],
                        required_skills=["Process troubleshooting", "Team leadership"], tools=["Microsoft Excel"],
                        other_requirements="Willingness to work shifts at the Onne plant.",
                        justification="2026 graduate trainee intake for the operations pool.", raised_by=users["hod.production"]),
            requisition("net", department=depts["ICT"], title="Network Administrator", positions=1,
                        job_role=JobRole.objects.get(title="Network Administrator"),
                        reason=Requisition.Reason.RESIGNATION, replacing_employee=employees["IE0411"],
                        employment_type="experienced", min_experience_years=4, education_level="bsc",
                        courses=["Computer Science", "Computer Engineering"],
                        required_skills=["Network administration", "Cybersecurity", "OT/ICS security"],
                        tools=["Cisco", "Fortinet", "Active Directory"], certifications=["CCNA"],
                        justification="Daniel Okafor resigned; plant network needs cover.", raised_by=users["hod.ict"]),
            requisition("hse", department=depts["HSE"], title="HSE Officer", positions=1,
                        reason=Requisition.Reason.NEW_POSITION, employment_type="experienced", min_experience_years=3,
                        education_level="bsc", required_skills=["Risk assessment", "Incident investigation"],
                        certifications=["NEBOSH IGC"], raised_by=users["hod.hse"]),
            requisition("ins", department=depts["INS"], title="Instrumentation Technician", positions=2,
                        job_role=JobRole.objects.get(title="Instrumentation Technician"),
                        reason=Requisition.Reason.RETIREMENT, replacing_employee=employees["IE0203"],
                        employment_type="experienced", min_experience_years=3, education_level="hnd",
                        courses=["Electrical/Electronics Engineering", "Instrumentation Engineering"],
                        required_skills=["Instrument calibration", "Control loop tuning", "Loop checking and commissioning"],
                        tools=["Yokogawa CENTUM VP", "Fluke calibrators"], raised_by=rec),
            requisition("lab", department=depts["LAB"], title="Laboratory Analyst", positions=1,
                        job_role=JobRole.objects.get(title="Laboratory Analyst"),
                        reason=Requisition.Reason.NEW_POSITION, employment_type="experienced", min_experience_years=2,
                        education_level="bsc", courses=["Industrial Chemistry", "Chemistry"],
                        required_skills=["Wet chemical analysis", "Fertilizer quality testing"],
                        tools=["Gas chromatography (GC)", "Karl Fischer titrator"], raised_by=users["manager.lab"]),
        ])

        # Approval flow
        for key in ("pe", "rot", "gt", "ins", "lab"):
            req_services.submit(reqs[key], actor=reqs[key].raised_by)
            req_services.approve(reqs[key], actor=hr, hr_owner=rec)
        for key in ("pe", "rot", "gt", "lab"):
            reqs[key].advert = draft_job_advert(reqs[key])
            reqs[key].save(update_fields=["advert"])
            req_services.publish(reqs[key], actor=rec, closing_date=reqs[key].closing_date or timezone.localdate() + timedelta(days=30))
        req_services.submit(reqs["net"], actor=users["hod.ict"])
        req_services.add_note(reqs["net"], author=users["hod.ict"],
                              message="This is urgent — the OT network upgrade starts next quarter.")
        req_services.submit(reqs["hse"], actor=users["hod.hse"])
        req_services.return_for_changes(reqs["hse"], actor=hr, reason="Please add the accepted courses and required tools.")

        # Candidates: generated CV files through the real intake pipeline
        apps = {}
        for index, (key, profile, source, req_key, kind) in enumerate(CANDIDATES):
            lines = cv_lines(profile)
            content = simple_pdf(lines) if kind == "pdf" else simple_docx(lines)
            filename = f"{profile['first']}_{profile['last']}_CV.{kind}"
            referred_by = users["staff.referrer"] if source == Candidate.Source.REFERRAL else None
            result = ingest_cv(content, filename, source=source, requisition=reqs[req_key], user=rec if source != "portal" else None,
                               referred_by=referred_by, referral_note="Worked with them on a turnaround." if referred_by else "",
                               notify_team=False)
            result.candidate.consent_given = True
            result.candidate.save(update_fields=["consent_given"])
            app = result.application
            Application.objects.filter(pk=app.pk).update(applied_at=now - timedelta(days=30 - index), stage_changed_at=now - timedelta(days=12))
            app.refresh_from_db()
            apps[key] = app

        criteria = list(EvaluationCriterion.objects.all())
        local_now = timezone.localtime(now)

        def at(days, hour=10):
            """A tidy interview time: `days` from today at `hour`:00 local time."""
            return (local_now + timedelta(days=days)).replace(hour=hour, minute=0, second=0, microsecond=0)

        def run_interviews(app, days_ago, strength, technical_panel, hod_user):
            """Three phases: technical (panel), behavioural (HR), HOD interview (HOD alone)."""
            plan = [(Interview.Round.TECHNICAL, technical_panel, 10), (Interview.Round.BEHAVIOURAL, [rec], 12),
                    (Interview.Round.HOD, [hod_user], 14)]
            for offset, (round_, members, hour) in enumerate(plan):
                interview = services.schedule_interview(
                    app, round=round_, scheduled_at=at(-(days_ago - offset), hour), mode=Interview.Mode.IN_PERSON,
                    location="Admin Block, Conference Room 2", panel=members, actor=rec, send=False)
                services.complete_interview(interview, actor=rec)
                for member in members:
                    good = strength > 0.7
                    evaluation = Evaluation.objects.create(
                        application=app, interview=interview, evaluator=member,
                        recommendation="select" if good else "on_hold",
                        remarks={Interview.Round.TECHNICAL: "Strong grasp of plant fundamentals; solved the case study well."
                                 if good else "Adequate fundamentals; limited plant exposure.",
                                 Interview.Round.BEHAVIOURAL: "Communicates clearly; good team examples and HSE mindset."
                                 if good else "Needs more structured answers.",
                                 Interview.Round.HOD: "Good fit for the team; ready to take on shift responsibilities."
                                 if good else "Would need close supervision initially."}[round_],
                    )
                    total = Decimal("0")
                    for criterion in criteria:
                        marks = Decimal(str(round(criterion.max_marks * min(1, max(0.2, strength + random.uniform(-0.08, 0.06))) * 2) / 2))
                        EvaluationScore.objects.create(evaluation=evaluation, criterion=criterion, marks=marks)
                        total += marks
                    evaluation.total = total
                    evaluation.submitted_at = interview.scheduled_at + timedelta(hours=2)
                    evaluation.save()

        hod_prod, hod_mech = users["hod.production"], users["hod.maintenance"]
        tech_panel = [users["interviewer"], rec]

        # Process Engineer pipeline
        for key in ("okafor", "uche", "danjuma", "adeyemi"):
            services.shortlist(apps[key], actor=rec)
        run_interviews(apps["okafor"], 9, 0.86, tech_panel, hod_prod)
        services.record_decision(apps["okafor"], "select", notes="Strongest technical interview.", actor=rec)
        self._upload_all_documents(apps["okafor"], rec, verify=True)
        services.clear_documents(apps["okafor"], actor=rec)
        offer = services.create_offer(apps["okafor"], job_title="Process Engineer", grade="M5",
                                      annual_salary=Decimal("14400000"), benefits="Housing, transport and HMO; annual bonus.",
                                      start_date=timezone.localdate() + timedelta(days=45),
                                      negotiation_notes="Candidate currently earns ₦12.6m.", actor=rec)
        services.send_offer(offer, actor=rec)
        services.candidate_offer_response(offer, "review", comment="Grateful for the offer; hoping for alignment with market rate.",
                                          counter_salary=Decimal("16800000"))

        run_interviews(apps["adeyemi"], 6, 0.78, tech_panel, hod_prod)
        services.schedule_interview(apps["uche"], round=Interview.Round.TECHNICAL, scheduled_at=at(2, 10),
                                    mode=Interview.Mode.VIDEO, panel=tech_panel, actor=rec, send=False,
                                    instructions="Please prepare a 10-minute case study on reformer efficiency.")
        services.candidate_interview_response(apps["uche"].interviews.first(), "confirmed", "Looking forward to it.")
        services.schedule_interview(apps["danjuma"], round=Interview.Round.TECHNICAL, scheduled_at=at(3, 11),
                                    mode=Interview.Mode.IN_PERSON, location="Admin Block, Conference Room 2", panel=tech_panel, actor=rec,
                                    send=False)
        services.set_status(apps["omoregie"], Application.Status.ON_HOLD, actor=rec, reason="Kept in reserve")

        # Rotating equipment: offer accepted → medicals
        services.shortlist(apps["bello"], actor=rec)
        run_interviews(apps["bello"], 14, 0.84, [hod_mech, rec], hod_mech)
        services.record_decision(apps["bello"], "select", actor=rec)
        self._upload_all_documents(apps["bello"], rec, verify=True)
        services.clear_documents(apps["bello"], actor=rec)
        offer = services.create_offer(apps["bello"], job_title="Rotating Equipment Engineer", grade="M5",
                                      annual_salary=Decimal("15600000"), start_date=timezone.localdate() + timedelta(days=30), actor=rec)
        services.send_offer(offer, actor=rec)
        services.candidate_offer_response(offer, "accept", comment="Delighted to accept.")
        services.schedule_medical(apps["bello"], scheduled_for=at(1, 9), facility="IEFCL Clinic, Onne", actor=rec)
        services.shortlist(apps["okon"], actor=rec)

        # Graduate trainees: one in document review, one onboarding
        for key in ("ibekwe", "hassan", "nwankwo"):
            services.shortlist(apps[key], actor=rec)
        run_interviews(apps["ibekwe"], 10, 0.9, tech_panel, hod_prod)
        services.record_decision(apps["ibekwe"], "select", actor=rec)
        self._upload_all_documents(apps["ibekwe"], None, verify=True)
        services.clear_documents(apps["ibekwe"], actor=rec)  # trainee → onboarding directly
        run_interviews(apps["hassan"], 5, 0.8, tech_panel, hod_prod)
        services.record_decision(apps["hassan"], "select", actor=rec)
        self._upload_all_documents(apps["hassan"], None, verify=False, skip=["birth"])

        # Laboratory analyst: fully hired
        services.shortlist(apps["lawal"], actor=rec)
        run_interviews(apps["lawal"], 40, 0.82, [users["manager.lab"], rec], users["manager.lab"])
        services.record_decision(apps["lawal"], "select", actor=rec)
        self._upload_all_documents(apps["lawal"], rec, verify=True)
        services.clear_documents(apps["lawal"], actor=rec)
        offer = services.create_offer(apps["lawal"], job_title="Laboratory Analyst", annual_salary=Decimal("7200000"),
                                      start_date=timezone.localdate() - timedelta(days=5), actor=rec)
        services.send_offer(offer, actor=rec)
        services.candidate_offer_response(offer, "accept")
        medical = services.schedule_medical(apps["lawal"], scheduled_for=at(-12, 9), facility="IEFCL Clinic, Onne", actor=rec)
        services.record_medical_result(medical, MedicalCheck.Result.FIT, actor=rec)
        onboarding = apps["lawal"].onboarding
        onboarding.staff_id = "IE0990"
        onboarding.save()
        for task in onboarding.tasks.all():
            task.done, task.done_by, task.done_at = True, users["onboarding"], now - timedelta(days=2)
            task.save()
        services.complete_onboarding(onboarding, actor=users["onboarding"])
        Application.objects.filter(pk=apps["lawal"].pk).update(hired_at=now - timedelta(days=3))

        onboarding = apps["ibekwe"].onboarding
        for task in list(onboarding.tasks.all())[:3]:
            task.done, task.done_by, task.done_at = True, users["onboarding"], now
            task.save()

        self.stdout.write(self.style.SUCCESS("Demo data loaded."))
        self.stdout.write("Sign in at /accounts/login/ with any of these usernames (password: %s):" % password)
        for username, first, last, role, dept, title in USERS:
            self.stdout.write(f"  {username:<16} {User.Role(role).label} {('· ' + dept) if dept else ''}")
        self.stdout.write("  admin            Superuser (admin site)")

    def _upload_all_documents(self, app, user, *, verify, skip=()):
        from candidates.models import CandidateDocument as Doc

        for requirement in services.required_documents(app):
            if requirement.doc_type in skip:
                continue
            label = requirement.get_doc_type_display()
            content = simple_pdf([label.upper(), app.candidate.full_name, "Demo document"])
            doc = save_document(app.candidate, content=content, filename=f"{requirement.doc_type}.pdf",
                                doc_type=requirement.doc_type, user=user, application=app)
            if verify:
                services.review_document(doc, Doc.Status.VERIFIED, actor=user or User.objects.filter(role="recruiter").first())
