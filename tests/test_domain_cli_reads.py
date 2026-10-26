"""Domain CLI reads are routed with selection gates; env and cert listings stay excluded (#44)."""
from pathlib import Path
import re
import unittest

REFS = Path(__file__).resolve().parents[1] / "skills" / "vercel-security-audit" / "references"


def route(text, check_id):
    body = text.split(f"### {check_id}\n", 1)[1].split("\n### ", 1)[0]
    return dict(re.findall(r"^- ([^:]+): (.+)$", body, re.M))


class DomainCliReadTests(unittest.TestCase):
    def setUp(self):
        self.capabilities = (REFS / "capabilities.md").read_text()
        self.map = (REFS / "mcp-check-map.md").read_text()

    def test_domains_list_is_a_documented_json_pattern(self):
        self.assertIn('vercel domains list --scope "$team_slug" --limit 100 --json', self.capabilities)
        self.assertIn("requires explicit team-wide read authorisation", self.capabilities)
        self.assertIn("synthetic aliases", self.capabilities)

    def test_domain_routes_use_domains_list_with_gates(self):
        for check_id in ("DOM-01", "DOM-03"):
            with self.subTest(check_id=check_id):
                cli = route(self.map, check_id)["CLI"]
                self.assertTrue(cli.startswith("domains list "))
                self.assertIn("team-wide authorisation", cli)
                self.assertIn("pre-exposure selection", cli)
                self.assertIn("actually returns", cli)

    def test_certificates_and_environment_stay_unsupported(self):
        self.assertTrue(route(self.map, "DOM-02")["CLI"].startswith("Unsupported"))
        sec = route(self.map, "SEC-01")["CLI"]
        self.assertTrue(sec.startswith("Unsupported"))
        self.assertIn("readable values", sec)
        self.assertIn("do not run env list/ls", self.capabilities)
        self.assertNotRegex(self.capabilities, r"^vercel (?:env|certs) ", "no env/cert command patterns")
        self.assertNotRegex(self.capabilities, re.compile(r"^vercel (?:env|certs) ", re.M))


if __name__ == "__main__":
    unittest.main()
