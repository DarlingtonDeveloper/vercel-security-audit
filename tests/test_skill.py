"""Offline packaging/content checks. These do not test an agent or a live account."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills" / "vercel-security-audit"
SKILL = SKILL_DIR / "SKILL.md"


class PublicSkillTests(unittest.TestCase):
    def test_portable_frontmatter(self):
        text = SKILL.read_text()
        frontmatter = text.split("---", 2)[1]
        fields = dict(re.findall(r"^(name|description): (.+)$", frontmatter, re.M))
        self.assertEqual(fields["name"], "vercel-security-audit")
        self.assertGreater(len(fields["description"]), 40)
        self.assertLess(len(fields["description"]), 1024)
        self.assertNotIn("allowed-tools:", frontmatter)
        self.assertNotIn("context:", frontmatter)
        self.assertNotIn("hooks:", frontmatter)

    def test_relative_reference_links_resolve(self):
        for file in SKILL_DIR.rglob("*.md"):
            for target in re.findall(r"\]\(([^)]+)\)", file.read_text()):
                if target.startswith(("https://", "http://", "#")):
                    continue
                resolved = (file.parent / target.split("#", 1)[0]).resolve()
                self.assertTrue(resolved.is_relative_to(SKILL_DIR.resolve()), target)
                self.assertTrue(resolved.is_file(), target)

    def test_required_resources_exist(self):
        for name in ("capabilities.md", "checklist.md", "report-template.md"):
            self.assertTrue((SKILL_DIR / "references" / name).is_file())

    def test_core_checklist_is_complete_and_unique(self):
        text = (SKILL_DIR / "references" / "checklist.md").read_text()
        core, optional = text.split("## Optional deeper", 1)
        core_ids = re.findall(r"^### ([A-Z]{3}-\d{2})", core, re.M)
        optional_ids = re.findall(r"^### ([A-Z]{3}-\d{2})", optional, re.M)
        self.assertEqual(len(core_ids), 24)
        self.assertEqual(len(optional_ids), 4)
        self.assertEqual(len(set(core_ids + optional_ids)), 28)
        self.assertEqual(len(re.findall(r"^## Required core:", core, re.M)), 8)
        for section in re.split(r"^### ", text, flags=re.M)[1:]:
            for label in ("Primary read source:", "Evidence needed:", "Cannot infer:"):
                self.assertIn(label, section)

    def test_all_result_states_are_defined(self):
        text = SKILL.read_text()
        for state in ("satisfactory", "action_recommended", "needs_confirmation", "not_reviewed", "not_applicable"):
            self.assertIn(f"- {state}:", text)

    def test_runtime_dependencies_are_capability_based(self):
        text = (ROOT / "README.md").read_text()
        self.assertIn("Grokbot: not established", text)
        self.assertIn("Live execution has not been tested", text)
        self.assertIn("does not need desktop control", text)
        self.assertIn("and/or an installed Vercel CLI", text)

    def test_public_skill_has_no_internal_sources_or_customer_data(self):
        forbidden = (
            "admin.vercel.com", "support-session", "vertex.vercel.systems", "VERTEX_JWT",
            "clickstate", "vercel.slack.com", "shareableToken",
        )
        for file in SKILL_DIR.rglob("*"):
            if not file.is_file() or file.suffix in {".woff2", ".pyc"}:
                continue
            text = file.read_text().lower()
            for marker in forbidden:
                self.assertNotIn(marker.lower(), text, f"{file.name}: {marker}")
            self.assertNotRegex(text, r"(?:/users/|/home/)[a-z0-9_-]+/")

    def test_review_is_read_only_and_has_a_handoff(self):
        text = SKILL.read_text()
        self.assertIn("never stages or applies configuration changes", text)
        self.assertIn("A Log-mode firewall rule is still a configuration change", text)
        self.assertIn("Stop on MFA, device-policy or permission blocks", text)
        self.assertIn("approval of the exact destination and final content", text)
        self.assertIn("do not automatically fix findings", text)

    def test_sensitive_browser_views_require_pre_exposure_selection(self):
        text = SKILL.read_text()
        self.assertIn("before any page text or image reaches the model", text)
        self.assertIn("do not automate sensitive member, credential or environment views", text)
        self.assertIn("Skill instructions alone do not implement a safe collector", text)

    def test_team_wide_reads_need_distinct_authorisation(self):
        text = SKILL.read_text()
        self.assertIn("team-wide inventory and configuration reads separately", text)
        self.assertIn("filtering after collection cannot repair an authorisation gap", text)

    def test_capability_command_examples_are_inspection_only(self):
        text = (SKILL_DIR / "references" / "capabilities.md").read_text()
        allowed = (
            "whoami", "teams list", "security check", "project ls", "firewall status",
            "firewall overview", "firewall rules list", "firewall system-bypass list",
            "firewall bot-management", "firewall traffic list", "firewall alerts list",
            "activity", "webhooks list", "integration list", "domains list",
        )
        commands = re.findall(r"^vercel (.+)$", text, re.M)
        self.assertGreaterEqual(len(commands), 12)
        for command in commands:
            self.assertTrue(any(command == item or command.startswith(item + " ") for item in allowed), command)
            self.assertNotRegex(command, r"(?:^|\s)(?:--token|-t|--debug|-d|--yes)(?:\s|$)")
            self.assertNotIn("vercel api", command)
        self.assertIn("before exposing it to the model or saving it", text)

    def test_report_json_example_is_synthetic_and_valid(self):
        text = (SKILL_DIR / "references" / "report-template.md").read_text()
        blocks = re.findall(r"```json\n(.*?)\n```", text, re.S)
        self.assertEqual(len(blocks), 1)
        example = json.loads(blocks[0])
        self.assertEqual(example["scope_alias"], "example-team")
        self.assertEqual(example["status"], "needs_confirmation")
        self.assertNotIn("token", example)

    def test_report_contains_guided_action_fields(self):
        text = (SKILL_DIR / "references" / "report-template.md").read_text()
        for label in ("Benefit:", "Who:", "Before changing:", "Where to start:", "Done when:", "Impact / rollback:", "Docs:"):
            self.assertIn(label, text)
        self.assertIn("at most three", text)
        self.assertIn("PDF is optional", text)

    def test_behaviour_scenarios_are_explicitly_unexecuted(self):
        text = (ROOT / "evals" / "scenarios.md").read_text()
        self.assertIn("not executed model or host tests", text)
        self.assertEqual(len(re.findall(r"^## \d+\.", text, re.M)), 13)
        self.assertEqual(text.count("Pass:"), 13)

    def test_no_tables_or_unbalanced_fences(self):
        for file in ROOT.rglob("*.md"):
            text = file.read_text()
            self.assertFalse(any(line.startswith("|") for line in text.splitlines()), str(file))
            self.assertEqual(sum(line.startswith("```") for line in text.splitlines()) % 2, 0, str(file))


if __name__ == "__main__":
    unittest.main()
