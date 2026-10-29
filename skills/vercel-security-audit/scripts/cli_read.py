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
import os
import re
import signal
import subprocess
import sys
import threading
import time

MINIMUM_TESTED_VERSION = (62, 7, 0)
TIMEOUT_SECONDS = 90
# Login preflight before every account read: a logged-out CLI must fail fast, not start a device flow.
AUTH_TIMEOUT_SECONDS = 15
# Seen when a logged-out CLI starts the device-login flow even with --non-interactive (CLI 65.3.1).
LOGIN_FLOW_MARKERS = ("starting login flow", "oauth/device", "no existing credentials found")
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


def product_result(violations, total):
    """Conservative per-product-check result from the only fields the CLI returns.

    violations > 0: violations_found (a review candidate, not yet a finding).
    violations == 0 and total > 0: no_violations (this product check and scope only).
    violations == 0 and total omitted: no_violations_total_unreported (the CLI omits
    totalCount for some checks; zero from a complete structured check still counts,
    with the missing total recorded as a caveat).
    total == 0: nothing_evaluated. Missing, negative or mistyped counts: unknown.
    Muted findings cannot be detected from this output.
    """
    if violations == UNKNOWN:
        return UNKNOWN
    if violations > 0:
        return "violations_found"
    if total == UNKNOWN:
        return "no_violations_total_unreported"
    return "no_violations" if total > 0 else "nothing_evaluated"


def select_security_check(data):
    report = _get(data, "report")
    checks, withheld = {}, 0
    for key, value in (report.items() if isinstance(report, dict) else ()):
        if not CHECK_KEY.fullmatch(key):
            withheld += 1
            continue
        violations, total = _int(_get(value, "violationsCount")), _int(_get(value, "totalCount"))
        raw_total = _get(value, "totalCount")
        malformed = (violations != UNKNOWN and violations < 0) or (total != UNKNOWN and total < 0) \
            or (raw_total != UNKNOWN and total == UNKNOWN)
        if malformed:
            violations = total = UNKNOWN
        checks[key] = {
            "productResult": product_result(violations, total),
            "violationsCount": violations,
            "totalCount": total,
            "sampleType": [item for item in _list(_get(value, "sampleType")) if isinstance(item, str) and SAMPLE_TYPE.fullmatch(item)],
            # Samples name projects, deployments and environment variables: count only.
            "samplesReceived": _count(_get(value, "samples")),
        }
    return {"checks": checks, "withheldCheckKeys": withheld, "reportPresent": isinstance(report, dict),
            "mutedDetectable": False}


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


def _login_flow_started(stdout, stderr):
    """True when the CLI has begun an interactive device login; JSON stdout is never scanned."""
    if any(marker in bytes(stderr).lower().decode("utf-8", "replace") for marker in LOGIN_FLOW_MARKERS):
        return True
    head = bytes(stdout[:4096]).lstrip()
    if head[:1] in (b"{", b"["):
        return False
    return any(marker in head.lower().decode("utf-8", "replace") for marker in LOGIN_FLOW_MARKERS)


def _kill(process):
    if process.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)  # the CLI's own child processes too
        else:
            process.kill()
    except OSError:
        pass
    process.wait()


def _run(cli, args, timeout):
    """Run the CLI with no stdin, streaming its output so a login prompt or oversized output stops it early."""
    try:
        process = subprocess.Popen([cli, *args], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=(os.name == "posix"))
    except OSError:
        raise ReaderError("cli_unavailable") from None
    stdout, stderr = bytearray(), bytearray()

    def pump(stream, buffer):
        for chunk in iter(lambda: stream.read1(65536), b""):
            buffer.extend(chunk)

    threads = [threading.Thread(target=pump, args=pair, daemon=True)
               for pair in ((process.stdout, stdout), (process.stderr, stderr))]
    for thread in threads:
        thread.start()
    deadline = time.monotonic() + timeout
    try:
        while True:
            exited = process.poll() is not None
            if exited:
                for thread in threads:
                    thread.join(timeout=5)
            if _login_flow_started(stdout, stderr):
                # Never wait on, print or relay a device code or URL.
                raise ReaderError("not_authenticated")
            if len(stdout) > MAX_OUTPUT_BYTES:
                raise ReaderError("output_too_large")
            if exited:
                return process.returncode, bytes(stdout), bytes(stderr)
            if time.monotonic() > deadline:
                raise ReaderError("timeout")
            time.sleep(0.05)
    finally:
        _kill(process)
        for stream in (process.stdout, process.stderr):
            stream.close()


def _logged_out(data):
    return isinstance(data, dict) and data.get("loggedIn") is False


def invoke(cli, argv, timeout=TIMEOUT_SECONDS):
    returncode, stdout, stderr = _run(cli, [*argv, "--json", "--non-interactive"], timeout)
    try:
        data = json.loads(stdout.decode("utf-8"))
    except (ValueError, UnicodeError, RecursionError):
        data = None
        parsed = False
    else:
        parsed = True
    # A logged-out whoami exits 1 with {"loggedIn": false} on stdout and nothing on stderr.
    if parsed and _logged_out(data):
        raise ReaderError("not_authenticated")
    if returncode != 0:
        raise ReaderError(classify(stderr.decode("utf-8", "replace")))
    if not parsed:
        # Never treat unparseable output as an empty or final page.
        raise ReaderError("invalid_json")
    return data


