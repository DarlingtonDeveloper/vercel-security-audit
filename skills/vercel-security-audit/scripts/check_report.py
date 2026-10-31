#!/usr/bin/env python3
"""Read-only structural QA for bundled-renderer HTML. Stdlib; never opens a browser."""
import argparse
import base64
from collections import Counter
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys

# Resolve the sibling renderer from this file, not sys.path[0], so the helper
# also works under python -I (which does not add the script directory).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from render_report import OWNER_ACCEPTED_MARKER, ReportError, describe_os_error, safe_link

SKILL = Path(__file__).resolve().parents[1]
MAX_BYTES = 8_000_000
LABELS = {
    "Satisfactory": "satisfactory",
    "Action recommended": "action_recommended",
    "Needs confirmation": "needs_confirmation",
    "Not reviewed": "not_reviewed",
    "Not applicable": "not_applicable",
}
# Least to most favourable; report-template.md defines the same order. Matrix
# rows with several status cells summarise to their least favourable status.
STATUS_ORDER = ("action_recommended", "needs_confirmation", "not_reviewed", "satisfactory", "not_applicable")
MATRIX_MARKERS = ("Team-wide", "By project")
CHECK_ID = re.compile(r"\b[A-Z]{3}-\d{2}\b")


def checklist_groups():
    checklist = (SKILL / "references" / "checklist.md").read_text(encoding="utf-8")
    core_text, optional_text = checklist.split("## Optional deeper", 1)
    groups = {name: set(re.findall(r"^### ([A-Z]{3}-\d{2})", text, re.M))
              for name, text in (("core", core_text), ("optional", optional_text))}
    if len(groups["core"]) != 24 or len(groups["optional"]) != 4 or groups["core"] & groups["optional"]:
        raise ReportError("Bundled checklist IDs are invalid.")
    return groups


class CheckError(ReportError):
    """A literal rule message naming one bundled checklist ID, and optionally status keys.

    Only values from the bundled checklist and the five status keys are added,
    so report text can never reach the message; anything else is dropped.
    """

    def __init__(self, message, check_id, matrix=None, appendix=None):
        known = set().union(*checklist_groups().values())
        details = []
        if check_id in known:
            details.append("check ID " + check_id)
        for role, status in (("matrix", matrix), ("appendix", appendix)):
            if status in STATUS_ORDER:
                details.append(role + " " + status)
        super().__init__(message + (" (" + "; ".join(details) + ")." if details else ""))


class Node:
    def __init__(self, tag, attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []
        self.names = [name for name, _ in attrs]

    @property
    def text(self):
        return "".join(child if isinstance(child, str) else child.text for child in self.children)

    def find(self, tag=None, cls=None):
        result = []
        for child in self.children:
            if isinstance(child, Node):
                if (tag is None or child.tag == tag) and (cls is None or cls in child.attrs.get("class", "").split()):
                    result.append(child)
                result.extend(child.find(tag, cls))
        return result


class Document(HTMLParser):
    VOID = {"meta", "hr", "br"}

    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.root = Node("document")
        self.stack, self.declarations = [self.root], []
        self.feed(text)
        self.close()
        if len(self.stack) != 1 or self.declarations != ["doctype html"]:
            raise ReportError("Expected balanced HTML with one HTML doctype.")

    def handle_decl(self, value):
        self.declarations.append(value.lower())

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        if len(node.names) != len(set(node.names)):
            raise ReportError("Duplicate HTML attribute.")
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)
        if len(self.stack) > 64:
            raise ReportError("HTML nesting exceeds checker limit.")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if len(self.stack) == 1 or self.stack[-1].tag != tag:
            raise ReportError("Unbalanced HTML.")
        self.stack.pop()

    def handle_data(self, value):
        self.stack[-1].children.append(value)

    def handle_comment(self, value):
        raise ReportError("Comments are outside the generated HTML dialect.")

    def handle_pi(self, value):
        raise ReportError("Processing instructions are not supported.")

    def unknown_decl(self, value):
        raise ReportError("Unsupported declaration.")


