"""What kind of work a job was, in what kind of business, and what a duty is about: used to judge a job
description's requirements against the jobs in a CV by meaning rather than by the exact words.

- A *function* is the kind of work (sales, marketing, accounting, HR, procurement, maintenance…). It is read from a
  job's title, or from its duties when at least two of them are clearly that kind of work ("met monthly sales
  targets", "appointed new distributors"). Accounting lines such as "posted the sales ledger" are not selling.
- A *setting* is the kind of business (industrial / B2B, manufacturing, chemicals, fertilizer, oil and gas, FMCG and
  retail, banking…). It is read from the employer's name and what the job describes ("Notore Chemical Industries",
  "sold urea to blenders"). Industrial covers manufacturing, chemicals, fertilizer and oil and gas, so production
  sales or selling chemicals to manufacturers counts as industrial sales, while selling in a supermarket does not.
- *Concepts* group words that mean the same thing in a duty ("client", "customer", "key account"; "reconciled",
  "reconciliation"), so a duty in the JD can be recognised in a CV that words it differently.

The lists are plain data: add an employer, a word or a function here and every match uses it after a re-score.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache


def _rx(*parts: str) -> re.Pattern:
    return re.compile(r"\b(?:" + "|".join(parts) + r")\b", re.I)


@dataclass
class Function:
    label: str
    title: re.Pattern               # in a job title, or a requirement such as "experience in industrial sales"
    duty: re.Pattern                # a duty that is clearly this kind of work
    related: dict = field(default_factory=dict)  # other functions that partly transfer, with their credit


# Lines that use a function's words for something else (an accountant posting the sales ledger is not selling).
NOT_FUNCTION = {
    "sales": re.compile(r"sales (?:ledgers?|invoices?|tax|records?|returns?|day ?books?|accounts?|receipts?|journals?|"
                        r"vouchers?)|points? of sales?|after[- ]sales", re.I),
    "marketing": re.compile(r"marketing (?:department's|unit's) (?:invoices|payments)", re.I),
    "accounting": re.compile(r"account (?:managers?|executives?|officers?|representatives?)|key accounts?|"
                             r"(?:new|customer|client|corporate) accounts?|accounts? (?:opening|officer \(sales\))", re.I),
}

FUNCTIONS: dict[str, Function] = {
    "sales": Function(
        "sales",
        _rx(r"sales", r"selling", r"business development", r"account (?:manager|executive|officer|representative)s?",
            r"key accounts?", r"territory (?:manager|officer|representative)", r"merchandis(?:er|ing)",
            r"commercial (?:officer|executive|manager|analyst|assistant)", r"distributor development",
            r"channel (?:manager|sales)", r"marketer", r"relationship manager", r"trade development"),
        _rx(r"sold", r"sell(?:s|ing)?", r"sales (?:targets?|volumes?|growth|revenues?|pipeline|team|strateg(?:y|ies)|"
            r"plans?|territor(?:y|ies)|force|calls?|visits?|presentations?|forecasts?|quotas?|budgets?|performance|"
            r"figures|reports?|leads?|orders?)",
            r"(?:met|meet|meeting|achieved|achieving|exceeded|exceeding|surpassed|hit) (?:\w+ ){0,3}targets?",
            r"business development", r"key accounts?", r"new (?:customers|clients|accounts|markets|business|"
            r"distributors|dealers|outlets)", r"prospect(?:s|ing|ive (?:customers|clients))",
            r"clos(?:ed|ing) (?:\w+ ){0,2}deals?", r"customer acquisition",
            r"(?:grew|grow|growing|increased) (?:\w+ ){0,3}(?:sales|revenue|market share|customer base)",
            r"market share", r"(?:recruited|appointed|onboarded|managed) (?:\w+ ){0,2}(?:distributors|dealers|stockists)",
            r"negotiat\w* (?:\w+ ){0,3}(?:prices?|contracts?|deals?|terms|orders?)", r"(?:sales|price) quotations?",
            r"order (?:taking|booking)", r"revenue (?:targets?|growth)", r"customer visits?"),
        {"marketing": 0.6, "customer_service": 0.4}),
    "marketing": Function(
        "marketing",
        _rx(r"marketing", r"brand (?:manager|executive|officer|assistant|management|activation)", r"trade marketing",
            r"product (?:manager|marketing)", r"market(?:ing)? research(?:er)?", r"communications (?:officer|executive|"
            r"manager|specialist)", r"advertising", r"public relations", r"marketer", r"market development"),
        _rx(r"marketing (?:campaigns?|plans?|strateg(?:y|ies)|activities|programmes?|programs?|budgets?|materials|"
            r"communications?)", r"brand(?:ing| awareness| management| activation| visibility| campaigns?| equity)",
            r"market (?:research|surveys?|intelligence|analysis|segmentation|penetration|development|insights?|"
            r"studies|trends)", r"campaigns?", r"advertis\w+", r"promotions?|promotional", r"digital marketing",
            r"social media", r"content (?:creation|marketing|calendar)", r"product launch(?:es)?",
            r"competitor (?:analysis|activities|intelligence|tracking)", r"customer insights?", r"trade marketing",
            r"(?:events?|exhibitions?|trade (?:shows?|fairs?))", r"go[- ]to[- ]market", r"marketing"),
        {"sales": 0.6, "customer_service": 0.3}),
    "customer_service": Function(
        "customer service",
        _rx(r"customer (?:service|care|experience|support|relations?)", r"client (?:services?|relations?|support)",
            r"call cent(?:er|re)", r"contact cent(?:er|re)", r"help ?desk", r"front desk"),
        _rx(r"(?:resolved|resolving|handled|handling|attended to|managed|addressed) (?:\w+ ){0,3}(?:complaints|"
            r"enquiries|inquiries|queries|issues)", r"customer (?:complaints|enquiries|inquiries|queries|feedback|"
            r"satisfaction|retention|service|care|experience)", r"after[- ]sales", r"client (?:queries|complaints)"),
        {"sales": 0.4, "marketing": 0.3}),
    "procurement": Function(
        "procurement",
        _rx(r"procurement", r"purchasing", r"buyer", r"sourcing", r"supply officer", r"contracts? (?:officer|manager|"
            r"administrator|specialist)", r"vendor management", r"category (?:manager|buyer)"),
        _rx(r"procur\w+", r"purchase (?:orders?|requisitions?)", r"(?:raised|raising|issued) (?:\w+ ){0,2}(?:pos|"
            r"purchase orders)", r"sourc(?:ed|ing) (?:\w+ ){0,3}(?:suppliers|vendors|materials|goods|items)",
            r"vendor (?:evaluation|selection|management|registration|onboarding|prequalification|performance)",
            r"supplier (?:evaluation|selection|management|relationships?|performance|prequalification)",
            r"tender(?:s|ing)?", r"request for (?:quotation|proposal)s?", r"rfqs?", r"rfps?",
            r"negotiat\w* (?:\w+ ){0,3}(?:suppliers|vendors)", r"contract (?:management|administration)",
            r"bid (?:evaluation|analysis)", r"expediting"),
        {"supply_chain": 0.6, "admin": 0.3}),
    "supply_chain": Function(
        "logistics and supply chain",
        _rx(r"logistics", r"supply chain", r"warehous(?:e|ing)", r"inventory", r"stores? (?:officer|keeper|manager|"
            r"clerk|supervisor|assistant)", r"storekeeper", r"fleet", r"dispatch", r"shipping", r"transport (?:officer|"
            r"manager|supervisor)", r"materials (?:officer|manager|planner|controller|management)",
            r"distribution (?:officer|manager|coordinator|supervisor)", r"demand plann(?:er|ing)"),
        _rx(r"inventory (?:control|management|levels|records|counts?|reconciliation)", r"stock (?:counts?|taking|levels|"
            r"control|records|reconciliation|management)", r"warehous\w+", r"dispatch\w*", r"deliver(?:y|ies)",
            r"logistics", r"shipments?", r"haulage", r"fleet", r"goods (?:received|receipt|issued)", r"grns?",
            r"waybills?", r"(?:demand|supply) planning", r"bill of lading", r"clearing and forwarding"),
        {"procurement": 0.6}),
    "accounting": Function(
        "accounting and finance",
        _rx(r"accountants?", r"accounts (?:officer|assistant|clerk|payable|receivable|executive|supervisor|manager|"
            r"department|unit)", r"accounting", r"finance", r"financial (?:analyst|controller|officer|accountant|"
            r"reporting|accounting)", r"treasury", r"tax (?:officer|analyst|manager|accountant|consultant)",
            r"payables", r"receivables", r"bookkeep(?:er|ing)", r"book[- ]keep(?:er|ing)", r"cashier",
            r"credit control(?:ler)?", r"cost (?:accountant|accounting|controller)", r"budget (?:officer|analyst)",
            r"financial controller", r"bursar", r"revenue (?:officer|accountant)"),
        _rx(r"reconcil\w+", r"journals?", r"(?:general )?ledgers?", r"book[- ]?keeping", r"financial (?:statements|"
            r"reports?|reporting|analysis)", r"management accounts", r"month[- ]end", r"year[- ]end", r"trial balance",
            r"accounts payable", r"accounts receivable", r"payables", r"receivables", r"payment vouchers?",
            r"vendor payments?", r"bank reconciliations?", r"variance analysis", r"cash ?flows?",
            r"cash (?:management|book)", r"petty cash", r"vat", r"withholding tax", r"wht", r"paye",
            r"tax (?:returns|computations?|remittances?)", r"fixed assets? (?:register)?", r"depreciation",
            r"accruals?", r"prepayments?", r"ifrs", r"gaap", r"cost (?:accounting|analysis|control)", r"treasury",
            r"credit control", r"debt (?:recovery|collection)", r"budget(?:ing|s)? (?:preparation|monitoring|control)",
            r"invoic\w+"),
        {"audit": 0.7}),
    "audit": Function(
        "audit and control",
        _rx(r"audit(?:or|ing)?", r"internal control", r"compliance (?:officer|analyst|manager)",
            r"risk (?:officer|analyst|manager)"),
        _rx(r"audit(?:s|ed|ing)?", r"internal controls?", r"compliance (?:checks|reviews|reports?|monitoring)",
            r"risk (?:assessments?|management|registers?)", r"control (?:testing|reviews)", r"fraud (?:investigations?|"
            r"detection)", r"spot checks?"),
        {"accounting": 0.7}),
    "hr": Function(
        "human resources",
        _rx(r"human resources?", r"hr", r"hrbp", r"personnel", r"recruit\w*", r"talent (?:acquisition|management)",
            r"people (?:operations|partner|officer)", r"learning (?:and|&) development", r"l&d",
            r"training (?:officer|coordinator|manager|specialist)", r"payroll (?:officer|administrator|specialist)",
            r"employee relations", r"industrial relations (?:officer|manager)", r"compensation", r"hris"),
        _rx(r"recruit\w+", r"hiring", r"talent acquisition", r"onboard\w*", r"induction",
            r"interview(?:s|ed|ing)? (?:\w+ ){0,2}(?:candidates|applicants)", r"shortlist\w*", r"job descriptions?",
            r"payroll", r"employee (?:relations|records|engagement|welfare|files|data|benefits|grievances?|exits?|"
            r"lifecycle)", r"staff (?:welfare|records|training|appraisals?|files|matters|discipline|deployment|"
            r"engagement)", r"performance (?:management|appraisals?|reviews?|evaluations?)", r"appraisals?",
            r"training (?:needs|programmes?|programs?|calendar|plans?)", r"learning (?:and|&) development",
            r"disciplinary", r"grievances?", r"hr (?:policies|policy|records|administration|operations|metrics|"
            r"reports?|budget)", r"leave (?:management|records|administration|schedules?|roster)",
            r"compensation", r"benefits administration", r"industrial relations", r"union (?:matters|negotiations?)",
            r"exit interviews?", r"hris", r"(?:manpower|workforce|succession) planning",
            r"personnel (?:records|files|administration)"),
        {"admin": 0.5}),
    "admin": Function(
        "administration",
        _rx(r"admin(?:istrative|istration)? (?:officer|assistant|manager|executive|clerk|secretary)", r"administrator",
            r"office (?:manager|assistant|administrator|secretary)", r"secretary", r"receptionist", r"front desk",
            r"personal assistant", r"executive assistant", r"facilit(?:y|ies) (?:officer|manager|coordinator)",
            r"clerk"),
        _rx(r"office (?:administration|management|supplies|equipment)", r"front desk", r"(?:received|receiving|"
            r"welcomed) (?:\w+ ){0,2}(?:visitors|guests)", r"correspondence", r"filing", r"records management",
            r"minutes of (?:meetings|the meeting)", r"(?:scheduled|scheduling) (?:\w+ ){0,2}(?:meetings|appointments)",
            r"travel (?:arrangements|logistics|bookings)", r"facilit(?:y|ies) management", r"stationery",
            r"diary management", r"calendar management", r"memos?"),
        {"hr": 0.5, "customer_service": 0.3}),
    "production": Function(
        "production and operations",
        _rx(r"production", r"operations (?:officer|manager|supervisor|engineer|technician|analyst)",
            r"plant (?:operator|manager|supervisor|engineer)", r"process (?:operator|engineer|technician)",
            r"operators?", r"shift (?:supervisor|manager|engineer|leader|lead)", r"manufacturing",
            r"panel operator", r"field operator", r"control room"),
        _rx(r"production (?:targets?|plans?|planning|schedules?|lines?|output|processes|operations|reports?)",
            r"plant operations?", r"start[- ]?ups?", r"shut[- ]?downs?", r"process (?:control|parameters|"
            r"optimi[sz]ation|monitoring|safety)", r"operat(?:ed|ing|e) (?:the )?(?:plant|units?|equipment|"
            r"machines?|boilers?|compressors?|reactors?|turbines?)", r"dcs", r"control room", r"throughput",
            r"yields?", r"batch (?:records|processing)", r"shift (?:handover|reports?|logs?)"),
        {"maintenance": 0.4, "quality": 0.4, "hse": 0.3}),
    "maintenance": Function(
        "maintenance and engineering",
        _rx(r"maintenance", r"technicians?", r"mechanic(?:al)? (?:engineer|technician|fitter|supervisor)",
            r"electrical (?:engineer|technician|supervisor)", r"instrument(?:ation)? (?:engineer|technician)",
            r"reliability", r"fitter", r"welder", r"millwright", r"artisan", r"rotating equipment",
            r"static equipment"),
        _rx(r"(?:preventive|corrective|predictive|planned) maintenance", r"maintenance (?:plans?|schedules?|work|"
            r"activities|jobs|records|strategy)", r"work orders?", r"troubleshoot\w*", r"repair(?:s|ed|ing)?",
            r"overhaul\w*", r"calibrat\w+", r"pumps?", r"compressors?", r"turbines?", r"valves?", r"switchgears?",
            r"transformers?", r"plc", r"scada", r"lubrication", r"cmms", r"maximo", r"root cause (?:analysis|failure)"),
        {"production": 0.4}),
    "hse": Function(
        "health, safety and environment",
        _rx(r"hse", r"hsse", r"ehs", r"qhse", r"safety", r"health,? safety", r"environment(?:al)? (?:officer|specialist|"
            r"manager|engineer)", r"fire (?:officer|safety)"),
        _rx(r"safety (?:inspections?|audits?|meetings|talks|induction|briefings|training|campaigns|observations?|"
            r"procedures|permits?|performance)", r"permit to work", r"ptw", r"risk assessments?",
            r"hazard identification", r"hazid", r"hazop", r"jsa", r"job safety analysis", r"incident (?:investigations?|"
            r"reports?|reporting)", r"toolbox talks?", r"ppe", r"emergency response", r"fire (?:drills?|safety|"
            r"fighting)", r"environmental (?:monitoring|compliance|impact)", r"iso 14001", r"iso 45001", r"ohsas"),
        {"production": 0.3, "quality": 0.4}),
    "quality": Function(
        "quality and laboratory",
        _rx(r"quality", r"qa", r"qc", r"laborator(?:y|ies)", r"lab (?:analyst|technician|scientist|technologist)",
            r"analyst chemist", r"chemist", r"inspector"),
        _rx(r"quality (?:control|assurance|checks?|tests?|standards|management|audits?)", r"laboratory (?:analysis|"
            r"tests?|testing)", r"lab (?:analysis|tests?)", r"sampl(?:es|ing)", r"specifications", r"iso 9001",
            r"titration", r"chromatograph\w*", r"certificates? of analysis"),
        {"production": 0.4, "hse": 0.4}),
    "it": Function(
        "information technology",
        _rx(r"it", r"ict", r"information technology", r"software", r"developer", r"programmer", r"network (?:engineer|"
            r"administrator|analyst)", r"systems? (?:administrator|analyst|engineer|support)", r"database",
            r"data (?:analyst|engineer|scientist)", r"help ?desk", r"technical support", r"cyber ?security",
            r"erp (?:consultant|analyst|administrator)", r"sap (?:consultant|analyst|basis|administrator)"),
        _rx(r"software (?:development|applications?|installation)", r"developed (?:\w+ ){0,3}(?:application|software|"
            r"system|website|app)", r"networks?", r"lan", r"wan", r"servers?", r"active directory", r"helpdesk",
            r"technical support", r"databases?", r"sql", r"python", r"javascript", r"cybersecurity", r"firewalls?",
            r"backups?", r"it (?:support|infrastructure|systems?|assets?|equipment)"),
        {}),
    "legal": Function(
        "legal",
        _rx(r"legal", r"lawyer", r"solicitor", r"counsel", r"company secretar\w+", r"paralegal"),
        _rx(r"(?:contracts?|agreements?) (?:drafting|review|vetting)", r"drafted (?:\w+ ){0,3}(?:agreements|contracts)",
            r"litigation", r"legal (?:advice|opinions?|documents)", r"regulatory compliance",
            r"corporate governance", r"board (?:meetings|resolutions)", r"cac (?:filings?|returns)"),
        {"admin": 0.3}),
}


@dataclass
class Setting:
    label: str
    words: re.Pattern
    children: tuple = ()     # narrower settings it includes (industrial includes chemicals, fertilizer…)
    related: dict = field(default_factory=dict)   # settings that partly transfer, with their credit


SETTINGS: dict[str, Setting] = {
    "industrial": Setting(
        "industrial (B2B, manufacturing, chemicals, oil and gas)",
        _rx(r"industrial", r"b2b", r"business[- ]to[- ]business", r"corporate (?:clients|customers|accounts|buyers)",
            r"institutional (?:clients|customers|buyers|sales)", r"raw materials?",
            r"bulk (?:sales|supply|supplies|buyers|customers|orders|products)", r"(?:heavy|industrial) equipment",
            r"machinery", r"spare parts", r"industrial gas(?:es)?", r"mining",
            r"engineering (?:products|services|solutions|firm|company)", r"oems?"),
        ("manufacturing", "petrochemical", "fertilizer", "oil_gas")),
    "manufacturing": Setting(
        "manufacturing / production",
        _rx(r"manufactur\w*", r"factor(?:y|ies)", r"plants?", r"production", r"processing (?:plant|company|facility|"
            r"line)", r"assembly (?:line|plant)", r"mills?", r"industries", r"cement", r"steel", r"iron rods?",
            r"alumin(?:i)?um", r"paints?", r"coatings", r"lubricants?", r"(?:building|construction) materials?",
            r"textiles?", r"packaging", r"dangote", r"lafarge", r"bua"),
        ("petrochemical", "fertilizer"),
        related={"fmcg": 0.8}),
    "petrochemical": Setting(
        "chemicals / petrochemicals",
        _rx(r"petrochem\w*", r"chemicals?", r"polymers?", r"polyethylene", r"polypropylene", r"pet resins?", r"resins?",
            r"plastics?", r"methanol", r"ammonia", r"indorama", r"eleme petrochem\w*"),
        related={"fertilizer": 0.7, "oil_gas": 0.7, "manufacturing": 0.6}),
    "fertilizer": Setting(
        "fertilizer",
        _rx(r"fertili[sz]ers?", r"urea", r"npk", r"blend(?:ers|ing plants?)", r"agro[- ]?chemicals?",
            r"crop protection", r"agro[- ]?(?:dealers?|inputs?)", r"farm inputs?", r"notore", r"indorama"),
        related={"agriculture": 0.6, "petrochemical": 0.7, "manufacturing": 0.6}),
    "oil_gas": Setting(
        "oil and gas",
        _rx(r"oil (?:and|&) gas", r"petroleum", r"upstream", r"downstream", r"midstream", r"refiner(?:y|ies)", r"nnpc\w*",
            r"lpg", r"lng", r"cng", r"gas (?:plant|processing|distribution)", r"drilling", r"offshore", r"onshore",
            r"pipelines?", r"shell", r"chevron", r"totalenergies", r"exxon ?mobil", r"agip", r"seplat", r"oando",
            r"conoil", r"ardova", r"forte oil", r"nlng", r"oil servic\w+"),
        related={"petrochemical": 0.7, "manufacturing": 0.5}),
    "agriculture": Setting(
        "agriculture / agro-allied",
        _rx(r"agricultur\w*", r"agro[- ]?allied", r"agri[- ]?business", r"agro[- ]?business", r"farms?", r"farming",
            r"farmers", r"seeds?", r"livestock", r"poultry", r"olam", r"plantations?"),
        related={"fertilizer": 0.6}),
    "fmcg": Setting(
        "FMCG (consumer goods)",
        _rx(r"fmcg", r"fast[- ]moving consumer goods", r"consumer (?:goods|products)", r"beverages?",
            r"food(?:s| and beverages?| & beverages?| products| processing)", r"brewer(?:y|ies)", r"beer",
            r"soft drinks?", r"bottling", r"confectioner(?:y|ies)", r"noodles", r"toiletries", r"detergents?",
            r"cosmetics", r"nestl[eé]", r"unilever", r"guinness", r"nigerian breweries", r"cadbury", r"pz cussons",
            r"promasidor", r"friesland\w*", r"wamco", r"dufil", r"indomie", r"coca[- ]?cola", r"nbc", r"seven[- ]?up",
            r"7up", r"reckitt", r"procter", r"flour mills"),
        related={"manufacturing": 0.5, "retail": 0.5}),
    "retail": Setting(
        "retail (shops and supermarkets)",
        _rx(r"retail", r"supermarkets?", r"hypermarkets?", r"shop floor", r"shops?", r"stores? (?:sales|attendant|"
            r"manager)", r"boutiques?", r"malls?", r"shoprite", r"spar", r"justrite", r"ebeano", r"market square",
            r"jumia", r"konga", r"e-?commerce"),
        related={"fmcg": 0.5}),
    "banking": Setting(
        "banking / financial services",
        _rx(r"banks?", r"banking", r"microfinance", r"financial services", r"insurance", r"fintech", r"mortgage",
            r"pensions?", r"asset management", r"stockbrok\w*", r"gtbank", r"gtco", r"guaranty trust", r"zenith",
            r"access bank", r"first ?bank", r"uba", r"fidelity", r"stanbic\w*", r"ecobank", r"sterling bank", r"fcmb",
            r"union bank", r"wema", r"polaris", r"keystone", r"opay", r"moniepoint", r"palmpay", r"paystack",
            r"flutterwave")),
    "telecom": Setting(
        "telecoms",
        _rx(r"telecom\w*", r"mtn", r"airtel", r"globacom", r"9mobile", r"etisalat", r"ihs (?:towers|nigeria)",
            r"internet service providers?")),
    "public": Setting(
        "public sector",
        _rx(r"ministry", r"government", r"parastatals?", r"public (?:sector|service)", r"civil service",
            r"local government", r"federal", r"state (?:government|ministry)")),
    "ngo": Setting(
        "NGO / development",
        _rx(r"ngos?", r"non[- ]governmental", r"non[- ]profit", r"not[- ]for[- ]profit", r"charit(?:y|ies)", r"unicef",
            r"undp", r"usaid", r"world health organi[sz]ation", r"red cross", r"humanitarian",
            r"development partners?")),
    "health": Setting(
        "healthcare / pharmaceuticals",
        _rx(r"hospitals?", r"clinics?", r"pharma\w*", r"health ?care", r"medical")),
    "construction": Setting(
        "construction / real estate",
        _rx(r"construction", r"real estate", r"civil works", r"property development")),
    "hospitality": Setting(
        "hospitality", _rx(r"hotels?", r"hospitality", r"restaurants?", r"catering", r"resorts?")),
    "logistics": Setting(
        "logistics / shipping",
        _rx(r"logistics (?:company|firm|services)", r"haulage", r"shipping (?:company|line)", r"freight",
            r"courier", r"maritime")),
}
# Words that look like a setting but are not one: an accountant's "bank reconciliation" is not banking, and
# "industrial training" (SIWES) or "industrial relations" (HR) is not industrial work.
SETTING_NOISE = re.compile(
    r"bank (?:reconciliations?|statements?|charges|lodg(?:e)?ments?|payments?|transfers?|balances?|accounts?|"
    r"details|tellers?)|industrial (?:training|attachment|relations|psychology|chemistry|physics|mathematics|"
    r"design|court)|production of (?:reports?|documents?|minutes)|(?:pension|insurance) (?:deductions?|remittances?|"
    r"schedules?)|tax (?:office|authority)|federal (?:inland revenue|university|polytechnic|government college)|"
    r"(?:inland|state) revenue service|plant (?:a|the) seed", re.I)
# What a requirement says about the business rather than the work ("in a manufacturing environment").
SETTING_CONTEXT = re.compile(r"\b(?:environment|industry|industries|sector|company|companies|organi[sz]ations?|"
                             r"setting|firm|firms|plant|business|market)\b", re.I)


@lru_cache(maxsize=4096)
def settings_named(text: str) -> frozenset:
    """The kinds of business a text names itself, without the broader kinds that include them."""
    clean = SETTING_NOISE.sub(" ", text or "")
    return frozenset(key for key, setting in SETTINGS.items() if setting.words.search(clean))


@lru_cache(maxsize=4096)
def settings_in(text: str) -> frozenset:
    """The kinds of business a text shows, each with the broader kinds that include it (chemicals → industrial)."""
    clean = SETTING_NOISE.sub(" ", text or "")
    found = {key for key, setting in SETTINGS.items() if setting.words.search(clean)}
    for _ in range(2):
        for key, setting in SETTINGS.items():
            if any(child in found for child in setting.children):
                found.add(key)
    return frozenset(found)


def setting_credit(wanted: frozenset, have: frozenset) -> tuple[float, str]:
    """(credit, the setting that earned it) for a job's settings against the settings a requirement asks for."""
    best, why = 0.0, ""
    for key in wanted:
        if key in have:  # name the narrowest kind the job shows (chemicals, for industrial)
            while True:
                narrower = [c for c in SETTINGS[key].children if c in have]
                if not narrower:
                    return 1.0, key
                key = narrower[0]
        setting = SETTINGS[key]
        for other, value in setting.related.items():
            if other in have and value > best:
                best, why = value, other
        # A sibling under the same broader kind (cement for chemicals: both industrial) partly transfers.
        for parent in SETTINGS.values():
            if key in parent.children:
                for sibling in parent.children:
                    if sibling != key and sibling in have and 0.5 > best:
                        best, why = 0.5, sibling
    return best, why


