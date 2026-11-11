# IEFCL Recruitment Portal

A single web application for the whole recruitment cycle at **Indorama Eleme Fertilizer & Chemicals Ltd.**, from a
department raising a requisition to the new hire's first day. CVs are read automatically, every applicant is scored
against the department's requirements, and each step sends notifications, emails and calendar invites. The hiring team
mostly monitors and approves.

---

## How the current process maps to the portal

| # | Today (manual) | In the portal |
|---|---|---|
| 1 | Departments ask for new hires; HR spots upcoming retirements in the employee database and asks departments whether they need replacements | **Requisitions**: departments pick a standard role (or type a new one) and choose requirements from AI and knowledge-base suggestions for skills, tools, certifications and courses. **Retirements & exits** forecasts retirements from the staff list (age 60 or 35 years' service, whichever comes first). A scheduled job asks the department whether it needs a replacement, and a one-click link opens a pre-filled replacement requisition. Resignations and dismissals work the same way. |
| 2 | Call for applications; some CVs arrive by email, as hard copies or through employees and skip the form | **Careers page** with an application form that reads the CV and fills most fields itself. **CV intake** takes bulk uploads of emailed CVs, scanned hard copies and photos. **Refer a candidate** lets any employee submit a CV for a vacancy. **`fetch_cv_emails`** pulls CVs straight from the recruitment mailbox. |
| 3 | Hiring manager types everything into one Excel sheet | Every CV is read into a structured **candidate profile** with a **document folder**. Duplicates are merged by email or phone. The existing Excel database can be **imported**, and any vacancy's applicants can be **exported** to Excel. |
| 4 | Manual matching against the department's criteria | **Automatic scoring (0–100, grade A–D)** of every applicant against the requirements, with a breakdown of what matched, what's missing and any flags. Candidates are ranked, and **auto-shortlist** picks everyone above a threshold. |
| 5 | Invite shortlisted candidates | **Schedule interview** emails the candidate and the panel with an Outlook/Google calendar invite (`.ics`) and a video link. The candidate confirms or asks to reschedule from their personal page, and reminders go out 24 hours before. |
| 6 | Three interview phases (technical/practical, behavioural, HOD) | Each phase is tracked separately with its own panel. Completing the HOD phase moves the candidate to the decision stage. |
| 7 | Paper selection report (9 criteria, E/VG/G/S/P) | A **digital selection report** with the same criteria and marks (15/15/10…=100) and ratings applied automatically from the legend. Panel members score from their phone or PC and sign electronically. A **printable version reproduces the paper form**, including salary negotiation, offer made and date of joining. |
| 8 | Select / on hold / reject | A **decision** step shows the panel average. Selecting a candidate automatically asks them for documents; rejecting sends a regret letter; on-hold candidates stay in reserve. |
| 9 | Document review | Each candidate has a **document checklist** by hiring type (degree, WAEC, NYSC, ID, references, …). Candidates upload documents on their personal page and HR verifies or rejects each one. |
| 10 | Trainees → onboarding; experienced hires → offer | The **tracks are built in**: graduate trainees and interns skip the offer stage, and experienced hires get an offer. |
| 11 | Offer → medicals → onboarding; review requests go to management; next candidate if declined | Candidates **accept, decline or request a review** of the offer online. Review requests go to **Management**, who can revise (a new offer version is sent), maintain or withdraw. A decline shows the **next-best candidates**. Medicals are scheduled and their results recorded; the **onboarding team** receives a checklist; completing onboarding creates the employee record and marks the requisition *Filled*. |

Departments can follow their own candidates live (dashboard, candidate tracker and a Kanban board). Every step is
logged on a timeline, and department and HR staff message each other on the requisition.

## Quick start (local demo)

Requires Python 3.10+.

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate     macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # optional: edit company name, email, AI key…
python manage.py migrate
python manage.py seed_demo      # optional, demo only: never on a database with your real data
python manage.py runserver
```

> **Windows:** keep the project in a short folder outside OneDrive (e.g. `C:\Users\<you>\portal`). Deep OneDrive
> paths exceed Windows' 260-character path limit and `pip install` fails with "No such file or directory" (often on
> `lxml`).

> **Windows, to get the latest version:** close the portal window and double-click `update-portal.bat`. Because the
> repository is private, it asks your browser (signed in to GitHub) to download the code, picks the file up from your
> Downloads folder, keeps your database, settings, uploads and Python environment, removes screens and styles the new
> version no longer uses, installs any new packages and starts the portal. A copy of the code downloaded in the last
> 30 minutes is used straight away.
>
> **Windows, every day after that:** double-click `start-portal.bat`. It applies any database updates, starts the
> portal and opens it in your browser. Keep its window open while you work; close it to stop the portal. To start it
> automatically when you sign in to Windows, press Win+R, type `shell:startup`, and put a shortcut to
> `start-portal.bat` in that folder (set the shortcut to run minimised). This is still only on your PC; for the hiring
> team, see [Deployment](#deployment).

Open http://localhost:8000. With demo data, every account's password is **`Demo@2026`**:

| Username | Role | What to try |
|---|---|---|
| `hr.admin` / `recruiter` | Hiring team | Dashboard, approve REQ-2026-0004, CV intake, auto-shortlist, schedule interviews, decisions, offers |
| `hod.production` | Head of Production | Raise a requisition with suggestions, track Process Engineer candidates, decide on Funke Adeyemi |
| `hod.ict` / `hod.hse` | Heads of department | Pending and returned requisitions |
| `interviewer` | Panel member | Upcoming interviews, fill a selection report |
| `management` | Management | Offer review for Chinedu Okafor (asks ₦16.8m vs ₦14.4m offered) |
| `onboarding` | Onboarding team | Tobechi Ibekwe's onboarding checklist |
| `staff.referrer` | Any employee | Refer a candidate, follow your referrals |
| `admin` | Superuser | `/admin/` for master data and user accounts |

The public careers page is at http://localhost:8000/careers/. Emails are printed in the terminal until SMTP is set up.

For a real installation, skip `seed_demo` and create the first HR admin with `python manage.py createsuperuser` (`load-my-data.bat` asks for it too). Forgot a password? Close the portal and double-click `reset-password.bat`: it lists the sign-in accounts and sets a new password for the one you choose (or creates the HR admin if there is none). Then, in
**Master data & users** (`/admin/`), add departments, users (with a role and department), standard job roles and extra
skill tags.

## Loading your recruitment workbooks

On Windows, close the portal and double-click `load-my-data.bat` (or drag the workbooks onto it). It asks for the CV
file, the Recruitment Master workbook and, optionally, the website applications dump (Application Query), asks you to
type YES, saves a backup of the database in `backups\`, removes **everything** in the portal (demo data and demo
sign-ins included), loads the workbooks and asks you to create your own HR Admin sign-in. Elsewhere:
`python manage.py import_workbooks <cv file>.xlsx <master>.xlsx [<applications dump>.xlsx] --replace`. Without
`--replace`, `import_workbooks` adds any of these files to what is already in the portal.

Sheets are recognised by their column headings, so file and sheet names may change. Where each sheet goes:

| Sheet | In the portal |
|---|---|
| CV Dump (CV file) | **Talent database**: one profile per person (name, contacts, date of birth, gender, state, LGA/community, experience, qualification, course, institution, year, class of degree, source as recorded). The original row is kept on the profile. |
| Recruitment_CBTs | **CBT results** on each person's profile (date, test, score out of total, company). |
| Recruitment_Interview Records | **Interview records** on each person's profile and on the requisition (date, panel, score, result, community status, onboarding, join date). Where the Ref_ID matches a requisition, the person is also added to that requisition with the recorded outcome (hired, onboarding in progress, selected, on hold, rejected, declined, or *not engaged* when the requisition is closed). |
| Manpower_Requisition_Summary | **Requisitions** (Req_Ref, company/business unit, department, band, category, classification, reason, positions, requester, coordinator, dates). Closed ones are *Filled* when everyone needed was onboarded, otherwise *Closed*; Pending and In Progress ones are *Approved* (not published on the careers page). The tracker's figures are shown on the requisition. |
| ApplicationS Dump_Indorama (applications dump, optional) | **Talent database**: every website applicant, with their resume link (see *Resumes* below), date of birth, gender, qualification, class, course, institution, year, LGA and community, NYSC. Nothing is graded: the dump says nothing about which vacancy each person applied for. |
| Retirement Forecast_3 Years Pro | **Staff & retirements** (staff number, name, company, business unit, location, department, grade, designation, category, work status, dates). **Salaries are never read or stored.** |
| Report Weekly Summary, HR Metrics, Analysis, Dashboard | Not imported: they are calculations, not records. Offer records live in Excel's data model (another file), not in a sheet. |

People in several sheets become one profile when they share an email or phone number and their names share a word.
A contact used by more than three different people (an office number, say) is never used to match anyone. Rows that
repeat exactly are loaded once. Departments are created from the department names in the two workbooks (QA/QC and
QAQC, HR and Human Resources, IT and Information Technology count as one). Settings stay: the selection-report
criteria, document checklists and skill vocabulary. Nothing is sent to AI.

Each run writes a report to `import-reports\`: values that could not be used (dates written as text, impossible
years, Excel `#REF!` errors), contacts shared by people with different names, names used by more than one person, and
the duplicates that were merged. Fix the workbook and run it again; the result replaces the previous load.

The workbooks, backups and reports hold personal data. They are kept out of git (`.gitignore`) and must never be
uploaded to GitHub.

### Website applicants and their resumes

Each row of the applications dump is checked against the people already in the portal before anything is joined:

* It joins a profile when the email or phone **and** the names agree, and no date of birth or gender disagrees (a
  difference is accepted only when email, phone and names all agree; it is listed in the report and the portal keeps
  its own value). People who applied twice with a new email are one profile when the full name, date of birth, gender
  and course all agree.
* When that is not clear (the email or phone matches more than one profile or someone with another name, only one name
  matches and nothing else confirms it, or two applications for one profile disagree), the row is **held**: nothing is
  changed, no second profile is made, and the row is listed under *Applications to check* in the import report with
  the reason and the resume link.
* Everyone else becomes a new profile. Empty fields are filled; nothing already in the portal is replaced.

With the real files (October 2026): 14,573 rows gave 12,332 new profiles, 2,087 joined existing ones, 64 people had
applied twice, and 88 rows were held for checking.

**Resumes.** Double-click `load-resumes.bat` (or `python manage.py fetch_resumes`). It downloads every resume from its
link on the website and files it in the candidate's folder **as a PDF**: Word files are converted by Microsoft Word
when it is installed (otherwise LibreOffice), photos and scans by the portal itself, and the file as received is kept
next to it. A resume already in the folder is not added again, and links that fail (removed from the website, audio
files, web pages) are listed in a report and tried again the next day. Reading a resume only fills empty skills,
tools, certifications and experience; names, contacts and dates of birth always come from the spreadsheets, and
nothing is sent to AI. It can be stopped at any time and carries on next time; the first run takes an hour or more
and the resumes need a few gigabytes of disk.

The resume opens straight away in the **Resume** tab of the candidate's page. Anyone without one (people who applied
in person or by email) has an **Attach resume** box there; Word files and photos attached by hand become PDFs too. The
talent database can be filtered by *Resume on file* / *No resume yet*.

