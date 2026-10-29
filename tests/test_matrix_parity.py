"""check_report.py compares the status matrix with appendix outcomes (#87); synthetic inputs only."""
import ast
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "vercel-security-audit"
SCRIPTS = SKILL / "scripts"
CHECKER = SCRIPTS / "check_report.py"
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location("parity_renderer", SCRIPTS / "render_report.py")
RENDERER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RENDERER)
SPEC = importlib.util.spec_from_file_location("parity_model", SCRIPTS / "manage_report.py")
MODEL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODEL)
SPEC = importlib.util.spec_from_file_location("parity_checker", CHECKER)
QA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(QA)

CANARY = "SYNTHETIC_MATRIX_CANARY"
CORE = [f"{d}-{n:02}" for d in ("IAM", "CRE", "DEP", "FWB", "SRC", "SEC", "DOM", "OPS") for n in (1, 2, 3)]
OPTIONAL = ["DEP-04", "SRC-04", "SEC-04", "OPS-04"]
STATES = ("satisfactory", "action_recommended", "needs_confirmation", "not_reviewed", "not_applicable")


def appendix_statuses():
    statuses = {topic: STATES[index % 5] for index, topic in enumerate(CORE)}
    statuses.update(dict.fromkeys(OPTIONAL, "not_reviewed"))
    return statuses


def source(appendix=None, rows=None, drop=(), extra_rows=(), opening="## Status at a glance", later=""):
    """Matrix rows default to `| ID name | status | Team-wide |`; rows overrides cells after the ID."""
    appendix = appendix or appendix_statuses()
    cells = {topic: f"{status} | Team-wide" for topic, status in appendix.items()}
    cells.update(rows or {})
    text = f"# Synthetic review\n\n{opening}\n\n"
    for label, topics in (("Check", CORE), ("Optional check", OPTIONAL)):
        text += f"| {label} | Team | `example-site` |\n| --- | --- | --- |\n"
        text += "".join(f"| {topic} Synthetic check | {cells[topic]} |\n" for topic in topics if topic not in drop)
        text += "".join(row + "\n" for row in extra_rows if label == "Check")
        text += "\n"
    text += f"## Review summary\n\n{CANARY}\n\n{later}\n## Appendix: check outcomes\n"
    for topic in CORE + OPTIONAL:
        text += f"\n### {topic} - Synthetic check\nStatus: {appendix[topic]}\n\nRationale: {CANARY}.\n"
    return text


