"""Turn resumes into PDF, so they open inside the portal instead of downloading.

PDFs are kept as they are (after checking they open). Photos and scans become PDF pages with
Pillow. Word, RTF, OpenDocument and text files are converted by Microsoft Word on Windows when it
is installed (exactly as Word shows them), otherwise by LibreOffice. Several files are converted in
one go, because starting Word or LibreOffice takes a few seconds.
"""

from __future__ import annotations

import io
import logging
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

OFFICE_KINDS = {"docx", "doc", "rtf", "odt", "text"}
OFFICE_EXTENSIONS = {"docx": ".docx", "doc": ".doc", "rtf": ".rtf", "odt": ".odt", "text": ".txt"}
NOT_DOCUMENTS = {
    "audio": "The link holds an audio recording, not a resume.",
    "video": "The link holds a video, not a resume.",
    "html": "The link returned a web page instead of a file (the resume may have been removed from the website).",
    "empty": "The file is empty.",
    "zip": "The file is a compressed folder, not a resume.",
    "spreadsheet": "The file is a spreadsheet, not a resume.",
    "unknown": "The file type could not be recognised.",
}


class ConversionError(Exception):
    """The file cannot be turned into a PDF."""


class ConverterMissing(ConversionError):
    """Word files need Microsoft Word or LibreOffice, and neither was found."""


def sniff(data: bytes) -> str:
    """What the bytes really are, whatever the file is called."""
    head = data[:16]
    if not data.strip():
        return "empty"
    if b"%PDF-" in data[:1024]:
        return "pdf"
    if head.startswith(b"PK\x03\x04"):
        try:
            names = set(zipfile.ZipFile(io.BytesIO(data)).namelist())
        except zipfile.BadZipFile:
            return "unknown"
        if "word/document.xml" in names:
            return "docx"
        if "content.xml" in names:
            return "odt"
        if any(n.startswith("xl/") for n in names):
            return "spreadsheet"
        return "zip"
    if head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return "doc"
    if head.startswith(b"{\\rtf"):
        return "rtf"
    if head.startswith((b"\xff\xd8\xff", b"\x89PNG", b"GIF87a", b"GIF89a", b"BM", b"II*\x00", b"MM\x00*")) or \
            (head[:4] == b"RIFF" and head[8:12] == b"WEBP"):
        return "image"
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in {b"heic", b"heix", b"mif1", b"msf1"}:
            return "unknown"
        return "audio" if brand in {b"M4A ", b"M4B "} else "video"
    if head.startswith((b"ID3", b"OggS", b"fLaC", b"#!AMR")) or (head[:4] == b"RIFF" and head[8:12] == b"WAVE") or \
            (len(head) > 1 and head[0] == 0xFF and head[1] & 0xF0 == 0xF0):
        return "audio"
    sample = data[:4096].lstrip()
    if sample[:15].lower().startswith((b"<!doctype html", b"<html")):
        return "html"
    try:
        text = data[:4096].decode("utf-8")
    except UnicodeDecodeError:
        text = data[:4096].decode("cp1252", errors="replace")
    printable = sum(1 for ch in text if ch.isprintable() or ch in "\r\n\t")
    return "text" if text and printable / len(text) > 0.95 else "unknown"


def check_pdf(data: bytes) -> int:
    """Number of pages; raises ConversionError when the PDF does not open."""
    import pypdfium2 as pdfium

    try:
        pdf = pdfium.PdfDocument(data)
        pages = len(pdf)
        pdf.close()
    except Exception as exc:  # noqa: BLE001 - any parser error means the file is damaged
        raise ConversionError("The PDF is damaged and cannot be opened.") from exc
    if not pages:
        raise ConversionError("The PDF has no pages.")
    return pages


def image_to_pdf(data: bytes) -> bytes:
    from PIL import Image, ImageOps, ImageSequence, UnidentifiedImageError

    try:
        image = Image.open(io.BytesIO(data))
        pages = [ImageOps.exif_transpose(frame.copy()).convert("RGB") for frame in ImageSequence.Iterator(image)]
    except (UnidentifiedImageError, OSError) as exc:
        raise ConversionError("The picture is damaged and cannot be opened.") from exc
    out = io.BytesIO()
    pages[0].save(out, "PDF", resolution=150.0, save_all=True, append_images=pages[1:])
    return out.getvalue()


def text_to_pdf(text: str) -> bytes:
    """A plain-text resume set on A4 pages, used when neither Word nor LibreOffice is available."""
    import textwrap

    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.load_default(size=22)
    width, height, margin, line_height = 1240, 1754, 110, 34
    columns = 88
    lines = []
    for paragraph in text.replace("\r\n", "\n").split("\n"):
        lines.extend(textwrap.wrap(paragraph, columns) or [""])
    per_page = (height - 2 * margin) // line_height
    pages = []
    for start in range(0, max(len(lines), 1), per_page):
        page = Image.new("RGB", (width, height), "white")
        draw = ImageDraw.Draw(page)
        for n, line in enumerate(lines[start:start + per_page]):
            draw.text((margin, margin + n * line_height), line, fill="black", font=font)
        pages.append(page)
    out = io.BytesIO()
    pages[0].save(out, "PDF", resolution=150.0, save_all=True, append_images=pages[1:])
    return out.getvalue()


