"""Offline policy-contract checks, not executed agent/account behaviour tests."""
from pathlib import Path
import unittest

SKILL = Path(__file__).resolve().parents[1] / "skills/vercel-security-audit"


class EvidencePolicyTests(unittest.TestCase):
    def policy(self):
        return (SKILL / "references/evidence-assessment.md").read_text()

    def test_conflict_policy_is_required_context(self):
        for path in ("SKILL.md", "references/checklist.md"):
            text = (SKILL / path).read_text()
            self.assertIn("evidence-assessment.md", text)
            self.assertIn("before assigning statuses", text)

    def test_conflicts_preserve_provenance_and_uncertainty(self):
        text = self.policy()
        for clause in ("No source is universally authoritative", "both observations",
                       "observation and documentation verification dates", "scope",
                       "product names", "redacted", "needs_confirmation"):
            with self.subTest(clause=clause):
                self.assertIn(clause, text)

    def test_aggregate_pass_cannot_override_personal_token_evidence(self):
        text = self.policy().split("## Personal access tokens", 1)[1].split("\n## ", 1)[0]
        for clause in ("PAT", "aggregate pass", "personal token count",
                       "cannot override", "each Owner", "needs_confirmation"):
            self.assertIn(clause, text)

    def test_project_count_is_not_a_complete_id_inventory(self):
        text = self.policy().split("## Project inventory", 1)[1].split("\n## ", 1)[0]
        for clause in ("reported project count", "listed project IDs", "incomplete",
                       "needs_confirmation", "no missing project names"):
            self.assertIn(clause, text)

    def test_associations_and_historical_metadata_have_narrow_meaning(self):
        text = self.policy()
        integration = text.split("## Integration and environment metadata", 1)[1].split("\n## ", 1)[0]
        self.assertIn("resource associations are not proof of environment-variable metadata", integration)
        self.assertIn("SEC-01", integration)
        git = text.split("## Current Git connection", 1)[1].split("\n## ", 1)[0]
        self.assertIn("historical Git metadata does not establish a current Git link", git)
        self.assertIn("SRC-01", git)
        self.assertIn("needs_confirmation", git)


if __name__ == "__main__":
    unittest.main()