def _clean_for(key: str, text: str) -> str:
    noise = NOT_FUNCTION.get(key)
    return noise.sub(" ", text) if noise else text


@lru_cache(maxsize=4096)
def functions_in_job(title: str, body: str) -> dict:
    """{function: (score, how)} for one job: 1.0 when its title says so or two or more of its duties are clearly
    that work; 0.5 for a single duty."""
    found = {}
    for key, function in FUNCTIONS.items():
        if function.title.search(_clean_for(key, title or "")):
            found[key] = (1.0, "title")
            continue
        duties = {m.group(0).lower() for m in function.duty.finditer(_clean_for(key, body or ""))}
        if len(duties) >= 2:
            found[key] = (1.0, "duties")
        elif duties:
            found[key] = (0.5, "one duty")
    return found


def functions_in_requirement(text: str) -> list[str]:
    """The kind(s) of work a requirement asks for: "industrial sales" → sales; "a manufacturing environment" → none
    (that is a setting)."""
    without_settings = text
    for setting in SETTINGS.values():
        without_settings = setting.words.sub(" ", without_settings)
    found = [k for k, f in FUNCTIONS.items() if f.title.search(_clean_for(k, without_settings))]
    if not found and not SETTING_CONTEXT.search(text):
        found = [k for k, f in FUNCTIONS.items() if f.title.search(_clean_for(k, text))]
    return found


