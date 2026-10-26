#!/usr/bin/env python3
"""Run one documented, read-only Vercel CLI command and print only allow-listed fields.

Standard library only. The command runs as an argument list (no shell), always
with --json and --non-interactive, and its raw output never leaves this process:
only the bundled selector's fields are printed. CLI stderr is never echoed;
failures are classified into fixed, value-free kinds. This is the bundled
field-selection mechanism for CLI account reads, not a secret scanner.
"""
import argparse
import json
import re
import subprocess
import sys

MINIMUM_TESTED_VERSION = (62, 7, 0)
TIMEOUT_SECONDS = 90
MAX_OUTPUT_BYTES = 8_000_000
# Agreed identifiers only: no leading dash, so they can never become CLI flags.
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}")
SINCE = re.compile(r"[1-9][0-9]{0,3}[mhd]")
CHECK_KEY = re.compile(r"[a-z0-9][a-z0-9-]{0,79}")
ENUM = re.compile(r"[a-z][a-z0-9_.:-]{0,39}")
# Sample type labels are camelCase product words; UPPER_SNAKE (env var names) never matches.
SAMPLE_TYPE = re.compile(r"[a-z][a-zA-Z0-9]{0,39}")
# Marketplace product names, e.g. "Neon" or "Upstash for Redis".
PRODUCT = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ._+-]{0,39}")
UNKNOWN = "unknown"


class ReaderError(Exception):
    """A fixed, value-free failure kind; never carries CLI output."""

    def __init__(self, kind):
        super().__init__(kind)
        self.kind = kind


# --- small, defensive accessors: missing or mistyped fields are unknown, never zero.

def _get(value, *path):
    for key in path:
        if not isinstance(value, dict) or key not in value:
            return UNKNOWN
        value = value[key]
    return value


def _int(value):
    return value if type(value) is int else UNKNOWN


def _bool(value):
    return value if type(value) is bool else UNKNOWN


def _enum(value):
    """Product enums only (e.g. deny, active); anything else is withheld."""
    if value is None:
        return None
    return value if isinstance(value, str) and ENUM.fullmatch(value) else UNKNOWN


def _count(value):
    return len(value) if isinstance(value, list) else UNKNOWN


def _list(value):
    return value if isinstance(value, list) else []


def _feature(value):
    return {"enabled": _bool(_get(value, "enabled")), "action": _enum(_get(value, "action"))}


# --- selectors: each returns only allow-listed fields from parsed JSON.

def select_whoami(data):
    return {"username": _get(data, "username") if isinstance(_get(data, "username"), str) else UNKNOWN}


def select_security_check(data):
    report = _get(data, "report")
    checks, withheld = {}, 0
    for key, value in (report.items() if isinstance(report, dict) else ()):
        if not CHECK_KEY.fullmatch(key):
            withheld += 1
            continue
        checks[key] = {
            "violationsCount": _int(_get(value, "violationsCount")),
            "totalCount": _int(_get(value, "totalCount")),
            "sampleType": [item for item in _list(_get(value, "sampleType")) if isinstance(item, str) and SAMPLE_TYPE.fullmatch(item)],
            # Samples name projects, deployments and environment variables: count only.
            "samplesReceived": _count(_get(value, "samples")),
        }
    return {"checks": checks, "withheldCheckKeys": withheld, "reportPresent": isinstance(report, dict)}


def select_project_ls(data):
    projects = []
    for item in _list(_get(data, "projects")):
        projects.append({
            "id": _get(item, "id") if isinstance(_get(item, "id"), str) else UNKNOWN,
            "name": _get(item, "name") if isinstance(_get(item, "name"), str) else UNKNOWN,
            "deprecated": _bool(_get(item, "deprecated")),
            "nodeVersion": _get(item, "nodeVersion") if isinstance(_get(item, "nodeVersion"), str) else UNKNOWN,
            "updatedAt": _int(_get(item, "updatedAt")),
        })
    return {"projects": projects}


