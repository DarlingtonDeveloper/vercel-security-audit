"""Offline coverage-report contracts; pagination is not exercised against accounts."""
from pathlib import Path
import unittest

SKILL = Path(__file__).resolve().parents[1] / "skills/vercel-security-audit"


class CoverageLimitsTests(unittest.TestCase):
    def test_report_requires_per_feed_collection_accounting(self):
        text = (SKILL / "references/report-template.md").read_text()
        block = text.split("## Coverage limits", 1)[1].split("\n## ", 1)[0]
        for field in ("Source/feed:", "Window:", "Reported total:", "Received:",
                      "Inspected:", "Page/finding cap:", "Truncation:",
                      "Cursor availability:", "End known:", "Missing sources:",
                      "Timeouts/failures:", "Retries and outcomes:"):
            with self.subTest(field=field):
                self.assertIn(field, block)
        self.assertIn("mandatory even when there are no known limits", block)
        self.assertIn("unknown", block)

    def test_completion_requires_coverage_block_even_without_limits(self):
        text = (SKILL / "SKILL.md").read_text()
        completion = text.split("### 5. Draft the guided report", 1)[1].split("### 6.", 1)[0]
        self.assertIn("Completion:", completion)
        self.assertIn("mandatory Coverage limits block", completion)
        self.assertIn("even when none are known", completion)

    def test_feed_pagination_uses_discovery_not_invented_flags(self):
        text = (SKILL / "references/capabilities.md").read_text()
        block = text.split("## Pagination and bounded collection", 1)[1].split("\n## ", 1)[0]
        for clause in ("activity", "deployments", "observability", "schemas", "installed help",
                       "Do not invent pagination flags", "cursor", "Coverage limits"):
            self.assertIn(clause, block)

    def test_caps_and_failures_cannot_support_absence_claims(self):
        text = (SKILL / "references/capabilities.md").read_text()
        block = text.split("## Pagination and bounded collection", 1)[1].split("\n## ", 1)[0]
        for clause in ("100 records is not proof of completeness", "no usable cursor",
                       "partial bounded result after failure", "coverage gap",
                       "never a negative finding", "needs_confirmation"):
            self.assertIn(clause, block)


if __name__ == "__main__":
    unittest.main()