### Where candidates are from

Every candidate is put in a group: **Host community, Pipeline community, Jetty community, Niger Delta, Other states**
or **Outside Nigeria**. The group comes from the recruitment records when a column says it: any column whose heading
mentions community, tag, region, zone, catchment or category and holds a value such as "Host", "Pipeline community",
"Jetty" or "Niger Delta" (and the interview records' *Community Query*, where "Community" means a host community).
Otherwise the state decides: one of the nine Niger Delta states (Abia, Akwa Ibom, Bayelsa, Cross River, Delta, Edo,
Imo, Ondo, Rivers), another Nigerian state, or outside Nigeria. HR can set the group by hand on the profile; the
workbook loads then leave it alone (clear it to go back to what the records say).

The talent database shows how many candidates are in each group, for the whole database or for any search, and can be
filtered by group, state, zone (North Central … South West) and country.

### Applicants, current staff and former staff

The talent database lists everyone in one place, under four tabs: **Everyone**, **Applicants not hired yet**,
**Current staff** and **Exited or retired** (resigned, retired, dismissed or transferred), each with its count. The
tabs work together with every other filter and search. Clicking a name opens the person's page: their resume, profile,
applications, CBTs and interviews, and for staff a **Staff record** card (staff number, status, department, job
title, grade, date joined, retirement date). Names on *Retirements & exits* open the same page.

Each staff-list record is joined to the person's profile only when it is clearly the same person: the same date of
birth and the same name (in any order; a middle name may be missing), or the same email and name, or the same name
and a hire through recruitment that started on the day they joined. Anyone else on the staff list gets a profile of
their own (source "Staff list"), so everyone has a page. When other profiles have the same name, that page lists them
for HR with a **Same person: join** button; any profile also has an **On the staff list?** box to join a staff number
by hand, and a staff page has **Not the same person? Unlink**. HR's choices are kept by later workbook loads. Someone
hired through the portal is joined to their new staff record when onboarding is completed.

## Keeping in step with Excel

While the team still updates the workbooks in Excel, the portal can follow them so it is never out of date. On
Windows, double-click `link-excel.bat` and pick the Recruitment Master workbook, then answer **Y** to add the CV file
or any other workbook, as many as you need (or drag them all onto `link-excel.bat`). Pick the copies the team keeps
working on, for example in a synced OneDrive or SharePoint folder. Running it again later adds more files; the ones
already linked stay. Elsewhere: `python manage.py sync_workbooks --link <file>.xlsx [<file>.xlsx ...]`.

Any workbook holding at least one of the record sheets above can be linked, and several files may hold the same kind
of sheet (for example, each officer's own interview records): each file is loaded on its own when it changes. Within
one workbook, only the first sheet of each kind is read; a second one is listed in the report.

From then on, `start-portal.bat` also opens a minimised **Excel link** window
(`python manage.py sync_workbooks --watch`). It checks the files every `EXCEL_SYNC_MINUTES` (5) and, when one was
saved with changes, loads a copy:

* New rows are added and rows edited in Excel update their records (a corrected interview result or CBT score updates
  that record rather than adding a second one). Nothing is duplicated.
* What the hiring team did in the portal is kept. A requisition's status follows the tracker only when its **Status**
  cell changes in Excel (closing it in Excel closes it in the portal), and an imported candidate follows the interview
  records only until someone works on that application in the portal.
* Rows deleted in Excel stay in the portal.

HR Admins see each linked file, when it was last loaded and what changed under **Excel link** in the menu, with a
**Refresh now** button and the import report. When the portal runs on a server that cannot see the PC, upload the
saved workbook on that page instead; the scheduler loads it. Once everyone works in the portal, click **Stop
following** (or run `sync_workbooks --unlink`). The records already loaded stay.

### The CV folder: new CVs read on their own

When CVs are saved into one folder (for example by an Outlook rule that saves attachments, or by whoever receives
them), the portal can read them as they arrive. On **Excel link**, under **CV folder**, paste the folder's path (from
the File Explorer address bar), choose how these CVs arrive (by email, hard copy, agency…), optionally a vacancy, and
whether to read the CVs already in it, then **Watch this folder**.

The same Excel link window (or the server's scheduler) then looks in the folder every `CV_FOLDER_SECONDS` (60):

* Each new file, subfolders included, is read like an upload on the CV intake page and becomes a profile marked
  *To check*; HR gets a notification and checks it under **Talent → Check new profiles**. If the folder has a
  vacancy, the CV is applied to it (and scored) once its profile is checked.
* Each file is read once. A file saved again with changes is read again (and updates the same person, found by email
  or phone); a copy of a CV already read, under another name, is not. A file still being copied waits for the next
  check, and at most 50 files are read per check, so a big folder is worked through in turns.
* Files that are not CVs (spreadsheets, Word lock files, Thumbs.db) are skipped. **Files in the folder are never moved,
  renamed or deleted.**

The page shows each folder, when it was last checked, how many CVs were read and the latest ones, with **Check now**
and **Stop watching** (the profiles already read stay). On a server, the folder must be one the server can reach (a
shared folder IT links).

### Portal updates.xlsx: the portal's latest data, in Excel

The portal never writes to the team's workbooks. Instead it keeps a workbook of its own, **Portal updates.xlsx**,
beside the linked workbook that holds the requisition tracker (or at `PORTAL_UPDATES_PATH`), and rewrites it whenever
something changes in the portal:

| Sheet | What it holds |
|---|---|
| Applicants | Every application: candidate, contacts, vacancy, channel, date applied, score and grade, key requirements not met, the hiring manager's call, stage, status and reason, last and next interview, the department's review |
| CVs received | Every profile that came in through the portal (careers page, CV intake, the CV folder, the mailbox, referrals): checked or to check, qualification, course, experience, the vacancies it went to, the CV file |
| Vacancies | Every requisition: status, positions, dates, and how many candidates are at each stage, on hold, rejected or withdrawn |
| Interviews | Every interview scheduled in the portal, with the panel, status and the candidate's response |

The new version replaces the old one in one step. While the file is open in Excel it cannot be replaced: the page
says so, and it is written as soon as the file is closed. Do not edit it (changes are not kept); work in your own
workbooks or in the portal. **Excel link** shows where it is and when it was written, with **Write now** and
**Download** (useful when the portal runs on a server).

## Roles and what they see

| Role | Access |
|---|---|
| HR Admin, Recruiter | Everything: all requisitions, the talent database, CV intake, the whole workflow, exports, candidate summaries to departments. HR Admin also manages master data and the Excel link. |
| Head of Department, Department Manager | Raise and track their department's requisitions and candidates, approve which shortlisted candidates move on to interviews, sit on panels, record decisions for their department, see their department's retirements, and open the pages (resume and records) of their department's staff. |
| Interviewer | Interviews they are on, and the selection report for those candidates. |
| Management | All requisitions and candidates (read-only), offer reviews, and requisition approval if enabled. |
| Onboarding team | Onboarding checklists and the new joiners' documents. |
| Employee | Refer candidates and follow their own referrals. |

### The summary (home page)

HR, management and heads of department open the portal on **Summary**, before *My tasks*; interviewers, the
onboarding team and employees go straight to *My tasks*. A head of department sees only their own department. One
row of filters scopes the page: **period** (today, last 7 or 30 days, this month, this year, an earlier year, all
time), **department**, **group** (host, pipeline, jetty, Niger Delta...) and **channel**. The page is a dark display
board, laid out like a wall dashboard:

- **Requisitions**: requisitions (with their status as the tracker writes it), positions, days to fill and positions
  filled, in large figures.
- **Applicants**: applicants, shortlisted for interview, interviews and onboarded, in large figures.
- **Month by month** (day, week or year by year, following the period): participants, shortlisted and onboarded by when
  the requisition was raised.
- **Current hiring pipeline**: the open requisitions with the most participants, with positions, participants,
  shortlisted, selected, onboarded and in progress, and a total row.
- **Host, pipeline and jetty applicants**: how each group applied, with each group's total (click a total to list them).
- Along the bottom: today's figures, staff (current, retiring within 12 months) and the time; at the top, whether the
  portal is in step with the linked workbooks.

Every figure is what Excel says, dated by the dates written in Excel, never by the day the workbook was loaded. Each
card names its source:

| Figure | From Excel |
|---|---|
| Requisitions, positions, status | The tracker row by row: *Manpower Required* and *Status* exactly as written, by *Requisition Date* |
| Funnel: participants, shortlisted, selected, onboarded, rejected, on hold, in progress | The tracker's own columns of those names, added up |
| Interviews | The interview records, by their *Date* (*Remarks_Query* for selected) |
| CBTs | The CBT results, by their *Date* |
| Applicants | People (each once, however many rows), by the date they applied: the moment in the resume link on the website applications (the website names each resume `<time>-<name>`), or an application-date column (Date Applied, Application Date, Submission Date, Timestamp...) |
| Group, channel | The Community, LGA/Community Tag and State columns; the Source column |
| Staff | The staff list: *Release Date*, *Join Date*, and the retirement age it gives (*Age* + *Years to Retirement*) |

A record Excel gives no date (for example, the CV list has no application date) is counted under **All time** only,
and the card says how many there are. Requisitions, applications and interviews created in the portal itself are
added with their own dates. Hire dates are the interview records' *Join Date* only. Clicking a group or channel
opens the talent database showing exactly the people counted.

### Raising a requisition and publishing the job description

Before a department can submit a requisition it must fill in the **required skills, nice-to-have skills, tools /
software / equipment, other requirements, justification and job description / responsibilities**. They score the
candidates and make up the job description; a draft can be saved without them.

**Have a job description already?** At the top of the requisition form (new or edit), choose the Word, PDF or text
file and click **Read it**. The portal fills in what the document says: the title (new requisitions only), required
and nice-to-have skills (a skill written next to "desirable", "an added advantage", "nice to have" and the like is a
nice-to-have), tools, certifications, accepted courses, the minimum qualification and class of degree ("B.Sc/HND"
gives HND), years of experience and NYSC, plus the text as the job description (an existing one is kept when
editing). It only picks terms the portal knows: the knowledge base and the skill tags HR adds in the admin. Nothing is
sent anywhere and nothing is saved until you save the form, so check every field, move anything that is not a real
must-have from *Required skills* to *Nice-to-have*, and add anything it missed.

Once the requisition is approved, **Review and publish** opens the job description already drafted in a standard
format (job title and key facts, job summary, key responsibilities, qualifications and experience, required skills,
tools, certifications, desirable, other requirements, how to apply). With AI on, Claude writes it from everything the
department gave; it uses the justification only as background and never names employees or internal reasons, and it
adds no requirement the department did not ask for. Without AI, the same sections are built from the requisition.
HR edits it beside a live preview of the careers page, then publishes. **Redraft** writes a fresh one.

### Candidate summaries to departments

From a requisition, HR can **email the candidate summary** to the department (its HOD, managers and department email,
copied to the sender and the recruiter): how many applied and how many are at each stage, the shortlisted candidates'
profiles, and every applicant as an attached Excel file without contact details. The department is asked to **approve
who moves on to interviews**: the email links to a page where the HOD approves or declines each shortlisted
candidate, with an optional comment. The recruiter is told at once, the answers show on the ranked list, and every
summary and answer is recorded in the requisition's activity. The summary can also go out automatically every day
(weekdays) or every week, from `SUMMARY_EMAIL_HOUR` (8:00), while the vacancy is open.

Candidates have no account. Each application gets a private link (included in every email) where the candidate can
follow their status, confirm interviews, upload documents and respond to offers. They can also look up their
application by reference number and email.

## AI features (optional)

Everything works **without AI**: the built-in rule-based CV reader and a skills/tools knowledge base for a
fertilizer/petrochemical plant cover the basics. The reader takes the name from a heading ("ENGR. IFEOMA CHUKWU",
"OKAFOR, Chinedu", surname in capitals first), a personal-data table or "Surname / Other names" lines, and reads Word
text boxes, tables, headers and footers; failing that, from the file name ("Chinedu Okafor CV.pdf") or the email
address, with a note to check. It also reads phone numbers in any grouping, sex, date of birth, state of origin and
LGA. Adding a Claude API key (`ANTHROPIC_API_KEY` in `.env`) enables:

* **Reading any CV, including scanned hard copies and phone photos**: the PDF or image goes straight to Claude, which
  returns structured data (name, contacts, qualification, course, class of degree, NYSC, years of experience, work
  history, skills, tools, certifications). The rule-based reader still runs and fills any gaps.
* **Skill and tool suggestions** when a department raises a requisition, merged with the knowledge base and the
  standard role's defaults.
* **Job description drafting** in a standard format from the requisition, ready for HR to review and publish, and an
  on-demand **AI fit summary** per candidate.

The default model is `claude-opus-5-5` (change it with `ANTHROPIC_MODEL`). Requests use structured JSON output and the
API's server-side refusal fallback (turn it off with `AI_SERVER_FALLBACK=false` if you call the API through a gateway
that doesn't support it). If the API is unreachable, the portal quietly falls back to the rule-based reader.

Without AI, scanned CVs need **Tesseract OCR** (`apt install tesseract-ocr`; on Windows, install from
UB-Mannheim and set `TESSERACT_CMD`). Old `.doc` files need LibreOffice. The Docker image includes both.

Scoring itself is **not** AI. It is a transparent weighted formula (below), so every rank can be explained and audited.

## How matching works

A candidate is graded only against the requirements of a vacancy they applied for, or that HR deliberately puts them
forward for (*Consider for a vacancy*, or the *Match CVs to vacancies* grid below): never against other departments'
vacancies, and profiles in the talent database without an application are not graded at all. Each application is scored out of 100:

| Component | Experienced hire | Graduate trainee |
|---|---|---|
| Required + nice-to-have skills (nice-to-have count half) | 25 | 15 |
| Tools / software / equipment | 10 | 10 |
| Years of experience (weighted by relevance of background) | 20 | 5 |
| Fit with the job (the JD's title and duties against the candidate's summary, past roles and CV) | 15 | 10 |
| Qualification level (+ minimum class of degree) | 10 | 25 |
| Course of study | 10 | 25 |
| Certifications | 10 | 10 |

Matching screens and ranks the way an ATS does, without ruling people out on wording:

1. **Key requirements.** The portal checks the minimum qualification and years of experience, at least half of the
   required skills (`MATCH_MIN_REQUIRED_SKILLS_PERCENT`), an accepted or related course (Banking and Finance for
   Accounting, Petroleum for Chemical Engineering: counted at 60%), the class of degree and NYSC. A detail the CV
   does not mention is marked **Confirm**. A key requirement that is not met **never sets the score to 0 or rules
   the candidate out**: the score still counts everything they have, and the application says which key requirement
   is missing. The hiring manager (HR, or the vacancy's own department) decides on the application page: **Keep in
   the running**, or **Not eligible** (the application is closed, without emailing the candidate). The ranked list
   marks those waiting for a decision (*Decide: 1 key requirement not met*), and auto-shortlist leaves them for the
   hiring manager unless they were kept in.
2. **The score.** The weights above, spread over the components the requisition asks for so they add up to 100. Each
   component earns *weight × share met*; the points add up to the score. Fit with the job is left out (its weight
   spread over the rest) for a profile with no CV text or past roles, such as one loaded from Excel.

A term counts when the candidate has it in any of these ways (point at a term on the Scores tab to see which):

* the same term (plurals included) or an approved synonym: "MS Word" = "Microsoft Word", "MS Excel" = "Microsoft
  Excel", "HYSYS" = "Aspen HYSYS" (HR adds more in the admin under *Skill tags*);
* the required term written inside what the candidate wrote ("AutoCAD" in "AutoCAD 2D/3D");
* a broader term that includes it: Microsoft 365 / MS Office covers Excel, Word, PowerPoint and Outlook (and Excel
  shows Office is used), Google Workspace covers Sheets and Docs, HSE Level 3 covers Levels 1 and 2, any office
  software meets "computer literacy" (`SUITES`, `LEVELS` and `BROADER` in `requisitions/knowledge_base.py`);
* the same thing said in other words in the CV, the words in one line ("Reconciled vendor statements" for "Vendor
  reconciliation"): counted at 75%.

Terms are looked for on the profile, in past job titles and duties, and in the CV text. Ordinary words that are also
product names count only as the product ("Proficient in Word, Excel" counts, "I excel at teamwork" does not).
Grades: A 85+, B 70+, C 55+, D below 55.

A vacancy that asks for nothing yet (a requisition loaded from the tracker arrives without skills, courses,
qualification or experience) is not scored: its applicants show *Not scored* until HR adds the requirements, and are
then scored at once. Nobody gets 100 against an empty vacancy.

A vacancy's **Ranked candidates** list has the same filters beside the stage and status: the top 5, 10, 20 or 50,
a score range, and only those meeting every key requirement (highest score first).

On an application's **Scores** tab, HR sees the full working: each key requirement (needed, the candidate's, met, not met or confirm)
and each component (asked for, found, every matched term and where it was found, weight, share met, points), with the
total. Others see the score and the key requirements. Changing a requisition's requirements re-scores all of its applicants
automatically; existing scores were re-scored with these rules when the portal was updated.

### Matching a batch of CVs to several vacancies

For CVs that arrive outside the careers page (by email, on paper or in a shared folder) and could suit more than one
job:

1. Create each vacancy (Roles → New requisition, **Read it** from its job description), and approve it.
2. **CV intake**: leave *Vacancy* empty, click **Choose a whole folder** (or drop the folder on the box, or pick files;
   each pick adds to the list), then **Read & add CVs**. Files that are not CVs (a spreadsheet, a zip, Word's `~$`
   lock files) or are over `MAX_UPLOAD_MB` are set aside with the reason, and any file can be taken off the list.
   Any number of files can go: more than five are sent five at a time with a progress bar (keep the page open), and
   all the results show at the end. A file that cannot be read is listed in red and never stops the others. New
   people are added to the talent database; someone already there (same email or phone) is updated instead.
3. **Check each new profile** (compulsory): click **Check the N new profiles** on the results. Each one opens beside
   its CV: the name, contacts, sex, date of birth, state and LGA, qualification, course, NYSC, experience and skills
   the portal read, with notes on what to look at ("Name taken from the file name: check it") and what it could not
   find. Correct anything, then **Confirm and next** (or *Skip for now*, or *Not a CV: delete*). A name and an email or
   phone are needed, and an email already on another profile is flagged. Until it is checked, a profile is marked
   *To check* everywhere, is left out of matching and cannot be put forward for a vacancy; a vacancy chosen at upload is
   applied to (and scored) when the profile is confirmed. CVs from the recruitment mailbox are checked the same way;
   *Talent* shows a **Check N new profiles** button while any wait.
4. When the last one is confirmed, click **Match these CVs to vacancies** (or *Talent → Match CVs to vacancies*, or
   *⋯ → Match CVs to this vacancy* on a requisition; these start from the CVs added on the last upload day, and you
   can pick another day). Tick the vacancies and click **Match**.

The grid scores every CV against every vacancy with the same rules as an application. Each cell gives the score,
how strong the match is (excellent 85+, strong 70+, possible 55+, weak below), the CV's rank for that role ("#3 of
40") and how many key requirements are not met, if any (point at it for which). With several roles chosen, "Fits
this role best" marks only a CV that scores clearly higher (5+ points) for one of them. **Rank by** one role, or by
each CV's strongest role; **Show** the top 5, 10, 20 or 50; set a **score** range; or keep **only those meeting every
key requirement**. Possible matches or better (or those in the chosen score range) in the ranked role are ticked;
tick or untick any cell, then **Add the ticked matches as applications**. Only then is anything saved: each pair
becomes an application, scored with the full working on its Scores tab, and the vacancy's ranked list includes it.
Vacancies still waiting for approval can be scored to see who fits, but take applications only once
approved. HR only. Up to 400 CVs at a time.

### Hiring timeline

A candidate's **Applications & timeline** tab, and the top of each application, show the steps of each application
with their dates and the days between: applied, CBT, shortlisted, first interview, selected, offer accepted,
onboarding and started work. Choose what to measure to (first interview, selected, onboarding or started work) to
see the days from applying. Dates come from Excel for what was loaded from it (the date applied, the CBT and interview
records' Date, Selected in Remarks_Query, the Join Date) and from the portal for steps taken there; pointing at a date
says where it comes from. A step with no date is shown as such and left out of the count, never dated by the day the
workbook was loaded. A date that does not fit the order of the steps is marked *out of order* to be checked.

## Scheduled jobs

| Command | Suggested schedule | What it does |
|---|---|---|
| `python manage.py send_retirement_alerts` | daily | Asks departments about staff retiring within `RETIREMENT_ALERT_MONTHS` (at most once every 90 days per person) |
| `python manage.py send_reminders` | every 15–60 min | Interview reminders 24 hours ahead, chasers for overdue selection reports, expired-offer alerts |
| `python manage.py sync_workbooks` | every 5–15 min | Loads the linked Excel workbooks that were saved with changes, reads new CVs from the CV folder, and rewrites Portal updates.xlsx when the portal's data changed (see Keeping in step with Excel). `--watch` keeps going (workbooks every `EXCEL_SYNC_MINUTES`, the folder every `CV_FOLDER_SECONDS`); `start-portal.bat` runs it on Windows |
| `python manage.py fetch_resumes` | after loading the applications dump | Saves the resumes from the website links as PDFs (`load-resumes.bat`). The Excel link window also saves up to 100 new ones each time it checks |
| `python manage.py send_department_summaries` | every 15–60 min | Emails the candidate summary to departments for vacancies set to send it daily or weekly (once per day or week, from `SUMMARY_EMAIL_HOUR`) |
| `python manage.py fetch_cv_emails` | every 15 min | Reads unread emails in the recruitment mailbox (IMAP) and adds their CV attachments. A requisition reference (e.g. `REQ-2026-0004`) or the vacancy title in the subject applies the CV to that vacancy |

On Linux, use cron. On Windows Server, use Task Scheduler, for example
`C:\portal\.venv\Scripts\python.exe C:\portal\manage.py send_reminders`. With Docker Compose, the `scheduler` service
runs all of them.

## Deployment

```bash
cp .env.example .env    # set DJANGO_DEBUG=false, DJANGO_SECRET_KEY, DJANGO_ALLOWED_HOSTS, SITE_URL, SMTP, …
docker compose up -d --build
docker compose exec web python manage.py createsuperuser
```

This starts PostgreSQL, the web app (gunicorn + WhiteNoise for static files) and the scheduler. Put it behind the
company's HTTPS reverse proxy or load balancer. For Microsoft 365 email, use `smtp.office365.com:587` with a licensed
mailbox, or an SMTP relay.

## Configuration

Most rules live in `.env` (see `.env.example`): retirement age and maximum service years, whether requisitions also need
management approval, the auto-shortlist threshold, whether HND counts as equal to a BSc, whether trainees need
medicals, offer validity, maximum upload size, the video-meeting base URL, how often the linked Excel workbooks are
checked (`EXCEL_SYNC_MINUTES`) and the hour automatic candidate summaries go out (`SUMMARY_EMAIL_HOUR`).

In the admin you can change, without touching code:

* **Evaluation criteria**: names, max marks, order (seeded from the paper form).
* **Document requirements**: which documents each hiring type must provide, and whether each is mandatory.
* **Job roles**: standard titles per department with default requirements.
* **Skill tags**: extra skills, tools, certifications and courses, plus aliases.
* **Departments, users and roles.**

## Data protection

* Uploaded CVs, certificates and medical reports are **never served publicly**. Every download goes through a view that
  checks the user's role and department.
* Candidates must give consent under the Nigeria Data Protection Act 2023 before applying.
* Department users only see their own department's requisitions and candidates. Interviewers only see candidates they
  interview.
* With AI enabled, CV content is sent to the Claude API for extraction, and the requisition (including the
  justification) for drafting the job description. Leave `ANTHROPIC_API_KEY` empty to keep all processing on your
  own servers.
* Candidate summaries emailed to departments carry names, qualifications and scores, never email addresses or phone
  numbers.
* Resumes are stored with the other candidate documents in `media/` on the portal's own computer or server, and are
  only shown to staff allowed to see that candidate.

## Project layout

```
config/          settings, URLs
accounts/        users and roles
core/            departments, staff/retirements, notifications, dashboard, AI client, scheduled jobs, demo data,
                 workbook import (core/workbook_import.py)
requisitions/    requisitions, job roles, skill catalogue, suggestions (knowledge base + AI)
candidates/      candidate profiles, document folders, CV reader, bulk intake, referrals, Excel import
pipeline/        applications, matching, interviews, selection reports, decisions, offers, medicals, onboarding
careers/         public careers site and the candidate's personal application page
templates/, static/   Design system UI (static/ds), all assets vendored, no CDN needed
docs/            3D render spec sheets for the designer
start-portal.bat, update-portal.bat, load-my-data.bat, link-excel.bat, load-resumes.bat, reset-password.bat
                 Windows: start, update, load your workbooks, follow them while you still use Excel, save resumes,
                 set a new password
```

The design system and every component are shown at `/styleguide/` (signed in). The seven 3D objects appear as
labelled grey placeholders until the renders are supplied; [docs/3d-render-specs.md](docs/3d-render-specs.md) has the
Blender brief, and dropping a render into `static/img/3d/` with the listed file name swaps it in everywhere.

## Tests

```bash
python manage.py test
```

The 202 tests cover the CV reader (PDF/Word/text, scanned files, duplicates), matching, the paper-form rating legend,
both hiring tracks end to end, all offer-review outcomes, permissions, the careers flow, calendar invites, the AI
client (mocked, so no API calls), loading and refreshing the workbooks (edits in Excel, work kept in the portal, no
duplicates), the candidate groups and their filters, joining staff records to profiles and the applicant/staff/former
staff tabs, matching the website applications (held rows, repeat applicants, nothing replaced), saving resumes as PDFs
from a local test website, the compulsory requisition details, the job description review, and candidate summaries and
department approvals, the summary page (each figure checked against the workbook rows, dates only from Excel, the
department view, click-through counts), strict matching and its working, and the hiring timeline. A smoke test loads
the demo data and opens every screen as every role.

## Possible next steps

* Microsoft 365 single sign-on (Entra ID) and creating Teams meetings through Microsoft Graph.
* SMS/WhatsApp notifications for candidates.
* A sync with the HRIS/payroll system so staff data and new hires flow automatically.
