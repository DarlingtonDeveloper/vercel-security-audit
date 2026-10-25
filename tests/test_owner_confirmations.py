"""Offline handoff-questionnaire contracts; no messages are sent to Owners."""
from pathlib import Path
import unittest

SKILL = Path(__file__).resolve().parents[1] / "skills/vercel-security-audit"


class OwnerConfirmationTests(unittest.TestCase):
    def questionnaire(self):
        return (SKILL / "references/report-template.md").read_text().split(
            "### Owner confirmation questionnaire", 1)[1].split("\n## ", 1)[0]

    def test_each_owner_confirms_only_own_current_token_metadata(self):
        text = self.questionnaire()
        for clause in ("each Owner", "only your own", "scoped token count",
                       "expiry", "not_applicable", "current metadata", "CRE-01",
                       "token values", "rotation"):
            self.assertIn(clause, text)

    def test_mfa_questions_ask_for_policy_and_recoverability_not_secrets(self):
        text = self.questionnaire()
        for clause in ("IAM-02", "MFA", "agreed policy", "recoverability",
                       "recovery codes", "method secrets"):
            self.assertIn(clause, text)

    def test_incident_confirmation_asks_roles_not_endpoints(self):
        text = self.questionnaire()
        for clause in ("OPS-01", "incident delivery ownership", "responsible roles",
                       "not endpoints", "Do not send test messages"):
            self.assertIn(clause, text)

    def test_statements_are_timestamped_and_missing_facts_stay_unresolved(self):
        text = self.questionnaire()
        for clause in ("Owner self-statement", "directly observed", "UTC",
                       "needs_confirmation", "unavailable", "do not broaden access"):
            self.assertIn(clause, text)

    def test_report_handoff_does_not_contact_owners(self):
        text = self.questionnaire()
        for clause in ("handed to the user", "No automatic DMs", "exact final content and destination"):
            self.assertIn(clause, text)
        skill = (SKILL / "SKILL.md").read_text().split("### 6. Human review and handoff", 1)[1]
        self.assertIn("Owner confirmation questionnaire", skill)
        self.assertIn("do not contact Owners", skill)


if __name__ == "__main__":
    unittest.main()
