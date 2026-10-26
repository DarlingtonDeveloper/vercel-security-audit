"""Deterministic, stdlib-only checks of the offline renderer and local CLI.

All report content is synthetic. No browser, network service, account, or Git
command is used. Subprocesses are restricted to running the local renderer CLI.
"""
import base64
from collections import Counter
from contextlib import ExitStack
import hashlib
from html.parser import HTMLParser
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


# Import the standalone script without installing it or leaving renderer caches.
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills" / "vercel-security-audit"
SCRIPT = SKILL_DIR / "scripts" / "render_report.py"
ASSETS = SKILL_DIR / "assets"
SPEC = importlib.util.spec_from_file_location("offline_report_renderer", SCRIPT)
RENDERER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RENDERER)

STATUS_LABELS = {
    "satisfactory": "Satisfactory",
    "action_recommended": "Action recommended",
    "needs_confirmation": "Needs confirmation",
    "not_reviewed": "Not reviewed",
    "not_applicable": "Not applicable",
}


class Element:
    """Minimal parsed tree; text is decoded by HTMLParser, never regex-stripped."""

    def __init__(self, tag, attrs=(), parent=None):
        self.tag = tag
        self.attrs = dict(attrs)
        self.attribute_names = [name for name, _ in attrs]
        self.parent = parent
        self.children = []

    @property
    def text(self):
        return "".join(child if isinstance(child, str) else child.text
                       for child in self.children)

    def find(self, tag=None, css_class=None):
        found = []
        for child in self.children:
            if isinstance(child, Element):
                if ((tag is None or child.tag == tag)
                        and (css_class is None
                             or css_class in child.attrs.get("class", "").split())):
                    found.append(child)
                found.extend(child.find(tag, css_class))
        return found


