"""Static privacy contracts; no screenshots, real accounts or customer data."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "skills" / "vercel-security-audit"


class BrowserPrivacyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.evidence = (ROOT / "references/browser-evidence.md").read_text()

    def test_required_reference_is_reachable_before_capture(self):
        for path in (ROOT / "SKILL.md", ROOT / "references/capabilities.md"):
            with self.subTest(path=path):
                self.assertIn("browser-evidence.md", path.read_text())
        self.assertTrue(self.evidence.startswith("# Browser evidence safety"))
        self.assertIn("before any browser navigation, reload, snapshot or screenshot", self.evidence)

    def test_screenshot_only_host_cannot_repair_post_exposure(self):
        for rule in (
            "full viewport cannot prefilter", "redact after saving is not a repair",
            "before content reaches the model, transcript, tool logs or disk",
            "navigation, reload, human takeover or tool completion",
            "Otherwise skip the page", "Text snapshots and accessibility trees",
        ):
            with self.subTest(rule=rule):
                self.assertIn(rule, self.evidence)

    def test_actual_page_classification_includes_high_risk_destinations(self):
        section = self.evidence.split("## Sensitive destinations", 1)[1].split("## Safe owner", 1)[0]
        for marker in (
            "IAM-01 / IAM-03", "Security Dashboard", "users and projects", "blanket safe",
            "CRE-01", "DEP-02", "SEC-01 / SEC-02", "CRE-02 / CRE-03",
            "shared-secret conditions", "actual page",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, section)
        self.assertIn("If sensitivity or behavior is unknown", self.evidence)

    def test_safe_questions_cover_all_core_ids(self):
        checklist = (ROOT / "references/checklist.md").read_text().split("## Optional deeper", 1)[0]
        ids = set(re.findall(r"^### ([A-Z]{3}-\d{2})", checklist, re.M))
        questions = self.evidence.split("## Safe owner-statement questions per check", 1)[1].split("## Accidental", 1)[0]
        self.assertEqual(set(re.findall(r"^- ([A-Z]{3}-\d{2}):", questions, re.M)), ids)
        for rule in ("aggregates, policy categories and synthetic aliases", "not screenshots",
                     "never browser observations", "Missing observed data stays unknown"):
            self.assertIn(rule, questions)

    def test_human_navigation_does_not_bypass_gate(self):
        for rule in ("does not authorise automatic model exposure", "without streaming",
                     "do not navigate or ask the owner to open it in the captured session"):
            self.assertIn(rule, self.evidence)

    def test_exposure_stops_collection_without_rereading_values(self):
        incident = self.evidence.split("## Accidental exposure:", 1)[1]
        for rule in (
            "stop all further collection immediately", "Do not re-read values", "OCR",
            "metadata only", "UTC time", "containment status", "without opening affected artifacts",
            "pause for user-directed incident handling", "separate approval",
            "renewed scope/privacy confirmation",
        ):
            with self.subTest(rule=rule):
                self.assertIn(rule, incident)


if __name__ == "__main__":
    unittest.main()
