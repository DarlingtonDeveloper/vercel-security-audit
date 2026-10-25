#!/usr/bin/env python3
"""Optional, offline versioned report model. Metadata must be pre-sanitised.

Standard library only; no collection, secret scanning, network or remediation.
Readable Markdown remains the mandatory, portable deliverable.
"""
import argparse
import copy
from datetime import datetime
import json
import os
from pathlib import Path
import re
import sys
import tempfile

# Importing the renderer must not create or replace cache files in the skill.
sys.dont_write_bytecode = True
from render_report import MAX_BYTES, STATUSES, render_report

CORE_IDS = tuple(f"{domain}-{index:02}" for domain in
                 ("IAM", "CRE", "DEP", "FWB", "SRC", "SEC", "DOM", "OPS")
                 for index in (1, 2, 3))
OPTIONAL_IDS = ("DEP-04", "SRC-04", "SEC-04", "OPS-04")
CHECK_IDS = CORE_IDS + OPTIONAL_IDS
SOURCE_KINDS = ("plugin", "cli", "browser", "owner_statement", "source_review", "documentation")
CHECK_TEXT = ("statement", "requirement", "rationale", "missing_evidence")
SCOPE_TEXT = ("included", "excluded", "authorization", "sources_used", "limitations",
              "source_application_review", "documentation_verification")
SUMMARY_TEXT = ("reviewed_at", "method", "overall_takeaway")
FOLLOW_UP_TEXT = ("owner_decisions", "deferred_checks", "suggested_recheck")
RECOMMENDATION_TEXT = ("title", "evidence_and_rationale", "benefit", "responsible_role",
                       "where_to_start", "done_when", "impact", "docs")
ID_PATTERN = r"[A-Za-z][A-Za-z0-9_-]{0,63}"
CHECK_TITLES = dict(zip(CHECK_IDS, (
    "Team membership and roles", "Sign-in policy coverage", "Invitations and access review",
    "Credential scope and expiry metadata", "Integration permissions and purpose", "Integration lifecycle accountability",
    "Deployment protection scope", "Preview collaboration and sharing", "Deployment inventory and retention intent",
    "Firewall policy intent and scope", "Bot control posture", "Exceptions and rule review",
    "Repository connection and authority", "Production deployment governance", "Contribution and build trust boundaries",
    "Environment variable targeting", "Secret lifecycle responsibility", "Log access, export, and retention",
    "Domain association and intended ownership", "Certificate and transport status", "Domain lifecycle and configuration warnings",
    "Incident notifications, ownership and escalation", "Change traceability and review", "Recovery and configuration follow-up",
    "Application authentication boundaries", "Repository governance evidence",
    "Secret handling and log redaction design", "Application recovery design",
)))


class ModelError(ValueError):
    """Value-free diagnostics: never echo source keys, paths or evidence."""


def _require(condition, message):
    if not condition:
        raise ModelError(message)


def _object(value, required, optional=()):
    _require(type(value) is dict and set(required) <= value.keys()
             and value.keys() <= set(required) | set(optional), "Invalid object fields.")


def _text(value, limit=8000):
    _require(type(value) is str and bool(value.strip()) and len(value) <= limit
             and not any(ord(c) < 32 or 127 <= ord(c) <= 159 or c in "\u2028\u2029"
                         for c in value), "Expected bounded, nonempty single-line text.")


def _identifier(value):
    _text(value, 64)
    _require(re.fullmatch(ID_PATTERN, value) is not None, "Invalid metadata identifier.")


def _texts(value, minimum=0, maximum=100):
    _require(type(value) is list and minimum <= len(value) <= maximum, "Invalid text list.")
    for item in value:
        _text(item)


def _integer(value):
    _require(type(value) is int and value >= 1, "Expected a positive integer.")


def _utc(value):
    _text(value, 32)
    _require(re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z",
                          value) is not None, "Expected a UTC timestamp ending in Z.")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ModelError("Invalid UTC calendar time.") from None


