"""Resumes saved from website links as PDFs, and shown on the candidate's page. Names here are made up."""

import io
import shutil
import tempfile
import threading
from datetime import date
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import skipUnless

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from accounts.models import User

from .models import Candidate, CandidateDocument
from .pdf import check_pdf, libreoffice_path
from .resumes import Fetcher, acquire_lock, convert_stored, file_name, pending, release_lock

MEDIA = tempfile.mkdtemp()


def tearDownModule():
    shutil.rmtree(MEDIA, ignore_errors=True)


def text_pdf(lines) -> bytes:
    """A small PDF with a real text layer."""
    stream = "BT /F1 12 Tf 72 760 Td 16 TL " + " ".join(f"({line}) Tj T*" for line in lines) + " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = b"%PDF-1.4\n", []
    for n, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n{body}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def jpeg() -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (600, 800), "white").save(buffer, "JPEG")
    return buffer.getvalue()


def docx() -> bytes:
    from docx import Document

    document, buffer = Document(), io.BytesIO()
    document.add_paragraph("Bisi Beta - Instrument technician")
    document.save(buffer)
    return buffer.getvalue()


RESUME = text_pdf(["Ada Testperson", "Process engineer with 6 years of experience",
                   "Skills: HAZOP, Aspen HYSYS, Process simulation", "Email: someone.else@example.com"])


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class Site:
    """A local web server standing in for the resume folder on the company website."""

    def __init__(self, files):
        self.dir = tempfile.mkdtemp()
        folder = Path(self.dir, "resume")
        folder.mkdir()
        for name, data in files.items():
            (folder / name).write_bytes(data)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=self.dir))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def url(self, name):
        return f"http://127.0.0.1:{self.server.server_port}/resume/{name}"

    def close(self):
        self.server.shutdown()
        shutil.rmtree(self.dir, ignore_errors=True)


@override_settings(MEDIA_ROOT=MEDIA)
class ResumeFetchTests(TestCase):
    def setUp(self):
        self.site = Site({"1700000000-ada cv.pdf": RESUME, "1700000001-photo.jpg": jpeg(),
                          "1700000002-bisi cv.docx": docx(), "1700000003-voice.aac": b"\xff\xf1\x50\x80" + b"\x00" * 64,
                          "1700000004-page.pdf": b"<!DOCTYPE html><html><body>Error</body></html>"})
        self.addCleanup(self.site.close)

    def candidate(self, first, link, **extra):
        return Candidate.objects.create(first_name=first, last_name="Test", email=f"{first.lower()}@example.com",
                                        resume_url=self.site.url(link), date_of_birth=date(1995, 1, 1), **extra)

    def test_resumes_are_saved_as_pdfs_without_touching_identity(self):
        ada = self.candidate("Ada", "1700000000-ada cv.pdf")
        photo = self.candidate("Chidi", "1700000001-photo.jpg")
        Fetcher(log=lambda m: None).run(pending())

        document = ada.documents.get()
        self.assertTrue(document.is_pdf)
        self.assertEqual(document.original_name, "ada cv.pdf")
        self.assertEqual(document.source_url, ada.resume_url)
        self.assertEqual(len(document.sha256), 64)
        self.assertFalse(document.original_file)  # already a PDF: one copy only
        ada.refresh_from_db()
        self.assertIn("HAZOP", ada.skills)
        self.assertEqual((ada.email, ada.date_of_birth), ("ada@example.com", date(1995, 1, 1)))
        self.assertEqual(ada.resume_error, "")

        scan = photo.documents.get()
        self.assertTrue(scan.is_pdf)
        self.assertTrue(scan.original_file.name.endswith(".jpg"))  # the file as received is kept
        with scan.file.open("rb") as handle:
            self.assertEqual(check_pdf(handle.read()), 1)

    def test_links_that_are_not_resumes_are_explained(self):
        voice = self.candidate("Dayo", "1700000003-voice.aac")
        page = self.candidate("Efe", "1700000004-page.pdf")
        gone = self.candidate("Femi", "1700000099-missing.pdf")
        stats = Fetcher(log=lambda m: None).run(pending())
        self.assertEqual(stats["not saved"], 3)
        for person, words in ((voice, "audio"), (page, "web page"), (gone, "no longer on the website")):
            person.refresh_from_db()
            self.assertIn(words, person.resume_error)
            self.assertFalse(person.documents.exists())
        self.assertFalse(pending().exists())  # tried today; tried again tomorrow
        self.assertEqual(pending(retry_failed=True).count(), 3)

    def test_running_again_adds_nothing_and_known_files_are_not_duplicated(self):
        ada = self.candidate("Ada", "1700000000-ada cv.pdf")
        # HR had already attached the same file by hand.
        CandidateDocument.objects.create(candidate=ada, doc_type="cv", original_name="cv.pdf",
                                         file=SimpleUploadedFile("cv.pdf", RESUME),
                                         sha256=__import__("hashlib").sha256(RESUME).hexdigest())
        stats = Fetcher(log=lambda m: None).run(pending())
        self.assertEqual(stats["already there"], 1)
        self.assertEqual(ada.documents.count(), 1)
        self.assertEqual(ada.documents.get().source_url, ada.resume_url)
        self.assertFalse(pending(retry_failed=True).exists())
        Fetcher(log=lambda m: None).run(pending(retry_failed=True))
        self.assertEqual(ada.documents.count(), 1)

    @skipUnless(libreoffice_path(), "LibreOffice is not installed")
    def test_word_resumes_become_pdfs(self):
        bisi = self.candidate("Bisi", "1700000002-bisi cv.docx")
        Fetcher(log=lambda m: None, read=False).run(pending())
        document = bisi.documents.get()
        self.assertTrue(document.is_pdf)
        self.assertTrue(document.original_file.name.endswith(".docx"))

    def test_only_one_window_saves_resumes_at_a_time(self):
        self.assertTrue(acquire_lock())
        self.assertFalse(acquire_lock())
        release_lock()
        self.assertTrue(acquire_lock())
        release_lock()

    def test_file_names(self):
        self.assertEqual(file_name("https://site/resume/1363195028-nwaigwe%20desmond%20c.v.pdf"), "nwaigwe desmond c.v.pdf")
        self.assertEqual(file_name("https://site/resume/my cv.pdf"), "my cv.pdf")