def read_text(path):
    with path.open("rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES or b"\0" in data:
        raise ReportError("Input is invalid or exceeds 8 MB.")
    return data.decode("utf-8")


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ReportError("Duplicate JSON key.")
            result[key] = value
        return result
    return json.loads(read_text(path), object_pairs_hook=unique)


def check_passive(root):
    """Conservative generated dialect, not a general HTML/CSS security validator."""
    tags = set("html head meta title style body div header p span h1 h2 h3 h4 h5 h6 aside main ul ol li a section article blockquote pre code strong em hr br footer details summary table thead tbody tr th td".split())
    attributes = {
        "html": {"lang"}, "meta": {"charset", "name", "content", "http-equiv"},
        "a": {"href", "rel"}, "aside": {"aria-label"}, "div": {"aria-hidden"},
        "li": {"value"}, "th": {"scope"},
    }
    nodes = root.find()
    for node in nodes:
        if node.tag not in tags or set(node.attrs) - attributes.get(node.tag, set()) - {"class", "id"}:
            raise ReportError("HTML is outside the passive generated dialect.")
        if any(value is None for value in node.attrs.values()):
            raise ReportError("Unexpected valueless attribute.")
        if re.search(r"logo", node.attrs.get("class", "") + " " + node.attrs.get("id", ""), re.I):
            raise ReportError("Logo markup is unsuitable for the community report.")
        if node.tag == "a" and (not safe_link(node.attrs.get("href"))
                                or set(node.attrs.get("rel", "").split()) != {"noopener", "noreferrer"}):
            # Generated navigation anchors have no rel and remain same-document.
            if not (re.fullmatch(r"#[a-zA-Z][a-zA-Z0-9_-]*", node.attrs.get("href", ""))
                    and set(node.attrs) <= {"href"}):
                raise ReportError("Unsafe or non-generated link.")
    for tag in ("html", "head", "body", "title", "style", "main", "header", "footer", "h1"):
        if len(root.find(tag)) != 1:
            raise ReportError("Required document landmark missing or duplicated.")
    html, = root.find("html")
    head, = root.find("head")
    body, = root.find("body")
    style, = root.find("style")
    if ([n for n in root.children if isinstance(n, Node)] != [html]
            or [n for n in html.children if isinstance(n, Node)] != [head, body]
            or style not in head.children
            or any(n.tag not in {"meta", "title", "style"} for n in head.find())
            or any(n.tag in {"meta", "title", "style", "head", "html"} for n in body.find())
            or len(body.find("main")) != 1):
        raise ReportError("Unexpected document landmark nesting.")
    check_tables(root)
    identifiers = [n.attrs["id"] for n in nodes if "id" in n.attrs]
    if len(identifiers) != len(set(identifiers)):
        raise ReportError("Duplicate HTML ID.")
    for link in root.find("a"):
        href = link.attrs["href"]
        if href.startswith("#") and href[1:] not in identifiers:
            raise ReportError("Unresolved local navigation.")
    policies = []
    for meta in root.find("meta"):
        if "http-equiv" in meta.attrs:
            if meta.attrs["http-equiv"].lower() != "content-security-policy":
                raise ReportError("Unexpected HTTP-equivalent meta.")
            policies.append(meta)
    if len(policies) != 1 or policies[0] not in head.children or head.children.index(policies[0]) > head.children.index(style):
        raise ReportError("One CSP is required before embedded style.")
    directives = {}
    for entry in policies[0].attrs.get("content", "").split(";"):
        parts = entry.split()
        if parts:
            if parts[0] in directives:
                raise ReportError("Duplicate CSP directive.")
            directives[parts[0]] = parts[1:]
    expected = {name: ["'none'"] for name in (
        "default-src", "img-src", "connect-src", "script-src", "form-action", "base-uri", "object-src")}
    expected.update({"style-src": ["'unsafe-inline'"], "font-src": ["data:"]})
    if directives != expected:
        raise ReportError("CSP differs from the bundled deny-by-default policy.")
    # Exact trusted CSS matching avoids claiming a regex is a general CSS parser.
    # This also rejects escapes, imports, remote url(), and hidden logo additions.
    fonts = []
    for family, weight, filename in (("Geist", "400", "Geist-Regular.woff2"),
                                      ("Geist", "600", "Geist-SemiBold.woff2"),
                                      ("Geist Mono", "400", "GeistMono-Regular.woff2")):
        data = (SKILL / "assets" / "fonts" / filename).read_bytes()
        if data[:4] != b"wOF2":
            raise ReportError("Bundled WOFF2 is invalid.")
        encoded = base64.b64encode(data).decode("ascii")
        fonts.append("@font-face{font-family:'" + family + "';font-style:normal;font-weight:" + weight
                     + ";font-display:swap;src:url(data:font/woff2;base64," + encoded + ") format('woff2');}")
    expected_style = "\n".join(fonts) + "\n" + (SKILL / "assets" / "report.css").read_text(encoding="utf-8")
    if style.text != expected_style:
        raise ReportError("Embedded styles/fonts differ from trusted bundled assets.")
    header, = root.find("header")
    footer, = root.find("footer")
    for node, phrases in ((header, (
            "Community-maintained · Unofficial",
            "Independently maintained. Not an official Vercel product or endorsed by Vercel.",
            "This review is not a security certification or a guarantee of compliance.")),
            (footer, ("Community-maintained · Unofficial", "Not endorsed by Vercel.",
                      "this report does not certify security or compliance."))):
        if any(phrase not in node.text for phrase in phrases):
            raise ReportError("Required community/unofficial disclaimer is missing.")


def elements(node):
    """Element children only; whitespace between generated tags is ignored."""
    if any(isinstance(child, str) and child.strip() for child in node.children):
        raise ReportError("Table structure contains unexpected text outside its cells.")
    return [child for child in node.children if isinstance(child, Node)]


def check_tables(root):
    """Only the renderer's pipe-table shape: wrapped, one header row, equal widths."""
    wrapped = []
    containers = root.find("main") + root.find("section") + root.find("article")
    for wrapper in root.find("div", "table-wrap"):
        if not any(wrapper in container.children for container in containers):
            raise ReportError("Tables must sit directly in the report body, a section or a recommendation.")
        if wrapper.attrs != {"class": "table-wrap"} or [n.tag for n in elements(wrapper)] != ["table"]:
            raise ReportError("Each table needs exactly one generated table-wrap container.")
        table, = elements(wrapper)
        if table.attrs or [n.tag for n in elements(table)] != ["thead", "tbody"]:
            raise ReportError("Tables need exactly one header group followed by one body group.")
        head, body = elements(table)
        header_rows, body_rows = elements(head), elements(body)
        if head.attrs or body.attrs or len(header_rows) != 1 or not body_rows:
            raise ReportError("Tables need one header row and at least one body row.")
        width = None
        for row, cell_tag in [(header_rows[0], "th")] + [(row, "td") for row in body_rows]:
            cells = elements(row)
            if row.tag != "tr" or row.attrs or not cells or any(cell.tag != cell_tag for cell in cells):
                raise ReportError("Table header rows need only column headers and body rows only data cells.")
            if any(cell.attrs != ({"scope": "col"} if cell_tag == "th" else {}) for cell in cells):
                raise ReportError("Table cells have attributes outside the generated dialect.")
            if width is not None and len(cells) != width:
                raise ReportError("Table rows have inconsistent column counts.")
            width = len(cells)
        wrapped += [table, head, body] + header_rows + body_rows
        wrapped += [cell for row in header_rows + body_rows for cell in elements(row)]
    expected = {id(node) for node in wrapped}
    if any(id(node) not in expected for tag in ("table", "thead", "tbody", "tr", "th", "td")
           for node in root.find(tag)):
        raise ReportError("Table elements appear outside the generated table shape.")


def outcome_badges(node):
    """Status badges outside tables; status-matrix cells are never appendix outcomes."""
    found = []
    for child in node.children:
        if isinstance(child, Node) and child.tag != "table":
            if "status-badge" in child.attrs.get("class", "").split():
                found.append(child)
            found += outcome_badges(child)
    return found


def check_counts(root):
    groups = checklist_groups()
    outcomes = {}
    main, = root.find("main")
    appendix = root.find("section", "appendix")
    if not appendix:
        raise ReportError("No appendix section found. Put check outcomes under second-level headings "
                         "that begin with Appendix, for example ## Appendix: Identity and access.")
    for section in appendix:
        if section not in main.children or any(heading not in section.children for heading in section.find("h3")):
            raise ReportError("Appendix sections and check headings must be direct children of main/section.")
        current, badges = None, []

        def finish():
            if current is not None:
                if current in outcomes or len(badges) != 1 or badges[0] not in LABELS:
                    raise ReportError("Each distinct appendix check needs exactly one known status.")
                outcomes[current] = LABELS[badges[0]]

        for child in section.children:
            if not isinstance(child, Node):
                continue
            if child.tag == "h3":
                finish()
                match = re.match(r"^([A-Z]{3}-\d{2})\s+-\s+\S", child.text.strip())
                if not match:
                    raise ReportError("Appendix check headings must begin with a topic ID and title.")
                current, badges = match.group(1), []
            if child.tag == "table":
                continue
            found = ([child] if "status-badge" in child.attrs.get("class", "").split() else [])
            found += outcome_badges(child)
            if found and current is None:
                raise ReportError("Appendix status lacks a check heading.")
            badges.extend(node.text.strip() for node in found)
        finish()
    if set(outcomes) != groups["core"] | groups["optional"]:
        raise ReportError("Appendix must contain all 24 core and four optional IDs exactly once. Only checks "
                         "under second-level headings that begin with Appendix are counted.")
    counts = {}
    for name, topics in groups.items():
        counter = Counter(outcomes[topic] for topic in topics)
        counts[name] = {status: counter[status] for status in LABELS.values()}
    return counts, outcomes


def matrix_tables(main):
    """Tables opening the report: directly in main before any section, then in its first section."""
    tables, children = [], [child for child in main.children if isinstance(child, Node)]
    for child in children:
        if child.tag == "section":
            if "appendix" not in child.attrs.get("class", "").split():
                tables += [node for node in child.children
                           if isinstance(node, Node) and "table-wrap" in node.attrs.get("class", "").split()]
            break
        if "table-wrap" in child.attrs.get("class", "").split():
            tables.append(child)
    return [elements(wrapper)[0] for wrapper in tables]


def matrix_cell(cell):
    """One status key from a badge, or None for Team-wide / By project."""
    parts = [child for child in cell.children if isinstance(child, Node)]
    if not parts and cell.text.strip() in MATRIX_MARKERS:
        return None
    if (len(parts) != 1 or any(isinstance(child, str) and child.strip() for child in cell.children)
            or "status-badge" not in parts[0].attrs.get("class", "").split()
            or parts[0].text.strip() not in LABELS):
        raise ReportError("Status matrix cells must hold exactly one status key, Team-wide or By project.")
    return LABELS[parts[0].text.strip()]


def check_matrix(root, outcomes):
    """Each check's status matrix row must summarise to its appendix outcome."""
    groups = checklist_groups()
    main, = root.find("main")
    tables = matrix_tables(main)
    if not tables:
        raise ReportError("No status matrix found. Open the report with the status matrix tables, before "
                          "the review summary and in the same second-level section.")
    rows, accepted = {}, set()
    for table in tables:
        head, body = elements(table)
        table_groups = set()
        for row in elements(body):
            cells = elements(row)
            identifiers = set(CHECK_ID.findall(cells[0].text))
            if len(identifiers) != 1:
                raise ReportError("Each status matrix row needs exactly one check ID in its first cell.")
            identifier, = identifiers
            label = " ".join(cells[0].text.split())
            if "owner-accepted" in label.lower():
                if label.lower().count("owner-accepted") != 1 or not label.endswith(" " + OWNER_ACCEPTED_MARKER):
                    raise CheckError("Owner-accepted marker must be exactly (owner-accepted) at the end of the Check cell.",
                                     identifier)
                accepted.add(identifier)
            group = next((name for name, topics in groups.items() if identifier in topics), None)
            if group is None:
                raise ReportError("Status matrix has a row for an ID that is not in the bundled checklist.")
            if identifier in rows:
                raise CheckError("Status matrix lists a check more than once.", identifier)
            statuses = [status for status in map(matrix_cell, cells[1:]) if status is not None]
            if not statuses:
                raise CheckError("Status matrix row has no status, only Team-wide or By project.", identifier)
            rows[identifier] = min(statuses, key=STATUS_ORDER.index)
            table_groups.add(group)
        if len(table_groups) > 1:
            raise ReportError("Optional checks need their own status matrix table, separate from core checks.")
    for group in ("core", "optional"):
        for identifier in sorted(groups[group]):
            if identifier not in rows:
                raise CheckError("Status matrix is missing a check that the appendix contains.", identifier)
            matrix, appendix = rows[identifier], outcomes[identifier]
            if matrix != appendix:
                if STATUS_ORDER.index(matrix) > STATUS_ORDER.index(appendix):
                    raise CheckError("Status matrix shows a better result than the appendix.",
                                     identifier, matrix, appendix)
                raise CheckError("Status matrix shows a worse result than the appendix.",
                                 identifier, matrix, appendix)
            if identifier in accepted and appendix != "needs_confirmation":
                raise CheckError("Owner-accepted marker is on a check whose status is not needs_confirmation.",
                                 identifier, matrix, appendix)
    return "matched all 28 checks", sorted(accepted)


def check_summary(summary, counts):
    if not isinstance(summary, dict) or set(summary) != {"core", "optional"}:
        raise ReportError("Expected summary needs separate core and optional objects.")
    for group in counts:
        values = summary[group]
        if (not isinstance(values, dict) or set(values) != set(LABELS.values())
                or any(type(value) is not int or value < 0 for value in values.values())):
            raise ReportError("Expected summary needs all five nonnegative integer status counts.")
    if summary["core"] != counts["core"]:
        raise ReportError("Expected summary core counts do not match the appendix.")
    if summary["optional"] != counts["optional"]:
        raise ReportError("Expected summary optional counts do not match the appendix.")


def check_evidence(source, outcomes):
    """Accept a template-style record or flat records, not a report-builder schema."""
    records = [source] if isinstance(source, dict) else source
    if not isinstance(records, list) or not records:
        raise ReportError("Evidence needs a record or nonempty list of records.")
    seen = set()
    for record in records:
        if not isinstance(record, dict):
            raise ReportError("Invalid evidence record.")
        topic, status = record.get("topic_id"), record.get("status")
        if (not isinstance(topic, str) or not isinstance(status, str)
                or topic not in outcomes or topic in seen or status != outcomes[topic]):
            raise ReportError("Evidence topic/status does not match appendix.")
        seen.add(topic)
    if len(seen) == 28:
        return "matched all 28 checks"
    return f"matched {len(seen)} of 28 checks; partial source"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html", type=Path, help="Generated sanitised local HTML")
    parser.add_argument("--expected-summary", type=Path, help="JSON with core/optional five-status count objects")
    parser.add_argument("--evidence-json", type=Path, help="Optional template-style evidence record or flat list of records")
    args = parser.parse_args(argv)
    try:
        root = Document(read_text(args.html)).root
        check_passive(root)
        counts, outcomes = check_counts(root)
        matrix_parity, accepted = check_matrix(root, outcomes)
        if args.expected_summary:
            check_summary(read_json(args.expected_summary), counts)
        evidence_parity = check_evidence(read_json(args.evidence_json), outcomes) if args.evidence_json else "not checked; no evidence JSON supplied"
        result = {"counts": counts, "matrix_parity": matrix_parity, "owner_accepted_markers": accepted, "summary_parity": "matched" if args.expected_summary else "not checked; no expected summary supplied",
                  "evidence_parity": evidence_parity, "passive_html": "matched bundled structural constraints",
                  "visual_qa": "not performed", "network_qa": "structural only; runtime not observed"}
    except ReportError as error:
        print(f"Report QA failed: {error} No content echoed.", file=sys.stderr)
        return 1
    except json.JSONDecodeError:
        print("Report QA failed: a JSON input is not valid JSON. No content echoed.", file=sys.stderr)
        return 1
    except UnicodeError:
        print("Report QA failed: inputs must be UTF-8 text. No content echoed.", file=sys.stderr)
        return 1
    except OSError as error:
        print(f"Report QA failed: {describe_os_error('input file', error)} No content echoed.", file=sys.stderr)
        return 1
    except (ValueError, RecursionError):
        print("Report QA failed: invalid HTML, counts, JSON or bundled assets. Review locally; no content echoed.", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
