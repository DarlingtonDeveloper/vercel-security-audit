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

# Importing the renderer must not create or replace cache files in the skill.
sys.dont_write_bytecode = True
# Resolve the sibling renderer from this file, not sys.path[0], so the helper
# also works under python -I (which does not add the script directory).
sys.path.insert(0, str(Path(__file__).resolve().parent))
# publish_new is shared with the renderer: one output per invocation avoids
# multi-file partial publication; distinct paths may branch a revision.
from render_report import (MAX_BYTES, STATUSES, ReportError, describe_os_error,
                           publish_new, render_report)

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
OUTCOMES = ("not_collected", "complete", "partial", "failed", "timed_out")
FAILURE_KINDS = ("none", "permission", "unavailable", "timeout", "limit", "other", "unknown")
WINDOW_FIELDS = ("requested_start", "requested_end", "covered_start", "covered_end", "retention_boundary")
QUESTIONNAIRE = {
    "CRE-01": ("Owner token metadata", "Using only your own current metadata in the agreed scope, what is your scoped token count, "
               "and what scope and expiry metadata is visible? Give redacted aggregate counts and expiry coverage only, or say unavailable. "
               "If expiry is not_applicable, state a verified reason, such as a verified zero-token inventory. "
               "Do not supply token values, token strings, sensitive token names or credential screenshots. "
               "Metadata dates alone do not prove rotation or actual use."),
    "IAM-02": ("Owner MFA policy and recovery", "Does your own MFA posture meet the agreed policy, and is recoverability arranged "
               "within that policy? Record the agreed requirement or mark it unresolved. Confirm compliance, recoverability and unresolved "
               "exceptions at a non-secret level only. Do not provide passwords, recovery codes, authentication method secrets, "
               "device identifiers or setup details. Your statement does not establish team-wide enrolment or enforcement."),
    "OPS-01": ("Owner incident delivery responsibility", "Can you confirm incident delivery ownership and escalation responsibility "
               "for this scope? Identify responsible roles and non-sensitive subscription arrangements, not endpoints, webhook URLs, "
               "email addresses, names or recipient identifiers. Distinguish configured subscription metadata from delivery readiness "
               "statements. Actual delivery remains unverified unless separately verified through an approved procedure. "
               "This questionnaire does not authorize a delivery test."),
}
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


class ModelError(ReportError):
    """Value-free diagnostics: never echo source keys, paths or evidence.

    Messages are literal strings, so main() can print them to tell failures apart.
    """


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


def _enum(value, choices):
    _text(value, 64)
    _require(value in choices, "Invalid metadata state.")


def _ids(values, choices=None, minimum=0):
    _require(type(values) is list and minimum <= len(values) <= 1000, "Invalid identifier list.")
    for value in values:
        _identifier(value)
    _require(len(values) == len(set(values)), "Duplicate metadata identifier.")
    if choices is not None:
        _require(set(values) <= set(choices), "Unknown metadata identifier.")


def _record_id(record, seen):
    _identifier(record["id"])
    _require(record["id"] not in seen, "Duplicate record ID.")
    seen.add(record["id"])


def _validate_consent(ledger):
    _require(type(ledger) is list and len(ledger) == 4, "Require four per-ID optional consent records.")
    decisions = {}
    for entry in ledger:
        _object(entry, ("check_id", "decision", "materials", "exclusions", "source_kind", "owner_alias",
                        "provenance", "statement_at", "approved_at"))
        _enum(entry["check_id"], OPTIONAL_IDS)
        _require(entry["check_id"] not in decisions, "Duplicate consent check ID.")
        decisions[entry["check_id"]] = entry
        _enum(entry["decision"], ("not_requested", "accepted", "declined", "partial"))
        _enum(entry["source_kind"], ("owner_statement",))
        _ids(entry["exclusions"])
        materials = entry["materials"]
        _require(type(materials) is list and len(materials) <= 100, "Invalid named material list.")
        seen = set()
        for material in materials:
            _object(material, ("alias", "scope_alias", "read_boundaries"))
            _identifier(material["alias"])
            _identifier(material["scope_alias"])
            _ids(material["read_boundaries"], minimum=1)
            key = (material["alias"], material["scope_alias"])
            _require(key not in seen and material["alias"] not in entry["exclusions"], "Duplicate or excluded material.")
            seen.add(key)
        decision = entry["decision"]
        if decision == "partial":
            _require(bool(entry["exclusions"]), "Partial consent must identify excluded material.")
        if decision == "not_requested":
            _require(not materials and all(entry[key] is None for key in
                     ("owner_alias", "provenance", "statement_at", "approved_at")), "Unrequested consent grants no scope.")
            continue
        _identifier(entry["owner_alias"])
        _text(entry["provenance"])
        statement_time = _utc(entry["statement_at"])
        if decision == "declined":
            _require(not materials and entry["approved_at"] is None, "Declined consent grants no material.")
        else:
            _require(bool(materials) and _utc(entry["approved_at"]) >= statement_time,
                     "Named material requires timestamped owner approval.")
    return decisions