@override_settings(MEDIA_ROOT=MEDIA)
class ResumeOnThePageTests(TestCase):
    def setUp(self):
        self.hr = User.objects.create_user("hr", password="x", role=User.Role.HR_ADMIN)
        self.client.force_login(self.hr)
        self.ada = Candidate.objects.create(first_name="Ada", last_name="Test", email="ada@example.com")

    def test_resume_opens_first_inside_the_page(self):
        doc = CandidateDocument.objects.create(candidate=self.ada, doc_type="cv", original_name="ada.pdf",
                                               file=SimpleUploadedFile("ada.pdf", RESUME))
        page = self.client.get(self.ada.get_absolute_url())
        self.assertContains(page, f'<iframe class="resume-frame" src="{reverse("candidates:document", args=[doc.pk])}')
        self.assertContains(page, 'id="t-resume" aria-controls="resume" aria-selected="true"')
        shown = self.client.get(reverse("candidates:document", args=[doc.pk]))
        self.assertEqual(shown["Content-Type"], "application/pdf")
        self.assertEqual(shown["X-Frame-Options"], "SAMEORIGIN")
        self.assertTrue(shown["Content-Disposition"].startswith("inline"))

    def test_without_a_resume_there_is_a_place_to_attach_one(self):
        page = self.client.get(self.ada.get_absolute_url())
        self.assertContains(page, "Attach resume")
        self.assertContains(page, 'id="t-profile" aria-controls="profile" aria-selected="true"')
        response = self.client.post(reverse("candidates:upload", args=[self.ada.pk]),
                                    {"doc_type": "cv", "file": SimpleUploadedFile("scan.jpg", jpeg(), "image/jpeg")})
        self.assertRedirects(response, self.ada.get_absolute_url() + "#resume", fetch_redirect_response=False)
        document = self.ada.documents.get()
        self.assertTrue(document.is_pdf)
        original = self.client.get(reverse("candidates:document", args=[document.pk]) + "?original=1")
        self.assertEqual(original["Content-Type"], "image/jpeg")

    def test_waiting_and_failed_resumes_say_so(self):
        self.ada.resume_url = "https://www.example.com/resume/1-ada.pdf"
        self.ada.save()
        self.assertContains(self.client.get(self.ada.get_absolute_url()), "has not been saved yet")
        self.ada.resume_error = "The resume is no longer on the website (not found)."
        self.ada.save()
        self.assertContains(self.client.get(self.ada.get_absolute_url()), "no longer on the website")

    def test_talent_list_shows_and_filters_resumes(self):
        CandidateDocument.objects.create(candidate=self.ada, doc_type="cv", original_name="ada.pdf",
                                         file=SimpleUploadedFile("ada.pdf", RESUME))
        Candidate.objects.create(first_name="Bayo", last_name="None", email="bayo@example.com")
        with_resume = self.client.get(reverse("candidates:list") + "?resume=yes")
        self.assertContains(with_resume, "Ada Test")
        self.assertNotContains(with_resume, "Bayo None")
        self.assertContains(self.client.get(reverse("candidates:list") + "?resume=no"), "Bayo None")

    def test_stored_photos_are_turned_into_pdfs(self):
        CandidateDocument.objects.create(candidate=self.ada, doc_type="cv", original_name="old.jpg",
                                         file=SimpleUploadedFile("old.jpg", jpeg()))
        stats = convert_stored(log=lambda m: None)
        self.assertEqual(stats["converted"], 1)
        document = self.ada.documents.get()
        self.assertTrue(document.is_pdf)
        self.assertTrue(document.original_file.name.endswith(".jpg"))