def select_firewall_status(data):
    flow = []
    for step in _list(_get(data, "requestFlow")):
        flow.append({
            "id": _enum(_get(step, "id")),
            "state": _enum(_get(step, "state")),
            "configurable": _bool(_get(step, "configurable")),
            "rulesets": [{"id": _enum(_get(r, "id")), "state": _enum(_get(r, "state")),
                          "unavailableReason": _enum(_get(r, "unavailable", "reason")) if isinstance(_get(r, "unavailable"), dict) else None}
                         for r in _list(_get(step, "rulesets"))],
        })
    bypasses = {kind: {"count": _int(_get(data, "bypasses", kind, "count")),
                       "state": _enum(_get(data, "bypasses", kind, "state"))} for kind in ("custom", "system")}
    return {
        "firewallEnabled": _bool(_get(data, "firewallEnabled")),
        "attackMode": {"enabled": _bool(_get(data, "attackMode", "enabled"))},
        "botProtection": _feature(_get(data, "botProtection")),
        "aiBots": _feature(_get(data, "aiBots")),
        "owasp": dict(_feature(_get(data, "owasp")), requiresUpgrade=_bool(_get(data, "owasp", "requiresUpgrade"))),
        "rules": {key: _int(_get(data, "rules", key)) for key in ("active", "inactive", "total")},
        "draftChanges": _int(_get(data, "draftChanges")),
        "ipBlocks": _int(_get(data, "ipBlocks")),
        "bypasses": bypasses,
        "requestFlow": flow,
    }


def _period(data):
    return {"start": _get(data, "period", "start") if isinstance(_get(data, "period", "start"), str) else UNKNOWN,
            "end": _get(data, "period", "end") if isinstance(_get(data, "period", "end"), str) else UNKNOWN,
            "granularityHours": _int(_get(data, "period", "granularity", "hours"))}


def select_firewall_overview(data):
    return {
        "period": _period(data),
        "attackMode": {"enabled": _bool(_get(data, "attackMode", "enabled"))},
        "attacksMitigated": _int(_get(data, "stats", "attacksMitigated")),
        "draftPresent": UNKNOWN if _get(data, "draft") == UNKNOWN else _get(data, "draft") is not None,
        "topRulesCount": _count(_get(data, "topRules")),
        "annotationsCount": _count(_get(data, "annotations")),
    }


def _managed(data):
    return [{"id": _enum(_get(item, "id")), "action": _enum(_get(item, "action"))} for item in _list(_get(data, "managed"))]


def select_firewall_rules(data):
    # Custom rule bodies can hold shared-secret header conditions and paths: counts and states only.
    rules = _get(data, "rules")
    return {
        "hasDraft": _bool(_get(data, "hasDraft")),
        "pendingChanges": _int(_get(data, "pendingChanges")),
        "customRulesCount": _count(rules),
        # Rule shape was not observed (empty list when verified): keep state only.
        "customRules": [{"active": _bool(_get(r, "active"))} for r in _list(rules)],
        "managedRulesets": _managed(data),
    }


def select_firewall_system_bypass(data):
    entries = data if isinstance(data, list) else _get(data, "bypasses")
    return {"entriesCount": _count(entries)}


def select_firewall_bot_management(data):
    return {"managedRulesets": _managed(data), "unknownBotTrafficRows": _count(_get(data, "unknownBotTraffic", "rows"))}


def select_firewall_traffic(data):
    lists = []
    for item in _list(_get(data, "topLists")):
        rows = []
        for row in _list(_get(item, "rows")):
            # Only enum-shaped keys (e.g. an action name) and numbers; IPs, paths and hosts are withheld.
            rows.append({key: (value if type(value) is int else _enum(value))
                         for key, value in (row.items() if isinstance(row, dict) else ())
                         if key in ("key", "action", "value", "count") and (type(value) is int or isinstance(value, str))})
        lists.append({"dimension": _enum(_get(item, "dimension")), "rows": rows})
    return {"period": _period(data), "topLists": lists}


def select_firewall_alerts(data):
    return {"activeCount": _count(_get(data, "active")), "resolvedCount": _count(_get(data, "resolved"))}