def _consented(decisions, check_id, record, observed_at):
    consent = decisions[check_id]
    _require(consent["decision"] in ("accepted", "partial"), "Optional read has no per-ID approval.")
    _require(_utc(observed_at) >= _utc(consent["approved_at"]), "Observation precedes optional approval.")
    _identifier(record.get("material_alias"))
    _identifier(record.get("read_boundary"))
    _require(any(material["alias"] == record["material_alias"]
                 and material["scope_alias"] == record["scope_alias"]
                 and record["read_boundary"] in material["read_boundaries"]
                 for material in consent["materials"]), "Observation exceeds approved named material boundaries.")


def _window(value):
    _object(value, WINDOW_FIELDS)
    times = {key: None if value[key] is None else _utc(value[key]) for key in WINDOW_FIELDS}
    for start, end in (("requested_start", "requested_end"), ("covered_start", "covered_end")):
        _require((times[start] is None) == (times[end] is None), "Window endpoints must both be known or unknown.")
        _require(times[start] is None or times[start] <= times[end], "Window ends before its start.")
    if times["requested_start"] is not None and times["covered_start"] is not None:
        _require(times["requested_start"] <= times["covered_start"] <= times["covered_end"] <= times["requested_end"],
                 "Covered window exceeds requested window.")


def _outcome(record):
    _enum(record["outcome"], OUTCOMES)
    _enum(record["failure_kind"], FAILURE_KINDS)
    if record["outcome"] == "timed_out":
        _require(record["failure_kind"] == "timeout", "Timed-out outcome needs timeout metadata.")
    elif record["outcome"] == "failed":
        _require(record["failure_kind"] != "none", "Failed outcome needs a sanitised failure kind.")
    elif record["outcome"] in ("complete", "not_collected"):
        _require(record["failure_kind"] == "none", "Outcome conflicts with failure metadata.")


