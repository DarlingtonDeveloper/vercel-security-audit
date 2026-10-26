"""Routing recommends a connector before CLI/browser fallbacks (#43); offline document contracts."""
from pathlib import Path
import unittest

SKILL = Path(__file__).resolve().parents[1] / "skills" / "vercel-security-audit"
REFS = SKILL / "references"


class ConnectorRecommendationTests(unittest.TestCase):
    def test_routing_recommends_connector_then_cli_then_browser(self):
        text = (REFS / "capabilities.md").read_text()
        routing = text.split("## Routing", 1)[1].split("\n## ", 1)[0]
        recommend = routing.index("recommend connecting one before any account reads")
        cli = routing.index("only if the user declines or cannot connect")
        browser = routing.index("Use an authorised browser last")
        self.assertLess(recommend, cli)
        self.assertLess(cli, browser)
        self.assertIn("Never install, connect or authenticate it yourself.", routing)
        self.assertIn("Record the user's choice.", routing)
        self.assertIn("Do not use the browser as a substitute", routing)

    def test_check_map_has_no_connector_path(self):
        text = (REFS / "mcp-check-map.md").read_text()
        contract = text.split("## Selection contract", 1)[1].split("## Routing entries", 1)[0]
        self.assertIn("No connector:", contract)
        self.assertIn("skip every MCP entry below", contract)
        self.assertIn("rather than browser work by default", contract)

    def test_skill_step_one_recommends_without_installing(self):
        text = (SKILL / "SKILL.md").read_text()
        step = text.split("### 1.", 1)[1].split("### 2.", 1)[0]
        self.assertIn("recommend that the user connect one before collection", step)
        self.assertIn("never install or connect it yourself", step)
        self.assertIn("Use the CLI only if they decline", step)


if __name__ == "__main__":
    unittest.main()