def select_activity(data):
    events = _list(_get(data, "events"))
    types = {}
    for event in events:
        kind = _enum(_get(event, "type"))
        types[kind if isinstance(kind, str) else UNKNOWN] = types.get(kind if isinstance(kind, str) else UNKNOWN, 0) + 1
    return {"eventsCount": _count(_get(data, "events")), "eventTypes": types}


def select_webhooks(data):
    return {"webhooksCount": _count(_get(data, "webhooks")), "status": _enum(_get(data, "status"))}


def select_integrations(data):
    return {"resources": [{"product": _get(r, "product") if isinstance(_get(r, "product"), str) and PRODUCT.fullmatch(_get(r, "product")) else UNKNOWN, "status": _enum(_get(r, "status")),
                           "projectCount": _count(_get(r, "projects"))} for r in _list(_get(data, "resources"))]}


def select_domains(data):
    """Synthetic aliases assigned here; hostnames never leave the reader."""
    domains = []
    for index, item in enumerate(_list(_get(data, "domains")), start=1):
        flags = {key: value for key, value in (item.items() if isinstance(item, dict) else ())
                 if type(value) is bool and ENUM.fullmatch(key.lower())}
        domains.append({"alias": f"domain-{index}", "flags": flags})
    return {"domainsCount": _count(_get(data, "domains")), "domains": domains}


def select_team_check(data, slug):
    """Membership of the one agreed team only; other teams are never printed or counted."""
    for team in _list(_get(data, "teams")):
        if _get(team, "slug") == slug:
            return {"member": True, "plan": _enum(_get(team, "plan")), "current": _bool(_get(team, "current"))}
    # Absent from this page is only "not a member" when the list is known to be complete.
    return {"member": False if _get(data, "pagination", "next") is None else UNKNOWN}


def team_flags(args):
    return ["--scope", args.scope]


def project_flags(args):
    return ["--scope", args.scope, "--project", args.project]


# name: (argv builder, selector, needs project, paginated)
READS = {
    "whoami": (lambda a: ["whoami"], select_whoami, False, False),
    "team-check": (lambda a: ["teams", "list"], None, False, True),
    "security-check": (lambda a: ["security", "check", *(project_flags(a) if a.project else team_flags(a))], select_security_check, False, False),
    "project-ls": (lambda a: ["project", "ls", *team_flags(a)], select_project_ls, False, True),
    "firewall-status": (lambda a: ["firewall", "status", *project_flags(a)], select_firewall_status, True, False),
    "firewall-overview": (lambda a: ["firewall", "overview", *project_flags(a)], select_firewall_overview, True, False),
    "firewall-rules": (lambda a: ["firewall", "rules", "list", *project_flags(a)], select_firewall_rules, True, False),
    "firewall-system-bypass": (lambda a: ["firewall", "system-bypass", "list", *project_flags(a)], select_firewall_system_bypass, True, False),
    "firewall-bot-management": (lambda a: ["firewall", "bot-management", *project_flags(a)], select_firewall_bot_management, True, False),
    "firewall-traffic": (lambda a: ["firewall", "traffic", "list", *project_flags(a), "--since", a.since, "--dimension", "action"], select_firewall_traffic, True, False),
    "firewall-alerts": (lambda a: ["firewall", "alerts", "list", *project_flags(a), "--since", a.since], select_firewall_alerts, True, False),
    "activity": (lambda a: ["activity", *team_flags(a), "--all", "--since", a.since, "--limit", "100"], select_activity, False, True),
    "webhooks": (lambda a: ["webhooks", "list", *team_flags(a)], select_webhooks, False, False),
    "integrations": (lambda a: ["integration", "list", *team_flags(a), "--all"], select_integrations, False, False),
    "domains": (lambda a: ["domains", "list", *team_flags(a), "--limit", "100"], select_domains, False, True),
}


