"""Navigation map lists the OPS/SEC destinations without guessed routes (#52)."""
from pathlib import Path
import re
import unittest

REFS = Path(__file__).resolve().parents[1] / "skills" / "vercel-security-audit" / "references"


class NavigationMapTests(unittest.TestCase):
    def setUp(self):
        text = (REFS / "capabilities.md").read_text()
        self.map = text.split("## Browser navigation map", 1)[1].split("\n## ", 1)[0]

    def test_drains_alerts_and_notifications_are_listed_with_checks(self):
        for entry, checks in (("Drains", ("SEC-03", "OPS-02")), ("Alerts", ("OPS-01",)),
                              ("Notifications", ("OPS-01",))):
            line = re.search(rf"^- {entry} \(([^)]*)\): (.+)$", self.map, re.M)
            with self.subTest(entry=entry):
                self.assertIsNotNone(line)
                for check in checks:
                    self.assertIn(check, line.group(1))
                self.assertIn("use observed team Settings navigation", line.group(2))
                self.assertNotIn("/~/", line.group(2), "routes are not verified; do not guess them")

    def test_entries_keep_selection_limits(self):
        self.assertIn("select destination type, enabled state and scope only", self.map)
        self.assertIn("never recipient addresses or webhook URLs", self.map)
        self.assertIn("do not treat one person's preferences as team coverage", self.map)


if __name__ == "__main__":
    unittest.main()
