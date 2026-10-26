"""The UI-state playbook covers client-side tabs (#50); offline document contract."""
from pathlib import Path
import unittest

REFS = Path(__file__).resolve().parents[1] / "skills" / "vercel-security-audit" / "references"


class TabbedViewTests(unittest.TestCase):
    def test_tab_switch_must_be_confirmed_before_reading(self):
        text = (REFS / "browser-evidence.md").read_text()
        playbook = text.split("## UI-state playbook", 1)[1]
        tabs = playbook.split("### Tabs and client-side views", 1)[1].split("\n### ", 1)[0]
        for clause in ('aria-selected="true"', 'role="tabpanel"', "privacy gate before selecting it",
                       "Each panel is its own destination", "record needs_confirmation",
                       "Never attribute the previous panel's content", "do not retry by clicking repeatedly"):
            with self.subTest(clause=clause):
                self.assertIn(clause, tabs)
        self.assertLess(playbook.index("### Tabs and client-side views"), playbook.index("### Per-check interpretation"))


if __name__ == "__main__":
    unittest.main()