def _validate_coverage(records, decisions, seen):
    _require(type(records) is list and len(records) <= 1000, "Invalid coverage record list.")
    previous = {}
    for record in records:
        _object(record, ("id", "feed_id", "usage", "check_ids", "source_kind", "source_description", "scope_alias",
                         "material_alias", "read_boundary", "observed_at", "window", "reported_total", "count_basis",
                         "received", "inspected", "page_cap", "overall_cap", "next_available", "exhausted", "truncated",
                         "outcome", "failure_kind", "missing_sources", "assessment_effect", "retries"))
        _record_id(record, seen)
        _identifier(record["feed_id"])
        _identifier(record["scope_alias"])
        _ids(record["check_ids"], CHECK_IDS, minimum=1)
        _enum(record["usage"], ("planned", "used"))
        _enum(record["source_kind"], SOURCE_KINDS)
        for key in ("source_description", "count_basis", "missing_sources", "assessment_effect"):
            _text(record[key])
        observed_time = _utc(record["observed_at"])
        key = (record["feed_id"], record["scope_alias"])
        _require(key not in previous or observed_time >= previous[key], "Coverage records must be chronological per feed/scope.")
        previous[key] = observed_time
        _window(record["window"])
        for key in ("reported_total", "received", "inspected", "page_cap", "overall_cap"):
            count = record[key]
            _require(count is None or type(count) is int and count >= 0, "Counts must be nonnegative integers or unknown.")
        if record["received"] is not None and record["inspected"] is not None:
            _require(record["inspected"] <= record["received"], "Inspected count exceeds received count.")
        for key in ("next_available", "exhausted", "truncated"):
            _require(record[key] is None or type(record[key]) is bool, "Coverage state must be true, false or unknown.")
        for key in ("material_alias", "read_boundary"):
            if record[key] is not None:
                _identifier(record[key])
        _outcome(record)
        if record["usage"] == "planned":
            _require(record["outcome"] == "not_collected", "Planned feeds cannot claim collection.")
        if record["outcome"] == "not_collected":
            _require(record["received"] is None and record["inspected"] is None
                     and record["window"]["covered_start"] is None
                     and all(record[key] is None for key in ("next_available", "exhausted", "truncated")),
                     "Uncollected coverage must remain unknown.")
        if record["outcome"] == "complete":
            _require(record["exhausted"] is True and record["next_available"] is False and record["truncated"] is False
                     and record["received"] is not None, "Complete collection requires verified end and counts.")
        for check_id in record["check_ids"]:
            if check_id in OPTIONAL_IDS and record["outcome"] != "not_collected":
                _consented(decisions, check_id, record, record["observed_at"])
        retries = record["retries"]
        _require(type(retries) is list and len(retries) <= 100, "Invalid retry record list.")
        _require(record["outcome"] != "not_collected" or not retries, "Uncollected feeds cannot contain retry attempts.")
        last_retry = None
        for attempt in retries:
            _object(attempt, ("id", "attempted_at", "window", "outcome", "failure_kind", "remaining_gaps"))
            _record_id(attempt, seen)
            attempted_time = _utc(attempt["attempted_at"])
            _require((last_retry is None or attempted_time >= last_retry) and attempted_time <= observed_time,
                     "Retry times must be chronological and no later than the coverage record.")
            last_retry = attempted_time
            _window(attempt["window"])
            _outcome(attempt)
            for check_id in record["check_ids"]:
                if check_id in OPTIONAL_IDS and attempt["outcome"] != "not_collected":
                    _consented(decisions, check_id, record, attempt["attempted_at"])
            _text(attempt["remaining_gaps"])


def _validate_owners(records, evidence_by_id, seen):
    _require(type(records) is list and len(records) <= 1000, "Invalid owner confirmation list.")
    previous = {}
    for record in records:
        _object(record, ("id", "check_id", "scope_alias", "owner_alias", "source_kind", "statement_at",
                         "metadata_observed_at", "evidence_refs", "answer"))
        _record_id(record, seen)
        _enum(record["check_id"], QUESTIONNAIRE)
        _identifier(record["scope_alias"])
        _identifier(record["owner_alias"])
        _enum(record["source_kind"], ("owner_statement",))
        statement_time = _utc(record["statement_at"])
        key = (record["check_id"], record["scope_alias"], record["owner_alias"])
        _require(key not in previous or statement_time >= previous[key], "Owner statements must be chronological.")
        previous[key] = statement_time
        if record["metadata_observed_at"] is not None:
            _require(_utc(record["metadata_observed_at"]) <= statement_time, "Metadata observation postdates its statement.")
        _ids(record["evidence_refs"], evidence_by_id)
        for reference in record["evidence_refs"]:
            check_id, entry = evidence_by_id[reference]
            _require(check_id == record["check_id"] and entry["scope_alias"] == record["scope_alias"]
                     and entry["source_kind"] != "owner_statement", "Owner evidence reference must match separately observed scope/check.")
        _text(record["answer"])


