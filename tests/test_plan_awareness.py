"""Offline entitlement-policy contracts; no current entitlement claims or live reads."""
from pathlib import Path
import unittest

SKILL = Path(__file__).resolve().parents[1] / "skills/vercel-security-audit"


class PlanAwarenessTests(unittest.TestCase):
    def policy(self):
        return (SKILL / "references/evidence-assessment.md").read_text().split(
            "## Plan and per-feature applicability", 1)[1]

    def test_plan_is_recorded_without_treating_it_as_entitlement(self):
        text = self.policy()
        for clause in ("observed plan", "per-feature entitlements", "account-specific",
                       "custom features", "role visibility", "current public documentation",
                       "verification date", "account facts"):
            self.assertIn(clause, text)
        for path in ("SKILL.md", "references/report-template.md"):
            self.assertIn("per-feature", (SKILL / path).read_text())

    def test_access_errors_are_not_nonapplicability(self):
        text = self.policy()
        for clause in ("not_applicable only", "feature-specific", "403", "upgrade prompt",
                       "not_reviewed", "needs_confirmation", "not proof of non-applicability"):
            self.assertIn(clause, text)

    def test_mixed_iam_subchecks_do_not_inherit_a_pass(self):
        text = self.policy()
        for clause in ("IAM-02", "MFA", "SAML", "directory provisioning",
                       "one non-applicable subfeature", "cannot make the whole check satisfactory"):
            self.assertIn(clause, text)

    def test_managed_ruleset_requires_effective_state_and_intent(self):
        text = self.policy()
        for clause in ("managed ruleset", "entitlement", "published", "effective plan",
                       "intent", "inert", "mismatch", "confirmation, not an assertion"):
            self.assertIn(clause, text)
        self.assertIn("Do not hardcode plan-to-feature mappings", text)
        self.assertNotRegex(text, r"Pro (?:does not|cannot|never) (?:support|include|use)")


if __name__ == "__main__":
    unittest.main()
