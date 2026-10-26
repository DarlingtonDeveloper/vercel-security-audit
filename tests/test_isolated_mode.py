"""Helpers must run under python -I and resolve siblings from the skill, not the CWD."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills" / "vercel-security-audit" / "scripts"
EXAMPLE = ROOT / "examples" / "security-audit.md"


class IsolatedModeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        # A decoy in the working directory must never be imported.
        (self.directory / "render_report.py").write_text(
            "raise SystemExit('DECOY_RENDERER_IMPORTED')\n", encoding="utf-8")

    def run_isolated(self, script, *args):
        return subprocess.run([sys.executable, "-I", "-B", str(SCRIPTS / script), *map(str, args)],
                              cwd=self.directory, capture_output=True, text=True,
                              encoding="utf-8", timeout=20, check=False)

    def assert_ok(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("DECOY_RENDERER_IMPORTED", result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_render_and_check_run_isolated(self):
        output = self.directory / "report.html"
        self.assert_ok(self.run_isolated("render_report.py", EXAMPLE, "-o", output))
        self.assert_ok(self.run_isolated("check_report.py", output))

    def test_manage_runs_isolated(self):
        output = self.directory / "report-v1.json"
        self.assert_ok(self.run_isolated("manage_report.py", "init", "--scope-alias", "t",
                                         "--title", "Synthetic", "-o", output))
        self.assert_ok(self.run_isolated("manage_report.py", "validate", output))


if __name__ == "__main__":
    unittest.main()
