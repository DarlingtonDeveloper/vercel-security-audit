"""Offline packaging/content checks. These do not test an agent or a live account."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills" / "vercel-security-audit"
SKILL = SKILL_DIR / "SKILL.md"


class DocsDriftTests(unittest.TestCase):
    """README and SKILL.md agree with the shipped tree and with each other (#82)."""

    @classmethod
    def setUpClass(cls):
        cls.readme = (ROOT / "README.md").read_text(encoding="utf-8")
        cls.files = cls.readme.split("## Files\n", 1)[1].split("\n## ", 1)[0]
        cls.skill = SKILL.read_text(encoding="utf-8")

    def test_every_skill_file_and_test_is_listed(self):
        shipped = [path for path in SKILL_DIR.rglob("*")
                   if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc"]
        self.assertGreater(len(shipped), 20)
        for path in shipped:
            with self.subTest(path=path.name):
                self.assertIn(path.relative_to(ROOT).as_posix(), self.files)
        for path in (ROOT / "tests").glob("test_*.py"):
            with self.subTest(test=path.name):
                self.assertIn(f"`{path.name}`", self.files)

    def test_changelog_exists(self):
        changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertTrue(changelog.startswith("# Changelog"))
        for number in (54, 76, 92, 102):
            self.assertIn(f"#{number}", changelog)

    def test_python_requirement_agrees(self):
        for text in (self.readme, self.skill):
            self.assertIn("`scripts/cli_read.py`", text)
        self.assertIn("Python 3 (standard library only) for any CLI-based audit", self.readme)
        self.assertIn("Python 3 and the readable bundled `scripts/cli_read.py` are required", self.skill)
        self.assertNotIn("Python and a report-export browser are optional", self.readme)
        self.assertNotIn("the renderer, Python 3 or a report-export browser", self.skill)
        self.assertNotIn("Startup must read all four references", self.readme)
        self.assertIn("asks for scope first", self.readme)

    def test_skill_asks_for_scope_and_reads_the_checklist_once(self):
        self.assertEqual(self.skill.count("Ask for scope first"), 1)
        self.assertEqual(self.skill.count("Ask for the team slug first"), 1)
        self.assertEqual(self.skill.count("the complete [checklist](references/checklist.md)"), 1)
        self.assertNotIn("Read the complete [checklist]", self.skill)


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

    def skill_texts(self):
        for file in SKILL_DIR.rglob("*"):
            if file.is_file() and file.suffix not in {".woff2", ".pyc"} and "__pycache__" not in file.parts:
                yield file, file.read_text().lower()

    def test_public_skill_has_no_local_paths(self):
        for file, text in self.skill_texts():
            self.assertNotRegex(text, r"(?:/users/|/home/)[a-z0-9_-]+/", file.name)

    def test_public_skill_has_no_internal_sources(self):
        """Internal names are kept out of the public repo in a gitignored, maintainer-only list.

        Create tests/private-markers.txt with one name per line (lines starting with # are
        comments). Without it, this check is skipped, so it runs only where that file exists.
        """
        markers_file = ROOT / "tests" / "private-markers.txt"
        if not markers_file.is_file():
            self.skipTest("tests/private-markers.txt not present; internal-name check runs only for maintainers")
        markers = [line.strip().lower() for line in markers_file.read_text(encoding="utf-8").splitlines()
                   if line.strip() and not line.lstrip().startswith("#")]
        self.assertTrue(markers, "tests/private-markers.txt has no entries")
        for file, text in self.skill_texts():
            for index, marker in enumerate(markers, 1):
                # assertFalse, not assertNotIn: the failure shows only this message (the entry
                # number), never the name or the file text.
                self.assertFalse(marker in text, f"{file.name}: private marker entry {index} found")

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
            "--version", "whoami", "teams list", "security check", "project ls", "firewall status",
            "firewall overview", "firewall rules list", "firewall system-bypass list",
            "firewall bot-management", "firewall traffic list", "firewall alerts list",
            "activity", "webhooks list", "integration list", "domains list",
        )
        # Only help and version run directly; account reads run through the bundled reader (#32).
        direct = re.findall(r"^vercel (.+)$", text, re.M)
        self.assertGreaterEqual(len(direct), 6)
        for command in direct:
            self.assertTrue(command == "--version" or command.endswith(" --help"), command)
        mapped = re.findall(r"^[a-z-]+ +vercel (.+)$", text, re.M)
        self.assertGreaterEqual(len(mapped), 14)
        for command in direct + mapped:
            self.assertTrue(any(command == item or command.startswith(item + " ") for item in allowed), command)
            self.assertNotRegex(command, r"(?:^|\s)(?:--token|-t|--debug|-d|--yes)(?:\s|$)")
            self.assertNotIn("vercel api", command)
        self.assertIn("Never run a documented account read directly", text)

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

    def test_tables_use_only_the_bounded_renderer_grammar_and_fences_balance(self):
        # Pipe tables are supported (status matrix); every pipe line must belong to a
        # header + separator + rows block with consistent widths, so nothing that
        # looks like a table silently renders as paragraph text.
        separator = re.compile(r"\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+")
        for file in ROOT.rglob("*.md"):
            lines = file.read_text().splitlines()
            self.assertEqual(sum(line.startswith("```") for line in lines) % 2, 0, str(file))
            fenced, block, blocks = False, [], []
            for line in lines + [""]:
                if line.startswith("```"):
                    fenced = not fenced
                if not fenced and line.startswith("|"):
                    block.append(line)
                    continue
                if block:
                    blocks.append(block)
                    block = []
            for block in blocks:
                with self.subTest(file=file.name, header=block[0][:40]):
                    self.assertGreaterEqual(len(block), 3)
                    self.assertRegex(block[1], separator)
                    widths = {len(re.split(r"(?<!\\)\|", row.strip())) for row in block}
                    self.assertTrue(all(row.rstrip().endswith("|") for row in block))
                    self.assertEqual(len(widths), 1)


if __name__ == "__main__":
    unittest.main()
