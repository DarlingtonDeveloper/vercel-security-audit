#!/usr/bin/env python3
"""Render sanitised audit Markdown as offline, community-branded HTML.

Standard library only. No network, JavaScript, raw HTML, images or subprocesses.
This renderer is not a secret scanner: review and sanitise the source first.
"""
import argparse
import base64
import html
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

ASSETS = Path(__file__).resolve().parents[1] / "assets"
MAX_BYTES = 2_000_000
FONT_FILES = (
    ("Geist", "400", "Geist-Regular.woff2"),
    ("Geist", "600", "Geist-SemiBold.woff2"),
    ("Geist Mono", "400", "GeistMono-Regular.woff2"),
)
STATUSES = {
    "satisfactory": ("Satisfactory", "good"),
    "action_recommended": ("Action recommended", "action"),
    "needs_confirmation": ("Needs confirmation", "unknown"),
    "not_reviewed": ("Not reviewed", "unreviewed"),
    "not_applicable": ("Not applicable", "na"),
}
INLINE = re.compile(r"`[^`\n]+`|!\[[^\]\n]*\]\([^\)\n]*\)|\[[^\]\n]+\]\([^\)\n]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*")


def safe_link(value):
    """Only credential-free HTTPS or same-document anchors; never fetch anything."""
    if not value or re.search(r"[\x00-\x20\x7f\\]", value):
        return None
    if re.fullmatch(r"#[a-zA-Z][a-zA-Z0-9_-]*", value):
        return value
    try:
        url = urlsplit(value)
        if url.scheme != "https" or not url.hostname or url.username is not None or url.password is not None or url.query:
            return None
        if url.port not in (None, 443):
            return None
        # Percent-encoded URL structure may hide credentials, whitespace or a query.
        if re.search(r"%(?:0[0-9a-f]|1[0-9a-f]|20|3a|3f|40|5c|7f)", value, re.I):
            return None
        return value
    except ValueError:
        return None


def inline(text):
    parts, start = [], 0
    for match in INLINE.finditer(text):
        parts.append(html.escape(text[start:match.start()]))
        token = match.group()
        if token.startswith("`"):
            parts.append("<code>" + html.escape(token[1:-1]) + "</code>")
        elif token.startswith("!["):
            parts.append('<span class="omitted-image">[Image omitted from offline report]</span>')
        elif token.startswith("["):
            label, value = token[1:].split("](", 1)
            href = safe_link(value[:-1])
            parts.append('<a href="' + html.escape(href, quote=True) + '" rel="noopener noreferrer">' + html.escape(label) + "</a>" if href else html.escape(label) + " [link omitted]")
        elif token.startswith("**"):
            parts.append("<strong>" + html.escape(token[2:-2]) + "</strong>")
        else:
            parts.append("<em>" + html.escape(token[1:-1]) + "</em>")
        start = match.end()
    parts.append(html.escape(text[start:]))
    return "".join(parts)


def text_line(text):
    status = re.fullmatch(r"(?:\*\*)?Status:(?:\*\*)?\s*([a-z_]+)\.?", text.strip())
    if status and status.group(1) in STATUSES:
        label, css = STATUSES[status.group(1)]
        return '<span class="status-badge status-' + css + '">' + label + "</span>"
    return inline(text)