def require_login(cli):
    """Confirm the CLI is logged in before an account read, so no device-login flow can start."""
    data = invoke(cli, ["whoami"], timeout=AUTH_TIMEOUT_SECONDS)
    if not isinstance(data, dict) or not (data.get("loggedIn") is True or isinstance(data.get("username"), str)):
        raise ReaderError("not_authenticated")


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


CURSOR = re.compile(r"[A-Za-z0-9_.:-]{1,200}")
DEFAULT_MAX_PAGES = 20
HARD_MAX_PAGES = 50


class PartialRead(Exception):
    """A later page failed: keep the pages already read, never call it complete."""

    def __init__(self, kind, result, coverage):
        super().__init__(kind)
        self.kind, self.result, self.coverage = kind, result, coverage


def _sum(values):
    return UNKNOWN if any(v == UNKNOWN for v in values) else sum(values)


def combine(read, pages, slug):
    if read == "team-check":
        for page in pages:
            match = select_team_check(page, slug)
            if match["member"] is True:
                return match
        return None  # decided by the caller from end-of-list knowledge
    selected = [READS[read][1](page) for page in pages]
    if read == "project-ls":
        return {"projects": [p for page in selected for p in page["projects"]]}
    if read == "domains":
        merged = [d for page in selected for d in page["domains"]]
        for index, domain in enumerate(merged, start=1):
            domain["alias"] = f"domain-{index}"  # aliases stay unique across pages
        return {"domainsCount": _sum([page["domainsCount"] for page in selected]), "domains": merged}
    if read == "activity":
        types = {}
        for page in selected:
            for kind, count in page["eventTypes"].items():
                types[kind] = types.get(kind, 0) + count
        return {"eventsCount": _sum([page["eventsCount"] for page in selected]), "eventTypes": types}
    return selected[0]


def collect(args):
    builder, selector, _, paginated = READS[args.read]
    if args.read != "whoami":
        require_login(args.cli)
    if not paginated:
        data = invoke(args.cli, builder(args))
        return selector(data), {"pages": 1, "endOfList": "not_paginated", "complete": UNKNOWN}
    pages, seen, cursor, end, failure = [], set(), None, UNKNOWN, None
    while True:
        argv = builder(args) + (["--next", str(cursor)] if cursor is not None else [])
        try:
            data = invoke(args.cli, argv)
        except ReaderError as error:
            if not pages:
                raise
            failure = error.kind  # never treated as end-of-list
            break
        pages.append(data)
        if args.read == "team-check" and select_team_check(data, args.scope)["member"] is True:
            end = "not_needed"
            break
        next_value = _get(data, "pagination", "next")
        if next_value is None:
            end = "known"
            break
        if next_value == UNKNOWN or isinstance(next_value, bool) or not (
                type(next_value) is int or (isinstance(next_value, str) and CURSOR.fullmatch(next_value))):
            failure = "invalid_cursor"
            break
        if next_value in seen:
            failure = "repeated_cursor"
            break
        if len(pages) >= args.max_pages:
            failure = "page_cap_reached"
            break
        seen.add(next_value)
        cursor = next_value
    result = combine(args.read, pages, args.scope)
    if args.read == "team-check" and result is None:
        result = {"member": False if end == "known" else UNKNOWN}
    complete = end in ("known", "not_needed")
    coverage = {"pages": len(pages), "endOfList": end if end != UNKNOWN else "not_reached", "complete": complete}
    if failure:
        coverage["stoppedBecause"] = failure
        raise PartialRead(failure, result, coverage)
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
    parser.add_argument("--max-pages", type=int, default=DEFAULT_MAX_PAGES,
                        help=f"Page cap for paginated reads (1-{HARD_MAX_PAGES}); reaching it is incomplete coverage")
    parser.add_argument("--cli", default="vercel", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    for value in (args.scope, args.project):
        if value is not None and not IDENTIFIER.fullmatch(value):
            parser.error("identifier")
    if not 1 <= args.max_pages <= HARD_MAX_PAGES:
        parser.error("max-pages")
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
    except PartialRead as error:
        # Pages already read are useful bounded observations, labelled as partial.
        output.update(ok=False, failure=error.kind, partialResult=error.result, coverage=error.coverage)
        print(json.dumps(output, indent=2, sort_keys=True))
        return 1
    except ReaderError as error:
        output.update(ok=False, failure=error.kind, coverage={"complete": False})
        if error.kind == "unknown_command":
            output["note"] = "Record a capability gap with an 'upgrade the CLI' note; do not retry or guess equivalent commands."
        elif error.kind == "not_authenticated":
            output["note"] = "Ask the user to run 'vercel login' themselves, then retry; never start, open or relay a device-login URL or code."
        print(json.dumps(output, indent=2, sort_keys=True))
        return 1
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
