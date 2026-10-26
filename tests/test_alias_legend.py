"""Owner-only reports may have a separate private alias legend (#51); offline document contract."""
from pathlib import Path
import unittest

SKILL = Path(__file__).resolve().parents[1] / "skills" / "vercel-security-audit"


class AliasLegendTests(unittest.TestCase):
    def setUp(self):
        text = (SKILL / "references" / "report-template.md").read_text()
        self.legend = text.split("## Private alias legend (optional)", 1)[1].split("\n## ", 1)[0]

    def test_legend_is_separate_and_never_rendered(self):
        for clause in ("Synthetic aliases stay mandatory in the report itself", "separate file",
                       "Never embed it in the Markdown, JSON model, HTML or PDF",
                       "never pass it to the renderer or QA script", "never overwrite an existing one",
                       "Do not share, attach or publish."):
            with self.subTest(clause=clause):
                self.assertIn(clause, self.legend)

    def test_legend_excludes_people_and_secrets(self):
        for clause in ("team, project, environment and domain aliases", "already returned by authorised inventory reads",
                       "Never include people", "credentials", "environment values"):
            with self.subTest(clause=clause):
                self.assertIn(clause, self.legend)

    def test_skill_links_the_legend_rules(self):
        step = (SKILL / "SKILL.md").read_text().split("### 5.", 1)[1].split("### 6.", 1)[0]
        self.assertIn("(references/report-template.md#private-alias-legend-optional)", step)
        self.assertIn("never part of the report", step)


if __name__ == "__main__":
    unittest.main()