def json_bytes(value):
    """Deterministic, bounded JSON serialization (also bounds the Python API)."""
    try:
        data = (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode("utf-8")
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise ModelError("Invalid JSON value.") from None
    _require(len(data) <= MAX_BYTES, "JSON exceeds 2 MB.")
    return data


def validate_report(report):
    """Validate schema v1 without altering any input or inferring a status."""
    json_bytes(report)
    _object(report, ("schema_version", "revision", "scope_alias", "title", "scope",
                     "review_summary", "recommendations", "follow_up", "checks"))
    _integer(report["schema_version"])
    _require(report["schema_version"] == 1, "Unsupported schema version.")
    _integer(report["revision"])
    _identifier(report["scope_alias"])
    _text(report["title"], 240)
    scope = report["scope"]
    _object(scope, SCOPE_TEXT + ("optional_authorized",))
    for key in SCOPE_TEXT:
        _text(scope[key])
    _require(type(scope["optional_authorized"]) is bool, "Expected explicit optional authorization.")
    summary = report["review_summary"]
    _object(summary, SUMMARY_TEXT + ("confirmed_strengths", "initial_priorities"))
    for key in SUMMARY_TEXT:
        _text(summary[key])
    _texts(summary["confirmed_strengths"])
    _texts(summary["initial_priorities"], maximum=3)
    _object(report["follow_up"], FOLLOW_UP_TEXT)
    for key in FOLLOW_UP_TEXT:
        _text(report["follow_up"][key])
    checks = report["checks"]
    _require(type(checks) is list and len(checks) == 28, "Require exactly 24 core and 4 optional checks.")
    check_ids, evidence_ids = set(), set()
    for check in checks:
        _object(check, ("id", "status", "evidence_log") + CHECK_TEXT)
        _text(check["id"], 6)
        _require(check["id"] in CHECK_IDS and check["id"] not in check_ids, "Unknown or duplicate check ID.")
        check_ids.add(check["id"])
        _text(check["status"], 32)
        _require(check["status"] in STATUSES, "Invalid check status.")
        for key in CHECK_TEXT:
            _text(check[key])
        log = check["evidence_log"]
        _require(type(log) is list, "Expected an evidence log.")
        _require(check["status"] == "not_reviewed" or bool(log), "Assessed checks need evidence.")
        if check["id"] in OPTIONAL_IDS and not scope["optional_authorized"]:
            _require(check["status"] == "not_reviewed" and not log,
                     "Optional source/application review requires explicit authorization.")
        previous_time = None
        for entry in log:
            _object(entry, ("id", "observed_at", "source_kind", "source_description",
                            "scope_alias", "observed", "limitation"))
            _identifier(entry["id"])
            _require(entry["id"] not in evidence_ids, "Duplicate evidence ID.")
            evidence_ids.add(entry["id"])
            observed_time = _utc(entry["observed_at"])
            _require(previous_time is None or observed_time >= previous_time,
                     "Evidence log must be chronological.")
            previous_time = observed_time
            _text(entry["source_kind"], 32)
            _require(entry["source_kind"] in SOURCE_KINDS, "Invalid evidence source kind.")
            _identifier(entry["scope_alias"])
            for key in ("source_description", "observed", "limitation"):
                _text(entry[key])
    recommendations = report["recommendations"]
    _require(type(recommendations) is list and len(recommendations) <= 100, "Invalid recommendations.")
    for recommendation in recommendations:
        _object(recommendation, RECOMMENDATION_TEXT + ("check_ids", "prerequisites", "steps"))
        for key in RECOMMENDATION_TEXT:
            _text(recommendation[key])
        ids = recommendation["check_ids"]
        _texts(ids, minimum=1, maximum=28)
        _require(len(ids) == len(set(ids)) and set(ids) <= set(CHECK_IDS), "Invalid related check IDs.")
        _texts(recommendation["prerequisites"], minimum=1)
        _texts(recommendation["steps"], minimum=1)


def new_report(scope_alias, title):
    """Start an unreviewed draft; creation is not evidence collection or consent."""
    report = {
        "schema_version": 1, "revision": 1, "scope_alias": scope_alias, "title": title,
        "scope": {key: "Not reviewed; owner confirmation required." for key in SCOPE_TEXT},
        "review_summary": {key: "Not reviewed." for key in SUMMARY_TEXT},
        "recommendations": [],
        "follow_up": {key: "Owner confirmation required." for key in FOLLOW_UP_TEXT},
        "checks": [{"id": check_id, "status": "not_reviewed", "statement": "Not inspected.",
                    "requirement": "Intent not confirmed.", "rationale": "Collection not performed.",
                    "missing_evidence": "Confirm authorization and collection capability.", "evidence_log": []}
                   for check_id in CHECK_IDS],
    }
    report["scope"]["optional_authorized"] = False
    report["scope"]["source_application_review"] = "Not authorized; not reviewed."
    report["review_summary"].update(confirmed_strengths=[], initial_priorities=[])
    validate_report(report)
    return report


def append_evidence(report, patch):
    """Return a new revision; old evidence and all unpatched fields are immutable.

    Status is always supplied by the reviewer, never inferred from observations.
    Contradictions need human resolution; this is not a semantic evidence judge.
    """
    validate_report(report)
    json_bytes(patch)
    _object(patch, ("expected_revision", "checks"))
    _integer(patch["expected_revision"])
    _require(patch["expected_revision"] == report["revision"], "Revision conflict.")
    _require(type(patch["checks"]) is list and 1 <= len(patch["checks"]) <= 28,
             "Require a nonempty check patch.")
    updated = copy.deepcopy(report)
    by_id = {check["id"]: check for check in updated["checks"]}
    supplied = set()
    for change in patch["checks"]:
        _object(change, ("id", "status", "statement", "rationale", "evidence_log"),
                ("requirement", "missing_evidence"))
        _text(change["id"], 6)
        _require(change["id"] in by_id and change["id"] not in supplied,
                 "Unknown or duplicate patched check ID.")
        supplied.add(change["id"])
        _require(type(change["evidence_log"]) is list and bool(change["evidence_log"]),
                 "Each patch must append new evidence.")
        check = by_id[change["id"]]
        for key in ("status",) + CHECK_TEXT:
            if key in change:
                check[key] = copy.deepcopy(change[key])
        check["evidence_log"].extend(copy.deepcopy(change["evidence_log"]))
    updated["revision"] += 1
    validate_report(updated)
    return updated


def build_summary(report):
    """Issue #10 interchange shape; counts are derived, never owner-authored."""
    validate_report(report)
    summary = {group: {status: 0 for status in STATUSES} for group in ("core", "optional")}
    for check in report["checks"]:
        group = "core" if check["id"] in CORE_IDS else "optional"
        summary[group][check["status"]] += 1
    return summary


def build_markdown(report):
    """Build readable guided Markdown; author text is never a template or code."""
    counts = build_summary(report)
    summary, scope = report["review_summary"], report["scope"]
    checks = {check["id"]: check for check in report["checks"]}
    lines = ["# " + report["title"], "",
             "Community-maintained and unofficial. Not endorsed by Vercel. Local draft; review before sharing.", "",
             "## Review summary", "",
             f"- Revision: {report['revision']}", f"- Scope alias: {report['scope_alias']}",
             "- Reviewed at: " + summary["reviewed_at"], "- Method: " + summary["method"],
             "- Overall takeaway: " + summary["overall_takeaway"]]
    for group, total in (("core", 24), ("optional", 4)):
        lines.append(f"- {group.capitalize()} coverage ({total}): " + "; ".join(
            f"{status}: {count}" for status, count in counts[group].items()))
    lines += ["- Changes made: none. Recommendations are proposed actions, not work performed.", "",
              "This point-in-time configuration review is not penetration testing, certification, compliance assessment, "
              "or ongoing monitoring. A satisfactory setting does not establish application security.", "",
              "## Initial priorities", ""]
    lines += [f"{index}. {text}" for index, text in enumerate(summary["initial_priorities"], 1)] or ["No initial priorities recorded."]
    lines += ["", "## Confirmed strengths", ""]
    lines += ["- " + text for text in summary["confirmed_strengths"]] or ["No confirmed strengths recorded."]
    lines += ["", "## Scope, missing evidence, and limitations", ""]
    scope_labels = ("Included", "Excluded", "Authorization", "Sources used", "Limitations",
                    "Source/application review", "Documentation verification")
    lines += [f"- {label}: {scope[key]}" for key, label in zip(SCOPE_TEXT, scope_labels)]
    lines += ["- Optional review authorized: " + ("yes" if scope["optional_authorized"] else "no"), "",
              "Unavailable fields mean unknown, not disabled. Owner statements are not observed configuration. "
              "Contradictory and stale evidence requires human resolution. Authored summary and recommendations "
              "are preserved on append and must be reviewed again against the complete history.", "",
              "## Recommendations", ""]
    if not report["recommendations"]:
        lines += ["No recommendations recorded. Review unresolved checks before sharing.", ""]
    for index, recommendation in enumerate(report["recommendations"], 1):
        lines += [f"### {index} - {recommendation['title']}", "",
                  "- Related checks / status: " + "; ".join(
                      f"{identifier}: {checks[identifier]['status']}" for identifier in recommendation["check_ids"]),
                  "- Evidence and rationale: " + recommendation["evidence_and_rationale"],
                  "- Benefit: " + recommendation["benefit"], "- Who: " + recommendation["responsible_role"]]
        lines += ["- Before changing: " + text for text in recommendation["prerequisites"]]
        lines += ["- Where to start: " + recommendation["where_to_start"], ""]
        lines += [f"{step}. {text}" for step, text in enumerate(recommendation["steps"], 1)]
        lines += ["", "- Done when: " + recommendation["done_when"],
                  "- Impact / rollback: " + recommendation["impact"], "- Docs: " + recommendation["docs"], ""]
    lines += ["## Follow-up and completion", ""]
    lines += [f"- {label}: {report['follow_up'][key]}" for key, label in zip(
        FOLLOW_UP_TEXT, ("Owner decisions needed", "Deferred checks", "Suggested recheck"))]
    for identifiers, heading in ((CORE_IDS, "Appendix: required core checks"),
                                 (OPTIONAL_IDS, "Appendix: optional checks, excluded from core coverage")):
        lines += ["", "## " + heading, ""]
        for identifier in identifiers:
            check = checks[identifier]
            lines += [f"### {identifier} - {CHECK_TITLES[identifier]}", "", "Status: " + check["status"], "",
                      "- Requirement or intent: " + check["requirement"],
                      "- Current statement: " + check["statement"], "- Rationale: " + check["rationale"],
                      "- Missing evidence / next confirmation: " + check["missing_evidence"]]
            if not check["evidence_log"]:
                lines += ["- Evidence log: no observations recorded."]
            for entry in check["evidence_log"]:
                lines += [f"- Evidence {entry['id']}; UTC: {entry['observed_at']}; Scope: {entry['scope_alias']}; "
                          f"Source: {entry['source_kind']}; Description: {entry['source_description']}",
                          "- Observed: " + entry["observed"], "- Limitation: " + entry["limitation"]]
            lines += [""]
    markdown = "\n".join(lines)
    _require(len(markdown.encode("utf-8")) <= MAX_BYTES, "Markdown exceeds 2 MB.")
    return markdown


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result, "Duplicate JSON object key.")
        result[key] = value
    return result


