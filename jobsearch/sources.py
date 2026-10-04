"""Fetch remote job listings from public job board APIs.

Every source returns a list of dicts with the same keys, so the filter
and tracker never need to know where a job came from.
"""

import json
import re
import urllib.parse
import urllib.request

USER_AGENT = "Mozilla/5.0 (compatible; TrackingApp-JobSearch/1.0)"
TIMEOUT = 30


def fetch_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


def strip_html(text):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text or "")).strip()


def job(source, source_id, title, company, location, url, posted="",
        salary_text="", salary_min=None, salary_max=None, currency=None,
        period=None, tags=None, description=""):
    return {
        "id": f"{source}:{source_id}",
        "source": source,
        "title": (title or "").strip(),
        "company": (company or "").strip(),
        "location": (location or "").strip(),
        "url": url or "",
        "posted": (posted or "")[:10],
        "salary_text": salary_text or "",
        "salary_min": salary_min,
        "salary_max": salary_max,
        "currency": currency,
        "period": period,
        "tags": tags or [],
        "description": strip_html(description)[:8000],
        "raw_description": (description or "")[:20000],
    }


def remotive(data):
    jobs = []
    for item in data.get("jobs", []):
        jobs.append(job(
            "remotive", item.get("id"), item.get("title"), item.get("company_name"),
            item.get("candidate_required_location"), item.get("url"),
            posted=item.get("publication_date"), salary_text=item.get("salary"),
            tags=item.get("tags"), description=item.get("description"),
        ))
    return jobs


def remoteok(data):
    jobs = []
    for item in data:
        if not isinstance(item, dict) or "position" not in item:
            continue  # the first element is a legal notice
        jobs.append(job(
            "remoteok", item.get("id"), item.get("position"), item.get("company"),
            item.get("location"), item.get("url") or item.get("apply_url"),
            posted=item.get("date"),
            salary_min=item.get("salary_min") or None,
            salary_max=item.get("salary_max") or None,
            currency="USD", period="year",
            tags=item.get("tags"), description=item.get("description"),
        ))
    return jobs


def himalayas(data):
    jobs = []
    for item in data.get("jobs", []):
        locations = item.get("locationRestrictions") or []
        location = ", ".join(
            loc if isinstance(loc, str) else loc.get("name", "") for loc in locations
        ) or "Worldwide"
        jobs.append(job(
            "himalayas", item.get("guid") or item.get("applicationLink"), item.get("title"),
            item.get("companyName"), location,
            item.get("applicationLink") or item.get("guid"),
            posted=str(item.get("pubDate") or ""),
            salary_min=item.get("minSalary"), salary_max=item.get("maxSalary"),
            currency=item.get("currency") or item.get("salaryCurrency") or "USD",
            period="year", tags=item.get("categories"),
            description=item.get("excerpt") or item.get("description"),
        ))
    return jobs


def jobicy(data):
    jobs = []
    for item in data.get("jobs", []):
        jobs.append(job(
            "jobicy", item.get("id"), item.get("jobTitle"), item.get("companyName"),
            item.get("jobGeo"), item.get("url"), posted=item.get("pubDate"),
            salary_min=item.get("annualSalaryMin"), salary_max=item.get("annualSalaryMax"),
            currency=item.get("salaryCurrency") or "USD", period="year",
            tags=item.get("jobIndustry"), description=item.get("jobExcerpt"),
        ))
    return jobs


def queries_for(keywords):
    """Search terms sent to boards that support search."""
    return sorted({"data analyst", "analytics", "business intelligence", *keywords[:3]})


def sources(keywords):
    """(name, url, parser) for every request this run makes."""
    quote = urllib.parse.quote
    for query in queries_for(keywords):
        yield "remotive", f"https://remotive.com/api/remote-jobs?search={quote(query)}", remotive
        yield "himalayas", f"https://himalayas.app/jobs/api/search?q={quote(query)}", himalayas
    yield "remoteok", "https://remoteok.com/api?tag=analyst", remoteok
    yield "remoteok", "https://remoteok.com/api?tag=data", remoteok
    yield "jobicy", "https://jobicy.com/api/v2/remote-jobs?count=50&tag=data%20analyst", jobicy
    yield "jobicy", "https://jobicy.com/api/v2/remote-jobs?count=50&industry=data-science", jobicy


def fetch_all(keywords, log=print):
    """Fetch every source. A failing source is logged and skipped."""
    jobs, seen = [], set()
    for name, url, parser in sources(keywords):
        try:
            found = parser(fetch_json(url))
        except Exception as error:  # one bad board should not stop the run
            log(f"  ! {name}: {url} failed: {error}")
            continue
        log(f"  {name}: {len(found)} listings from {url}")
        for item in found:
            if item["id"] not in seen:
                seen.add(item["id"])
                jobs.append(item)
    return jobs
