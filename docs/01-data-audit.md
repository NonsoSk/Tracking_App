# Phase 1–2 · Historical Data Audit

**Scope:** read-only inspection of the two supplied workbooks. Nothing has been imported, changed or deleted.
**Reproduce:** `python3 scripts/migration/audit_workbooks.py --complete <Complete…xlsx> --tracker <Indorama…2026.1.xlsx>`
The script prints the PII-free summary below and writes row-level review lists (with names and phones) to the git-ignored `audit-output/` folder.

> **Files not supplied.** Only the two Excel workbooks were attached. `GRIEVANCE FORM IPL.docx`, `Host Communities in Indorama.docx`, `Pipeline Communities Structure.pdf` and `Jetty Communities Structure.pdf` were **not** available, so the community master below comes from the structure written in the brief. Where the brief and the workbooks disagree, both are shown.

---

## 1. Inventory

### Workbook A: `Complete Grievance Tracker (2018–2026).xlsx` (12.5 MB)

| Sheet | Visible | What it is | Grievance rows |
|---|---|---|---|
| Summary | yes | Dashboard titled "2018 – 2025" (formulas) | – |
| Sheet2 | hidden | Community count pivot | – |
| 2018 | yes | Grievance log | **9** |
| 2019 | yes | Grievance log | **29** |
| 2020 | yes | Grievance log | **26** |
| 2021 | yes | Grievance log | **21** |
| 2022 | yes | Grievance log (+1 unnamed empty column) | **16** |
| 2023 | yes | Grievance log (header on row 5) | **16** |
| 2024 | yes | Grievance log, **new schema** (header on row 7) | **3** |
| 2025 | yes | Grievance log, new schema (header on row 9) | **63** |
| 2026A | hidden | Header only, **no records** | 0 |
| Data | hidden | Someone's earlier normalisation (Normalized Community, Normalized Category) | (183 mirror rows) |
| Query | hidden | Power Query output padded to **1,048,574 rows** – the main reason the file is 12.5 MB | – |

**Total: 183 grievance rows.** This matches the workbook's own Summary sheet (183, of which 180 Closed and 3 Open/WIP).

### Workbook B: `Indorama_Grievance Tracker_2026.1.xlsx`

| Sheet | Visible | What it is | Rows |
|---|---|---|---|
| Grievance Tracker | yes | Master log, newest schema (22 columns) | **425 records** (+4 empty template rows that hold only formula output) |
| Dashboard | yes | Charts only | – |
| Sheet3 | hidden | Pivot tables – **stale** (says 407; real count is 425) | – |
| Detail1 | hidden | Pivot drill-down copy (2 rows duplicated from the tracker) | ignore |
| LOOKUP | hidden | **48 sub-categories → 8 categories** taxonomy | reference |
| Sheet1 | hidden | Dropdown lists: CR officers, consent options, communities, gender, severity, status | reference |
| Sheet2 | hidden | Empty | – |

Records in the tracker by its `Year` column: **2024: 25 · 2025: 68 · 2026: 332.**

---

## 2. Exact historical columns

| Era | Columns (exact header text) |
|---|---|
| **2018–2023** (Workbook A) | `S/N`, `Community`, `Log Date`, `Log Description`, `Grievance Category`, `Grievance Officer's Remarks`, `Responsibility`, `Management Action`, `Review Date`, `Review Year`, `Status` |
| **2024–2026A** (Workbook A) | `S/N`, `Tracking ID`, `Date Received`, `Date of Submission`, `Full Name`, `Community`, `Gender`, `Phone Number`, `Grievance Category`, `Grievance Sub-Category`, `Incident Details`, `Desired Resolution`, `Severity Level`, `Status`, `Resolution Details` |
| **Tracker 2026.1** (Workbook B) | `S/N`, `Tracking ID`, `Community Category`, `Community Type`, `Form Issuance Date`, `Date of Submission`, `Full Name`, `Community`, `Gender`, `Phone Number`, `Grievance Details`, `Grievance Sub-Category`, `Grievance Category`, `Suggestions`, `Severity Level`, `Status`, `Resolution Details`, `Officer in-charge of closeure` *(sic)*, `Year`, `Complainant's consent to Management's Resolutions`, `Date of Closure`, `Month` |

