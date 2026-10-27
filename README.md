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

For a real installation, skip `seed_demo` and create the first HR admin with `python manage.py createsuperuser`. Then, in
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

## Roles and what they see

| Role | Access |
|---|---|
| HR Admin, Recruiter | Everything: all requisitions, the talent database, CV intake, the whole workflow, exports, candidate summaries to departments. HR Admin also manages master data and the Excel link. |
| Head of Department, Department Manager | Raise and track their department's requisitions and candidates, approve which shortlisted candidates move on to interviews, sit on panels, record decisions for their department, see their department's retirements. |
| Interviewer | Interviews they are on, and the selection report for those candidates. |
| Management | All requisitions and candidates (read-only), offer reviews, and requisition approval if enabled. |
| Onboarding team | Onboarding checklists and the new joiners' documents. |
| Employee | Refer candidates and follow their own referrals. |

### Raising a requisition and publishing the job description

Before a department can submit a requisition it must fill in the **required skills, nice-to-have skills, tools /
software / equipment, other requirements, justification and job description / responsibilities**. They score the
candidates and make up the job description; a draft can be saved without them.

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
fertilizer/petrochemical plant cover the basics. Adding a Claude API key (`ANTHROPIC_API_KEY` in `.env`) enables:

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
forward for (*Consider for a vacancy*): never against other departments' vacancies, and profiles in the talent
database without an application are not graded at all. Each application is scored out of 100:

| Component | Experienced hire | Graduate trainee |
|---|---|---|
| Required + nice-to-have skills (nice-to-have count half) | 30 | 20 |
| Tools / software / equipment | 15 | 10 |
| Years of experience (weighted by relevance of background) | 25 | 5 |
| Qualification level (+ minimum class of degree) | 10 | 25 |
| Course of study | 10 | 30 |
| Certifications | 10 | 10 |

Components the requisition leaves empty are dropped and the rest re-balanced. Terms are matched on the profile *and*
in the full CV text, with common aliases ("MS Excel" = "Microsoft Excel", "HYSYS" = "Aspen HYSYS", …). HR can add more
aliases in the admin under *Skill tags*. Grades are A ≥ 80, B ≥ 65, C ≥ 50 and D below that. Flags such as "Below
minimum qualification", "NYSC not completed" or "Missing 3 of 5 required skills" appear next to the score. Changing a
requisition's requirements re-scores all of its applicants automatically.

## Scheduled jobs

| Command | Suggested schedule | What it does |
|---|---|---|
| `python manage.py send_retirement_alerts` | daily | Asks departments about staff retiring within `RETIREMENT_ALERT_MONTHS` (at most once every 90 days per person) |
| `python manage.py send_reminders` | every 15–60 min | Interview reminders 24 hours ahead, chasers for overdue selection reports, expired-offer alerts |
| `python manage.py sync_workbooks` | every 5–15 min | Loads the linked Excel workbooks that were saved with changes (see Keeping in step with Excel). `--watch` keeps checking; `start-portal.bat` runs it on Windows |
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
start-portal.bat, update-portal.bat, load-my-data.bat, link-excel.bat, load-resumes.bat
                 Windows: start, update, load your workbooks, follow them while you still use Excel, save resumes
```

The design system and every component are shown at `/styleguide/` (signed in). The seven 3D objects appear as
labelled grey placeholders until the renders are supplied; [docs/3d-render-specs.md](docs/3d-render-specs.md) has the
Blender brief, and dropping a render into `static/img/3d/` with the listed file name swaps it in everywhere.

## Tests

```bash
python manage.py test
```

The 160 tests cover the CV reader (PDF/Word/text, scanned files, duplicates), matching, the paper-form rating legend,
both hiring tracks end to end, all offer-review outcomes, permissions, the careers flow, calendar invites, the AI
client (mocked, so no API calls), loading and refreshing the workbooks (edits in Excel, work kept in the portal, no
duplicates), matching the website applications (held rows, repeat applicants, nothing replaced), saving resumes as
PDFs from a local test website, the compulsory requisition details, the job description review, and candidate
summaries and department approvals. A smoke test loads the demo data and opens every screen as every role.

## Possible next steps

* Microsoft 365 single sign-on (Entra ID) and creating Teams meetings through Microsoft Graph.
* SMS/WhatsApp notifications for candidates.
* A sync with the HRIS/payroll system so staff data and new hires flow automatically.
