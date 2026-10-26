"""Agree the team slug before any account read; never list every team (#35)."""
from pathlib import Path
import re
import unittest

SKILL_DIR = Path(__file__).resolve().parents[1] / "skills" / "vercel-security-audit"
SKILL = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
CAPABILITIES = (SKILL_DIR / "references" / "capabilities.md").read_text(encoding="utf-8")


class TeamFirstTests(unittest.TestCase):
    def test_slug_is_asked_before_account_reads(self):
        self.assertIn("Ask for the team slug first", SKILL)
        self.assertIn("Ask for the team slug before any account read", CAPABILITIES)
        self.assertIn("copy it from their own dashboard URL", SKILL)

    def test_membership_is_confirmed_for_the_agreed_team_only(self):
        self.assertIn("`team-check` read", SKILL)
        self.assertIn('cli_read.py" team-check --scope "$team_slug"', CAPABILITIES)
        self.assertIn("other teams are never printed or counted", CAPABILITIES)

    def test_teams_list_is_never_run_directly(self):
        self.assertIn("Never run `vercel teams list` directly", SKILL)
        self.assertIsNone(re.search(r"^vercel teams list", CAPABILITIES, re.M))
        self.assertNotIn("discover permitted teams", SKILL)


if __name__ == "__main__":
    unittest.main()
