"""Offline scope-consent contracts, not a test of agent conversations."""
from pathlib import Path
import unittest

SKILL = Path(__file__).resolve().parents[1] / "skills/vercel-security-audit"
OPTIONAL = ("DEP-04", "SRC-04", "SEC-04", "OPS-04")


class OptionalScopeTests(unittest.TestCase):
    def scope_step(self):
        return (SKILL / "SKILL.md").read_text().split(
            "### 1. Agree scope and discover capabilities", 1)[1].split("### 2.", 1)[0]

    def test_step_one_names_all_four_optional_checks(self):
        text = self.scope_step()
        for topic in OPTIONAL:
            self.assertIn(topic, text)
        self.assertIn("per named source/application", text)

    def test_full_review_asks_once_without_implicit_consent(self):
        text = self.scope_step()
        for clause in ('"full"', "ask once", "not automatic authorisation",
                       "accept", "decline", "partial", "already explicit", "do not repeat"):
            self.assertIn(clause, text)

    def test_declined_and_partial_decisions_are_recorded_separately(self):
        text = (SKILL / "references/checklist.md").read_text().split(
            "## Optional deeper authorized source/application review", 1)[1]
        for clause in ("per named source/application", "accepted, declined or partial",
                       "not_reviewed", "unauthorised", "does not fail the core review"):
            self.assertIn(clause, text)

    def test_report_has_a_consent_ledger_not_just_a_global_yes_no(self):
        text = (SKILL / "references/report-template.md").read_text()
        block = text.split("### Optional scope decisions", 1)[1].split("\n## ", 1)[0]
        for topic in OPTIONAL:
            self.assertIn(topic, block)
        for clause in ("named source/application", "accepted/declined/partial",
                       "consent provenance", "exclusions", "not_reviewed", "unauthorised"):
            self.assertIn(clause, block)


if __name__ == "__main__":
    unittest.main()
