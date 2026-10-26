"""check_report.py names the failing rule without echoing content (#46); synthetic inputs only."""
import ast
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "vercel-security-audit"
CHECKER = SKILL / "scripts" / "check_report.py"
SPEC = importlib.util.spec_from_file_location("qa_diag_renderer", SKILL / "scripts" / "render_report.py")
RENDERER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RENDERER)
CANARY = "SYNTHETIC_QA_CANARY"
CORE = [f"{d}-{n:02}" for d in ("IAM", "CRE", "DEP", "FWB", "SRC", "SEC", "DOM", "OPS") for n in (1, 2, 3)]
OPTIONAL = ["DEP-04", "SRC-04", "SEC-04", "OPS-04"]


def source(domain_heading="## Appendix: Identity and access"):
    text = f"# Synthetic review\n\n## Summary\n{CANARY}\n\n{domain_heading}\n"
    for topic in CORE:
        text += f"\n### {topic} - Synthetic check {CANARY}\nStatus: not_reviewed\n"
    text += "\n## Appendix: optional checks\n"
    for topic in OPTIONAL:
        text += f"\n### {topic} - Optional check\nStatus: not_reviewed\n"
    return text


class ReportQADiagnosticsTests(unittest.TestCase):
    def run_checker(self, html, *extra):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / f"{CANARY}.html"
            path.write_text(html, encoding="utf-8")
            args = []
            for name, value in extra:
                sidecar = Path(directory) / f"{CANARY}-{name}.json"
                sidecar.write_text(value, encoding="utf-8")
                args += [f"--{name}", str(sidecar)]
            result = subprocess.run([sys.executable, "-B", str(CHECKER), str(path), *args],
                                    capture_output=True, text=True, timeout=20, check=False)
        self.assertNotIn(CANARY, result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        return result

    def test_domain_heading_with_appendix_prefix_passes(self):
        result = self.run_checker(RENDERER.render_report(source()))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_unprefixed_domain_heading_names_the_appendix_rule(self):
        result = self.run_checker(RENDERER.render_report(source("## Identity and access")))
        self.assertEqual(result.returncode, 1)
        self.assertIn("Only checks under second-level headings that begin with Appendix are counted.",
                      result.stderr)

    def test_missing_appendix_is_reported_specifically(self):
        result = self.run_checker(RENDERER.render_report(f"# Synthetic\n\n## Summary\n{CANARY}\n"))
        self.assertEqual(result.returncode, 1)
        self.assertIn("No appendix section found.", result.stderr)

    def test_summary_mismatch_and_bad_json_are_distinguishable(self):
        html = RENDERER.render_report(source())
        zero = dict.fromkeys(("satisfactory", "action_recommended", "needs_confirmation",
                              "not_reviewed", "not_applicable"), 0)
        wrong = json.dumps({"core": zero, "optional": dict(zero, not_reviewed=4)})
        mismatch = self.run_checker(html, ("expected-summary", wrong)).stderr
        self.assertIn("Expected summary core counts do not match the appendix.", mismatch)
        invalid = self.run_checker(html, ("expected-summary", "{" + CANARY)).stderr
        self.assertIn("a JSON input is not valid JSON.", invalid)
        self.assertNotEqual(mismatch, invalid)

    def test_missing_input_names_the_role_not_the_path(self):
        result = subprocess.run([sys.executable, "-B", str(CHECKER), f"/nonexistent/{CANARY}.html"],
                                capture_output=True, text=True, timeout=20, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("The input file could not be used", result.stderr)
        self.assertNotIn(CANARY, result.stderr)

    def test_printed_messages_are_literal_strings(self):
        tree = ast.parse(CHECKER.read_text(encoding="utf-8"))
        calls = [node for node in ast.walk(tree)
                 if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "ReportError"]
        self.assertGreater(len(calls), 30)
        for node in calls:
            with self.subTest(line=node.lineno):
                self.assertEqual(len(node.args), 1)
                self.assertIsInstance(node.args[0], ast.Constant)
                self.assertIsInstance(node.args[0].value, str)
        raised = [node for node in ast.walk(tree) if isinstance(node, ast.Raise)
                  and isinstance(node.exc, ast.Call) and getattr(node.exc.func, "id", None) == "ValueError"]
        self.assertEqual(raised, [], "authored failures must use ReportError")


if __name__ == "__main__":
    unittest.main()