**Fields that exist only in the early era (2018–2023):** Officer's Remarks, Responsibility (always "CR&D"), Management Action, Review Date, Review Year.
**Fields that first appear in 2024:** Tracking ID, Full Name, Gender, Phone Number, Sub-Category, Incident Details, Desired Resolution, Severity, Resolution Details, Date Received / Date of Submission.
**Fields only in Tracker 2026.1:** Community Category (cluster), Community Type, Form Issuance Date, Suggestions, Officer in charge of closure, Complainant's consent, Date of Closure, Month.

Consequence: a 2019 record has **no complainant name, phone, gender, severity or tracking ID**. Those fields stay empty after import. Nothing is invented.

---

## 3. Duplicates and overlap

### 3.1 Overlap between the two workbooks
- **All 63 records on the Complete/2025 sheet also appear in Tracker 2026.1** (matched on Tracking ID). That is 68 row pairs, because some of those IDs occur more than once in the tracker.
  - 65 pairs have identical name, community and text. 3 pairs have the same person and community but slightly different text.
  - Status conflicts in **every pair**: Workbook A says `Closed`, Workbook B says `Resolved`.
  - Categories agree in every pair.
- **Complete/2024 (3 records: IPL2001037, IPL2001047, IPL2001095) are not in the tracker.**
- **Tracker "2024" block (25 records) is not in Workbook A**, and it looks wrong:
  - all 25 carry **2026-style IDs** (`IPL2026…`, `IFL2026…`);
  - all share Form Issuance Date **13 Apr 2024**;
  - their submission dates climb by exactly one day per row (29 May → 20 Jun 2024), which is the pattern Excel's fill-down produces.

  The likely explanation is a mis-keyed year on 2026 forms. **This is a flag, not a correction:** the dates are imported as recorded and marked `date_suspect` for you to confirm.

### 3.2 Duplicates inside Tracker 2026.1
**57 Tracking IDs are used more than once, across 120 rows:**

| Pattern | IDs | What it probably means | Proposed handling |
|---|---|---|---|
| Same person, **different** grievance text | 40 | One paper form carrying several concerns, typed as separate rows under the form's reference | Keep every row as its own grievance. Store the shared reference as `legacy_tracking_id`. |
| Same person, **same** text | 10 | Double entry | Flag as a duplicate candidate for review. Not deleted. |
| **Different people** under one ID | 7 | ID collision / typing error | Keep both. Flag the ID collision. |

Separately, **24 rows share name and text with another row** (18 surplus copies), including some under different IDs or communities. For example, one complainant appears under Okerewa, Elelenwo, Akpajo and Ubima with the same ID. All of these are flagged for review.

### 3.3 Duplicates in 2018–2023
**12 rows (6 pairs)** have identical community and text: 2 pairs in 2020 and 4 pairs in 2021. They may be genuine repeat submissions, so they are flagged and not merged.

### 3.4 Tracking-ID formats (legacy)
The IDs use 11 different shapes: `IPL2001037`, `IPL20261391F`, `IFL20261617F`, `IPL20261391f`, `IP20261…F`, `IFL2026 1234F` (contains a space), 13-digit variants, and more. The prefix is split between `IPL` (244) and `IFL` (246). These IDs are **not unique** and **cannot be a primary key**. They are preserved verbatim, plus a normalised copy (upper-case, no spaces) for searching.

---

## 4. Community naming