def _invalid_constant(value):
    raise ModelError("Non-finite JSON numbers are invalid.")


def load_json(path):
    """Bound reads before parsing; reject duplicate keys and nonstandard numbers."""
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    _require(len(data) <= MAX_BYTES, "JSON exceeds 2 MB.")
    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=_unique_object,
                          parse_constant=_invalid_constant)
    except (ValueError, UnicodeError, RecursionError):
        raise ModelError("Invalid JSON input.") from None


def publish_new(path, data):
    """Stage private bytes, then atomically link to a fresh path, never replace.

    One output per invocation avoids multi-file partial publication. Same-path
    writers race on link(2): exactly one wins. Distinct paths may branch a revision.
    Requires a trusted private output directory and same-filesystem hard links.
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


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "Invalid report command. Use --help for usage.\n")


def main(argv=None):
    parser = _Parser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    initialize = commands.add_parser("init", help="Create an unreviewed version-1 draft")
    initialize.add_argument("--scope-alias", required=True)
    initialize.add_argument("--title", required=True)
    initialize.add_argument("-o", "--output", required=True, type=Path)
    for name in ("validate", "append", "build", "export-summary"):
        command = commands.add_parser(name)
        command.add_argument("source", type=Path, help="Pre-sanitised report JSON")
        if name != "validate":
            command.add_argument("-o", "--output", required=True, type=Path,
                                 help="Fresh private output file; existing paths are refused")
        if name == "append":
            command.add_argument("--patch", required=True, type=Path,
                                 help="Metadata patch with expected_revision and checks")
        if name == "build":
            command.add_argument("--format", choices=("markdown", "html"), default="markdown")
            command.add_argument("--lang", default="en", help="HTML language tag; shell labels remain English")
    args = parser.parse_args(argv)
    try:
        if args.command == "init":
            data = json_bytes(new_report(args.scope_alias, args.title))
        else:
            report = load_json(args.source)
            validate_report(report)
            if args.command == "validate":
                print("Report model is valid. Evidence truth and sanitisation still require human review.")
                return 0
            if args.command == "append":
                data = json_bytes(append_evidence(report, load_json(args.patch)))
            elif args.command == "export-summary":
                data = json_bytes(build_summary(report))
            else:
                markdown = build_markdown(report)
                data = (render_report(markdown, args.lang) if args.format == "html" else markdown).encode("utf-8")
        publish_new(args.output, data)
    except (OSError, ValueError, UnicodeError, RecursionError):
        print("Could not manage report. Check the pre-sanitised schema, revision, bundled assets "
              "and fresh output path. Inputs and existing files were not modified.", file=sys.stderr)
        return 1
    print("New private report artifact created. Review before sharing; Markdown remains required.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
