"""Offline routing-document contracts, not live tool or host validation."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "vercel-security-audit"
REFS = SKILL / "references"


def entries(text):
    result = {}
    for check_id, body in re.findall(r"^### ([A-Z]{3}-\d{2})\n(.*?)(?=^### |\Z)", text, re.M | re.S):
        if check_id in result:
            raise ValueError(f"Duplicate routing ID: {check_id}")
        fields = re.findall(r"^- ([^:]+): (.+)$", body, re.M)
        if len(dict(fields)) != len(fields):
            raise ValueError(f"Duplicate field: {check_id}")
        result[check_id] = dict(fields)
    return result


class ToolRoutingTests(unittest.TestCase):
    def setUp(self):
        self.text = (REFS / "mcp-check-map.md").read_text()
        self.routes = entries(self.text)

    def test_exact_checklist_coverage_and_route_shape(self):
        checklist = (REFS / "checklist.md").read_text()
        core, optional = checklist.split("## Optional deeper", 1)
        ids = lambda text: set(re.findall(r"^### ([A-Z]{3}-\d{2})", text, re.M))
        self.assertEqual(len(ids(core)), 24)
        self.assertEqual(len(ids(optional)), 4)
        self.assertEqual(set(self.routes), ids(core) | ids(optional))
        for check_id, route in self.routes.items():
            with self.subTest(check_id=check_id):
                self.assertEqual(set(route), {"MCP", "CLI", "Security Dashboard", "Browser"})
                self.assertTrue(all(route.values()))
                # No discovered executable tool claims; every candidate needs a schema gate.
                self.assertTrue(route["MCP"].startswith("Conditional "))
                self.assertRegex(route["MCP"], r"schema|SEC-01")
                self.assertNotRegex(route["MCP"], r"`[a-z]+_[a-z_]+`")
                self.assertEqual(route["Security Dashboard"],
                                 "Partial/no equivalent verified; no observed check name.")

    def test_cli_routes_use_existing_documented_reads_or_are_unsupported(self):
        capabilities = (REFS / "capabilities.md").read_text()
        # Direct help lines and the bundled reader's read -> command mapping (#32).
        commands = set(re.findall(r"^(?:[a-z-]+ +)?vercel (.+?)(?: --| \[|$)", capabilities, re.M))
        self.assertTrue(commands)
        for check_id, route in self.routes.items():
            value = route["CLI"]
            with self.subTest(check_id=check_id):
                self.assertTrue(value.startswith("Unsupported") or
                                any(value.startswith(command + " ") for command in commands), value)
                self.assertNotRegex(value, r"\bvercel (?:api|env|pull|deploy)\b")

    def test_routing_is_loaded_before_collection(self):
        skill = (SKILL / "SKILL.md").read_text()
        discovery = skill.split("### 1.", 1)[1].split("### 2.", 1)[0]
        self.assertIn("references/mcp-check-map.md", discovery)
        routing = (REFS / "capabilities.md").read_text().split("## Identity", 1)[0]
        self.assertIn("mcp-check-map.md", routing)
        self.assertLess(routing.index("authenticated MCP"), routing.index("Vercel CLI"))

    def test_sharing_inventory_cannot_be_reconstructed_from_events(self):
        route = self.routes["DEP-02"]
        self.assertIn("current-state read", route["MCP"])
        self.assertIn("no access-bearing URLs or values", route["MCP"])
        self.assertIn("never a current active count", route["CLI"])
        self.assertIn("cannot drive a current-state finding", route["CLI"])
        self.assertIn("pre-exposure privacy gate", route["Browser"])

    def test_parser_rejects_duplicate_ids_and_fields(self):
        with self.assertRaises(ValueError):
            entries("### IAM-01\n- MCP: x\n### IAM-01\n- MCP: y\n")
        with self.assertRaises(ValueError):
            entries("### IAM-01\n- MCP: x\n- MCP: y\n")


if __name__ == "__main__":
    unittest.main()
