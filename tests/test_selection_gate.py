"""The pre-exposure gate names the mechanisms that count, with examples (#33)."""
from pathlib import Path
import unittest

SKILL_DIR = Path(__file__).resolve().parents[1] / "skills" / "vercel-security-audit"
REFS = SKILL_DIR / "references"
ANCHOR = "capabilities.md#what-counts-as-field-selection-before-exposure"


class SelectionGateTests(unittest.TestCase):
    def setUp(self):
        text = (REFS / "capabilities.md").read_text(encoding="utf-8")
        start = text.index("## What counts as field selection before exposure")
        self.section = text[start:text.index("\n## ", start + 1)]

    def test_only_bundled_or_verified_mechanisms_count(self):
        for phrase in ("Only these mechanisms count", "the bundled reader, `scripts/cli_read.py`",
                       "verified response contract is metadata-only",
                       "verified to take no automatic screenshot, snapshot or accessibility-tree capture",
                       "Write the selector before navigating"):
            self.assertIn(phrase, self.section)

    def test_ad_hoc_and_after_the_fact_selection_do_not_count(self):
        for phrase in ("An ad-hoc filter written during the audit", "| jq",
                       "after the output, page text or image has already reached the model",
                       "Saving raw output to a file", "document.body.innerText",
                       "Instructions to the model to ignore"):
            self.assertIn(phrase, self.section)

    def test_worked_examples_cover_cli_and_browser(self):
        self.assertIn("Acceptable CLI read:", self.section)
        self.assertIn("Acceptable browser read", self.section)
        self.assertIn("Not acceptable:", self.section)

    def test_no_mechanism_routes_to_owner_statement_before_not_reviewed(self):
        self.assertIn("does not automatically make it not_reviewed", self.section)
        self.assertIn("Record which mechanism was used", self.section)

    def test_gate_references_link_to_the_definition(self):
        for path in (SKILL_DIR / "SKILL.md", REFS / "mcp-boundary.md", REFS / "browser-evidence.md"):
            text = path.read_text(encoding="utf-8")
            self.assertTrue(ANCHOR in text or ANCHOR.split("#")[1] in text, path.name)


if __name__ == "__main__":
    unittest.main()
