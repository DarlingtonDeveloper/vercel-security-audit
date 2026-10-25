"""Offline install documentation and relocated-bundle checks, not live host tests."""
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills" / "vercel-security-audit"
SOURCE = "DarlingtonDeveloper/vercel-security-audit"


class InstallDocumentationTests(unittest.TestCase):
    def test_project_global_and_agent_specific_commands(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        commands = [shlex.split(line) for line in readme.splitlines()
                    if line.startswith("npx skills add ")]
        base = ["npx", "skills", "add", SOURCE, "--skill", "vercel-security-audit"]
        for command in (base, base + ["--agent", "eve"], base + ["--global"],
                        base + ["--global", "--agent", "grok"]):
            with self.subTest(command=command):
                self.assertIn(command, commands)
        self.assertIn(["npx", "skills", "add", SOURCE, "--list"], commands)
        for command in commands:
            self.assertFalse("--global" in command and "eve" in command,
                             "Eve has no global install target in the verified CLI source")
        self.assertIn("does not support global", readme)
        self.assertIn("https://github.com/vercel-labs/skills/blob/", readme)

    def test_manual_central_install_preserves_the_whole_bundle(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        heading = "### Manual central agent-library install\n"
        self.assertIn(heading, readme)
        section = readme.split(heading, 1)[1].split("\n### ", 1)[0]
        self.assertIn("host-configured", section)
        self.assertIn("cp -R skills/vercel-security-audit ", section)
        self.assertIn('test ! -e "$skill_library/vercel-security-audit"', section)
        self.assertIn("not just SKILL.md", section)
        for resource in ("references/", "scripts/", "assets/", "assets/fonts/"):
            with self.subTest(resource=resource):
                self.assertIn(resource, section)


class InstallIntegrityTests(unittest.TestCase):
    def startup(self):
        text = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        heading = "## Startup: installation integrity\n"
        self.assertTrue(heading in text, "Missing startup installation integrity preflight")
        self.assertLess(text.index(heading), text.index("## Process\n"))
        return text.split(heading, 1)[1].split("\n## ", 1)[0]

    def test_startup_reads_all_four_essential_references_before_account_reads(self):
        startup = self.startup()
        references = set(re.findall(r"\]\((references/[^)]+)\)", startup))
        self.assertEqual(references, {
            "references/capabilities.md", "references/checklist.md",
            "references/report-template.md", "references/report-design.md",
        })
        for reference in references:
            self.assertTrue((SKILL_DIR / reference).is_file(), reference)
        for instruction in ("Read all four essential references in full", "missing or unreadable",
                            "stop before account reads", "Installation integrity error",
                            "complete skill directory", "host's actual skill location",
                            "not the current project or working directory"):
            self.assertIn(instruction, startup)

    def test_export_preflight_is_optional_and_keeps_markdown_on_missing_helpers(self):
        startup = self.startup()
        condition = "Only for styled HTML/PDF export"
        self.assertTrue(condition in startup, "Export dependencies need a conditional preflight")
        export = startup.split(condition, 1)[1]
        for resource in ("scripts/render_report.py", "assets/report.html", "assets/report.css",
                         "assets/fonts/Geist-Regular.woff2", "assets/fonts/Geist-SemiBold.woff2",
                         "assets/fonts/GeistMono-Regular.woff2", "assets/fonts/OFL.txt",
                         "assets/fonts/LICENSE.txt"):
            with self.subTest(resource=resource):
                self.assertIn(f"`{resource}`", export)
                self.assertTrue((SKILL_DIR / resource).is_file(), resource)
        for instruction in ("Markdown-only audits do not require", "Python 3",
                            "report-export browser", "warn", "keep `security-audit.md`",
                            "not an audit failure", "Do not install packages"):
            self.assertIn(instruction, export)


class RelocatedBundleTests(unittest.TestCase):
    def test_complete_bundle_renders_from_each_install_location_not_cwd(self):
        # Arbitrary fixture locations, not claims about any host's loader paths.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cwd = root / "unrelated-working-directory"
            (cwd / "assets").mkdir(parents=True)
            (cwd / "assets" / "report.html").write_text("Not the skill template.")
            source = root / "synthetic.md"
            markdown = b"# Install relocation check\n\n## Summary\nSynthetic evidence only.\n"
            source.write_bytes(markdown)
            for location in ("project install", "global install", "central agent-library"):
                with self.subTest(location=location):
                    installed = root / location / "vercel-security-audit"
                    shutil.copytree(SKILL_DIR, installed, ignore=shutil.ignore_patterns("__pycache__"))
                    text = (installed / "SKILL.md").read_text(encoding="utf-8")
                    for reference in re.findall(r"\]\((references/[^)]+)\)", text):
                        self.assertTrue((installed / reference.split("#", 1)[0]).is_file(), reference)
                    output = root / (location + ".html")
                    result = subprocess.run(
                        [sys.executable, "-B", str(installed / "scripts" / "render_report.py"),
                         str(source), "-o", str(output)],
                        cwd=cwd, capture_output=True, text=True, encoding="utf-8",
                        timeout=20, check=False,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stderr, "")
                    document = output.read_text(encoding="utf-8")
                    self.assertIn("<title>Install relocation check</title>", document)
                    self.assertEqual(document.count("@font-face{"), 3)
                    self.assertIn("SIL OPEN FONT LICENSE Version 1.1", document)
                    self.assertEqual(source.read_bytes(), markdown)


if __name__ == "__main__":
    unittest.main()
