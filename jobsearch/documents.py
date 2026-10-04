"""Turn tailored Markdown into a one-page HTML resume and a PDF."""

import html
import os
import re
import shutil
import subprocess

PAGE_CSS = """
@page { size: A4; margin: 12mm 14mm; }
body { font: 10pt/1.35 "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0; }
h1 { font-size: 17pt; margin: 0 0 2pt; }
h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: .04em;
     border-bottom: 1px solid #999; margin: 9pt 0 3pt; padding-bottom: 1pt; }
h3 { font-size: 10pt; margin: 5pt 0 1pt; }
p { margin: 2pt 0; }
ul { margin: 1pt 0 3pt 14pt; padding: 0; }
li { margin: 0 0 1pt; }
a { color: #111; }
"""


def inline(text):
    text = html.escape(text)
    text = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r'<a href="\2">\1</a>', text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)", r"<em>\1</em>", text)
    return text


def markdown_to_html(markdown):
    """Small Markdown subset: headings, bullets, bold, italics, links, paragraphs."""
    out, in_list = [], False
    for raw in markdown.splitlines():
        line = raw.rstrip()
        bullet = re.match(r"^\s*[-*•]\s+(.*)", line)
        if bullet:
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{inline(bullet.group(1))}</li>")
            continue
        if in_list:
            out.append("</ul>")
            in_list = False
        heading = re.match(r"^(#{1,3})\s+(.*)", line)
        if heading:
            level = len(heading.group(1))
            out.append(f"<h{level}>{inline(heading.group(2))}</h{level}>")
        elif line.strip() and not re.match(r"^-{3,}$", line.strip()):
            out.append(f"<p>{inline(line.strip())}</p>")
    if in_list:
        out.append("</ul>")
    return "\n".join(out)


def resume_html(markdown, title):
    return (f"<!doctype html><html><head><meta charset='utf-8'><title>{html.escape(title)}</title>"
            f"<style>{PAGE_CSS}</style></head><body>\n{markdown_to_html(markdown)}\n</body></html>\n")


def find_chrome():
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        path = shutil.which(name)
        if path:
            return path
    return os.environ.get("CHROME_PATH")


def html_to_pdf(html_path, pdf_path):
    """Print the HTML to PDF with headless Chrome. Returns False if Chrome is missing."""
    chrome = find_chrome()
    if not chrome:
        return False
    subprocess.run(
        [chrome, "--headless", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer",
         f"--print-to-pdf={os.path.abspath(pdf_path)}", "file://" + os.path.abspath(html_path)],
        check=True, capture_output=True, timeout=120,
    )
    return os.path.exists(pdf_path)