def function_credit(wanted: list[str], have: dict) -> tuple[float, str, str]:
    """(credit, the function that earned it, how) for one job against the functions a requirement asks for."""
    best = (0.0, "", "")
    for key in wanted:
        if key in have and have[key][0] > best[0]:
            best = (have[key][0], key, have[key][1])
        for other, value in FUNCTIONS[key].related.items():
            if other in have and value * have[other][0] > best[0]:
                best = (value * have[other][0], other, "related")
    return best


# --------------------------------------------------------------------------- what a duty is about
CONCEPT_GROUPS = {
    "customer": "customer customers client clients clientele buyer buyers consumer consumers offtaker offtakers",
    "relationship": "relationship relationships rapport retention retain retained loyalty partnership partnerships "
                    "liaise liaised liaising liaison engagement relation relations",
    "grow": "develop developed developing development build built building grow grew growing growth expand expanded "
            "expansion increase increased increasing generate generated generating drive drove driving boost boosted "
            "improve improved improving",
    "manage": "manage managed managing management handle handled handling oversee oversaw overseeing coordinate "
              "coordinated coordinating administer administered supervise supervised supervising led leading run ran "
              "running head headed control controlled maintain maintained maintaining monitor monitored monitoring "
              "track tracked tracking execute executed executing implement implemented implementing",
    "prepare": "prepare prepared preparing compile compiled compiling produce produced draft drafted drafting write "
               "wrote writing",
    "report": "report reports reporting reported mis dashboard dashboards analysis analyses analytics",
    "sales": "sales sale sell selling sold revenue revenues turnover",
    "target": "target targets quota quotas kpi kpis goals",
    "prospect": "prospect prospects prospecting acquisition acquire acquired canvass canvassing",
    "quote": "quotation quotations quote quotes pricing price prices proposal proposals bid bids tender tenders",
    "negotiate": "negotiate negotiated negotiating negotiation negotiations deal deals",
    "market": "market markets marketing brand brands branding promotion promotions promotional campaign campaigns "
              "advertising advert adverts advertisement",
    "research": "research survey surveys intelligence insight insights competitor competitors competition trends",
    "distributor": "distributor distributors dealer dealers agent agents wholesaler wholesalers stockist stockists "
                   "channel channels retailer retailers",
    "territory": "territory territories region regions regional zone zones",
    "collection": "collection collections receivable receivables debt debts debtors recovery credit",
    "payment": "payment payments pay paid payable payables disbursement disbursements remittance remittances remit "
               "remitted remitting",
    "invoice": "invoice invoices invoicing billing bill bills",
    "reconcile": "reconcile reconciled reconciling reconciliation reconciliations",
    "supplier": "supplier suppliers vendor vendors contractor contractors",
    "purchase": "purchase purchases purchasing procure procured procurement sourcing source sourced buying",
    "ledger": "ledger ledgers journal journals posting postings books bookkeeping entries",
    "tax": "tax taxes vat wht paye withholding",
    "audit": "audit audits auditing auditor auditors",
    "budget": "budget budgets budgeting forecast forecasts forecasting variance variances",
    "payroll": "payroll payrolls salary salaries wages wage compensation remuneration",
    "recruit": "recruit recruited recruiting recruitment hire hired hiring onboarding onboard induction shortlist "
               "shortlisted shortlisting interview interviews interviewing talent",
    "train": "train trained training learning coaching mentoring",
    "employee": "employee employees staff workforce personnel workers manpower",
    "appraisal": "appraisal appraisals performance evaluation evaluations",
    "discipline": "disciplinary discipline grievance grievances misconduct dispute disputes",
    "welfare": "welfare benefits wellbeing",
    "policy": "policy policies procedure procedures sop sops guidelines handbook",
    "record": "record records file files filing documentation database",
    "inventory": "inventory inventories stock stocks store stores warehouse warehouses warehousing",
    "delivery": "delivery deliveries deliver delivered dispatch dispatched shipment shipments shipping logistics "
                "haulage transport transportation fleet",
    "complaint": "complaint complaints query queries enquiry enquiries inquiry inquiries feedback",
    "safety": "safety hse hazard hazards incident incidents accident accidents ppe",
    "quality": "quality qa qc standard standards specification specifications compliance",
    "maintenance": "maintenance repair repairs repaired servicing overhaul troubleshoot troubleshooting",
    "equipment": "equipment machine machines machinery",
    "meeting": "meeting meetings minutes",
    "schedule": "schedule schedules scheduling plan plans planning calendar",
    "contract": "contract contracts agreement agreements",
    "cost": "cost costs costing expenses expense expenditure spend",
    "cash": "cash petty treasury fund funds liquidity",
}
# Words that say nothing about what a duty involves.
DUTY_GENERIC = {"product", "products", "assign", "assigned", "identify", "identified", "opportunity", "opportunities",
                "line", "company", "activities", "business", "businesses", "nigerian", "nigeria", "new", "monthly",
                "weekly", "daily", "annual", "quarterly", "relevant", "appropriate", "accordance", "ensure", "timely",
                "regular", "regularly", "existing", "potential", "relation", "relating", "respect", "liaise",
                "general", "overall", "external", "internal", "relevant", "all", "other", "within", "conduct",
                "conducted", "conducting", "carry", "carried", "undertake", "undertook", "perform", "performed",
                "accurately", "accurate", "time", "end-to-end", "issues", "processes", "process", "processed"}
