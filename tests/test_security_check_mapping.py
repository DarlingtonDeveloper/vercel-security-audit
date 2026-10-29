"""security check --json mapping uses the fields the CLI actually returns (#34)."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CAPABILITIES = (ROOT / "skills" / "vercel-security-audit" / "references" / "capabilities.md").read_text(encoding="utf-8")
SCENARIOS = (ROOT / "evals" / "scenarios.md").read_text(encoding="utf-8")
SKILL = (ROOT / "skills" / "vercel-security-audit" / "SKILL.md").read_text(encoding="utf-8")


class SecurityCheckMappingTests(unittest.TestCase):
    def test_real_output_shape_is_documented(self):
        self.assertIn("has no status or risk fields", CAPABILITIES)
        self.assertNotIn("has no status, risk or muted fields", CAPABILITIES)
        for field in ("`unavailable`", "`unavailableReason`", "`mutedCount`", "`posture.mutedCount`"):
            self.assertIn(field, CAPABILITIES)
        for field in ("`violationsCount`", "`totalCount` (omitted for some checks)", "`sampleType`", "`samples`"):
            self.assertIn(field, CAPABILITIES)
        self.assertNotIn("security check reports product check statuses, risk", CAPABILITIES)

    def test_mapping_from_counts_is_conservative(self):
        for phrase in ("`violations_found` (violationsCount above 0)", "not yet a finding",
                       "`no_violations` (violationsCount 0 and totalCount above 0)",
                       "never for the whole checklist ID or team",
                       "`nothing_evaluated` (totalCount 0)", "never satisfactory",
                       "`no_violations_total_unreported` (violationsCount 0 and totalCount omitted",
                       "record that the total was not reported"):
            self.assertIn(phrase, CAPABILITIES)

    def test_muted_and_unavailable_are_never_passing(self):
        for phrase in ("checking muted and unavailable before any count rule",
                       "`muted` (unavailableReason `muted`, or mutedCount above 0 with no unmuted violations): never passing",
                       "`unavailable` (unavailable set, or any other unavailableReason)",
                       "unrecognised reason strings are never echoed"):
            self.assertIn(phrase, CAPABILITIES)
        self.assertIn("A check reported as muted or unavailable (including no access) is never passing", SCENARIOS)

    def test_muted_state_is_unknown_when_fields_are_missing(self):
        self.assertIn("Do not infer that nothing is muted from missing fields", CAPABILITIES)
        self.assertIn("muted state is unknown when the CLI omits muted fields", SCENARIOS)
        for text in (CAPABILITIES, SKILL, SCENARIOS):
            self.assertNotIn("cannot be detected", text)
        self.assertNotIn("Muted findings are not visible in CLI output", SKILL)


if __name__ == "__main__":
    unittest.main()