class ParsedHTML(HTMLParser):
    VOID = frozenset({"area", "base", "br", "col", "embed", "hr", "img",
                      "input", "link", "meta", "param", "source", "track", "wbr"})

    def __init__(self, document):
        super().__init__(convert_charrefs=True)
        self.root = Element("document")
        self.stack = [self.root]
        self.errors = []
        self.declarations = []
        self.feed(document)
        self.close()
        if len(self.stack) != 1:
            self.errors.append("Unclosed tags: " + repr([e.tag for e in self.stack[1:]]))

    def handle_decl(self, declaration):
        self.declarations.append(declaration.lower())

    def handle_starttag(self, tag, attrs):
        element = Element(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(element)
        if tag not in self.VOID:
            self.stack.append(element)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if len(self.stack) == 1 or self.stack[-1].tag != tag:
            self.errors.append("Unexpected closing tag: " + tag)
        else:
            self.stack.pop()

    def handle_data(self, data):
        self.stack[-1].children.append(data)

    def find(self, tag=None, css_class=None):
        return self.root.find(tag, css_class)


class RendererCase(unittest.TestCase):
    def render(self, source="# Synthetic review\n\n## Summary\nSafe text.", **kwargs):
        # Deny even attempted DNS, connections, shell commands, and child processes.
        with ExitStack() as stack:
            guards = []
            for target in (
                "socket.socket", "socket.create_connection", "socket.getaddrinfo",
                "subprocess.Popen", "subprocess.run", "subprocess.call",
                "subprocess.check_call", "subprocess.check_output",
                "os.system", "os.popen",
            ):
                guards.append(stack.enter_context(patch(
                    target, side_effect=AssertionError("Forbidden renderer I/O: " + target))))
            document = RENDERER.render_report(source, **kwargs)
            for guard in guards:
                guard.assert_not_called()
        self.assertIsInstance(document, str)
        return document

    def parse(self, document):
        parsed = ParsedHTML(document)
        self.assertEqual(parsed.errors, [], "HTML must have balanced, explicit nesting")
        self.assertEqual(parsed.declarations, ["doctype html"])
        self.assertEqual(len(parsed.find("html")), 1)
        self.assertEqual(len(parsed.find("head")), 1)
        self.assertEqual(len(parsed.find("body")), 1)
        self.assertEqual(len(parsed.find("main")), 1)
        return parsed

    def assert_passive(self, parsed):
        allowed = {
            "html", "head", "meta", "title", "style", "body", "div", "header",
            "p", "span", "h1", "h2", "h3", "h4", "h5", "h6", "aside", "main",
            "ul", "ol", "li", "a", "section", "article", "blockquote", "pre",
            "code", "strong", "em", "hr", "br", "footer", "details", "summary",
        }
        for element in parsed.find():
            self.assertIn(element.tag, allowed)
            self.assertEqual(len(element.attribute_names), len(set(element.attribute_names)))
            for name in element.attrs:
                self.assertFalse(name.startswith("on"), (element.tag, name))
                self.assertNotIn(name, {"src", "srcset", "srcdoc", "action", "formaction",
                                        "poster", "data", "style", "background", "ping"})
                if name == "href":
                    self.assertEqual(element.tag, "a")
            if element.tag == "meta":
                self.assertNotEqual(element.attrs.get("http-equiv", "").lower(), "refresh")
        self.assertEqual(len(parsed.find("style")), 1)

    def assert_navigation_resolves(self, parsed):
        identifiers = [e.attrs["id"] for e in parsed.find() if "id" in e.attrs]
        self.assertEqual(len(identifiers), len(set(identifiers)), "HTML IDs must be unique")
        sections = parsed.find("section")
        navigation = parsed.find("aside", "report-nav")
        self.assertEqual(len(navigation), 1)
        links = navigation[0].find("a")
        self.assertEqual([e.attrs["href"] for e in links],
                         ["#" + section.attrs["id"] for section in sections])
        for link in links:
            self.assertEqual(identifiers.count(link.attrs["href"][1:]), 1)


class RendererHTMLTests(RendererCase):
    def test_string_api_is_deterministic_self_contained_and_offline(self):
        source = "# Revue café — 安全\n\n## Résumé\n[Docs](https://example.test/docs)"
        document = self.render(source)
        self.assertEqual(document, self.render(source))
        parsed = self.parse(document)
        self.assert_passive(parsed)
        self.assertEqual(parsed.find("html")[0].attrs["lang"], "en")
        self.assertEqual(parsed.find("h1")[0].text, "Revue café — 安全")
        self.assert_navigation_resolves(parsed)
        self.assertIn("Community-maintained", parsed.find("header")[0].text)
        self.assertIn("Not endorsed by Vercel", parsed.find("footer")[0].text)
        self.assertEqual(len(parsed.find("a")), 2)  # One nav and one user-activated link.

    def test_first_line_h1_is_required(self):
        for source in ("", "\n# Title", "Text\n# Title", "## Title", "# ", "#\tTitle"):
            with self.subTest(source=source), self.assertRaises(ValueError):
                self.render(source)

    def test_only_first_h1_becomes_document_title(self):
        parsed = self.parse(self.render("# First & <title>\n\n# Later heading\nBody."))
        self.assertEqual([e.text for e in parsed.find("h1")], ["First & <title>"])
        self.assertEqual([e.text for e in parsed.find("title")], ["First & <title>"])
        self.assertEqual([e.text for e in parsed.find("h2")], ["Later heading"])
        self.assert_navigation_resolves(parsed)

    def test_title_length_boundary(self):
        parsed = self.parse(self.render("# " + "é" * 240))
        self.assertEqual(parsed.find("h1")[0].text, "é" * 240)
        with self.assertRaises(ValueError):
            self.render("# " + "é" * 241)

    def test_raw_html_and_event_handlers_are_text_not_elements(self):
        payload = ('<script>alert("synthetic")</script> '
                   '<img src="https://example.test/pixel" onerror="alert(1)"> '
                   '<a href="javascript:alert(1)" onclick="alert(2)">click</a> '
                   '<iframe srcdoc="unsafe"></iframe><form action="/send"></form>')
        parsed = self.parse(self.render("# <b>Title</b> & safety\n\n## Content\n" + payload))
        self.assert_passive(parsed)
        main = parsed.find("main")[0]
        self.assertIn(payload, main.text)
        self.assertEqual(main.find("a"), [])
        self.assertEqual(parsed.find("h1")[0].text, "<b>Title</b> & safety")

    def test_script_and_css_breakouts_stay_literal_in_all_source_contexts(self):
        payload = ('</style><script>window.synthetic=1</script>'
                   '<style>@import url(https://example.test/remote.css);</style>')
        source = ("# " + payload + "\n\n## " + payload + "\n\n" + payload
                  + "\n\n`" + payload + "`\n\n```html\n" + payload + "\n```\n")
        parsed = self.parse(self.render(source))
        self.assert_passive(parsed)
        self.assertNotIn(payload, parsed.find("style")[0].text)
        self.assertEqual(parsed.find("title")[0].text, payload)
        self.assertIn(payload, parsed.find("main")[0].text)
        self.assertEqual(parsed.find("main")[0].find("pre")[0].text, payload)

    def test_template_placeholders_in_source_are_single_pass_literal_text(self):
        literal = "{{LANG}} {{TITLE}} {{STYLE}} {{NAV}} {{BODY}} {{FONT_LICENCE}}"
        source = "# " + literal + "\n\n## " + literal + "\n\n" + literal + " <script>no()</script>"
        parsed = self.parse(self.render(source, language="fr"))
        self.assert_passive(parsed)
        self.assertEqual(parsed.find("html")[0].attrs["lang"], "fr")
        self.assertEqual(parsed.find("title")[0].text, literal)
        self.assertEqual(parsed.find("h1")[0].text, literal)
        self.assertEqual(parsed.find("h2")[0].text, literal)
        self.assertEqual(parsed.find("aside")[0].find("a")[0].text, literal)
        self.assertIn(literal + " <script>no()</script>", parsed.find("main")[0].text)

    def test_markdown_images_are_omitted_not_loaded(self):
        source = ("# Images\n\n## Content\n"
                  "![Remote](https://example.test/pixel)\n"
                  "![Local](file:///tmp/synthetic.png)\n"
                  "![Inline](data:image/png;base64,AAAA)")
        parsed = self.parse(self.render(source))
        self.assert_passive(parsed)
        omitted = parsed.find("span", "omitted-image")
        self.assertEqual(len(omitted), 3)
        self.assertEqual([e.text for e in omitted], ["[Image omitted from offline report]"] * 3)
        self.assertNotIn("example.test/pixel", parsed.find("main")[0].text)
        self.assertEqual(parsed.find("img"), [])

    def test_unsafe_url_forms_never_become_links(self):
        unsafe = (
            "http://example.test/docs", "javascript:alert", "JaVaScRiPt:alert",
            "data:text/html,unsafe", "file:///tmp/synthetic", "//example.test/docs",
            "/relative", "docs/page", "https://user:password@example.test/docs",
            "https://user@example.test/docs", "https://example.test/docs?token=synthetic",
            "https://example.test/docs?token=synthetic#anchor", "https://example.test:444/docs",
            "https://example.test:invalid/docs", "https://[invalid/docs",
            "https://example.test/space here", "https://example.test/\ttab",
            "https://example.test/\x7fcontrol", "https://example.test/back\\slash",
            "https://example.test/%40hidden", "https://example.test/%3Fquery",
            "https://example.test/%0Anewline", "https://example.test/%20space",
            "https://example.test/%3Astructure", "https://example.test/%5Cslash",
            "#bad anchor", "#1bad", "#", "https:///missing-host",
        )
        for url in unsafe:
            with self.subTest(url=url):
                parsed = self.parse(self.render("# Links\n\n## Content\n[label](" + url + ")"))
                main = parsed.find("main")[0]
                self.assertEqual(main.find("a"), [], "Unsafe URL became an actual anchor")
                self.assertIn("label [link omitted]", main.text)
                self.assert_passive(parsed)

    def test_empty_credentials_are_also_disallowed(self):
        for url in ("https://@example.test/docs", "https://:@example.test/docs"):
            with self.subTest(url=url):
                parsed = self.parse(self.render("# Links\n\n[label](" + url + ")"))
                self.assertEqual(parsed.find("main")[0].find("a"), [],
                                 "An empty userinfo component is still URL credentials")

    def test_safe_https_and_document_anchors_retain_exact_href(self):
        safe = ("https://example.test/docs", "https://example.test:443/docs#part",
                "https://example.test/a&b#part", "https://example.test/caf%C3%A9",
                "#content", "#Content_2-test")
        for url in safe:
            with self.subTest(url=url):
                parsed = self.parse(self.render("# Links\n\n## Content\n[label](" + url + ")"))
                link, = parsed.find("main")[0].find("a")
                self.assertEqual(link.attrs["href"], url)
                self.assertEqual(link.text, "label")
                self.assertEqual(set(link.attrs["rel"].split()), {"noopener", "noreferrer"})

    def test_link_labels_and_attribute_quotes_are_escaped(self):
        label = '<img src=x onerror=alert> & "quoted"'
        url = 'https://example.test/path"onclick="synthetic'
        source = "# Links\n\n## Content\n[" + label + "](" + url + ")"
        parsed = self.parse(self.render(source))
        self.assert_passive(parsed)
        link, = parsed.find("main")[0].find("a")
        self.assertEqual(link.text, label)
        self.assertEqual(link.attrs["href"], url)
        self.assertEqual(set(link.attrs), {"href", "rel"})
        self.assertEqual(link.find(), [])

    def test_csp_disables_execution_connections_images_and_forms(self):
        parsed = self.parse(self.render())
        policies = [e.attrs["content"] for e in parsed.find("meta")
                    if e.attrs.get("http-equiv", "").lower() == "content-security-policy"]
        self.assertEqual(len(policies), 1)
        directives = {}
        for entry in policies[0].split(";"):
            tokens = entry.split()
            if tokens:
                self.assertNotIn(tokens[0], directives)
                directives[tokens[0]] = tokens[1:]
        for name in ("default-src", "script-src", "connect-src", "img-src", "form-action",
                     "base-uri", "object-src"):
            self.assertEqual(directives.get(name), ["'none'"], name)
        self.assertEqual(directives.get("font-src"), ["data:"])
        self.assertEqual(directives.get("style-src"), ["'unsafe-inline'"])
        # Frames must be explicitly denied or inherit the deny-all default.
        self.assertEqual(directives.get("frame-src", directives["default-src"]), ["'none'"])
        self.assert_passive(parsed)

    def test_supported_markdown_has_semantic_elements(self):
        source = ("# Report\n\n## Section\n### Detail\n#### Four\n##### Five\n###### Six\n\n"
                  "Paragraph with **bold & safe** and *emphasis* and `x < y`.\nSecond line.\n\n"
                  "- Unordered one\n* Unordered two\n\n3. Ordered three\n4) Ordered four\n\n"
                  "> Quoted <literal>\n\n```python\nx = '<not-html>'\nprint(x)\n```\n\n"
                  "---\n\n<!-- pagebreak -->")
        parsed = self.parse(self.render(source))
        main = parsed.find("main")[0]
        for tag in ("h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li",
                    "blockquote", "pre", "code", "strong", "em", "br", "hr"):
            self.assertTrue(main.find(tag), tag)
        self.assertEqual(main.find("strong")[0].text, "bold & safe")
        self.assertEqual(main.find("em")[0].text, "emphasis")
        self.assertEqual(main.find("blockquote")[0].text, "Quoted <literal>")
        self.assertEqual(main.find("pre")[0].text, "x = '<not-html>'\nprint(x)")
        self.assertEqual(main.find("pre")[0].children[0].tag, "code")
        self.assertEqual(main.find("div", "page-break")[0].attrs["aria-hidden"], "true")
        self.assert_passive(parsed)

    def test_all_five_statuses_have_visible_non_score_labels(self):
        lines = ["# States", "", "## Results"]
        for index, status in enumerate(STATUS_LABELS):
            lines.extend(["", ("**Status:** " if index % 2 else "Status: ") + status + "."])
        parsed = self.parse(self.render("\n".join(lines)))
        badges = parsed.find("span", "status-badge")
        self.assertEqual([badge.text for badge in badges], list(STATUS_LABELS.values()))
        for badge in badges:
            self.assertTrue(badge.text.strip(), "State must not be colour alone")
            self.assertNotRegex(badge.text, r"\d|%|(?i:score)")
            self.assertNotEqual(badge.attrs.get("aria-hidden"), "true")
            self.assertNotIn("hidden", badge.attrs)
        self.assertNotRegex(parsed.find("body")[0].text, r"(?i)security score|\d+/100|\d+%")

    def test_unknown_status_is_literal_not_a_passing_badge(self):
        parsed = self.parse(self.render("# States\n\nStatus: unrecognised\n\nStatus: satisfactory_extra"))
        self.assertEqual(parsed.find("span", "status-badge"), [])
        self.assertIn("Status: unrecognised", parsed.find("main")[0].text)

    def test_h2_ids_deduplicate_and_navigation_resolves(self):
        source = "# Report\n\n## Repeat\nA\n\n## Repeat\nB\n\n## !!!\nC\n\n## !!!\nD"
        parsed = self.parse(self.render(source))
        self.assertEqual([e.attrs["id"] for e in parsed.find("section")],
                         ["repeat", "repeat-2", "section", "section-2"])
        self.assert_navigation_resolves(parsed)

    def test_generated_ids_do_not_collide_with_literal_suffixes_or_main(self):
        for headings in (("Repeat", "Repeat", "Repeat-2"),
                         ("Report main", "Other")):
            with self.subTest(headings=headings):
                source = "# Report\n\n" + "\n\n".join("## " + h for h in headings)
                self.assert_navigation_resolves(self.parse(self.render(source)))

    def test_recommendation_articles_are_siblings_and_close_before_next_section(self):
        source = ("# Report\n\n## Recommendations\nIntro.\n\n"
                  "### First\nBody.\n\n#### Detail\n- Item\n\n"
                  "### Second\nBody.\n\n## Appendix\n### Ordinary heading\nEnd.")
        parsed = self.parse(self.render(source))
        sections = parsed.find("section")
        articles = parsed.find("article")
        self.assertEqual(len(articles), 2)
        self.assertEqual([a.find("h3")[0].text for a in articles], ["First", "Second"])
        for article in articles:
            self.assertIs(article.parent, sections[0])
            self.assertEqual(article.find("article"), [])
        self.assertEqual(sections[1].find("article"), [])
        self.assertEqual(sections[1].find("h3")[0].text, "Ordinary heading")
        self.assert_navigation_resolves(parsed)

    def test_final_article_and_section_close_at_end_of_input(self):
        parsed = self.parse(self.render("# Report\n\n## Recommendations\n### Last\n- End"))
        article, = parsed.find("article")
        self.assertEqual(article.find("li")[0].text, "End")
        self.assertEqual(article.parent.tag, "section")

    def test_ordered_numbers_survive_blank_lines_and_list_type_changes(self):
        source = ("# Steps\n\n## Plan\n3. Third\n\n7. Seventh\n8) Eighth\n\n"
                  "- Bullet\n\n12. Twelfth\n\n1. Restart")
        parsed = self.parse(self.render(source))
        main = parsed.find("main")[0]
        items = [item for listing in main.find("ol") for item in listing.find("li")]
        self.assertEqual([e.attrs.get("value") for e in items], ["3", "7", "8", "12", "1"])
        self.assertEqual([e.text for e in items], ["Third", "Seventh", "Eighth", "Twelfth", "Restart"])
        bullet, = main.find("ul")[0].find("li")
        self.assertNotIn("value", bullet.attrs)

    def test_invalid_source_types_nul_and_unclosed_fence_are_rejected(self):
        for source in (None, b"# Bytes", 42, "# Title\nNUL\x00here",
                       "# Title\n\n```python\nprint('synthetic')"):
            with self.subTest(source=repr(source)), self.assertRaises(ValueError):
                self.render(source)

    def test_two_megabyte_limit_counts_utf8_bytes(self):
        prefix = "# Limit\n\n"
        remaining = 2_000_000 - len(prefix.encode("utf-8"))
        source = prefix + "é" * (remaining // 2) + "a" * (remaining % 2)
        self.assertEqual(len(source.encode("utf-8")), 2_000_000)
        parsed = self.parse(self.render(source))
        self.assertEqual(parsed.find("main")[0].find("p")[0].text, source[len(prefix):])
        with self.assertRaises(ValueError):
            self.render(source + "a")

    def test_language_validation_rejects_attribute_injection_and_non_strings(self):
        for language in ('en" onload="synthetic', "en><script>", "en\nfr", "", "english",
                         "en_US", None, 1):
            with self.subTest(language=language), self.assertRaises(ValueError):
                self.render(language=language)
        for language in ("en", "fr", "fr-CA"):
            with self.subTest(language=language):
                parsed = self.parse(self.render(language=language))
                self.assertEqual(parsed.find("html")[0].attrs, {"lang": language})

    def test_unicode_and_command_like_source_remain_plain_text_without_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "must-not-exist"
            literal = ("é — 安全 🔒 $(touch " + str(marker) + ") "
                       "__import__('os').system('synthetic') {{7*7}}")
            source = "# Unicode\n\n## Content\n" + literal + "\n\n```sh\n" + literal + "\n```"
            parsed = self.parse(self.render(source))
            self.assertIn(literal, parsed.find("main")[0].text)
            self.assertEqual(parsed.find("main")[0].find("pre")[0].text, literal)
            self.assertFalse(marker.exists())


class BundledFontTests(RendererCase):
    def test_manifest_pins_all_three_font_bytes_and_licence_copies(self):
        fonts = ASSETS / "fonts"
        manifest = json.loads((fonts / "SOURCES.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["repository"], "https://github.com/vercel/geist-font")
        self.assertRegex(manifest["commit"], r"\A[0-9a-f]{40}\Z")
        self.assertEqual(manifest["licence"], "SIL Open Font License 1.1")
        self.assertEqual(manifest["licence_files"], ["OFL.txt", "LICENSE.txt"])
        self.assertEqual({e["file"] for e in manifest["fonts"]},
                         {"Geist-Regular.woff2", "Geist-SemiBold.woff2", "GeistMono-Regular.woff2"})
        self.assertEqual(len(manifest["fonts"]), 3)
        for entry in manifest["fonts"]:
            with self.subTest(font=entry["file"]):
                data = (fonts / entry["file"]).read_bytes()
                self.assertEqual(len(data), entry["bytes"])
                self.assertEqual(data[:4], b"wOF2")
                self.assertEqual(hashlib.sha256(data).hexdigest(), entry["sha256"])
                self.assertTrue(entry["source_path"].endswith("/" + entry["file"]))
        for filename in manifest["licence_files"]:
            licence = (fonts / filename).read_text(encoding="utf-8")
            self.assertIn("SIL OPEN FONT LICENSE Version 1.1", licence)
            self.assertIn("Copyright", licence)
            self.assertIn("TERMINATION", licence)
            self.assertIn("DISCLAIMER", licence)

    def test_all_fonts_are_embedded_with_correct_styles_and_no_remote_css(self):
        parsed = self.parse(self.render())
        style = parsed.find("style")[0].text
        # Base64 font payloads legitimately contain //; inspect CSS tokens and
        # URL destinations rather than treating those bytes as remote URLs.
        self.assertNotRegex(style, r"(?i)@import\b|https?://")
        faces = re.findall(r"@font-face\s*\{([^}]+)\}", style)
        self.assertEqual(len(faces), 3)
        expected = (("Geist", "400", "Geist-Regular.woff2"),
                    ("Geist", "600", "Geist-SemiBold.woff2"),
                    ("Geist Mono", "400", "GeistMono-Regular.woff2"))
        for face, (family, weight, filename) in zip(faces, expected):
            with self.subTest(font=filename):
                self.assertIn("font-family:'" + family + "'", face)
                self.assertIn("font-weight:" + weight + ";", face)
                self.assertIn("font-style:normal;", face)
                self.assertIn("font-display:swap;", face)
                self.assertIn("format('woff2')", face)
                encoded, = re.findall(r"url\(data:font/woff2;base64,([A-Za-z0-9+/=]+)\)", face)
                self.assertEqual(base64.b64decode(encoded, validate=True),
                                 (ASSETS / "fonts" / filename).read_bytes())
        urls = re.findall(r"url\(([^)]+)\)", style, flags=re.I)
        self.assertEqual(len(urls), 3)
        self.assertTrue(all(url.startswith("data:font/woff2;base64,") for url in urls))
        css = (ASSETS / "report.css").read_text(encoding="utf-8")
        self.assertIn(css, style)
        self.assertIn("@media print", style)
        self.assertIn("@page", style)
        self.assert_passive(parsed)

    def test_full_licence_copies_are_inline_readable_text(self):
        parsed = self.parse(self.render())
        details, = parsed.find("details", "font-licence")
        self.assertEqual(details.find("summary")[0].text, "Font licences")
        expected = "\n\n".join((ASSETS / "fonts" / filename).read_text(encoding="utf-8")
                                for filename in ("OFL.txt", "LICENSE.txt"))
        self.assertEqual(details.find("pre")[0].text, expected)
        self.assertEqual(details.find("a"), [])


class SyntheticExampleTests(RendererCase):
    def test_example_renders_all_core_and_optional_checks_with_exact_status_counts(self):
        source = (ROOT / "examples" / "security-audit.md").read_text(encoding="utf-8")
        self.assertIn("Synthetic, illustrative report", source)
        self.assertIn("fictional", source)
        parsed = self.parse(self.render(source))
        self.assert_passive(parsed)
        self.assert_navigation_resolves(parsed)
        self.assertEqual(parsed.find("h1")[0].text, "Example team security review")
        sections = {s.find("h2")[0].text: s for s in parsed.find("section")}
        core = sections["Appendix: required core checks"]
        optional = sections["Appendix: optional checks, excluded from core coverage"]
        expected_core = {domain + "-" + str(index).zfill(2)
                         for domain in ("IAM", "CRE", "DEP", "FWB", "SRC", "SEC", "DOM", "OPS")
                         for index in (1, 2, 3)}
        self.assertEqual({h.text.split()[0] for h in core.find("h3")}, expected_core)
        self.assertEqual(len(core.find("h3")), 24)
        self.assertEqual({h.text.split()[0] for h in optional.find("h3")},
                         {"DEP-04", "SRC-04", "SEC-04", "OPS-04"})
        self.assertEqual(len(optional.find("h3")), 4)
        self.assertEqual(Counter(b.text for b in core.find("span", "status-badge")),
                         Counter({"Satisfactory": 12, "Action recommended": 2,
                                  "Needs confirmation": 6, "Not reviewed": 3, "Not applicable": 1}))
        self.assertEqual(Counter(b.text for b in optional.find("span", "status-badge")),
                         Counter({"Not reviewed": 4}))
        self.assertEqual(len(parsed.find("span", "status-badge")), 28)
        self.assertEqual(len(parsed.find("article", "recommendation")), 2)
        priorities = sections["Initial priorities"].find("ol")[0].find("li")
        self.assertEqual([e.attrs.get("value") for e in priorities], ["1", "2", "3"])
        for article in parsed.find("article", "recommendation"):
            self.assertEqual([e.attrs.get("value") for e in article.find("ol")[0].find("li")],
                             [str(i) for i in range(1, 7)])
        self.assertNotRegex(parsed.find("body")[0].text, r"(?i)security score|\d+/100|\d+%")


class RendererCLITests(RendererCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.source = self.directory / "synthetic.md"
        self.output = self.directory / "report.html"

    def cli(self, data=b"# Synthetic CLI review\n\n## Summary\nSafe text.", extra=()):
        self.source.write_bytes(data)
        environment = os.environ.copy()
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        return subprocess.run(
            [sys.executable, "-B", str(SCRIPT), str(self.source), "-o", str(self.output), *extra],
            cwd=self.directory, env=environment, capture_output=True, text=True,
            encoding="utf-8", timeout=20, check=False,
        )

    def assert_cli_failure(self, result, secret="SYNTHETIC_SOURCE_CANARY"):
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr,
                         "Could not render report. Check the sanitised Markdown, bundled assets "
                         "and new output path. Existing files were preserved.\n")
        self.assertNotIn(secret, result.stdout + result.stderr)
        self.assertNotIn(str(self.source), result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_cli_creates_private_output_preserves_input_and_uses_no_cwd_assets(self):
        data = "# Revue café 安全\n\n## Résumé\nTexte synthétique.".encode("utf-8")
        result = self.cli(data)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertEqual(result.stdout,
                         "Offline HTML report created. Review it before sharing or printing to PDF.\n")
        self.assertEqual(self.source.read_bytes(), data)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)
        document = self.output.read_text(encoding="utf-8")
        self.assertEqual(document, self.render(data.decode("utf-8")))
        self.assert_passive(self.parse(document))
        self.assertEqual({p.name for p in self.directory.iterdir()}, {"synthetic.md", "report.html"})

    def test_cli_existing_output_is_never_overwritten(self):
        original = b"Keep existing output exactly.\x00\xff"
        self.output.write_bytes(original)
        os.chmod(self.output, 0o640)
        result = self.cli(b"# SYNTHETIC_SOURCE_CANARY\nNew content.")
        self.assert_cli_failure(result)
        self.assertEqual(self.output.read_bytes(), original)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o640)
        self.assertEqual(self.source.read_bytes(), b"# SYNTHETIC_SOURCE_CANARY\nNew content.")

    def test_cli_output_equal_to_input_preserves_source(self):
        data = b"# SYNTHETIC_SOURCE_CANARY\nMust remain Markdown."
        result = self.cli(data, extra=("--output", str(self.source)))
        self.assert_cli_failure(result)
        self.assertEqual(self.source.read_bytes(), data)
        self.assertFalse(self.output.exists())

    @unittest.skipUnless(hasattr(os, "symlink"), "Requires symlinks")
    def test_cli_refuses_existing_symlink_without_touching_target(self):
        target = self.directory / "target.txt"
        target.write_bytes(b"Preserve symlink target.")
        self.output.symlink_to(target)
        result = self.cli()
        self.assert_cli_failure(result)
        self.assertTrue(self.output.is_symlink())
        self.assertEqual(target.read_bytes(), b"Preserve symlink target.")

    def test_cli_rejects_invalid_inputs_without_output_or_source_content_in_error(self):
        canary = b"SYNTHETIC_SOURCE_CANARY"
        cases = {
            "invalid UTF-8": b"# " + canary + b"\n\xff",
            "unclosed fence": b"# " + canary + b"\n```python\nsecret = 'synthetic'",
            "oversized": b"# " + canary + b"\n" + b"x" * 2_000_000,
            "NUL": b"# " + canary + b"\n\x00",
            "missing title": canary + b"\nNo H1.",
            "empty": b"",
        }
        for name, data in cases.items():
            with self.subTest(case=name):
                self.assert_cli_failure(self.cli(data))
                self.assertFalse(self.output.exists())
                self.assertEqual(self.source.read_bytes(), data)

    def test_cli_lang_en_and_fr(self):
        for language in ("en", "fr"):
            with self.subTest(language=language):
                result = self.cli(extra=("--lang", language))
                self.assertEqual(result.returncode, 0, result.stderr)
                parsed = self.parse(self.output.read_text(encoding="utf-8"))
                self.assertEqual(parsed.find("html")[0].attrs, {"lang": language})
                self.output.unlink()

    def test_cli_language_injection_is_rejected_without_leaking_source(self):
        result = self.cli(b"# SYNTHETIC_SOURCE_CANARY\nPrivate synthetic body.",
                          extra=("--lang", 'en" onload="synthetic'))
        self.assert_cli_failure(result)
        self.assertFalse(self.output.exists())


class RendererPublishTests(unittest.TestCase):
    """A failed write must leave nothing at the destination so a retry works (#30)."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.source = self.directory / "synthetic.md"
        self.source.write_text("# Synthetic review\n\n## Summary\nSafe text.", encoding="utf-8")
        self.output = self.directory / "report.html"

    def main(self):
        with patch("sys.stdout"), patch("sys.stderr"):
            return RENDERER.main([str(self.source), "-o", str(self.output)])

    def assert_nothing_published(self):
        self.assertFalse(self.output.exists())
        self.assertFalse(list(self.directory.glob(".report-*")))

    def test_failed_write_publishes_nothing_and_retry_succeeds(self):
        real_fdopen = os.fdopen

        class PartialWriter:
            """Writes 100 bytes, then fails like a full disk."""
            def __init__(self, stream):
                self.stream = stream
            def __enter__(self):
                return self
            def __exit__(self, *exc):
                self.stream.close()
            def fileno(self):
                return self.stream.fileno()
            def flush(self):
                self.stream.flush()
            def write(self, data):
                self.stream.write(data[:100])
                self.stream.flush()
                raise OSError(28, "No space left on device")

        def failing_fdopen(descriptor, *args, **kwargs):
            return PartialWriter(real_fdopen(descriptor, *args, **kwargs))

        with patch.object(RENDERER.os, "fdopen", failing_fdopen):
            self.assertEqual(self.main(), 1)
        self.assert_nothing_published()
        self.assertEqual(self.main(), 0)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)
        self.assertTrue(self.output.read_text(encoding="utf-8").startswith("<!doctype html>"))

    def test_failed_fsync_or_link_publishes_nothing(self):
        for target in ("fsync", "link"):
            with self.subTest(target=target):
                with patch.object(RENDERER.os, target, side_effect=OSError(5, "I/O error")):
                    self.assertEqual(self.main(), 1)
                self.assert_nothing_published()


if __name__ == "__main__":
    unittest.main()
