"""Structured plan entitlement signals can support not_applicable under conditions (#49)."""
from pathlib import Path
import unittest

REFS = Path(__file__).resolve().parents[1] / "skills" / "vercel-security-audit" / "references"


class PlanSignalTests(unittest.TestCase):
    def setUp(self):
        text = (REFS / "evidence-assessment.md").read_text()
        policy = text.split("## Plan and per-feature applicability", 1)[1]
        self.signal = policy.split("Structured plan entitlement signals", 1)[1].split("A managed ruleset entry", 1)[0]
        self.policy = policy

    def test_signal_counts_only_with_all_conditions(self):
        for clause in ("counts as the scoped account fact for that feature",
                       "selected, authorised identity and team/project scope",
                       "Current public documentation, with its verification date, agrees",
                       "No other source shows the feature as enabled",
                       "UTC observation time are recorded"):
            with self.subTest(clause=clause):
                self.assertIn(clause, self.signal)

    def test_signal_is_bounded_and_never_drives_purchases(self):
        for clause in ("covers only the named feature in that scope", "keep both observations and needs_confirmation",
                       "upgrade prompt, 403, hidden control or tool error is still not enough",
                       "never a reason to recommend buying an upgrade"):
            with self.subTest(clause=clause):
                self.assertIn(clause, self.signal)

    def test_managed_ruleset_and_template_reference_the_signal(self):
        self.assertIn("a structured plan signal meeting the conditions above satisfies this part", self.policy)
        template = (REFS / "report-template.md").read_text()
        self.assertIn("a structured plan entitlement field from a verified read can", template)


if __name__ == "__main__":
    unittest.main()
