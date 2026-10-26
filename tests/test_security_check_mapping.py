"""security check --json mapping uses the fields the CLI actually returns (#34)."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CAPABILITIES = (ROOT / "skills" / "vercel-security-audit" / "references" / "capabilities.md").read_text(encoding="utf-8")
SCENARIOS = (ROOT / "evals" / "scenarios.md").read_text(encoding="utf-8")


class SecurityCheckMappingTests(unittest.TestCase):
    def test_real_output_shape_is_documented(self):
        self.assertIn("has no status, risk or muted fields", CAPABILITIES)
        for field in ("`violationsCount`", "`totalCount` (omitted for some checks)", "`sampleType`", "`samples`"):
            self.assertIn(field, CAPABILITIES)
        self.assertNotIn("security check reports product check statuses, risk", CAPABILITIES)

    def test_mapping_from_counts_is_conservative(self):
        for phrase in ("`violations_found` (violationsCount above 0)", "not yet a finding",
                       "`no_violations` (violationsCount 0 and totalCount above 0)",
                       "never for the whole checklist ID or team",
                       "`nothing_evaluated` (totalCount 0)", "never satisfactory"):
            self.assertIn(phrase, CAPABILITIES)

    def test_muted_is_recorded_as_undetectable(self):
        self.assertIn("Muted findings cannot be detected from this output", CAPABILITIES)
        self.assertIn("Do not infer that nothing is muted", CAPABILITIES)
        self.assertIn("muted findings cannot be detected from the CLI", SCENARIOS)


if __name__ == "__main__":
    unittest.main()
