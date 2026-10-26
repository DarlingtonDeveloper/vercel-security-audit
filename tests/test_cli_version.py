"""CLI version guidance: recommend updating, never force it, and record missing commands as gaps (#37)."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = ROOT / "skills" / "vercel-security-audit"
CAPABILITIES = (SKILL_DIR / "references" / "capabilities.md").read_text(encoding="utf-8")
SKILL = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
README = (ROOT / "README.md").read_text(encoding="utf-8")


class CLIVersionTests(unittest.TestCase):
    def test_minimum_tested_version_is_stated_in_readme_and_capabilities(self):
        for text in (README, CAPABILITIES):
            self.assertIn("Minimum tested CLI version: 62.7.0", text)
            self.assertIn("54.18.0", text)

    def test_update_is_recommended_not_forced(self):
        self.assertIn("vercel --version", CAPABILITIES)
        self.assertIn("This is guidance, not a requirement", CAPABILITIES)
        self.assertIn("do not install, upgrade or download the CLI yourself", CAPABILITIES)
        self.assertIn("recommend, without forcing", SKILL)

    def test_missing_security_command_is_a_recorded_gap(self):
        self.assertIn('"upgrade the CLI" note', CAPABILITIES)
        self.assertIn("Do not retry, guess equivalent commands", CAPABILITIES)
        self.assertIn('unknown `security` subcommand is a recorded capability gap', SKILL)
        self.assertIn("#cli-version", SKILL)


if __name__ == "__main__":
    unittest.main()