def classify(stderr):
    text = stderr.lower()
    if "not a valid target directory or subcommand" in text or "unknown command" in text or "unknown subcommand" in text:
        return "unknown_command"
    if "personal account as the scope" in text:
        return "personal_scope_rejected"
    if "not logged in" in text or "vercel login" in text or "no existing credentials" in text:
        return "not_authenticated"
    if "403" in text or "forbidden" in text or "permission" in text or "not authorized" in text:
        return "permission"
    if "404" in text or "not found" in text:
        return "not_found"
    return "cli_error"


def invoke(cli, argv):
    try:
        process = subprocess.run([cli, *argv, "--json", "--non-interactive"], capture_output=True,
                                 timeout=TIMEOUT_SECONDS, check=False)
    except subprocess.TimeoutExpired:
        raise ReaderError("timeout") from None
    except OSError:
        raise ReaderError("cli_unavailable") from None
    if process.returncode != 0:
        raise ReaderError(classify(process.stderr.decode("utf-8", "replace")))
    if len(process.stdout) > MAX_OUTPUT_BYTES:
        raise ReaderError("output_too_large")
    try:
        return json.loads(process.stdout.decode("utf-8"))
    except (ValueError, UnicodeError, RecursionError):
        # Never treat unparseable output as an empty or final page.
        raise ReaderError("invalid_json") from None


def read_version(cli):
    try:
        process = subprocess.run([cli, "--version"], capture_output=True, timeout=TIMEOUT_SECONDS, check=False)
    except (subprocess.TimeoutExpired, OSError):
        raise ReaderError("cli_unavailable") from None
    match = re.search(rb"\b([0-9]{1,4})\.([0-9]{1,4})\.([0-9]{1,4})\b", process.stdout + process.stderr)
    if process.returncode != 0 or not match:
        raise ReaderError("cli_error")
    version = tuple(int(part) for part in match.groups())
    return {"version": ".".join(map(str, version)),
            "minimumTested": ".".join(map(str, MINIMUM_TESTED_VERSION)),
            "olderThanMinimumTested": version < MINIMUM_TESTED_VERSION,
            "note": "Recommend updating to the latest CLI before collection; do not install or upgrade it yourself."}


def collect(args):
    builder, selector, _, paginated = READS[args.read]
    data = invoke(args.cli, builder(args))
    result = select_team_check(data, args.scope) if args.read == "team-check" else selector(data)
    coverage = {"pages": 1}
    if paginated:
        next_value = _get(data, "pagination", "next")
        if next_value is None:
            coverage.update(endOfList="known", complete=True)
        else:
            # A cursor, or a missing/unknown pagination field, both mean the end is not established.
            coverage.update(endOfList="not_reached" if next_value != UNKNOWN else UNKNOWN, complete=False)
    else:
        coverage.update(endOfList="not_paginated", complete=UNKNOWN)
    return result, coverage


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "Invalid reader command. Use --help for usage.\n")


def main(argv=None):
    parser = _Parser(description=__doc__)
    parser.add_argument("read", choices=("version", *READS), help="Documented read to run")
    parser.add_argument("--scope", help="Agreed team slug")
    parser.add_argument("--project", help="Agreed project ID or name")
    parser.add_argument("--since", default="24h", help="Window for traffic, alerts and activity, e.g. 24h or 7d")
    parser.add_argument("--cli", default="vercel", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    for value in (args.scope, args.project):
        if value is not None and not IDENTIFIER.fullmatch(value):
            parser.error("identifier")
    if not SINCE.fullmatch(args.since):
        parser.error("since")
    output = {"read": args.read}
    try:
        if args.read == "version":
            output.update(ok=True, result=read_version(args.cli))
        else:
            _, _, needs_project, _ = READS[args.read]
            if args.read != "whoami" and not args.scope:
                parser.error("scope")
            if needs_project and not args.project:
                parser.error("project")
            result, coverage = collect(args)
            output.update(ok=True, result=result, coverage=coverage)
    except ReaderError as error:
        output.update(ok=False, failure=error.kind, coverage={"complete": False})
        if error.kind == "unknown_command":
            output["note"] = "Record a capability gap with an 'upgrade the CLI' note; do not retry or guess equivalent commands."
        print(json.dumps(output, indent=2, sort_keys=True))
        return 1
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
