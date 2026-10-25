"""Offline instruction contracts; no browser, OAuth or account execution."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "skills" / "vercel-security-audit"


class BrowserPreflightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.skill = (ROOT / "SKILL.md").read_text()
        cls.plan = (ROOT / "references/collection-plan.md").read_text()
        cls.capabilities = (ROOT / "references/capabilities.md").read_text()

    def test_preflight_is_before_inventory_and_linked_from_capabilities(self):
        preflight, collection = self.skill.split("### 2. Inventory", 1)
        self.assertIn("references/collection-plan.md", preflight)
        self.assertIn("Before inventory or product checks", preflight)
        self.assertIn("collection-plan.md", self.capabilities)
        self.assertIn("one planned collection pass", collection)

    def test_identity_and_permissions_are_separate_preconditions(self):
        for rule in (
            "read OAuth scopes or equivalent role/grants", "pre-model field selection",
            "automatic screenshots on navigation/reload", "connector/CLI account and team",
            "before combining evidence", "Do not auto-login", "MFA, device policy",
            "match/mismatch and scope aliases", "A login page is not proof",
        ):
            with self.subTest(rule=rule):
                self.assertIn(rule, self.plan)

    def test_blocked_browser_has_explicit_portable_choice(self):
        for rule in (
            "continue API-only", "pause for user handoff", "explicit user confirmation",
            "silence is not consent", "noninteractive host pauses", "Markdown remains available",
            "separately confirmed authorised connector identity",
        ):
            with self.subTest(rule=rule):
                self.assertIn(rule, self.plan)

    def test_plan_covers_every_id_and_routes_before_report(self):
        for rule in (
            "24 core IDs", "separately authorised optional ID", "API-readable:",
            "dashboard-only:", "owner statement:", "unavailable:", "fallback route or none",
            "allowed evidence fields", "completeness criteria", "one planned pass",
            "before drafting the first report", "not_reviewed", "needs_confirmation",
            "Never imply that planned reads or unavailable browser features worked",
        ):
            with self.subTest(rule=rule):
                self.assertIn(rule, self.plan)


if __name__ == "__main__":
    unittest.main()
