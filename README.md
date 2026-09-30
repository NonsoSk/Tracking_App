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
python manage.py seed_demo      # optional: demo departments, users and candidates at every stage
python manage.py runserver
```

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

## Roles and what they see

| Role | Access |
|---|---|
| HR Admin, Recruiter | Everything: all requisitions, the talent database, CV intake, the whole workflow, exports. HR Admin also manages master data. |
| Head of Department, Department Manager | Raise and track their department's requisitions and candidates, sit on panels, record decisions for their department, see their department's retirements. |
| Interviewer | Interviews they are on, and the selection report for those candidates. |
| Management | All requisitions and candidates (read-only), offer reviews, and requisition approval if enabled. |
| Onboarding team | Onboarding checklists and the new joiners' documents. |
| Employee | Refer candidates and follow their own referrals. |

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
* **Job advert drafting** from the requirements, and an on-demand **AI fit summary** per candidate.

The default model is `claude-opus-5-5` (change it with `ANTHROPIC_MODEL`). Requests use structured JSON output and the
API's server-side refusal fallback (turn it off with `AI_SERVER_FALLBACK=false` if you call the API through a gateway
that doesn't support it). If the API is unreachable, the portal quietly falls back to the rule-based reader.

Without AI, scanned CVs need **Tesseract OCR** (`apt install tesseract-ocr`; on Windows, install from
UB-Mannheim and set `TESSERACT_CMD`). Old `.doc` files need LibreOffice. The Docker image includes both.

Scoring itself is **not** AI. It is a transparent weighted formula (below), so every rank can be explained and audited.

## How matching works

Each application is scored out of 100:

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
| `python manage.py fetch_cv_emails` | every 15 min | Reads unread emails in the recruitment mailbox (IMAP) and adds their CV attachments. A requisition reference (e.g. `REQ-2026-0004`) or the vacancy title in the subject applies the CV to that vacancy |

On Linux, use cron. On Windows Server, use Task Scheduler, for example
`C:\portal\.venv\Scripts\python.exe C:\portal\manage.py send_reminders`. With Docker Compose, the `scheduler` service
runs all three.

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
medicals, offer validity, maximum upload size, and the video-meeting base URL.

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
* With AI enabled, CV content is sent to the Claude API for extraction. Leave `ANTHROPIC_API_KEY` empty to keep all
  processing on your own servers.

## Project layout

```
config/          settings, URLs
accounts/        users and roles
core/            departments, staff/retirements, notifications, dashboard, AI client, scheduled jobs, demo data
requisitions/    requisitions, job roles, skill catalogue, suggestions (knowledge base + AI)
candidates/      candidate profiles, document folders, CV reader, bulk intake, referrals, Excel import
pipeline/        applications, matching, interviews, selection reports, decisions, offers, medicals, onboarding
careers/         public careers site and the candidate's personal application page
templates/, static/   Bootstrap 5 UI (all assets vendored, no CDN needed)
```

## Tests

```bash
python manage.py test
```

The 66 tests cover the CV reader (PDF/Word/text, scanned files, duplicates), matching, the paper-form rating legend,
both hiring tracks end to end, all offer-review outcomes, permissions, the careers flow, calendar invites and the AI
client (mocked, so no API calls). A smoke test loads the demo data and opens every screen as every role.

## Possible next steps

* Microsoft 365 single sign-on (Entra ID) and creating Teams meetings through Microsoft Graph.
* SMS/WhatsApp notifications for candidates.
* A sync with the HRIS/payroll system so staff data and new hires flow automatically.