def validate_report(report):
    """Validate schema v1 without altering any input or inferring a status."""
    json_bytes(report)
    _object(report, ("schema_version", "revision", "scope_alias", "title", "scope",
                     "review_summary", "recommendations", "follow_up", "checks", "coverage_limits", "owner_confirmations"))
    _integer(report["schema_version"])
    _require(report["schema_version"] == 1, "Unsupported schema version.")
    _integer(report["revision"])
    _identifier(report["scope_alias"])
    _text(report["title"], 240)
    scope = report["scope"]
    _object(scope, SCOPE_TEXT + ("optional_consent",))
    for key in SCOPE_TEXT:
        _text(scope[key])
    decisions = _validate_consent(scope["optional_consent"])
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
    check_ids, evidence_ids, evidence_by_id = set(), set(), {}
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
        if check["id"] in OPTIONAL_IDS and decisions[check["id"]]["decision"] in ("not_requested", "declined"):
            _require(check["status"] == "not_reviewed" and not log,
                     "Unapproved optional checks must be unreviewed without evidence history.")
        previous_time = None
        for entry in log:
            _object(entry, ("id", "observed_at", "source_kind", "source_description",
                            "scope_alias", "observed", "limitation"), ("material_alias", "read_boundary"))
            _record_id(entry, evidence_ids)
            evidence_by_id[entry["id"]] = (check["id"], entry)
            for key in ("material_alias", "read_boundary"):
                if key in entry:
                    _identifier(entry[key])
            if check["id"] in OPTIONAL_IDS:
                _consented(decisions, check["id"], entry, entry["observed_at"])
            observed_time = _utc(entry["observed_at"])
            _require(previous_time is None or observed_time >= previous_time,
                     "Evidence log must be chronological.")
            previous_time = observed_time
            _text(entry["source_kind"], 32)
            _require(entry["source_kind"] in SOURCE_KINDS, "Invalid evidence source kind.")
            _identifier(entry["scope_alias"])
            for key in ("source_description", "observed", "limitation"):
                _text(entry[key])
    _validate_coverage(report["coverage_limits"], decisions, evidence_ids)
    _validate_owners(report["owner_confirmations"], evidence_by_id, evidence_ids)
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
        "recommendations": [], "coverage_limits": [], "owner_confirmations": [],
        "follow_up": {key: "Owner confirmation required." for key in FOLLOW_UP_TEXT},
        "checks": [{"id": check_id, "status": "not_reviewed", "statement": "Not inspected.",
                    "requirement": "Intent not confirmed.", "rationale": "Collection not performed.",
                    "missing_evidence": "Confirm authorization and collection capability.", "evidence_log": []}
                   for check_id in CHECK_IDS],
    }
    report["scope"]["optional_consent"] = [
        {"check_id": check_id, "decision": "not_requested", "materials": [], "exclusions": [],
         "source_kind": "owner_statement", "owner_alias": None, "provenance": None, "statement_at": None, "approved_at": None}
        for check_id in OPTIONAL_IDS]
    report["scope"]["source_application_review"] = "Not authorized; not reviewed."
    report["scope"]["limitations"] = "No collection recorded; coverage is unknown. No feeds recorded does not establish completeness."
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
    _object(patch, ("expected_revision",), ("checks", "coverage_limits", "owner_confirmations"))
    _integer(patch["expected_revision"])
    _require(patch["expected_revision"] == report["revision"], "Revision conflict.")
    changes = patch.get("checks", [])
    _require(type(changes) is list and len(changes) <= 28, "Invalid check patch list.")
    mutated = bool(changes)
    updated = copy.deepcopy(report)
    for key in ("coverage_limits", "owner_confirmations"):
        if key in patch:
            _require(type(patch[key]) is list, "Metadata patch must be a list of new records.")
            mutated = mutated or bool(patch[key])
            updated[key].extend(copy.deepcopy(patch[key]))
    _require(mutated, "Empty patches do not create revisions.")
    by_id = {check["id"]: check for check in updated["checks"]}
    supplied = set()
    for change in changes:
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


def _known(value):
    if value is None:
        return "unknown"
    if type(value) is bool:
        return "yes" if value else "no"
    return str(value)


def _window_text(value):
    return "; ".join(key.replace("_", " ") + ": " + _known(value[key]) for key in WINDOW_FIELDS)


