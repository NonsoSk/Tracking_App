"""Save each candidate's resume from IEFCL's website into their document folder, as a PDF.

The applications dump gives every applicant a resume link (``Candidate.resume_url``). ``fetch_resumes``
downloads the ones not yet in the folder, turns Word files and photos into PDF (keeping the file as
received), and files them as the candidate's CV. A file already in the folder (same fingerprint) is not
added twice. Links that fail are noted on the candidate and tried again the next day.

Reading the resume only fills empty skills, tools, certifications, experience and job history, so
candidates can be scored when they are put forward for a vacancy. Names, contacts and dates of birth
always come from the spreadsheets, and nothing is sent to AI.
"""

from __future__ import annotations

import hashlib
import logging
import os
import tempfile
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from django.conf import settings
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from .models import Candidate, CandidateDocument
from .pdf import (NOT_DOCUMENTS, OFFICE_EXTENSIONS, OFFICE_KINDS, ConversionError, ConverterMissing, check_pdf,
                  convert_office_files, image_to_pdf, sniff)

logger = logging.getLogger(__name__)

MAX_BYTES = 25 * 1024 * 1024
RETRY_AFTER = timedelta(hours=20)
BATCH = 40  # downloads in flight at once, and Word files converted per batch
READ_FIELDS = {"skills", "tools", "certifications", "years_experience", "current_employer", "current_job_title",
               "summary", "work_history", "education_history", "linkedin_url"}


class DownloadError(Exception):
    pass


LOCK_STALE = timedelta(minutes=15)


def lock_path() -> Path:
    return Path(settings.MEDIA_ROOT) / ".resumes.lock"


def acquire_lock() -> bool:
    """Only one window saves resumes at a time, so the same file is never filed twice."""
    path = lock_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and time.time() - path.stat().st_mtime < LOCK_STALE.total_seconds():
        return False
    path.write_text(str(os.getpid()))
    return True


def release_lock():
    lock_path().unlink(missing_ok=True)


def pending(*, retry_failed: bool = False):
    """Candidates whose resume link is not yet a document in their folder."""
    saved = CandidateDocument.objects.filter(candidate=OuterRef("pk"), source_url=OuterRef("resume_url"))
    qs = Candidate.objects.exclude(resume_url="").exclude(Exists(saved))
    if not retry_failed:
        qs = qs.filter(Q(resume_error="") | Q(resume_checked_at__lt=timezone.now() - RETRY_AFTER))
    return qs.order_by("pk")


def safe_url(url: str) -> str:
    """Spaces and brackets in file names, encoded once."""
    parts = urlsplit(url.strip())
    return urlunsplit((parts.scheme, parts.netloc, quote(unquote(parts.path)), parts.query, ""))


def file_name(url: str) -> str:
    """The name the candidate gave the file, without the website's upload number."""
    name = unquote(urlsplit(url).path.rsplit("/", 1)[-1]) or "resume"
    stem, _, rest = name.partition("-")
    return rest if stem.isdigit() and rest else name


def download(url: str, *, attempts: int = 3) -> bytes:
    request = Request(safe_url(url), headers={"User-Agent": f"{settings.COMPANY_SHORT_NAME} Recruitment Portal"})
    for attempt in range(attempts):
        try:
            with urlopen(request, timeout=60) as response:  # noqa: S310 - links from the company's own website
                data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise DownloadError("The file is larger than 25 MB.")
            return data
        except HTTPError as exc:
            if exc.code == 404 or exc.code == 410:
                raise DownloadError("The resume is no longer on the website (not found).") from exc
            if exc.code < 500 or attempt == attempts - 1:
                raise DownloadError(f"The website refused the download (error {exc.code}).") from exc
        except (URLError, TimeoutError, OSError) as exc:
            if attempt == attempts - 1:
                reason = getattr(exc, "reason", exc)
                raise DownloadError(f"Could not reach the website: {reason}.") from exc
        time.sleep(2 * (attempt + 1))
    raise DownloadError("Could not download the resume.")