class MatrixParityTests(unittest.TestCase):
    def run_checker(self, html):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.html"
            path.write_text(html, encoding="utf-8")
            result = subprocess.run([sys.executable, "-B", str(CHECKER), str(path)],
                                    capture_output=True, text=True, timeout=20, check=False)
        self.assertNotIn(CANARY, result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        return result

    def check_source(self, text):
        return self.run_checker(RENDERER.render_report(text))

    def assert_fails(self, text, *phrases):
        result = self.check_source(text)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertEqual(result.stdout, "")
        for phrase in phrases:
            self.assertIn(phrase, result.stderr)
        return result.stderr

    def test_consistent_matrix_passes_and_reports_parity(self):
        result = self.check_source(source())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["matrix_parity"], "matched all 28 checks")

    def test_matrix_satisfactory_but_appendix_needs_confirmation_fails_naming_the_id(self):
        appendix = appendix_statuses()
        appendix["IAM-02"] = "needs_confirmation"
        stderr = self.assert_fails(source(appendix, rows={"IAM-02": "satisfactory | Team-wide"}),
                                   "Status matrix shows a better result than the appendix.",
                                   "check ID IAM-02", "matrix satisfactory", "appendix needs_confirmation")
        self.assertNotIn("IAM-01", stderr)

    def test_matrix_worse_than_appendix_also_fails(self):
        self.assert_fails(source(rows={"IAM-01": "action_recommended | Team-wide"}),
                          "Status matrix shows a worse result than the appendix.", "check ID IAM-01",
                          "matrix action_recommended", "appendix satisfactory")

    def test_every_status_pair_that_differs_fails(self):
        for matrix in STATES:
            for appendix in STATES:
                with self.subTest(matrix=matrix, appendix=appendix):
                    statuses = appendix_statuses()
                    statuses["DOM-02"] = appendix
                    result = self.check_source(source(statuses, rows={"DOM-02": f"{matrix} | Team-wide"}))
                    self.assertEqual(result.returncode, 0 if matrix == appendix else 1, result.stderr)

    def test_multi_column_row_summarises_to_its_least_favourable_status(self):
        appendix = appendix_statuses()
        appendix["DEP-01"] = "needs_confirmation"
        for cells, expected in (("By project | needs_confirmation", 0),
                                ("satisfactory | needs_confirmation", 0),
                                ("not_applicable | satisfactory", 1),
                                ("needs_confirmation | not_reviewed", 0),
                                ("needs_confirmation | action_recommended", 1),
                                ("By project | satisfactory", 1)):
            with self.subTest(cells=cells):
                result = self.check_source(source(appendix, rows={"DEP-01": cells}))
                self.assertEqual(result.returncode, expected, result.stderr)
                if expected:
                    self.assertIn("check ID DEP-01", result.stderr)

    def test_check_missing_from_matrix_or_listed_twice_names_the_id(self):
        self.assert_fails(source(drop=("SEC-04",)),
                          "Status matrix is missing a check that the appendix contains.", "check ID SEC-04")
        self.assert_fails(source(extra_rows=("| CRE-03 Again | satisfactory | Team-wide |",)),
                          "Status matrix lists a check more than once.", "check ID CRE-03")

    def test_unknown_or_ambiguous_ids_fail_without_echoing_them(self):
        stderr = self.assert_fails(source(extra_rows=("| ZZZ-97 Invented | satisfactory | Team-wide |",)),
                                   "not in the bundled checklist")
        self.assertNotIn("ZZZ-97", stderr)
        self.assert_fails(source(extra_rows=(f"| {CANARY} | satisfactory | Team-wide |",)),
                          "exactly one check ID in its first cell")
        self.assert_fails(source(rows={"IAM-01": "satisfactory | Team-wide"},
                                 extra_rows=("| IAM-03 and SRC-03 | satisfactory | Team-wide |",)),
                          "exactly one check ID in its first cell")

    def test_cells_hold_one_status_key_team_wide_or_by_project(self):
        for cells in (f"{CANARY} | Team-wide", "`satisfactory` | Team-wide", "satisfactory | ",
                      "satisfactory | Team wide", "**satisfactory** | Team-wide"):
            with self.subTest(cells=cells):
                self.assert_fails(source(rows={"IAM-01": cells}),
                                  "Status matrix cells must hold exactly one status key, Team-wide or By project.")
        self.assert_fails(source(rows={"IAM-01": "By project | Team-wide"}),
                          "Status matrix row has no status", "check ID IAM-01")

    def test_optional_checks_need_their_own_table(self):
        self.assert_fails(source(drop=("OPS-04",), extra_rows=("| OPS-04 Optional | not_reviewed | Team-wide |",)),
                          "Optional checks need their own status matrix table")

    def test_matrix_must_open_the_report(self):
        text = source()
        missing = re.sub(r"## Status at a glance\n\n(\|.*\n|\n)*", "", text)
        self.assert_fails(missing, "No status matrix found.")
        # A matrix moved below the opening section is not the status matrix.
        moved = text.replace("## Status at a glance", "## Introduction\n\nSynthetic.\n\n## Status at a glance")
        self.assert_fails(moved, "No status matrix found.")
        # Draft notices before the first heading are fine; so is a matrix without its own heading.
        self.assertEqual(self.check_source(text.replace("## Status at a glance", "> Local draft.")).returncode, 0)

    def test_later_and_appendix_tables_are_neither_matrix_rows_nor_outcomes(self):
        later = "| Check | Status |\n| --- | --- |\n| IAM-01 | action_recommended |\n"
        result = self.check_source(source(later=later))
        self.assertEqual(result.returncode, 0, result.stderr)
        text = source().replace("Rationale: " + CANARY + ".\n", "Rationale: synthetic.\n\n" + later, 1)
        result = self.check_source(text)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["counts"]["core"]["satisfactory"], 5)

    def test_manage_report_build_with_every_status_passes_unchanged(self):
        report = MODEL.new_report("example-team", "Synthetic configuration review")
        checks = []
        # Optional checks stay not_reviewed: the model rejects evidence without optional consent.
        for index, topic in enumerate(CORE):
            status = STATES[index % 5]
            checks.append({"id": topic, "status": status, "statement": "Synthetic statement.",
                           "rationale": "Synthetic rationale.",
                           "evidence_log": [{"id": f"ev-{index:03}", "observed_at": "2026-10-25T12:00:00Z",
                                             "source_kind": "browser", "source_description": "Synthetic metadata",
                                             "scope_alias": "example-project", "observed": "Synthetic observation.",
                                             "limitation": "Synthetic limitation."}]})
        report = MODEL.append_evidence(report, {"expected_revision": 1, "checks": checks})
        statuses = {check["id"]: check["status"] for check in report["checks"]}
        self.assertEqual(set(statuses.values()), set(STATES))
        for value in (MODEL.new_report("example-team", "Synthetic configuration review"), report):
            with self.subTest(revision=value["revision"]):
                result = self.run_checker(MODEL.render_report(MODEL.build_markdown(value)))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)["matrix_parity"], "matched all 28 checks")

    def test_named_errors_only_carry_checklist_ids_and_status_keys(self):
        self.assertEqual(str(QA.CheckError("Rule.", CANARY, CANARY, "satisfactory")), "Rule. (appendix satisfactory).")
        self.assertEqual(str(QA.CheckError("Rule.", "ZZZ-99")), "Rule.")
        self.assertEqual(str(QA.CheckError("Rule.", "IAM-01", "not_reviewed")),
                         "Rule. (check ID IAM-01; matrix not_reviewed).")
        tree = ast.parse(CHECKER.read_text(encoding="utf-8"))
        calls = [node for node in ast.walk(tree)
                 if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "CheckError"]
        self.assertGreaterEqual(len(calls), 5)
        for node in calls:
            with self.subTest(line=node.lineno):
                self.assertIsInstance(node.args[0], ast.Constant)
                self.assertIsInstance(node.args[0].value, str)
                self.assertTrue(all(isinstance(arg, ast.Name) for arg in node.args[1:]))
                self.assertEqual(node.keywords, [])

    def test_status_order_is_defined_in_the_template_in_the_checker_order(self):
        template = (SKILL / "references" / "report-template.md").read_text(encoding="utf-8")
        line = next(line for line in template.splitlines() if line.startswith("Status order"))
        self.assertEqual(tuple(re.findall(r"`([a-z_]+)`", line)), QA.STATUS_ORDER)
        design = (SKILL / "references" / "report-design.md").read_text(encoding="utf-8")
        self.assertIn("### Status matrix comparison", design)


if __name__ == "__main__":
    unittest.main()
