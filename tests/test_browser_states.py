"""Offline UI-state instruction contracts, not live DOM or browser tests."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "skills" / "vercel-security-audit"


class BrowserStateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playbook = (ROOT / "references/browser-evidence.md").read_text().split("## UI-state playbook", 1)[1]

    def test_state_playbook_is_linked_from_all_entry_points(self):
        for relative in ("SKILL.md", "references/capabilities.md", "references/checklist.md"):
            with self.subTest(relative=relative):
                self.assertIn("browser-evidence.md#ui-state-playbook", (ROOT / relative).read_text())

    def test_read_only_semantics_and_ambiguity_rules(self):
        for rule in (
            "aria-checked", "current `checked` property", "input type", "accessible label",
            "initial default rather than current state", 'aria-checked="mixed"',
            "Never click or toggle to discover state", "Color alone is not enabled-state proof",
            "disabled attribute describes interactivity", "unknown/needs_confirmation",
            "current published policy", "Role icons", "not scope enumeration",
        ):
            with self.subTest(rule=rule):
                self.assertIn(rule, self.playbook)

    def test_loading_is_bounded_by_capability_and_single_safe_reload(self):
        loading = self.playbook.split("### Loading, missing controls and navigation", 1)[1].split("### Per-check", 1)[0]
        for rule in (
            "bounded wait", "verified host capabilities", "not a blanket 30-second sleep",
            "no safe wait/readiness capability", "at most one safe reload",
            "no form change", "no unsaved input", "no submission in progress",
            "read-only reload", "privacy gate", "Check identity/team again",
            "still-pending Loading state becomes needs_confirmation", "Do not loop",
        ):
            with self.subTest(rule=rule):
                self.assertIn(rule, loading)

    def test_missing_is_unknown_not_disabled_or_guessed_route(self):
        for rule in (
            "404 or unavailable feature is not a disabled setting", "not_reviewed",
            "Follow the observed Rules view", "do not guess `/firewall/config`",
            "not_applicable or action_recommended", "not permission to open an unknown sensitive destination",
        ):
            with self.subTest(rule=rule):
                self.assertIn(rule, self.playbook)

    def test_per_id_interpretation_and_attack_mode_context(self):
        section = self.playbook.split("### Per-check interpretation", 1)[1].split("### Minimal state record", 1)[0]
        for check in ("IAM-02", "SEC-01", "OPS-01 / OPS-02 / OPS-03", "CRE-01", "DOM-02", "FWB-01", "FWB-02"):
            with self.subTest(check=check):
                self.assertIn(f"- {check}:", section)
        for rule in (
            "enrolment from enforcement", "SAML configuration from enforcement",
            "never send a test notification", "never reveal/copy token values",
            "no active TLS scan", "Attack Mode context", "Off alone is not a finding",
            "Never toggle Attack Mode", "not conflate Attack Mode",
        ):
            with self.subTest(rule=rule):
                self.assertIn(rule, section)

    def test_candidate_labels_and_minimal_records_do_not_claim_live_ui(self):
        for rule in (
            "candidate labels", "not official/current control names", "host-capability-based",
            "safe Control label", "scope aliases", "nonce IDs", "No secret belongs in the record",
            "A statement and an observed state are separate evidence entries",
        ):
            with self.subTest(rule=rule):
                self.assertIn(rule, self.playbook)


if __name__ == "__main__":
    unittest.main()