def _consent_lines(report, checks):
    lines = ["### Optional scope decisions", "",
             "Consent is per check and named material; no global approval is inferred. "
             "Unapproved checks remain not_reviewed. Partial approval excludes the unreviewed remainder.", ""]
    ledger = {entry["check_id"]: entry for entry in report["scope"]["optional_consent"]}
    for check_id in OPTIONAL_IDS:
        consent = ledger[check_id]
        lines += [f"#### {check_id} - {CHECK_TITLES[check_id]}", "",
                  "- Decision: " + consent["decision"], "- Current check status: " + checks[check_id]["status"],
                  f"- Consent source: {consent['source_kind']}; Role alias: {_known(consent['owner_alias'])}; "
                  f"Provenance: {_known(consent['provenance'])}",
                  f"- Statement UTC: {_known(consent['statement_at'])}; Approval UTC: {_known(consent['approved_at'])}",
                  "- Exclusions: " + (", ".join(consent["exclusions"]) or "none recorded; not permission to read more material.")]
        if not consent["materials"]:
            lines += ["- Named materials and read boundaries: none approved."]
        for material in consent["materials"]:
            lines += [f"- Named material: {material['alias']}; Scope: {material['scope_alias']}; "
                      "Approved read boundaries: " + ", ".join(material["read_boundaries"])]
        lines += [""]
    return lines


def _coverage_lines(records):
    lines = ["## Coverage limits", ""]
    if not records:
        return lines + ["No collection recorded; coverage is unknown. No planned or used feeds recorded "
                        "does not establish complete coverage or absence of resources.", ""]
    for record in records:
        lines += [f"### {record['feed_id']} - {record['id']}", "",
                  f"- Source/feed: {record['source_description']}; Source kind: {record['source_kind']}; "
                  f"Scope: {record['scope_alias']}; Observed UTC: {record['observed_at']}; "
                  f"Checks: {', '.join(record['check_ids'])}; Usage: {record['usage']}; Outcome: {record['outcome']}; "
                  f"Material: {_known(record['material_alias'])}; Read boundary: {_known(record['read_boundary'])}",
                  "- Window: " + _window_text(record["window"]),
                  f"- Reported total: {_known(record['reported_total'])}; Count basis: {record['count_basis']}",
                  "- Received: " + _known(record["received"]), "- Inspected: " + _known(record["inspected"]),
                  f"- Page/finding cap: page {_known(record['page_cap'])}; overall {_known(record['overall_cap'])}",
                  "- Truncation: " + _known(record["truncated"]),
                  "- Cursor availability: " + {None: "unknown", True: "available", False: "unavailable"}[record["next_available"]],
                  "- End known: " + _known(record["exhausted"]),
                  "- Missing sources: " + record["missing_sources"], "- Timeouts/failures: " + record["failure_kind"],
                  "- Retries and outcomes: " + ("recorded below" if record["retries"] else "not attempted; no retry outcome recorded.")]
        for attempt in record["retries"]:
            lines += [f"- Retry {attempt['id']}; Attempt UTC: {attempt['attempted_at']}; "
                      f"Window: {_window_text(attempt['window'])}; Outcome: {attempt['outcome']}; "
                      f"Failure kind: {attempt['failure_kind']}; Remaining gaps: {attempt['remaining_gaps']}"]
        lines += ["- Assessment effect: " + record["assessment_effect"], ""]
    return lines + ["Collection completeness does not prove individual inspection. A count, missing cursor, "
                    "or successful bounded retry alone does not establish the absence of events or resources.", ""]


def _questionnaire_lines(records):
    lines = ["", "### Owner confirmation questionnaire", "",
             "Owner replies are self-statements, not observed configuration. Source: owner_statement. "
             "No automatic contact, DMs, email, bot requests or notification tests. Communication requires separate approval "
             "of exact content and destination. Reuse provided answers without re-asking resolved questions. "
             "Use only each responding Owner's own metadata in the approved scope; do not broaden access, "
             "inspect another Owner's credentials or request elevated credentials.", ""]
    for check_id, (title, question) in QUESTIONNAIRE.items():
        lines += [f"#### {check_id} - {title}", "", question, ""]
        answers = [record for record in records if record["check_id"] == check_id]
        if not answers:
            lines += ["- Answer state: not answered; statement time and metadata observation time are unknown."]
        for record in answers:
            lines += [f"- Answer record: {record['id']}; Scope alias: {record['scope_alias']}; Role alias: {record['owner_alias']}; "
                      f"Source: {record['source_kind']}; Statement UTC: {record['statement_at']}",
                      "- Metadata observed at: " + _known(record["metadata_observed_at"]),
                      "- Separately observed evidence: " + (", ".join(record["evidence_refs"]) or "none supplied"),
                      "- Answer: " + record["answer"]]
        lines += [""]
    return lines