def read_resume(candidate, pdf: bytes):
    """Fill empty skills, tools and experience from the resume's text (no OCR, no AI)."""
    import pypdfium2 as pdfium

    from .cv_parser import heuristic_extract
    from .intake import apply_parsed

    try:
        document = pdfium.PdfDocument(pdf)
        pages = []
        for index in range(min(len(document), 8)):
            page = document[index]
            textpage = page.get_textpage()
            pages.append(textpage.get_text_bounded())
            textpage.close()
            page.close()
        document.close()
    except Exception:  # noqa: BLE001 - an unreadable text layer just means nothing to read
        return
    text = "\n".join(pages).strip()
    if len(text) < 80:
        return  # a scan: the PDF still shows, there is just no text to read
    parsed = {k: v for k, v in heuristic_extract(text).items() if k in READ_FIELDS}
    parsed.update(text=text, method="heuristic")
    apply_parsed(candidate, parsed)


def convert_stored(log=print) -> Counter:
    """CVs already in folders that are not PDFs yet (uploaded before, or when no converter was found)."""
    stats = Counter()
    documents = [d for d in CandidateDocument.objects.filter(doc_type=CandidateDocument.DocType.CV).exclude(file="")
                 if not d.is_pdf]
    if documents:
        log(f"Turning {len(documents):,} CV(s) already in the portal into PDF...")
    for start in range(0, len(documents), BATCH):
        batch, office = documents[start:start + BATCH], []
        for document in batch:
            try:
                with document.file.open("rb") as handle:
                    data = handle.read()
            except OSError:
                stats["missing"] += 1
                continue
            kind = sniff(data)
            if kind == "image":
                replace_with_pdf(document, data, image_to_pdf(data))
                stats["converted"] += 1
            elif kind in OFFICE_KINDS:
                office.append((document, data, kind))
            else:
                stats["left as they are"] += 1
        with tempfile.TemporaryDirectory() as tmp:
            jobs = []
            for n, (_, data, kind) in enumerate(office):
                src = Path(tmp) / f"cv-{n}{OFFICE_EXTENSIONS[kind]}"
                src.write_bytes(data)
                jobs.append((src, Path(tmp) / f"cv-{n}-converted.pdf"))
            try:
                convert_office_files(jobs)
            except ConverterMissing as exc:
                log(str(exc))
                stats["left as they are"] += len(office)
                continue
            for (document, data, _), (_, dst) in zip(office, jobs):
                if dst.exists():
                    replace_with_pdf(document, data, dst.read_bytes())
                    stats["converted"] += 1
                else:
                    stats["left as they are"] += 1
    return stats


def replace_with_pdf(document, data: bytes, pdf: bytes):
    from django.core.files.base import ContentFile

    check_pdf(pdf)
    name = document.original_name or os.path.basename(document.file.name)
    old = document.file
    document.original_file.save(name, ContentFile(data), save=False)
    document.file.save(os.path.splitext(name)[0] + ".pdf", ContentFile(pdf), save=False)
    document.sha256 = document.sha256 or hashlib.sha256(data).hexdigest()
    document.save()
    old.storage.delete(old.name)


