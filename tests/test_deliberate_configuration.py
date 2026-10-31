"""Offline contracts for codebase intent checks and owner-accepted settings (issue #41)."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/vercel-security-audit"
SCRIPT = SKILL / "scripts/manage_report.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("report_model_accepted", SCRIPT)
MODEL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODEL)


def section(text, start, end):
    return text.split(start, 1)[1].split(end, 1)[0]


def entry(identifier, source_kind, observed_at="2026-10-25T12:00:00Z", observed="Synthetic setting."):
    return {"id": identifier, "observed_at": observed_at, "source_kind": source_kind,
            "source_description": "Synthetic " + source_kind + " record", "scope_alias": "example-project",
            "observed": observed, "limitation": "Synthetic fixture; no account or repository was read."}


def accepted_report():
    report = MODEL.new_report("example-team", "Synthetic configuration review")
    patch = {"expected_revision": 1, "checks": [{
        "id": "DEP-01", "status": "needs_confirmation", "statement": "Preview protection is off by design.",
        "rationale": "Owner accepted public previews; no change is proposed.",
        "evidence_log": [entry("ev-dep-01", "browser"),
                         entry("ev-dep-02", "source_review", "2026-10-25T12:05:00Z", "Config file sets the observed state."),
                         entry("ev-dep-03", "owner_statement", "2026-10-25T12:10:00Z",
                               "Previews are public marketing builds; Team Owner role accepted this.")]}]}
    report = MODEL.append_evidence(report, patch)
    report["review_summary"]["owner_accepted"] = [{"check_id": "DEP-01", "evidence_ref": "ev-dep-03"}]
    MODEL.validate_report(report)
    return report


class GuidanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        skill = (SKILL / "SKILL.md").read_text()
        cls.step4 = section(skill, "#### Check the codebase before flagging deliberate configuration",
                            "#### Inline owner round")
        cls.policy = section((SKILL / "references/evidence-assessment.md").read_text(),
                             "## Deliberate configuration and owner acceptance", "\n## ")

    def test_codebase_check_precedes_owner_round_and_drafting(self):
        skill = (SKILL / "SKILL.md").read_text()
        self.assertLess(skill.index("#### Check the codebase"), skill.index("#### Inline owner round"))
        self.assertLess(skill.index("#### Inline owner round"), skill.index("### 5. Draft"))

    def test_read_needs_confirmed_repository_and_explicit_agreement(self):
        for clause in ("owner-controlled and is the source of an in-scope project alias",
                       "An open workspace, or a matching repository or organisation name, does not establish this",
                       "explicitly agreed to a config-intent read", "No answer, or a noninteractive host without prior agreement, means no read",
                       "covers only its own ID and does not count"):
            self.assertIn(clause, self.step4)

    def test_read_is_limited_to_named_config_files(self):
        for clause in ("current local working tree", "`vercel.json`", "`next.config.*`", "`middleware.*`",
                       "Never read `.env*` files", "Git history", "Do not run repository commands",
                       "DEP-04, SRC-04, SEC-04 and OPS-04", "Do not quote or record a secret-looking value"):
            self.assertIn(clause, self.step4)

    def test_config_intent_read_is_a_named_gate_exception(self):
        gate = section((SKILL / "references/capabilities.md").read_text(),
                       "## What counts as field selection before exposure", "\n## ")
        exception = section(gate, "One named exception", "These do not count")
        for clause in ("Config-intent read", "confirm that the listed files contain no inline secrets",
                       "Without it, there is no read", "stop the read at once",
                       "(browser-evidence.md#accidental-exposure-stop-and-hand-off)", "never covers `.env*` files",
                       "chosen over a bundled config parser (issue #80)"):
            self.assertIn(clause, exception)
        for clause in ("contain no inline secrets", "No confirmation means no read",
                       "one named exception to the pre-exposure gate",
                       "(references/browser-evidence.md#accidental-exposure-stop-and-hand-off) as a secret exposure"):
            self.assertIn(clause, self.step4)

    def test_intent_is_not_acceptance_and_no_new_status(self):
        for clause in ("`source_review` evidence", "Source-code evidence of intent is not owner acceptance",
                       "stays needs_confirmation with the reason and date recorded",
                       "out of the initial priorities and recommendations", "There is no separate accepted status",
                       "codebase intent not checked"):
            self.assertIn(clause, self.step4)
        for clause in ("does not show that anyone accepted the risk", "silence are not acceptance",
                       "The check stays needs_confirmation", "There is no separate accepted status",
                       "Remove it from the initial priorities and recommendations",
                       "never accepts a risk on the owner's behalf", "A reason without a statement time or role"):
            self.assertIn(clause, self.policy)
        text = (SKILL / "SKILL.md").read_text()
        states = [line for line in text.splitlines() if line.startswith("- ") and line.split(":")[0][2:] in MODEL.STATUSES]
        self.assertEqual(len(states), 5)

    def test_template_moves_accepted_settings_out_of_action_list(self):
        template = (SKILL / "references/report-template.md").read_text()
        self.assertIn("Leave out owner-accepted settings", section(template, "## Initial priorities", "\n## "))
        self.assertIn("Do not write a recommendation for an owner-accepted setting", template)
        note = section(template, "### Deliberate or owner-accepted settings", "### Owner confirmation questionnaire")
        for clause in ("stay needs_confirmation", "Owner reason:", "UTC statement time", "Codebase intent:",
                       "Source-code evidence of intent alone does not belong here"):
            self.assertIn(clause, note)
        self.assertIn("config-intent read", template)
        self.assertIn("ask whether it is deliberate", (SKILL / "references/browser-evidence.md").read_text())


class ModelTests(unittest.TestCase):
    def assert_invalid(self, report):
        with self.assertRaises(MODEL.ModelError):
            MODEL.validate_report(report)

    def test_absent_field_stays_valid_and_renders_empty_note(self):
        report = MODEL.new_report("example-team", "Synthetic configuration review")
        self.assertNotIn("owner_accepted", report["review_summary"])
        self.assertEqual(report["schema_version"], 1)
        markdown = MODEL.build_markdown(report)
        self.assertEqual(markdown.count("### Deliberate or owner-accepted settings"), 1)
        self.assertIn("No owner-accepted settings recorded.", markdown)

    def test_accepted_setting_renders_reason_and_keeps_counts(self):
        report = accepted_report()
        markdown = MODEL.build_markdown(report)
        note = section(markdown, "### Deliberate or owner-accepted settings", "### Owner confirmation questionnaire")
        for clause in ("DEP-01 - Deployment protection scope", "status needs_confirmation", "owner_statement",
                       "ev-dep-03", "Statement UTC: 2026-10-25T12:10:00Z", "Previews are public marketing builds"):
            self.assertIn(clause, note)
        self.assertIn("Source-code evidence of intent alone is not owner acceptance", note)
        summary = MODEL.build_summary(report)
        self.assertEqual(set(summary["core"]), set(MODEL.STATUSES))
        self.assertEqual(summary["core"]["needs_confirmation"], 1)

    def test_acceptance_requires_needs_confirmation_status(self):
        for status in ("satisfactory", "action_recommended", "not_applicable"):
            report = accepted_report()
            next(c for c in report["checks"] if c["id"] == "DEP-01")["status"] = status
            self.assert_invalid(report)

    def test_acceptance_requires_owner_statement_on_same_check(self):
        for reference in ("ev-dep-02", "ev-dep-01", "missing-ref"):
            report = accepted_report()
            report["review_summary"]["owner_accepted"][0]["evidence_ref"] = reference
            self.assert_invalid(report)
        report = accepted_report()
        report["review_summary"]["owner_accepted"][0]["check_id"] = "DEP-02"
        self.assert_invalid(report)

    def test_rejects_duplicates_extra_fields_and_recommendations(self):
        report = accepted_report()
        report["review_summary"]["owner_accepted"].append(copy.deepcopy(report["review_summary"]["owner_accepted"][0]))
        self.assert_invalid(report)
        report = accepted_report()
        report["review_summary"]["owner_accepted"][0]["accepted"] = True
        self.assert_invalid(report)
        report = accepted_report()
        report["review_summary"]["owner_accepted"] = {"DEP-01": "ev-dep-03"}
        self.assert_invalid(report)
        report = accepted_report()
        report["recommendations"] = [{
            "title": "Protect previews", "check_ids": ["DEP-01"], "evidence_and_rationale": "ev-dep-01.",
            "benefit": "Synthetic.", "responsible_role": "Team Owner", "prerequisites": ["Confirm intent."],
            "where_to_start": "Location not yet verified.", "steps": ["Confirm intent."],
            "done_when": "Intent recorded.", "impact": "None.", "docs": "Verification pending."}]
        self.assert_invalid(report)

    def test_append_cannot_silently_move_an_accepted_check(self):
        report = accepted_report()
        patch = {"expected_revision": report["revision"], "checks": [{
            "id": "DEP-01", "status": "action_recommended", "statement": "Changed.", "rationale": "Changed.",
            "evidence_log": [entry("ev-dep-04", "browser", "2026-10-25T13:00:00Z")]}]}
        with self.assertRaises(MODEL.ModelError):
            MODEL.append_evidence(report, patch)
        patch["checks"][0]["status"] = "needs_confirmation"
        updated = MODEL.append_evidence(report, patch)
        self.assertEqual(updated["review_summary"]["owner_accepted"], report["review_summary"]["owner_accepted"])

    def test_rendered_html_passes_report_qa(self):
        with tempfile.TemporaryDirectory() as directory:
            html = Path(directory) / "accepted.html"
            html.write_text(MODEL.render_report(MODEL.build_markdown(accepted_report())))
            result = subprocess.run([sys.executable, str(SKILL / "scripts/check_report.py"), str(html)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["owner_accepted_markers"], ["DEP-01"])


class MatrixMarkerTests(unittest.TestCase):
    """An owner-accepted check is visibly marked in the matrix while its status stays needs_confirmation (#80)."""

    def check(self, markdown):
        with tempfile.TemporaryDirectory() as directory:
            html = Path(directory) / "report.html"
            html.write_text(MODEL.render_report(markdown))
            return subprocess.run([sys.executable, "-I", "-B", str(SKILL / "scripts/check_report.py"), str(html)],
                                  capture_output=True, text=True)

    def test_matrix_marks_only_the_accepted_check(self):
        markdown = MODEL.build_markdown(accepted_report())
        rows = [line for line in markdown.splitlines() if line.startswith("| ") and "-0" in line]
        marked = [line for line in rows if "(owner-accepted)" in line]
        self.assertEqual(marked, ["| DEP-01 Deployment protection scope (owner-accepted) | needs_confirmation |"])
        self.assertIn("(owner-accepted) marks a setting the owner has confirmed as deliberate", markdown)
        unaccepted = MODEL.build_markdown(MODEL.new_report("example-team", "Synthetic configuration review"))
        self.assertNotIn("(owner-accepted)", unaccepted)

    def test_checker_rejects_a_marker_on_another_status(self):
        report = MODEL.new_report("example-team", "Synthetic configuration review")
        markdown = MODEL.build_markdown(report).replace(
            "| IAM-01 Team membership and roles |", "| IAM-01 Team membership and roles (owner-accepted) |", 1)
        result = self.check(markdown)
        self.assertEqual(result.returncode, 1)
        self.assertIn("Owner-accepted marker is on a check whose status is not needs_confirmation", result.stderr)
        self.assertIn("check ID IAM-01; matrix not_reviewed; appendix not_reviewed", result.stderr)

    def test_checker_rejects_a_misspelt_or_misplaced_marker(self):
        markdown = MODEL.build_markdown(accepted_report())
        for replacement in ("| DEP-01 Deployment protection scope (Owner-Accepted) |",
                            "| DEP-01 (owner-accepted) Deployment protection scope |",
                            "| DEP-01 Deployment protection scope (owner-accepted) (owner-accepted) |"):
            with self.subTest(replacement=replacement):
                result = self.check(markdown.replace("| DEP-01 Deployment protection scope (owner-accepted) |", replacement))
                self.assertEqual(result.returncode, 1)
                self.assertIn("Owner-accepted marker must be exactly (owner-accepted)", result.stderr)

    def test_marker_is_documented_for_template_and_checker(self):
        template = (SKILL / "references/report-template.md").read_text()
        design = (SKILL / "references/report-design.md").read_text()
        self.assertIn("ending its Check cell with exactly `(owner-accepted)`", template)
        self.assertIn("the marker is not a status", template)
        self.assertIn("`owner_accepted_markers`", design)


if __name__ == "__main__":
    unittest.main()
