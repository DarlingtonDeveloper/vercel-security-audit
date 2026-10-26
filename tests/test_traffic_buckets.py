"""Bucketed traffic windows are recorded as returned, not as requested (#48)."""
from pathlib import Path
import unittest

REFS = Path(__file__).resolve().parents[1] / "skills" / "vercel-security-audit" / "references"


class TrafficBucketTests(unittest.TestCase):
    def test_capabilities_explain_bucket_boundaries(self):
        text = (REFS / "capabilities.md").read_text()
        for clause in ("traffic list aggregates into time buckets", "returned period start and end",
                       "not the requested relative window", "explicit ISO 8601 --since and --until",
                       "record it as unknown"):
            with self.subTest(clause=clause):
                self.assertIn(clause, text)

    def test_coverage_window_field_uses_returned_period(self):
        text = (REFS / "report-template.md").read_text()
        block = text.split("## Coverage limits", 1)[1].split("\n## ", 1)[0]
        self.assertIn("using the returned period for bucketed feeds", block)
        self.assertIn("bucket size", block)


if __name__ == "__main__":
    unittest.main()
