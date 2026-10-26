"""Accidental exposure has a severe and a proportionate low-severity path (#47)."""
from pathlib import Path
import unittest

REFS = Path(__file__).resolve().parents[1] / "skills" / "vercel-security-audit" / "references"


class IncidentTierTests(unittest.TestCase):
    def setUp(self):
        text = (REFS / "browser-evidence.md").read_text()
        self.incident = text.split("## Accidental exposure:", 1)[1].split("\n## ", 1)[0]

    def test_classification_defaults_to_severe(self):
        intro = self.incident.split("### Severe exposure", 1)[0]
        for clause in ("CLI output or a connector response", "without re-reading the content",
                       "personal data", "environment variable values",
                       "environment variable names without values", "If in doubt, treat the exposure as severe."):
            with self.subTest(clause=clause):
                self.assertIn(clause, intro)

    def test_low_severity_path_has_containment_and_resume_rule(self):
        low = self.incident.split("### Low-severity exposure", 1)[1]
        for clause in ("do not repeat it", "keep it out of evidence", "metadata only",
                       "Never repeat the exposed values", "needs their approval", "fix it before continuing",
                       "explicitly confirms", "Silence is not confirmation", "treat it as severe"):
            with self.subTest(clause=clause):
                self.assertIn(clause, low)

    def test_cli_output_points_to_the_procedure(self):
        text = (REFS / "capabilities.md").read_text()
        self.assertIn("(browser-evidence.md#accidental-exposure-stop-and-hand-off)", text)


if __name__ == "__main__":
    unittest.main()
