# Tracking_App

Automated job search for remote data analyst roles at international startups
paying at least $5,000 a month. For every match it drafts a one-page tailored
resume, a cover letter and an outreach email, and sends them once you approve.

## What it does

Every day a GitHub Action searches public remote job boards (Remotive,
RemoteOK, Himalayas and Jobicy), keeps the listings that match, and records
them in the tracker:

- [`data/jobs.csv`](data/jobs.csv) is the tracker. Open it in Excel or Google
  Sheets, or edit it on GitHub. Change `status` (New, Interested, Applied,
  Interviewing, Offer, Rejected, Skipped) and `notes` as you go; the next
  search adds new jobs without touching your edits.
- [`JOBS.md`](JOBS.md) shows the same jobs grouped by status, with links.

A listing is a match when:

- the title is an analyst role from `title_keywords` (data, BI, product,
  analytics engineer and similar) and not one in `title_exclude`;
- it is open worldwide or to a region in `allowed_locations` (Europe, EMEA,
  Africa, UK, GMT and so on), so "US only" roles are skipped;
- its stated pay is at least `min_monthly_usd` ($5,000) a month at the top of
  its range. Yearly, hourly and non-USD pay is converted using `usd_rates`.
  Jobs that don't list pay are skipped unless `include_unknown_salary` is true.

All of these live in [`config.json`](config.json). Add companies you don't want
to see to `exclude_companies`.

## Applications

For each new match (up to `max_drafts_per_run` a day) Claude rewrites your
resume for that job and writes a cover letter and outreach email. Each job
gets a folder under `applications/` with:

- `resume.pdf` (one page), `resume.md` and `resume.html`
- `cover_letter.pdf` and `cover_letter.md`
- `outreach.md`: the email, with the recruiter address on the `To:` line
- `job.md`: the post, a 1 to 10 fit score, and requirements you don't meet

Claude only rewords and reorders what is in your resume; it never adds
experience you don't have. Check the gaps in `job.md` before approving.

**Nothing is sent without your approval.** To send, set the job's `status` to
`Approved` in `data/jobs.csv`. Saving that change on GitHub runs the
**Send approved applications** workflow, which emails `outreach.md` to the
`To:` address with the resume and cover letter attached, then marks the job
`Applied`. The address comes only from the job post itself; when a post lists
none, the `To:` line is blank and you either fill it in or apply through the
job link with the drafted files. Job board application forms are not filled in
automatically.

### One-time setup

In the repository, go to Settings, then Secrets and variables, then Actions,
and add these repository secrets:

| Secret | What it is |
|---|---|
| `ANTHROPIC_API_KEY` | A Claude API key from console.anthropic.com, used to tailor the documents |
| `RESUME_TEXT` | Your full resume as text (or put it in `profile/resume.md` if the repo is private) |
| `SMTP_USER` | The Gmail address emails are sent from |
| `SMTP_PASSWORD` | A Gmail app password (Google Account, Security, App passwords) |

For another provider, also set `SMTP_HOST` and `SMTP_PORT` (SSL).

The drafts in `applications/` contain your name and contact details, so keep
this repository private.

## Running it

From the Actions tab, pick **Job search** and click **Run workflow**, or run it
locally with Python 3.10+ after `pip install -r requirements.txt`:

```sh
python -m jobsearch            # search, update the tracker, draft applications
python -m jobsearch --dry-run  # show what it would add
python -m jobsearch send       # send outreach for jobs marked Approved
python -m unittest             # run the tests
```