def _matrix_lines(report, checks):
    """One status column: schema version 1 holds one status per check for the scope."""
    lines = ["## Status at a glance", "",
             "Each check's recorded status for the whole authorised scope. Schema version 1 stores one status "
             "per check, so there are no per-project columns; the appendix holds the evidence and is the counted outcome.", ""]
    for identifiers, label in ((CORE_IDS, "Check"), (OPTIONAL_IDS, "Optional check")):
        if identifiers is OPTIONAL_IDS:
            lines += ["Optional checks, kept separate from the 24 core checks:", ""]
        lines += [f"| {label} | {report['scope_alias']} |", "| --- | --- |"]
        lines += [f"| {identifier} {CHECK_TITLES[identifier]} | {checks[identifier]['status']} |"
                  for identifier in identifiers]
        lines += [""]
    return lines


def build_markdown(report):
    """Build readable guided Markdown; author text is never a template or code."""
    counts = build_summary(report)
    summary, scope = report["review_summary"], report["scope"]
    checks = {check["id"]: check for check in report["checks"]}
    lines = ["# " + report["title"], "",
             "Community-maintained and unofficial. Not endorsed by Vercel. Local draft; review before sharing.", ""]
    lines += _matrix_lines(report, checks)
    lines += ["## Review summary", "",
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
    lines += ["", "Unavailable fields mean unknown, not disabled. Owner statements are not observed configuration. "
              "Contradictory and stale evidence requires human resolution. Authored summary and recommendations "
              "are preserved on append and must be reviewed again against the complete history.", ""]
    lines += _consent_lines(report, checks)
    lines += _coverage_lines(report["coverage_limits"])
    lines += ["## Recommendations", ""]
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
    lines += _questionnaire_lines(report["owner_confirmations"])
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
                if "material_alias" in entry or "read_boundary" in entry:
                    lines += [f"- Evidence material: {_known(entry.get('material_alias'))}; "
                              f"Read boundary: {_known(entry.get('read_boundary'))}"]
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
    except ModelError:
        raise  # Keep the specific duplicate-key / non-finite diagnostics.
    except (ValueError, UnicodeError, RecursionError):
        raise ModelError("Invalid JSON input.") from None


UNCHANGED = "Inputs and existing files were not modified."


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
                                 help="Metadata patch with expected_revision and new checks, coverage or Owner records")
        if name == "build":
            command.add_argument("--format", choices=("markdown", "html"), default="markdown")
            command.add_argument("--lang", default="en", help="HTML language tag; shell labels remain English")
    args = parser.parse_args(argv)
    role = "source file"
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
                role = "patch file"
                data = json_bytes(append_evidence(report, load_json(args.patch)))
            elif args.command == "export-summary":
                data = json_bytes(build_summary(report))
            else:
                markdown = build_markdown(report)
                role = "bundled assets"
                data = (render_report(markdown, args.lang) if args.format == "html" else markdown).encode("utf-8")
        role = "output path"
        publish_new(args.output, data)
    except ReportError as error:
        print(f"Could not manage report: {error} {UNCHANGED}", file=sys.stderr)
        return 1
    except OSError as error:
        print(f"Could not manage report: {describe_os_error(role, error)} "
              f"Output paths must be new. {UNCHANGED}", file=sys.stderr)
        return 1
    except (ValueError, UnicodeError, RecursionError):
        print("Could not manage report. Check the pre-sanitised schema, revision, bundled assets "
              f"and fresh output path. {UNCHANGED}", file=sys.stderr)
        return 1
    print("New private report artifact created. Review before sharing; Markdown remains required.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
