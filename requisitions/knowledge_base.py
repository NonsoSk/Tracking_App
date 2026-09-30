"""
Built-in skills / tools knowledge base for a fertilizer & petrochemical plant.

Used to (1) suggest skills and tools when a department raises a requisition,
(2) detect skills in CVs, and (3) normalise spellings during matching. It works
without any AI; when Claude is configured its suggestions are merged on top.
HR can extend it from the admin (Skill tags) without touching code.
"""

JOB_FAMILIES = {
    "process_operations": {
        "label": "Production / Process Operations",
        "keywords": ["operator", "operations", "production", "process technician", "control room", "shift",
                     "ammonia", "urea", "plant", "panel", "field operator", "granulation", "utilities"],
        "skills": ["Plant start-up and shutdown", "Ammonia synthesis", "Urea synthesis", "Steam reforming",
                   "CO2 removal", "Granulation", "Process troubleshooting", "Shift handover", "Permit to work",
                   "Process safety management", "Equipment isolation (LOTO)", "Log sheet reporting",
                   "Boiler and utilities operation", "Cooling water treatment", "Emergency response"],
        "tools": ["DCS", "Honeywell Experion", "Yokogawa CENTUM VP", "Emerson DeltaV", "SCADA", "PI System",
                  "SAP PM", "Microsoft Excel"],
        "certifications": ["HSE Level 1", "HSE Level 2", "NEBOSH IGC", "Process Safety (PSM) certificate"],
        "courses": ["Chemical Engineering", "Petroleum Engineering", "Industrial Chemistry", "Chemical Technology",
                    "Mechanical Engineering"],
    },
    "process_engineering": {
        "label": "Process / Chemical Engineering",
        "keywords": ["process engineer", "chemical engineer", "technical services", "optimisation", "optimization",
                     "process design"],
        "skills": ["Process simulation", "Mass and energy balance", "HAZOP", "Process optimisation",
                   "Root cause analysis", "P&ID review", "Heat exchanger design", "Catalyst management",
                   "Management of change (MOC)", "Energy efficiency", "Technical report writing"],
        "tools": ["Aspen HYSYS", "Aspen Plus", "PRO/II", "HTRI", "AutoCAD", "PI System", "Microsoft Excel", "MATLAB"],
        "certifications": ["COREN", "NSE Membership", "Six Sigma Green Belt", "NEBOSH IGC"],
        "courses": ["Chemical Engineering", "Petroleum Engineering", "Process Engineering", "Petrochemical Engineering"],
    },
    "mechanical_maintenance": {
        "label": "Mechanical / Rotating Equipment Maintenance",
        "keywords": ["mechanical", "rotating", "maintenance", "fitter", "machinist", "static equipment",
                     "reliability", "turbine", "compressor", "pump", "millwright", "welder"],
        "skills": ["Preventive maintenance", "Predictive maintenance", "Rotating equipment maintenance",
                   "Compressor overhaul", "Steam turbine maintenance", "Pump alignment", "Vibration analysis",
                   "Bearing and seal replacement", "Root cause failure analysis", "Welding and fabrication",
                   "Static equipment inspection", "Lubrication management", "Shutdown / turnaround maintenance"],
        "tools": ["SAP PM", "IBM Maximo", "Laser alignment tools", "Vibration analyser", "AutoCAD", "SolidWorks",
                  "Thermography camera", "Microsoft Excel"],
        "certifications": ["COREN", "NSE Membership", "ASNT NDT Level II", "Vibration Analyst Cat II",
                           "API 510", "HSE Level 2"],
        "courses": ["Mechanical Engineering", "Production Engineering", "Marine Engineering", "Metallurgical Engineering"],
    },
    "electrical": {
        "label": "Electrical Engineering & Maintenance",
        "keywords": ["electrical", "electrician", "power", "substation", "switchgear", "generator"],
        "skills": ["High voltage switching", "Transformer maintenance", "Motor rewinding and testing",
                   "Protection relay testing", "Power distribution", "Electrical troubleshooting",
                   "Gas turbine generator operation", "UPS and battery systems", "Cable termination",
                   "Hazardous area (Ex) installations", "Electrical isolation (LOTO)"],
        "tools": ["ETAP", "AutoCAD Electrical", "Megger insulation tester", "Relay test kits", "SAP PM", "PLC"],
        "certifications": ["COREN", "CompEx", "NSE Membership", "HSE Level 2", "High Voltage Authorisation"],
        "courses": ["Electrical Engineering", "Electrical/Electronics Engineering", "Power Systems Engineering"],
    },
    "instrumentation_control": {
        "label": "Instrumentation & Control",
        "keywords": ["instrument", "instrumentation", "control systems", "automation", "i&c", "analyser", "analyzer",
                     "dcs engineer", "plc"],
        "skills": ["Instrument calibration", "Control loop tuning", "DCS configuration", "PLC programming",
                   "Safety instrumented systems", "Analyser maintenance", "Fire and gas systems",
                   "Control valve maintenance", "HART / Foundation Fieldbus", "Loop checking and commissioning"],
        "tools": ["Honeywell Experion", "Yokogawa CENTUM VP", "Emerson DeltaV", "Triconex", "Siemens S7 / TIA Portal",
                  "Allen-Bradley / Rockwell", "Fluke calibrators", "AMS Device Manager", "SAP PM"],
        "certifications": ["COREN", "ISA CCST", "TÜV Functional Safety Engineer", "CompEx", "HSE Level 2"],
        "courses": ["Electrical/Electronics Engineering", "Instrumentation Engineering", "Control Engineering",
                    "Mechatronics Engineering"],
    },
    "hse": {
        "label": "Health, Safety & Environment",
        "keywords": ["hse", "safety", "health", "environment", "ehs", "fire", "industrial hygiene", "sustainability"],
        "skills": ["Risk assessment", "Incident investigation", "HAZOP / HAZID", "Permit to work administration",
                   "Safety audits and inspections", "Emergency response planning", "Environmental monitoring",
                   "Waste management", "Industrial hygiene", "Safety training delivery", "Fire fighting",
                   "Regulatory compliance (NESREA, NOSDRA, DPR/NUPRC)"],
        "tools": ["Microsoft Office", "Incident management software", "Gas detectors", "Enablon", "Power BI"],
        "certifications": ["NEBOSH IGC", "NEBOSH Diploma", "IOSH Managing Safely", "ISO 45001 Lead Auditor",
                           "ISO 14001 Lead Auditor", "HSE Level 3", "OSHA 30", "ISPON"],
        "courses": ["Environmental Science", "Chemical Engineering", "Industrial Safety", "Environmental Management",
                    "Occupational Health and Safety"],
    },
    "laboratory_qc": {
        "label": "Laboratory / Quality Control",
        "keywords": ["laboratory", "lab", "chemist", "analyst", "quality control", "qc", "quality assurance", "qa"],
        "skills": ["Wet chemical analysis", "Instrumental analysis", "Sample preparation", "Water analysis",
                   "Fertilizer quality testing", "Method validation", "Laboratory safety", "Good laboratory practice",
                   "Statistical process control", "Calibration of lab equipment"],
        "tools": ["Gas chromatography (GC)", "HPLC", "UV-Vis spectrophotometer", "AAS", "ICP-OES", "Karl Fischer titrator",
                  "LIMS", "Microsoft Excel"],
        "certifications": ["ISO/IEC 17025", "ISO 9001 Internal Auditor", "Institute of Chartered Chemists of Nigeria (ICCON)"],
        "courses": ["Industrial Chemistry", "Pure and Applied Chemistry", "Chemistry", "Biochemistry", "Chemical Engineering"],
    },
    "inspection_integrity": {
        "label": "Inspection & Asset Integrity",
        "keywords": ["inspection", "integrity", "corrosion", "ndt", "inspector"],
        "skills": ["Risk-based inspection", "Corrosion monitoring", "Non-destructive testing", "Pressure vessel inspection",
                   "Piping inspection", "Fitness-for-service assessment", "Cathodic protection"],
        "tools": ["Ultrasonic thickness gauge", "Meridium APM", "SAP PM", "AutoCAD"],
        "certifications": ["API 510", "API 570", "API 653", "ASNT NDT Level II", "CSWIP 3.1", "NACE CIP"],
        "courses": ["Mechanical Engineering", "Metallurgical and Materials Engineering", "Chemical Engineering"],
    },
    "project_engineering": {
        "label": "Projects & Engineering",
        "keywords": ["project", "projects", "engineering manager", "civil", "structural", "planner", "planning", "scheduler"],
        "skills": ["Project planning and scheduling", "Cost control", "Contract management", "Construction supervision",
                   "Commissioning", "Stakeholder management", "Risk management", "Engineering design review"],
        "tools": ["Primavera P6", "Microsoft Project", "AutoCAD", "SAP PS", "Microsoft Excel", "Navisworks"],
        "certifications": ["PMP", "PRINCE2", "COREN", "NSE Membership"],
        "courses": ["Civil Engineering", "Mechanical Engineering", "Chemical Engineering", "Project Management",
                    "Quantity Surveying"],
    },
    "it": {
        "label": "Information Technology",
        "keywords": ["it ", "ict", "information technology", "software", "developer", "network", "systems administrator",
                     "sap basis", "cyber", "data analyst", "database", "helpdesk", "support engineer", "erp"],
        "skills": ["Network administration", "System administration", "IT support", "Cybersecurity", "Database administration",
                   "Software development", "ERP support", "Data analysis", "Cloud administration", "ITIL service management",
                   "OT/ICS security"],
        "tools": ["Microsoft 365", "Active Directory", "Windows Server", "Linux", "Cisco", "Fortinet", "VMware",
                  "SAP", "SQL Server", "Python", "Power BI", "Azure"],
        "certifications": ["CCNA", "CompTIA Security+", "ITIL Foundation", "Microsoft Certified: Azure Administrator",
                           "CISSP", "SAP Certified Associate"],
        "courses": ["Computer Science", "Computer Engineering", "Information Technology", "Electrical/Electronics Engineering"],
    },
    "finance": {
        "label": "Finance & Accounts",
        "keywords": ["finance", "account", "accountant", "treasury", "audit", "tax", "payroll", "budget", "controller"],
        "skills": ["Financial reporting (IFRS)", "Management accounting", "Budgeting and forecasting", "Tax compliance",
                   "Accounts payable / receivable", "Treasury management", "Internal audit", "Cost accounting",
                   "Reconciliations", "Fixed asset accounting"],
        "tools": ["SAP FICO", "Microsoft Excel", "Oracle Financials", "Sage", "Power BI"],
        "certifications": ["ICAN", "ACCA", "CIMA", "CITN", "CFA"],
        "courses": ["Accounting", "Finance", "Banking and Finance", "Economics", "Business Administration"],
    },
    "hr": {
        "label": "Human Resources & Administration",
        "keywords": ["human resource", "hr ", "hr&a", "recruit", "talent", "payroll officer", "learning", "training",
                     "admin", "administration", "industrial relations"],
        "skills": ["Recruitment and selection", "Employee relations", "Industrial relations", "Performance management",
                   "Learning and development", "Compensation and benefits", "HR policy administration",
                   "Onboarding", "Labour law compliance", "HR analytics"],
        "tools": ["SAP SuccessFactors", "SAP HCM", "Microsoft Excel", "Microsoft 365", "Workday"],
        "certifications": ["CIPM", "SHRM-CP", "CIPD", "PHRi"],
        "courses": ["Human Resource Management", "Industrial Relations", "Psychology", "Business Administration",
                    "Public Administration", "Sociology"],
    },
    "procurement": {
        "label": "Procurement & Supply Chain",
        "keywords": ["procurement", "purchasing", "buyer", "supply chain", "sourcing", "contracts", "vendor"],
        "skills": ["Strategic sourcing", "Vendor management", "Contract negotiation", "Tender evaluation",
                   "Inventory management", "Demand planning", "Local content compliance (NCDMB)", "Expediting"],
        "tools": ["SAP MM", "SAP Ariba", "Microsoft Excel", "Oracle SCM"],
        "certifications": ["CIPS", "CIPSMN", "APICS CSCP"],
        "courses": ["Purchasing and Supply", "Supply Chain Management", "Business Administration", "Economics", "Engineering"],
    },
    "logistics_warehouse": {
        "label": "Logistics, Warehouse & Shipping",
        "keywords": ["logistics", "warehouse", "store", "stores", "shipping", "dispatch", "jetty", "fleet", "transport",
                     "bagging", "loading"],
        "skills": ["Warehouse management", "Stock control", "Shipping documentation", "Fleet management",
                   "Bulk product handling", "Jetty operations", "Dispatch planning", "Forklift operation"],
        "tools": ["SAP MM", "SAP WM", "SAP SD", "Microsoft Excel", "Fleet tracking systems"],
        "certifications": ["CILT", "Forklift licence", "HSE Level 1"],
        "courses": ["Logistics and Transport", "Supply Chain Management", "Business Administration", "Marine Transport"],
    },
    "sales_marketing": {
        "label": "Sales, Marketing & Agronomy",
        "keywords": ["sales", "marketing", "commercial", "agronomist", "agronomy", "customer", "business development",
                     "trade", "export"],
        "skills": ["B2B sales", "Distributor management", "Market analysis", "Customer relationship management",
                   "Agronomy advisory", "Soil fertility management", "Export documentation", "Pricing strategy",
                   "Key account management"],
        "tools": ["SAP SD", "Salesforce", "Microsoft Excel", "Power BI"],
        "certifications": ["NIMN", "CIM", "Certified Crop Adviser"],
        "courses": ["Agriculture", "Agronomy", "Soil Science", "Marketing", "Agricultural Economics", "Business Administration"],
    },
    "legal": {
        "label": "Legal & Compliance",
        "keywords": ["legal", "counsel", "lawyer", "compliance", "company secretary"],
        "skills": ["Contract drafting and review", "Regulatory compliance", "Corporate governance", "Litigation management",
                   "Company secretarial practice", "Data protection (NDPA)"],
        "tools": ["Microsoft Office", "Legal research databases"],
        "certifications": ["Called to the Nigerian Bar (BL)", "ICSAN", "Certified Compliance Professional"],
        "courses": ["Law"],
    },
    "security": {
        "label": "Security",
        "keywords": ["security", "guard", "surveillance", "patrol"],
        "skills": ["Access control", "Security patrol", "Incident reporting", "CCTV monitoring", "Community relations",
                   "Crisis management"],
        "tools": ["CCTV systems", "Access control systems", "Radio communication"],
        "certifications": ["Certified Protection Professional (CPP)", "HSE Level 1"],
        "courses": ["Criminology and Security Studies", "Political Science", "Sociology"],
    },
    "medical": {
        "label": "Medical / Occupational Health",
        "keywords": ["medical", "doctor", "nurse", "clinic", "occupational health", "pharmacist"],
        "skills": ["Occupational health surveillance", "Emergency care", "Pre-employment medicals", "Health education",
                   "Clinical record keeping"],
        "tools": ["Electronic medical records", "Microsoft Office"],
        "certifications": ["MDCN licence", "NMCN licence", "BLS / ACLS", "Occupational Health certificate"],
        "courses": ["Medicine and Surgery", "Nursing", "Public Health", "Pharmacy"],
    },
}