# Verbs that say little on their own: they count half when comparing a duty with a job.
WEAK_CONCEPTS = {"grow", "manage", "prepare", "schedule", "report"}
PHRASES = [
    (re.compile(r"business development", re.I), "sales growth"),
    (re.compile(r"key accounts?", re.I), "customers"),
    (re.compile(r"accounts? payables?", re.I), "payables"),
    (re.compile(r"accounts? receivables?", re.I), "receivables"),
    (re.compile(r"human resources?", re.I), "personnel"),
    (re.compile(r"talent acquisition", re.I), "recruitment"),
    (re.compile(r"after[- ]sales", re.I), "complaints"),
    (re.compile(r"market share", re.I), "sales growth"),
    (re.compile(r"\bpos\b", re.I), "purchase orders"),
    (re.compile(r"\bgrns?\b", re.I), "goods received notes"),
    (re.compile(r"new (?:\w+ ){0,2}(?:customers|clients|accounts|markets|business(?:es)?|distributors|dealers|"
                r"outlets|territories)", re.I), "prospect customers"),
]


@lru_cache(maxsize=1)
def _concept_index() -> dict:
    from .matching import stem

    index = {}
    for concept, words in CONCEPT_GROUPS.items():
        for word in words.split():
            index.setdefault(stem(word), concept)
    return index


