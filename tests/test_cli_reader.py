"""Bundled CLI reader: allow-listed output only, fixed failure kinds, no raw CLI text (#32).

A fake `vercel` executable replays synthetic JSON shaped like CLI 62.7.0 output
(shapes verified with a keys-and-types-only probe). Canary values stand in for
names, URLs, IPs and environment variable names that must never be printed.
"""
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
READER = ROOT / "skills" / "vercel-security-audit" / "scripts" / "cli_read.py"
CANARY = "SYNTHETIC_READER_CANARY"

FAKE_CLI = r'''#!/usr/bin/env python3
import json, os, sys
argv = sys.argv[1:]
fixtures = json.load(open(os.environ["FAKE_FIXTURES"]))
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps(argv) + "\n")
if argv == ["--version"]:
    print(fixtures.get("--version", "Vercel CLI 62.7.0")); sys.exit(0)
key = " ".join(a for a in argv if a not in ("--json", "--non-interactive"))
entry = fixtures.get(key)
if entry is None:
    sys.stderr.write("Error: no fixture " + key + "\n"); sys.exit(1)
if "stderr" in entry:
    sys.stderr.write(entry["stderr"]); sys.exit(entry.get("exit", 1))
sys.stdout.write(entry["stdout"] if isinstance(entry.get("stdout"), str) else json.dumps(entry["json"]))
'''

SECURITY = {"report": {
    "env-vars-plaintext": {"violationsCount": 2, "totalCount": 9, "sampleType": ["envVar"],
                           "samples": [{"id": "prj_" + CANARY, "label": CANARY + "-project",
                                        "samples": [{"id": "env_1", "label": CANARY + "_SECRET_NAME"}]}]},
    "deployment-protection": {"violationsCount": 0, "totalCount": 4, "sampleType": ["project"], "samples": []},
    CANARY + "_ODD KEY": {"violationsCount": 1},
}}
PROJECTS = {"contextName": CANARY, "elapsed": "1s", "pagination": {"count": 1, "next": None, "prev": 1},
            "projects": [{"id": "prj_1", "name": "shop", "deprecated": False, "nodeVersion": "22.x",
                          "updatedAt": 1, "latestProductionUrl": "https://" + CANARY + ".example"}]}
FIREWALL = {"firewallEnabled": True, "attackMode": {"enabled": False},
            "botProtection": {"enabled": True, "action": None}, "aiBots": {"enabled": False, "action": None},
            "owasp": {"enabled": False, "action": None, "requiresUpgrade": True, "upgrade": "https://" + CANARY},
            "rules": {"active": 2, "inactive": 1, "total": 3}, "draftChanges": 0, "ipBlocks": 4,
            "bypass": [], "bypasses": {"custom": {"count": 1, "skips": [CANARY], "state": "active"},
                                       "system": {"count": 0, "skips": [], "state": "inactive"}},
            "requestFlow": [{"id": "managed-rules", "state": "active", "configurable": True, "label": CANARY,
                             "description": CANARY, "rulesets": [{"id": "owasp", "state": "unavailable", "label": CANARY,
                                                                  "unavailable": {"reason": "plan", "upgrade": CANARY}}]}]}
RULES = {"hasDraft": True, "pendingChanges": 1, "managed": [{"action": "deny", "id": "bot_filter", "name": CANARY, "wafRuleId": None}],
         "rules": [{"active": True, "name": CANARY, "conditionGroup": [{"conditions": [{"type": "header", "key": "x-" + CANARY, "value": CANARY}]}]}]}
TRAFFIC = {"filter": None, "period": {"start": "2026-10-25T13:00:00Z", "end": "2026-10-26T14:00:00Z", "granularity": {"hours": 1}},
           "series": [], "stats": {}, "topLists": [{"dimension": "action", "rows": [{"key": "deny", "value": 5}, {"key": "203.0.113.9", "value": 1, "ip": CANARY}]}]}
INTEGRATIONS = {"resources": [{"id": CANARY, "installationId": CANARY, "name": CANARY, "product": "Upstash for Redis",
                               "projects": [CANARY], "status": "available"}]}
SCOPE = ["--scope", "example-team"]
PROJECT = [*SCOPE, "--project", "prj_1"]
FIXTURES = {
    "whoami": {"json": {"username": "example-user", "email": CANARY + "@example.test", "name": CANARY,
                        "team": {"slug": CANARY, "name": CANARY}}},
    "security check --scope example-team": {"json": SECURITY},
    "project ls --scope example-team": {"json": PROJECTS},
    "firewall status --scope example-team --project prj_1": {"json": FIREWALL},
    "firewall rules list --scope example-team --project prj_1": {"json": RULES},
    "firewall traffic list --scope example-team --project prj_1 --since 24h --dimension action": {"json": TRAFFIC},
    "integration list --scope example-team --all": {"json": INTEGRATIONS},
    "domains list --scope example-team --limit 100": {"json": {"pagination": {"count": 2, "next": None, "prev": None},
        "domains": [{"name": CANARY + ".example", "verified": True, "id": CANARY, "nameservers": [CANARY]},
                    {"name": "internal-" + CANARY + ".example", "verified": False, "serviceType": CANARY}]}},
    "webhooks list --scope example-team": {"stdout": "not json " + CANARY},
    "activity --scope example-team --all --since 7d --limit 100": {
        "stderr": "Error: " + CANARY + " is forbidden (403)\n"},
    "security check --scope old-team": {
        "stderr": 'Error: "security" is not a valid target directory or subcommand. Did you mean "cert"?\n'},
}


class CLIReaderTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.cli = self.directory / "vercel"
        self.cli.write_text(FAKE_CLI, encoding="utf-8")
        self.cli.chmod(self.cli.stat().st_mode | stat.S_IXUSR)
        self.fixtures = self.directory / "fixtures.json"
        self.fixtures.write_text(json.dumps(FIXTURES), encoding="utf-8")
        self.log = self.directory / "argv.log"

    def read(self, *args, version=None):
        if version:
            data = dict(FIXTURES, **{"--version": version})
            self.fixtures.write_text(json.dumps(data), encoding="utf-8")
        environment = dict(os.environ, FAKE_FIXTURES=str(self.fixtures), FAKE_LOG=str(self.log))
        result = subprocess.run([sys.executable, "-I", "-B", str(READER), *args, "--cli", str(self.cli)],
                                capture_output=True, text=True, timeout=30, env=environment, check=False)
        self.assertNotIn(CANARY, result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        return result

    def ok(self, *args):
        result = self.read(*args)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def failure(self, *args):
        result = self.read(*args)
        self.assertEqual(result.returncode, 1, result.stdout)
        output = json.loads(result.stdout)
        self.assertFalse(output["ok"])
        self.assertFalse(output["coverage"]["complete"])
        return output

    def argv_log(self):
        return [json.loads(line) for line in self.log.read_text(encoding="utf-8").splitlines()]

    def test_every_read_uses_json_non_interactive_and_no_shell(self):
        self.ok("security-check", *SCOPE)
        argv = self.argv_log()[-1]
        self.assertEqual(argv[-2:], ["--json", "--non-interactive"])
        self.assertEqual(argv[:2], ["security", "check"])

    def test_security_check_keeps_counts_and_drops_samples(self):
        output = self.ok("security-check", *SCOPE)
        checks = output["result"]["checks"]
        self.assertEqual(checks["env-vars-plaintext"], {"violationsCount": 2, "totalCount": 9,
                                                        "sampleType": ["envVar"], "samplesReceived": 1})
        self.assertEqual(checks["deployment-protection"]["violationsCount"], 0)
        self.assertEqual(output["result"]["withheldCheckKeys"], 1)

    def test_whoami_keeps_username_only(self):
        self.assertEqual(self.ok("whoami")["result"], {"username": "example-user"})

    def test_project_inventory_drops_urls_and_reports_end_of_list(self):
        output = self.ok("project-ls", *SCOPE)
        self.assertEqual(set(output["result"]["projects"][0]),
                         {"id", "name", "deprecated", "nodeVersion", "updatedAt"})
        self.assertEqual(output["coverage"], {"pages": 1, "endOfList": "known", "complete": True})

    def test_firewall_status_keeps_states_and_entitlement_reason_only(self):
        result = self.ok("firewall-status", *PROJECT)["result"]
        self.assertEqual(result["rules"], {"active": 2, "inactive": 1, "total": 3})
        self.assertEqual(result["owasp"], {"enabled": False, "action": None, "requiresUpgrade": True})
        self.assertEqual(result["requestFlow"][0]["rulesets"][0]["unavailableReason"], "plan")
        self.assertEqual(result["bypasses"]["custom"], {"count": 1, "state": "active"})

    def test_firewall_rules_never_print_conditions(self):
        result = self.ok("firewall-rules", *PROJECT)["result"]
        self.assertEqual(result["customRules"], [{"active": True}])
        self.assertEqual(result["managedRulesets"], [{"id": "bot_filter", "action": "deny"}])

    def test_traffic_rows_withhold_non_enum_keys(self):
        rows = self.ok("firewall-traffic", *PROJECT)["result"]["topLists"][0]["rows"]
        self.assertEqual(rows[0], {"key": "deny", "value": 5})
        self.assertEqual(rows[1], {"key": "unknown", "value": 1})

    def test_integrations_keep_product_status_and_project_count(self):
        self.assertEqual(self.ok("integrations", *SCOPE)["result"],
                         {"resources": [{"product": "Upstash for Redis", "status": "available", "projectCount": 1}]})

    def test_domains_use_synthetic_aliases_and_boolean_flags_only(self):
        output = self.ok("domains", *SCOPE)
        self.assertEqual(output["result"], {"domainsCount": 2, "domains": [
            {"alias": "domain-1", "flags": {"verified": True}}, {"alias": "domain-2", "flags": {"verified": False}}]})
        self.assertNotIn(".example", json.dumps(output))

    def test_failures_are_fixed_kinds_without_cli_text(self):
        self.assertEqual(self.failure("webhooks", *SCOPE)["failure"], "invalid_json")
        self.assertEqual(self.failure("activity", *SCOPE, "--since", "7d")["failure"], "permission")

    def test_missing_security_command_is_a_capability_gap(self):
        output = self.failure("security-check", "--scope", "old-team")
        self.assertEqual(output["failure"], "unknown_command")
        self.assertIn("upgrade the CLI", output["note"])

    def test_version_compares_against_minimum_tested(self):
        old = json.loads(self.read("version", version="Vercel CLI 54.18.0").stdout)["result"]
        self.assertTrue(old["olderThanMinimumTested"])
        new = json.loads(self.read("version", version="Vercel CLI 65.0.0").stdout)["result"]
        self.assertFalse(new["olderThanMinimumTested"])
        self.assertEqual(new["minimumTested"], "62.7.0")

    def test_identifiers_cannot_inject_flags_and_scope_is_required(self):
        for args in (("security-check", "--scope", "--token"), ("security-check", "--scope=-t"),
                     ("firewall-status", *SCOPE), ("project-ls",), ("unknown-read", *SCOPE),
                     ("activity", *SCOPE, "--since", "1y")):
            result = self.read(*args)
            self.assertEqual(result.returncode, 2, args)
            self.assertEqual(result.stdout, "")
        self.assertFalse(self.log.exists())


if __name__ == "__main__":
    unittest.main()