| Raw value in workbooks | Rows | Canonical | Note |
|---|---|---|---|
| `Wakohu` | 96 | **Nwakohu** | The brief spells it Nwakohu. The tracker dropdown lists both "Wakohu" and "Nwakohu". |
| `Wakohu Family` | 12 | Nwakohu | A family group within Nwakohu, not a separate community. The original value is kept as `legacy_community`. |
| `Njuru/Akpakpan` | 16 | **Njuru** | Akpakpan is a compound of Njuru. The original value is preserved. |
| `onne` | 5 | Onne | Case only. |
| `Individual` | 4 | *none – manual review* | Not a community. The text says "I am from host community". |
| `PAC` | 2 | *none – manual review* | The Public Affairs Committee, not a community. |

All other values match the master exactly.

**Communities in the master with zero historical records:** Abara, Chokocho, Imeh, Omuanwa (Clusters 2–3); Akanu, Assa, Ochia, Awarra (11) (Cluster 4); and all 10 Indirectly Impacted communities.

### 4.1 Classification errors in Tracker 2026.1 (`Community Category` vs the brief)

| Community | Recorded as | Rows | Should be (per brief) |
|---|---|---|---|
| Ozuoha | Cluster 4 | 10 | Cluster 3 |
| Umuecheme | Cluster 5 | 10 | Cluster 2 |
| Umuogodo | Cluster 5 | 9 (5 correct) | Cluster 2 |
| Akpajo | Cluster 4 | 10 | Host and/or Cluster 1 |
| Atali | Cluster 2 | 1 | Cluster 1 |
| Elelenwo | Host | 1 | Cluster 1 |
| Okerewa | Cluster 1 | 1 | Host |

These 42 misclassified rows are why classification must be **derived from the Community Master**, never typed. The recorded value is kept as `legacy_community_category`.

### 4.2 ⚠ Akpajo is in two groups
The brief lists **Akpajo both as a Host Community and in Pipeline Cluster 1.** The tracker records it as Host 17 times and as "Cluster 4" 10 times. Community type therefore **cannot** be a single column on `communities`. See the design in `02-architecture.md` §2.2. **Decision needed.**

### 4.3 ⚠ 32 vs 31 pipeline communities
The brief states 32 pipeline communities, but the clusters list **31 names** (4 + 7 + 6 + 5 + 9). The tracker's own dropdown (`Sheet1`) contains the same 31. **No 32nd community has been added.** The master is editable by the Super Admin, so the missing name can be added once confirmed.

### 4.4 Other naming queries (not changed)
- `Awarra (1)` / `Awarra (11)`: "11" may be a typo for Roman numeral **II**, as in `Omoku II`. Kept as written.
- `Rumuokwurusi` (Indirectly Impacted) and `Rumuokruoshi` (Cluster 1) are **kept separate**, as instructed.

---

## 5. Categories

