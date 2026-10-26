"""Scope is agreed before long reference reads (#45); offline document contracts."""
from pathlib import Path
import unittest

SKILL = Path(__file__).resolve().parents[1] / "skills" / "vercel-security-audit" / "SKILL.md"


class ScopeFirstTests(unittest.TestCase):
    def setUp(self):
        self.text = SKILL.read_text(encoding="utf-8")

    def test_startup_checks_presence_without_full_reads(self):
        startup = self.text.split("## Startup: installation integrity\n", 1)[1].split("\n## ", 1)[0]
        self.assertIn("Do not read them in full yet", startup)
        self.assertNotIn("Read all four essential references in full at startup", startup)

    def test_scope_question_precedes_reference_reads(self):
        step = self.text.split("### 1.", 1)[1].split("### 2.", 1)[0]
        ask = step.index("Ask for scope first; it needs no account reads or reference reads.")
        read = step.index("Then read [capabilities](references/capabilities.md)")
        self.assertLess(ask, read)
        self.assertIn("in full before any account read", step)

    def test_report_references_load_at_step_five(self):
        step = self.text.split("### 5.", 1)[1].split("### 6.", 1)[0]
        self.assertIn("[report template](references/report-template.md) and "
                      "[report design](references/report-design.md) in full now", step)


if __name__ == "__main__":
    unittest.main()