# Common alternative spellings used when matching CVs to requirements.
ALIASES = {
    "microsoft excel": ["excel", "ms excel", "ms-excel", "spreadsheet"],
    "microsoft office": ["ms office", "office suite", "microsoft 365", "office 365"],
    "microsoft project": ["ms project", "msp"],
    "honeywell experion": ["experion", "honeywell dcs", "experion pks"],
    "yokogawa centum vp": ["centum", "centum vp", "yokogawa dcs", "yokogawa"],
    "emerson deltav": ["deltav", "delta v"],
    "siemens s7 / tia portal": ["siemens s7", "tia portal", "step 7", "simatic"],
    "allen-bradley / rockwell": ["allen bradley", "rockwell", "rslogix", "studio 5000"],
    "aspen hysys": ["hysys"],
    "aspen plus": ["aspenplus"],
    "primavera p6": ["primavera", "p6"],
    "sap pm": ["sap plant maintenance"],
    "sap mm": ["sap materials management"],
    "sap fico": ["sap fi/co", "sap fi", "sap co", "sap finance"],
    "ibm maximo": ["maximo"],
    "nebosh igc": ["nebosh", "nebosh international general certificate"],
    "hse level 1": ["hse 1", "hse i"],
    "hse level 2": ["hse 2", "hse ii"],
    "hse level 3": ["hse 3", "hse iii"],
    "coren": ["coren registered", "council for the regulation of engineering in nigeria"],
    "nse membership": ["nse", "nigerian society of engineers", "mnse"],
    "ican": ["aca", "chartered accountant", "institute of chartered accountants of nigeria"],
    "acca": ["association of chartered certified accountants"],
    "cipm": ["chartered institute of personnel management"],
    "pmp": ["project management professional"],
    "ccna": ["cisco certified network associate"],
    "equipment isolation (loto)": ["loto", "lockout tagout", "lock out tag out"],
    "hazop": ["hazop study", "hazard and operability"],
    "vibration analysis": ["vibration monitoring", "condition monitoring"],
    "plc programming": ["programmable logic controller", "plc programming and troubleshooting"],
    "chemical engineering": ["chemical and petroleum engineering", "chemical/petrochemical engineering"],
    "electrical/electronics engineering": ["electrical and electronics engineering", "electrical electronic engineering",
                                           "eee", "electrical & electronics engineering"],
    "industrial chemistry": ["applied chemistry", "pure and industrial chemistry"],
    "computer science": ["computer sciences"],
    "human resource management": ["hrm", "human resources management", "human resources"],
    "business administration": ["business management", "mba"],
    "api 510": ["api-510"],
    "api 570": ["api-570"],
}


def all_terms(kind: str | None = None) -> list[str]:
    """Every term known to the knowledge base, optionally filtered by kind."""
    keys = {"skill": "skills", "tool": "tools", "certification": "certifications", "course": "courses"}
    wanted = [keys[kind]] if kind else list(keys.values())
    seen: dict[str, str] = {}
    for family in JOB_FAMILIES.values():
        for key in wanted:
            for term in family[key]:
                seen.setdefault(term.lower(), term)
    return sorted(seen.values(), key=str.lower)


def match_families(text: str, limit: int = 2) -> list[str]:
    """Rank job families by keyword hits in a role title / department name."""
    text = f" {text.lower()} "
    scores = []
    for key, family in JOB_FAMILIES.items():
        score = sum(len(kw) for kw in family["keywords"] if kw in text)
        if family["label"].lower() in text:
            score += 10
        if score:
            scores.append((score, key))
    scores.sort(reverse=True)
    if not scores:
        return []
    best = scores[0][0]
    return [key for score, key in scores[:limit] if score >= best * 0.5]