**Taxonomy from 2024 on** (the tracker's LOOKUP sheet) has 8 categories and 48 sub-categories:
Employment & Economic Inclusion · Corporate Social Responsibility (CSR) & Community Engagement · Infrastructure & Public Services · Education & Youth Development · Health & Social Welfare · Governance & Representation · Environmental Impact · Operational Impact *(defined but unused)*.

**2018–2023** use **35 raw free-text values**, including case and spacing variants of the same thing:

| Variant group | Raw values |
|---|---|
| CSR | `CSR`, `CSR Project`, `CSR Projects` |
| Community grievance | `Community Grievance`, `community Grievance` |
| Skill acquisition | `Skill Acquisition`, `SKill Acquisition` |
| Infrastructure | `Infrastructure Development`, `infrastructure Development` |
| Empowerment | `Empowerment`, `Empowerment ` *(trailing space)* |
| Equity | `Equity Share`, `Equity Shares`, `Dividends` |

**Errors:**
- `#REF!` appears in 3 rows on the 2024 sheet (a broken formula). The sub-category is present in each, so the category can be derived from LOOKUP. The value `#REF!` is kept as legacy.
- 5 tracker rows have a blank category.
- 1 tracker row has a **sub-category name in the category column** ("Insufficient Reach of CSR Initiatives").

The proposed legacy → standard category mapping is in §8.2.

---

## 6. Statuses

| Source | Raw value | Rows |
|---|---|---|
| A 2018–2025 | `Closed` / `closed` | 179 / 1 |
| A 2020–2021 | `WIP` | 3 (Agbonchia Jun 2020, Njuru Feb 2021, Aleto Nov 2021) |
| B tracker | `Resolved` | 247 (3 have no resolution details) |
| B tracker | `Not Started` | 130 |
| B tracker | `Ongoing` | 47 |
| B tracker | blank | 1 (a partially entered record, IFL20261531F) |

**177 tracker grievances are still open** (Not Started + Ongoing). Nearly all were submitted between May and July 2026, so every one of them will be past the 3-day threshold when it is imported. The 3 `WIP` items from 2020–2021 have been open for 5 years.

`Complainant's consent` and `Date of Closure` are **100% empty**, so no historical resolution was ever acknowledged in the data.

---

## 7. Other anomalies

| Area | Finding |
|---|---|
| **Date precision** | 2018 dates are real dates but always fall on the 1st, so they are really month-level. 2019–2023 dates are **text such as `"Apr 2019"`** (103 log dates, 108 review dates). They are stored as the first of the month with `date_precision = 'month'`, so the app never shows a day that was never recorded. |
| Dates | Tracker: 1 blank Date of Submission. No future dates. No submission earlier than its form-issuance date. |
| Severity | `High ` with a trailing space (50) vs `High` (24). Before 2024 severity does not exist (not "Medium" by default). |
| Phones (tracker) | 118 blank, 287 valid Nigerian mobile numbers, **20 invalid** (7, 9, 10 or 12 digits). **51 numbers are shared by more than one complainant**, likely a family member or community leader. Phone is therefore **not** a safe identity key for linking historical records to new user accounts. |
| Suggestions | 116 cells contain the literal text `"None"`. They are imported as empty, and the raw value is kept. |
| Officers | `Officer in-charge of closeure`: "Godpower Jaka" ×412, "Okakaobari Ajii-Ollor" ×5, "Ruzzel Ngofa" ×3, "Godwin Bebe-Okpabi" ×1, blank ×8. Several dropdown names carry an invisible zero-width space (U+200B). |
| ⚠ Officer names | The brief says **"Godspower Jaka"** and **"Jima Bebe"**. The workbook says **"Godpower Jaka"**, and its officer list contains "Jima Ngofa" and "Godwin Bebe-Okpabi" but no "Jima Bebe". **Decision needed.** |
| Sub-category vs text | Spot checks show some sub-categories that don't match the text. For example, "We need free medical outreach" is filed under *Unemployment…*, clustered in the suspect "2024" block. Not quantified. Imported as recorded. |
| Workbook hygiene | Stale pivot (407 vs 425). Hidden `Query` sheet with 1,048,574 rows. The Summary title says 2018–2025. |

---

## 8. Migration mapping

### 8.1 Field mapping (legacy → standard)

| Legacy column | Era | Standard field | Notes |
|---|---|---|---|
| `S/N` | all | `legacy_source_records.source_serial` | Row identity only |
| `Tracking ID` | 2024+ | `grievances.legacy_tracking_id` (+ normalised copy) | New `tracking_id` issued separately |
| `Community` | all | `community_id` via alias table · `legacy_community` | |
| `Community Category`, `Community Type` | B | `legacy_community_category`, `legacy_community_type` | Standard type and cluster are **derived** from the master |
| `Log Date` | 18–23 | `date_received` + `date_received_precision='month'` | |
| `Date Received` | A 24–25 | `date_received` | |
| `Form Issuance Date` | B | `form_issued_date` | |
| `Date of Submission` | A 24+, B | `submitted_at` (date) | For B also `date_received` |
| `Full Name` | 24+ | `complainant_name` | |
| `Gender` | 24+ | `complainant_gender` | |
| `Phone Number` | 24+ | `complainant_phone` (E.164) · raw kept if invalid | |
| `Log Description` / `Incident Details` / `Grievance Details` | all | `description` | Primary grievance text |
| `Desired Resolution` | A 24+ | `desired_resolution` | |
| `Suggestions` | B | `suggestions` | `"None"` → empty |
| `Grievance Category` | all | `category_id` via mapping · `legacy_category` | |
| `Grievance Sub-Category` | 24+ | `subcategory_id` · `legacy_subcategory` | |
| `Severity Level` | 24+ | `severity_id` · `legacy_severity` | trimmed |
| `Status` | all | `status_id` via mapping · `legacy_status` | |
| `Grievance Officer's Remarks` | 18–23 | `grievance_comments` (type `officer_remark`, internal) | |
| `Responsibility` | 18–23 | `legacy_responsibility` | always "CR&D" |
| `Management Action` | 18–23 | `grievance_actions` (type `management_action`) | |
| `Review Date` | 18–23 | `review_date` (+ month precision) | |
| `Review Year` | 18–23 | derivable. Kept only in the raw source JSON | |
| `Resolution Details` | 24+ | `grievance_resolutions.details` | |
| `Officer in-charge of closeure` | B | `closure_officer_id` if matched to a user, else `legacy_closure_officer` | |
| `Complainant's consent…` | B | `grievance_acknowledgements` if present (none are) | |
| `Date of Closure` | B | `closed_at` (all empty) | |
| `Year`, `Month` | B | derivable. Kept in raw JSON | |
| *every original cell* | all | `legacy_source_records.raw jsonb` | Answers "what did the Excel file say?" exactly |

### 8.2 Category mapping (proposal; you confirm or edit in the import tool)

| Legacy category (2018–2023) | → Standard category |
|---|---|
| Employment, Empowerment, Contracts & Supplies, Distributions | Employment & Economic Inclusion |
| CSR, CSR Project, CSR Projects, Community Need | CSR & Community Engagement |
| Electricity, Drinking Water, Infrastructure Development | Infrastructure & Public Services |
| Education, Scholarship, Skill Acquisition | Education & Youth Development |
| Health, Feeding, COVID 19 Pandemic | Health & Social Welfare |
| Equity Share(s), Dividends, Community Grievance, Community conflict, LGA Grievance, Security | Governance & Representation |
| `#REF!` | derived from sub-category via LOOKUP |

The mapping lives in a `legacy_value_mappings` table, not in code. Each imported record keeps `legacy_category` exactly as typed.

### 8.3 Status mapping (proposal)

| Legacy | → Standard | Rationale |
|---|---|---|
| Closed, closed | Closed | |
| WIP | In Progress | Marked `legacy_open` and excluded from automatic overdue alerts until an officer reviews it |
| Resolved | Resolved | Acknowledgement = *not captured* (not "yes") |
| Ongoing | In Progress | |
| Not Started | Assigned if an officer is recorded, else Submitted | |
| blank | Submitted + flag | |
| A=Closed vs B=Resolved conflict (2025 overlap) | Closed | Workbook A is the later compilation. Both raw values are kept. |

### 8.4 Record reconciliation
- Import **Workbook A 2018–2024 (120 rows)** and **Tracker 2026.1 (425 rows)** as grievances: **545 candidate grievances**.
- **Workbook A 2025 (63 rows)** duplicates tracker rows. Each is stored as a *second source record* linked to the matching tracker grievance, so both versions remain traceable. They are **not** imported as separate grievances.
- Duplicate candidates (§3.2–3.3) are imported **and** flagged `needs_review`. Nothing is dropped automatically.
- Historical complainants are **not** turned into user accounts. Linking a new account to past grievances is a staff-verified action.