class Fetcher:
    def __init__(self, *, read: bool = True, workers: int = 6, log=print):
        self.read = read
        self.workers = workers
        self.log = log
        self.stats = Counter()
        self.rows = []  # for the report: (candidate id, name, link, result)

    def run(self, candidates) -> Counter:
        candidates = list(candidates)
        total = len(candidates)
        if not total:
            self.log("No resumes waiting to be saved.")
            return self.stats
        self.log(f"Saving {total:,} resume(s) from the website. You can stop at any time and run this again "
                 "later: it carries on where it stopped.")
        with ThreadPoolExecutor(self.workers) as pool:
            for start in range(0, total, BATCH):
                batch = candidates[start:start + BATCH]
                results = pool.map(self._download, [c.resume_url for c in batch])
                office = []
                for candidate, (data, error) in zip(batch, results):
                    if error:
                        self.fail(candidate, error)
                    else:
                        self.handle(candidate, data, office)
                self.convert(office)
                if lock_path().exists():
                    lock_path().touch()  # still working: the lock is not stale
                done = min(start + BATCH, total)
                self.log(f"  {done:,} of {total:,}: {self.stats['saved']:,} saved, "
                         f"{self.stats['already there']:,} already in the folder, {self.stats['not saved']:,} not saved")
        return self.stats

    @staticmethod
    def _download(url):
        try:
            return download(url), ""
        except DownloadError as exc:
            return None, str(exc)

    def handle(self, candidate, data: bytes, office: list):
        digest = hashlib.sha256(data).hexdigest()
        existing = candidate.documents.filter(sha256=digest).first()
        if existing:
            if existing.source_url != candidate.resume_url:
                existing.source_url = candidate.resume_url[:500]  # so this link counts as saved
                existing.save(update_fields=["source_url"])
            self.done(candidate, "already in the folder", "already there")
            return
        kind = sniff(data)
        try:
            if kind == "pdf":
                check_pdf(data)
                self.attach(candidate, data, None)
            elif kind == "image":
                self.attach(candidate, data, image_to_pdf(data))
            elif kind in OFFICE_KINDS:
                office.append((candidate, data, kind))
            else:
                self.fail(candidate, NOT_DOCUMENTS.get(kind, NOT_DOCUMENTS["unknown"]))
        except ConversionError as exc:
            self.fail(candidate, str(exc))

    def convert(self, office: list):
        if not office:
            return
        with tempfile.TemporaryDirectory() as tmp:
            jobs = []
            for n, (_, data, kind) in enumerate(office):
                src = Path(tmp) / f"resume-{n}{OFFICE_EXTENSIONS[kind]}"
                src.write_bytes(data)
                jobs.append((src, Path(tmp) / f"resume-{n}-converted.pdf"))
            try:
                convert_office_files(jobs)
            except ConverterMissing as exc:
                for candidate, _, _ in office:
                    self.fail(candidate, str(exc))
                return
            for (candidate, data, _), (_, dst) in zip(office, jobs):
                try:
                    if not dst.exists():
                        raise ConversionError("The Word file could not be converted (it may be damaged or "
                                              "password-protected).")
                    pdf = dst.read_bytes()
                    check_pdf(pdf)
                    self.attach(candidate, data, pdf)
                except ConversionError as exc:
                    self.fail(candidate, str(exc))

    def attach(self, candidate, data: bytes, pdf: bytes | None):
        from .intake import save_document

        url = candidate.resume_url
        # pdf is None when the file already is a PDF: it is stored as it is.
        document = save_document(candidate, content=data, filename=file_name(url), source_url=url,
                                 doc_type=CandidateDocument.DocType.CV, pdf=pdf)
        if self.read:
            read_resume(candidate, pdf if pdf is not None else data)
            document.is_parsed = True
            document.save(update_fields=["is_parsed"])
        self.done(candidate, "saved as PDF" + (" (converted)" if pdf is not None else ""), "saved")

    def done(self, candidate, result: str, stat: str):
        candidate.resume_error, candidate.resume_checked_at = "", timezone.now()
        candidate.save()
        if self.read and stat == "saved":
            from pipeline.matching import rescore_candidate

            rescore_candidate(candidate)
        self.stats[stat] += 1
        self.rows.append((candidate.pk, candidate.full_name, candidate.resume_url, result))

    def fail(self, candidate, error: str):
        candidate.resume_error, candidate.resume_checked_at = error[:255], timezone.now()
        candidate.save(update_fields=["resume_error", "resume_checked_at"])
        self.stats["not saved"] += 1
        self.rows.append((candidate.pk, candidate.full_name, candidate.resume_url, error))

    def write_report(self, folder) -> str:
        from openpyxl import Workbook
        from openpyxl.styles import Font

        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"resumes-{timezone.localtime():%Y-%m-%d-%H%M%S}.xlsx")
        wb = Workbook()
        ws = wb.active
        ws.title = "Resumes"
        ws.append(["Candidate #", "Name", "Resume link", "Result"])
        for row in sorted(self.rows, key=lambda r: (not r[3].startswith(("saved", "already")), r[0])):
            ws.append(list(row))
        for col, width in zip("ABCD", [12, 36, 70, 90]):
            ws.column_dimensions[col].width = width
        for cell in ws[1]:
            cell.font = Font(bold=True)
        ws.freeze_panes = "A2"
        wb.save(path)
        return path