@lru_cache(maxsize=8192)
def concepts_of(text: str) -> frozenset:
    """The ideas in a text: concept names for words the groups above know, word stems for the rest, and the
    settings it shows ("setting:industrial")."""
    from .matching import GENERIC, stem

    clean = text or ""
    for pattern, replacement in PHRASES:
        clean = pattern.sub(replacement, clean)
    for setting in SETTINGS.values():  # a kind of business counts as that setting, not as its words
        clean = setting.words.sub(" ", clean)
    index = _concept_index()
    found = set()
    for word in re.findall(r"[a-z][a-z0-9+#&-]*", clean.lower()):
        word = word.strip("-&")
        if len(word) < 3 or word in DUTY_GENERIC:
            continue
        s = stem(word)
        if s in index:  # a word the groups know counts even when it is common ("staff" is an employee)
            found.add(index[s])
        elif word not in GENERIC:
            found.add(s)
    found |= {f"setting:{k}" for k in settings_in(text or "")}
    return frozenset(found)


def concept_weight(concept: str) -> float:
    return 0.5 if concept in WEAK_CONCEPTS else 1.0


def overlap(wanted: frozenset, have: frozenset) -> tuple[float, list[str]]:
    """(share of what is wanted that is there, by weight; the strong concepts found)."""
    from .matching import same_stem

    if not wanted:
        return 0.0, []
    total = matched = 0.0
    strong = []
    for concept in wanted:
        weight = concept_weight(concept)
        total += weight
        hit = concept in have or (":" not in concept and len(concept) >= 5
                                  and any(same_stem(concept, other) for other in have if ":" not in other))
        if hit:
            matched += weight
            if weight == 1.0:
                strong.append(concept)
    return matched / total, strong