def markdown_body(source):
    """Small documented Markdown subset, escaped by construction; no raw HTML."""
    lines = source.splitlines()
    if not lines or not lines[0].startswith("# ") or not lines[0][2:].strip():
        raise ValueError("The Markdown report must start with one report title (# Title).")
    title = lines[0][2:].strip()
    if len(title) > 240:
        raise ValueError("The report title is too long.")
    output, navigation, identifiers = [], [], {}
    used_identifiers = {"report-main"}
    section_open, article_open, recommendations = False, False, False
    list_kind, paragraph, fence, code = None, [], False, []

    def flush_paragraph():
        if paragraph:
            output.append("<p>" + "<br>".join(text_line(line.strip()) for line in paragraph) + "</p>")
            paragraph.clear()

    def close_list():
        nonlocal list_kind
        if list_kind:
            output.append("</" + list_kind + ">")
            list_kind = None

    def close_article():
        nonlocal article_open
        if article_open:
            output.append("</article>")
            article_open = False

    def identifier(text):
        base = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:64] or "section"
        count = identifiers.get(base, 0) + 1
        candidate = base if count == 1 else f"{base}-{count}"
        while candidate in used_identifiers:
            count += 1
            candidate = f"{base}-{count}"
        identifiers[base] = count
        used_identifiers.add(candidate)
        return candidate

    for line in lines[1:]:
        stripped = line.strip()
        if re.fullmatch(r"```[a-zA-Z0-9_+-]*", stripped):
            flush_paragraph()
            close_list()
            if fence:
                output.append("<pre><code>" + html.escape("\n".join(code)) + "</code></pre>")
                code.clear()
            fence = not fence
            continue
        if fence:
            code.append(line)
            continue
        if not stripped:
            flush_paragraph()
            close_list()
            continue
        flush_paragraph_if_block = bool(re.match(r"^(?:#{1,6} |[-*] |\d+[.)] |>|---$|<!-- pagebreak -->$)", stripped))
        if flush_paragraph_if_block:
            flush_paragraph()
        heading = re.fullmatch(r"(#{1,6})\s+(.+)", stripped)
        if heading:
            close_list()
            level, text = max(2, len(heading.group(1))), heading.group(2)
            anchor = identifier(text)
            if level == 2:
                close_article()
                if section_open:
                    output.append("</section>")
                recommendations = text.lower().strip() == "recommendations"
                classes = "report-section"
                if "initial priorities" in text.lower():
                    classes += " initial-priorities"
                if text.lower().startswith("appendix"):
                    classes += " appendix"
                output.append('<section class="' + classes + '" id="' + anchor + '">')
                section_open = True
                navigation.append('<li><a href="#' + anchor + '">' + html.escape(text) + "</a></li>")
            elif level == 3 and recommendations:
                close_article()
                output.append('<article class="recommendation" id="' + anchor + '">')
                article_open = True
            output.append(f"<h{level}>" + inline(text) + f"</h{level}>")
            continue
        if stripped == "<!-- pagebreak -->":
            close_list()
            output.append('<div class="page-break" aria-hidden="true"></div>')
            continue
        if stripped == "---":
            close_list()
            output.append("<hr>")
            continue
        item = re.fullmatch(r"(?:([-*])\s+|([0-9]+)[.)]\s+)(.+)", stripped)
        if item:
            kind = "ul" if item.group(1) else "ol"
            if kind != list_kind:
                close_list()
                output.append("<" + kind + ">")
                list_kind = kind
            value = ' value="' + item.group(2) + '"' if kind == "ol" else ""
            output.append("<li" + value + ">" + text_line(item.group(3)) + "</li>")
            continue
        close_list()
        if stripped.startswith(">"):
            output.append("<blockquote><p>" + inline(stripped[1:].strip()) + "</p></blockquote>")
        else:
            paragraph.append(line)
    if fence:
        raise ValueError("Close all fenced code blocks before rendering.")
    flush_paragraph()
    close_list()
    close_article()
    if section_open:
        output.append("</section>")
    return title, "\n".join(output), "<ul>" + "".join(navigation) + "</ul>"


def render_report(source, language="en"):
    if not isinstance(language, str) or not re.fullmatch(r"[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*", language):
        raise ValueError("Use a valid report language tag.")
    if not isinstance(source, str) or len(source.encode("utf-8")) > MAX_BYTES or "\x00" in source:
        raise ValueError("Report input is invalid or exceeds 2 MB.")
    title, body, navigation = markdown_body(source)
    fonts = []
    for family, weight, filename in FONT_FILES:
        data = (ASSETS / "fonts" / filename).read_bytes()
        if data[:4] != b"wOF2":
            raise ValueError("Bundled font data is invalid.")
        encoded = base64.b64encode(data).decode("ascii")
        fonts.append("@font-face{font-family:'" + family + "';font-style:normal;font-weight:" + weight + ";font-display:swap;src:url(data:font/woff2;base64," + encoded + ") format('woff2');}")
    template = (ASSETS / "report.html").read_text(encoding="utf-8")
    style = "\n".join(fonts) + "\n" + (ASSETS / "report.css").read_text(encoding="utf-8")
    licence = "\n\n".join((ASSETS / "fonts" / name).read_text(encoding="utf-8") for name in ("OFL.txt", "LICENSE.txt"))
    values = {"LANG": language, "TITLE": html.escape(title), "STYLE": style, "NAV": navigation, "BODY": body, "FONT_LICENCE": html.escape(licence)}
    if set(re.findall(r"\{\{([A-Z_]+)\}\}", template)) != set(values):
        raise ValueError("Report template placeholders are invalid.")
    return re.sub(r"\{\{([A-Z_]+)\}\}", lambda match: values[match.group(1)], template)


def publish_new(path, data):
    """Stage private bytes, then atomically link to a fresh path, never replace.

    Readers never see a partial file, and a failed write leaves nothing at the
    destination, so a retry at the same path works. Same-path writers race on
    link(2): exactly one wins. Requires a trusted private output directory and
    same-filesystem hard links.
    """
    path = Path(path)
    descriptor, staging = tempfile.mkstemp(prefix=".report-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(staging, path)
    finally:
        os.unlink(staging)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Sanitised Markdown report")
    parser.add_argument("--lang", default="en", help="Document language tag, such as en or fr; shell labels remain English")
    parser.add_argument("-o", "--output", required=True, type=Path, help="New self-contained HTML file; existing files are never overwritten")
    args = parser.parse_args(argv)
    try:
        with args.source.open("rb") as stream:
            data = stream.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError("Report input exceeds 2 MB.")
        document = render_report(data.decode("utf-8"), args.lang)
        publish_new(args.output, document.encode("utf-8"))
    except (OSError, ValueError, UnicodeError):
        print("Could not render report. Check the sanitised Markdown, bundled assets and new output path. Existing files were preserved.", file=sys.stderr)
        return 1
    print("Offline HTML report created. Review it before sharing or printing to PDF.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
