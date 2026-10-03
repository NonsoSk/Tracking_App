# Tracking_App

Automated job search for remote data analyst roles at international startups
paying at least $5,000 a month.

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

## Running it

From the Actions tab, pick **Job search** and click **Run workflow**, or run it
locally with Python 3.9+ (no packages to install):

```sh
python -m jobsearch            # search and update the tracker
python -m jobsearch --dry-run  # show what it would add
python -m unittest             # run the tests
```