def libreoffice_path() -> str | None:
    configured = getattr(settings, "LIBREOFFICE_PATH", "")
    candidates = [configured, shutil.which("soffice"), shutil.which("libreoffice"),
                  r"C:\Program Files\LibreOffice\program\soffice.exe",
                  r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"]
    return next((c for c in candidates if c and os.path.exists(c)), None)


WORD_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  foreach ($line in (Get-Content -LiteralPath $args[0] -Encoding UTF8)) {
    $pair = $line -split "`t"
    try {
      # Read-only, no recent-files entry, and a dummy password so protected files fail instead of asking.
      $doc = $word.Documents.Open($pair[0], $false, $true, $false, 'x')
      $doc.ExportAsFixedFormat($pair[1], 17)
      $doc.Close(0)
    } catch { Write-Output ("FAILED`t" + $pair[0] + "`t" + $_.Exception.Message) }
  }
} finally { $word.Quit() }
"""

_word_works: bool | None = None


def _with_word(jobs: list[tuple[Path, Path]]) -> bool:
    """Convert with Microsoft Word through PowerShell. False when Word is not available."""
    global _word_works
    if os.name != "nt" or _word_works is False or not shutil.which("powershell"):
        return False
    with tempfile.TemporaryDirectory() as tmp:
        script, listing = Path(tmp) / "convert.ps1", Path(tmp) / "files.txt"
        script.write_text(WORD_SCRIPT, encoding="utf-8")
        listing.write_text("\n".join(f"{src}\t{dst}" for src, dst in jobs), encoding="utf-8")
        try:
            result = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script),
                                     str(listing)], capture_output=True, text=True, timeout=60 + 45 * len(jobs))
        except subprocess.TimeoutExpired:
            logger.warning("Microsoft Word took too long; closing it.")
            subprocess.run(["taskkill", "/F", "/IM", "WINWORD.EXE"], capture_output=True)
            return any(dst.exists() for _, dst in jobs)
    if result.returncode != 0 and not any(dst.exists() for _, dst in jobs):
        logger.info("Microsoft Word is not available for PDF conversion: %s", (result.stderr or "").strip()[:300])
        _word_works = False
        return False
    _word_works = True
    return True


def _with_libreoffice(jobs: list[tuple[Path, Path]]) -> bool:
    soffice = libreoffice_path()
    if not soffice:
        return False
    with tempfile.TemporaryDirectory() as profile, tempfile.TemporaryDirectory() as outdir:
        # Its own profile, so a LibreOffice window the user has open does not get in the way.
        command = [soffice, f"-env:UserInstallation={Path(profile).as_uri()}", "--headless", "--norestore",
                   "--convert-to", "pdf", "--outdir", outdir] + [str(src) for src, _ in jobs]
        try:
            subprocess.run(command, capture_output=True, timeout=60 + 30 * len(jobs))
        except subprocess.TimeoutExpired:
            logger.warning("LibreOffice took too long converting %s file(s).", len(jobs))
        for src, dst in jobs:
            made = Path(outdir) / (src.stem + ".pdf")
            if made.exists():
                shutil.move(str(made), dst)
    return True


def convert_office_files(jobs: list[tuple[Path, Path]]) -> None:
    """Write each source file as a PDF at its destination. Missing outputs mean that file failed."""
    if not jobs:
        return
    if _with_word(jobs):
        retry = [(src, dst) for src, dst in jobs if not dst.exists()]
        if retry and libreoffice_path():
            _with_libreoffice(retry)
        return
    if not _with_libreoffice(jobs):
        raise ConverterMissing("Word files need Microsoft Word or LibreOffice to become PDFs; neither was found.")


def to_pdf(data: bytes) -> tuple[bytes, bool]:
    """(pdf, converted) for one file. Raises ConversionError (or ConverterMissing) when it cannot be done."""
    kind = sniff(data)
    if kind == "pdf":
        check_pdf(data)
        return data, False
    if kind == "image":
        return image_to_pdf(data), True
    if kind in OFFICE_KINDS:
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / ("document" + OFFICE_EXTENSIONS[kind])
            dst = Path(tmp) / "document-converted.pdf"
            src.write_bytes(data)
            try:
                convert_office_files([(src, dst)])
            except ConverterMissing:
                if kind != "text":
                    raise
                return text_to_pdf(data.decode("utf-8", errors="replace")), True
            if not dst.exists():
                raise ConversionError("The Word file could not be converted (it may be damaged or password-protected).")
            pdf = dst.read_bytes()
        check_pdf(pdf)
        return pdf, True
    raise ConversionError(NOT_DOCUMENTS.get(kind, NOT_DOCUMENTS["unknown"]))
