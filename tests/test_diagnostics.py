"""CLI failures must be distinguishable yet never echo input values or paths (#29)."""
import ast
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills" / "vercel-security-audit" / "scripts"
CANARY = "SYNTHETIC_DIAGNOSTIC_CANARY"


class DiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name) / CANARY
        self.directory.mkdir()

    def run_script(self, script, *args):
        result = subprocess.run([sys.executable, "-B", str(SCRIPTS / script), *map(str, args)],
                                cwd=self.directory, capture_output=True, text=True,
                                encoding="utf-8", timeout=20, check=False)
        self.assertNotIn(CANARY, result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        return result

    def failure(self, script, *args):
        result = self.run_script(script, *args)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        return result.stderr

    def init(self, name="r1.json"):
        output = self.directory / name
        result = self.run_script("manage_report.py", "init", "--scope-alias", "t", "--title", "t", "-o", output)
        self.assertEqual(result.returncode, 0, result.stderr)
        return output

    def test_manage_schema_error_differs_from_existing_output(self):
        source = self.init()
        bad = self.directory / "bad.json"
        value = json.loads(source.read_text(encoding="utf-8"))
        value["schema_version"] = CANARY
        bad.write_text(json.dumps(value), encoding="utf-8")
        schema = self.failure("manage_report.py", "validate", bad)
        exists = self.failure("manage_report.py", "init", "--scope-alias", "t", "--title", "t", "-o", source)
        self.assertNotEqual(schema, exists)
        self.assertIn("The output path could not be used (File exists).", exists)

    def test_manage_reports_specific_json_errors(self):
        duplicate = self.directory / "duplicate.json"
        duplicate.write_text('{"a": 1, "a": 2}', encoding="utf-8")
        self.assertIn("Duplicate JSON object key.", self.failure("manage_report.py", "validate", duplicate))
        nonfinite = self.directory / "nan.json"
        nonfinite.write_text('{"a": NaN}', encoding="utf-8")
        self.assertIn("Non-finite JSON numbers are invalid.", self.failure("manage_report.py", "validate", nonfinite))
        missing = self.directory / "missing.json"
        self.assertIn("The source file could not be used", self.failure("manage_report.py", "validate", missing))

    def test_render_reports_specific_errors(self):
        notitle = self.directory / "notitle.md"
        notitle.write_text(f"no title {CANARY}\n", encoding="utf-8")
        self.assertIn("The Markdown report must start with one report title (# Title).",
                      self.failure("render_report.py", notitle, "-o", self.directory / "a.html"))
        fence = self.directory / "fence.md"
        fence.write_text("# T\n```\nopen", encoding="utf-8")
        self.assertIn("Close all fenced code blocks before rendering.",
                      self.failure("render_report.py", fence, "-o", self.directory / "b.html"))
        binary = self.directory / "binary.md"
        binary.write_bytes(b"# T\n\xff\xfe" + CANARY.encode())
        self.assertIn("must be UTF-8 text.", self.failure("render_report.py", binary, "-o", self.directory / "c.html"))
        existing = self.directory / "existing.html"
        existing.write_text("keep", encoding="utf-8")
        title = self.directory / "title.md"
        title.write_text("# T\n", encoding="utf-8")
        self.assertIn("The output path could not be used (File exists).",
                      self.failure("render_report.py", title, "-o", existing))
        self.assertEqual(existing.read_text(encoding="utf-8"), "keep")

    def test_printed_error_messages_are_literal_strings(self):
        """Printing is only safe because every authored message is a constant."""
        for name in ("render_report.py", "manage_report.py"):
            tree = ast.parse((SCRIPTS / name).read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Call) and getattr(node.func, "id", None) in (
                        "ReportError", "ModelError", "_require"):
                    message = node.args[-1] if node.args else None
                    if isinstance(message, ast.Name) and message.id == "message":
                        continue  # _require forwarding its literal argument
                    with self.subTest(file=name, line=node.lineno):
                        self.assertIsInstance(message, ast.Constant)
                        self.assertIsInstance(message.value, str)


if __name__ == "__main__":
    unittest.main()
