"""Offline contracts for required report components; no model or account is used."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "vercel-security-audit"
TEMPLATE = SKILL / "references" / "report-template.md"
EXAMPLE = ROOT / "examples" / "security-audit.md"


def components():
    text = TEMPLATE.read_text(encoding="utf-8")
    return text.split("\n## Required components\n", 1)[1].split("\n## ", 1)[0]


class RequiredComponentsTests(unittest.TestCase):
    def test_template_layout_is_one_example_of_the_contract(self):
        text = TEMPLATE.read_text(encoding="utf-8")
        intro = text.split("\n## ", 1)[0]
        self.assertIn("one example that satisfies the [required components](#required-components)", intro)
        self.assertIn("not this exact layout", intro)
        self.assertEqual(text.count("\n## Required components\n"), 1)

    def test_mandatory_components_are_enumerated_with_fixed_rules(self):
        block = components()
        mandatory = block.split("Mandatory components and their fixed rules:", 1)[1].split("Flexible,", 1)[0]
        names = re.findall(r"^\d+\. ([A-Z][^:]+):", mandatory, re.M)
        self.assertEqual(names, [
            "Title", "Status matrix", "Review summary", "Initial priorities", "Confirmed strengths",
            "Scope and limitations", "Optional scope decisions", "Coverage limits", "Actions",
            "Follow-up", "Owner confirmation questionnaire", "Appendix check outcomes", "Disclaimers"])
        for rule in ("at most three", "numbered single-action steps", "`Done when`",
                     "present even when no limits are known", "all three question groups",
                     "exactly once", "exactly one `Status:` line", "headings begin `Appendix`",
                     "separate core and optional status counts", "`Changes made: none`"):
            with self.subTest(rule=rule):
                self.assertIn(rule, mandatory)

    def test_flexibility_is_bounded(self):
        block = components()
        flexible = block.split("Flexible, provided the fixed rules hold:", 1)[1]
        for phrase in ("Order of components 5 to 11", "exactly `Recommendations`", "Grouping matrix rows by domain",
                       "collapsing several checks into one matrix cell",
                       "`Initial priorities`", "beginning `Appendix` are counted",
                       "Not allowed in any layout", "dropping or hiding a mandatory component",
                       "merging core and optional counts"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, flexible)

    def test_status_matrix_opens_the_report_with_the_five_existing_statuses(self):
        text = TEMPLATE.read_text(encoding="utf-8")
        headings = re.findall(r"^## (.+)$", text, re.M)
        self.assertEqual(headings[:2], ["Status at a glance", "Review summary"])
        matrix = text.split("## Status at a glance", 1)[1].split("\n## ", 1)[0]
        for phrase in ("| Check | Team | [project alias]", "| Optional check | Team |",
                       "`satisfactory`, `action_recommended`, `needs_confirmation`, `not_reviewed` or `not_applicable`",
                       "Do not use pass, warning, fail", "Team-wide", "By project",
                       "authoritative, counted outcome", "must not show a better result than the appendix supports"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, matrix)
        mandatory = components().split("Flexible,", 1)[0]
        self.assertIn("2. Status matrix: opens the report", mandatory)
        self.assertIn("never pass, warning or fail", mandatory)
        self.assertIn("its badges are not counted as outcomes", mandatory)
        summary = text.split("## Review summary", 1)[1].split("\n## ", 1)[0]
        self.assertIn("short and in plain language", summary)
        self.assertIn("technical detail to the appendix", summary)

    def test_example_matrix_opens_report_and_agrees_with_the_appendix(self):
        text = EXAMPLE.read_text(encoding="utf-8")
        self.assertEqual(re.findall(r"^## (.+)$", text, re.M)[:2], ["Status at a glance", "Review summary"])
        matrix = text.split("## Status at a glance", 1)[1].split("\n## ", 1)[0]
        appendix = dict(re.findall(r"^### ([A-Z]{3}-\d{2}) - .+\nStatus: ([a-z_]+)$", text, re.M))
        self.assertEqual(len(appendix), 28)
        rows = {}
        for line in matrix.splitlines():
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if re.match(r"[A-Z]{3}-\d{2} ", cells[0]):
                rows[cells[0][:6]] = cells[1:]
        self.assertEqual(set(rows), set(appendix))
        statuses = set(appendix.values())
        for identifier, cells in rows.items():
            with self.subTest(check=identifier):
                self.assertEqual(len(cells), 3)
                if cells[0] == "By project":
                    self.assertEqual(set(cells[1:]), {appendix[identifier]})
                else:
                    self.assertEqual(cells, [appendix[identifier], "Team-wide", "Team-wide"])
                self.assertTrue(set(cells) <= statuses | {"By project", "Team-wide"})

    def test_skill_step_five_treats_template_as_contract_plus_example(self):
        text = (SKILL / "SKILL.md").read_text(encoding="utf-8")
        step = text.split("### 5. Draft the guided report", 1)[1].split("\n### ", 1)[0]
        self.assertIn("required components are the contract and its layout is one example", step)
        self.assertIn("Open with the status matrix", step)
        self.assertIn("keep technical detail in the appendix", step)

    def test_repository_example_satisfies_mandatory_components_in_its_own_layout(self):
        text = EXAMPLE.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("# "))
        for marker in ("## Review summary", "Changes made: none", "Core checks (24):",
                       "Optional checks (4, kept separate):", "not a penetration test",
                       "## Initial priorities", "## Confirmed strengths", "### Optional scope decisions",
                       "## Coverage limits", "## Recommendations", "**Done when:**",
                       "## Appendix: required core checks", "### Owner confirmation questionnaire",
                       "Community-maintained, unofficial", "nothing has been published or sent"):
            with self.subTest(marker=marker):
                self.assertIn(marker, text)
        for identifier in ("DEP-04", "SRC-04", "SEC-04", "OPS-04"):
            self.assertIn("- " + identifier + " - ", text)
        questionnaire = text.split("### Owner confirmation questionnaire", 1)[1]
        for identifier in ("CRE-01", "IAM-02", "OPS-01"):
            self.assertIn("- " + identifier + " - ", questionnaire)
        priorities = text.split("## Initial priorities", 1)[1].split("\n## ", 1)[0]
        self.assertLessEqual(len(re.findall(r"^\d+\. ", priorities, re.M)), 3)

    def test_counter_test_is_documented_as_not_yet_run(self):
        text = (ROOT / "evals" / "scenarios.md").read_text(encoding="utf-8")
        scenario = text.split("## 13. Unformatted counter-test for report components", 1)[1].split("\n## ", 1)[0]
        for phrase in ("Not yet run", "no report format, template or component list",
                       "same evidence", "Neither arm reads the account again",
                       "stay mandatory", "are relaxed", "Pass:"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, scenario)


if __name__ == "__main__":
    unittest.main()
