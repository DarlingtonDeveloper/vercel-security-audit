"""Offline structural QA through the checker CLI; synthetic reports only."""
from contextlib import ExitStack, redirect_stdout, redirect_stderr
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "vercel-security-audit"
CHECKER = SKILL / "scripts" / "check_report.py"
SPEC = importlib.util.spec_from_file_location("qa_fixture_renderer", SKILL / "scripts" / "render_report.py")
RENDERER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RENDERER)

# Literal expectations independent of the checker's checklist discovery.
CORE = [f"{domain}-{number:02}" for domain in
        ("IAM", "CRE", "DEP", "FWB", "SRC", "SEC", "DOM", "OPS")
        for number in (1, 2, 3)]
OPTIONAL = ["DEP-04", "SRC-04", "SEC-04", "OPS-04"]
STATES = ("satisfactory", "action_recommended", "needs_confirmation",
          "not_reviewed", "not_applicable")
SUMMARY = {
    "core": dict(zip(STATES, (5, 5, 5, 5, 4))),
    "optional": dict(zip(STATES, (0, 0, 0, 4, 0))),
}


def fixture():
    source = "# Synthetic QA review\n\n## Summary\n[Docs](https://example.test/docs)\n"
    # A recommendation badge is not an appendix outcome.
    source += "\n## Recommendations\n### Confirm ownership\nStatus: needs_confirmation\n"
    source += "\n## Appendix: check outcomes\n"
    for index, topic in enumerate(CORE):
        source += f"\n### {topic} - Synthetic check\nStatus: {STATES[index % 5]}\n\nRationale: synthetic.\n"
    source += "\n## Appendix: optional checks\n"
    for topic in OPTIONAL:
        source += f"\n### {topic} - Optional check\nStatus: not_reviewed\n\nRationale: not authorized.\n"
    return RENDERER.render_report(source)


class ReportQATests(unittest.TestCase):
    def check(self, document, summary=SUMMARY, evidence=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "report.html"
            report.write_text(document, encoding="utf-8")
            command = [sys.executable, "-B", str(CHECKER), str(report)]
            if summary is not None:
                path = root / "summary.json"
                path.write_text(json.dumps(summary), encoding="utf-8")
                command += ["--expected-summary", str(path)]
            if evidence is not None:
                path = root / "evidence.json"
                path.write_text(json.dumps(evidence), encoding="utf-8")
                command += ["--evidence-json", str(path)]
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            result = subprocess.run(command, capture_output=True, text=True, timeout=10)
            self.assertEqual(before, {p.name: p.read_bytes() for p in root.iterdir()})
            return result

    def test_complete_report_counts_match_all_five_states_separately(self):
        result = self.check(fixture())
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output["counts"], SUMMARY)
        self.assertEqual(output["summary_parity"], "matched")
        self.assertEqual(output["visual_qa"], "not performed")
        self.assertEqual(output["network_qa"], "structural only; runtime not observed")

    def test_each_status_mismatch_is_rejected_including_zero_optional_counts(self):
        for group in SUMMARY:
            for status in STATES:
                with self.subTest(group=group, status=status):
                    wrong = json.loads(json.dumps(SUMMARY))
                    wrong[group][status] += 1
                    self.assertEqual(self.check(fixture(), wrong).returncode, 1)

    def test_summary_requires_exact_groups_all_states_and_integer_counts(self):
        for invalid in ({}, {"core": SUMMARY["core"]},
                        {**SUMMARY, "extra": {}},
                        {**SUMMARY, "optional": {"not_reviewed": 4}},
                        {**SUMMARY, "optional": {**SUMMARY["optional"], "satisfactory": False}},
                        {**SUMMARY, "core": {**SUMMARY["core"], "satisfactory": 5.0}},
                        {**SUMMARY, "core": {**SUMMARY["core"], "satisfactory": -1}}):
            with self.subTest(invalid=invalid):
                self.assertEqual(self.check(fixture(), invalid).returncode, 1)

    def test_duplicate_missing_unknown_or_multiple_status_appendix_checks_fail(self):
        document = fixture()
        mutations = (
            document.replace("IAM-02 - Synthetic check", "IAM-01 - Synthetic check"),
            document.replace("IAM-01 - Synthetic check", "ZZZ-01 - Synthetic check"),
            document.replace('<span class="status-badge status-good">Satisfactory</span>', "", 1),
            document.replace('>Satisfactory</span>', '>Invented status</span>', 1),
            document.replace('>Satisfactory</span>', '>Satisfactory</span><span class="status-badge">Not reviewed</span>', 1),
            document.replace('<section class="report-section appendix"', '<section class="report-section"'),
        )
        for mutated in mutations:
            with self.subTest(index=mutations.index(mutated)):
                self.assertEqual(self.check(mutated).returncode, 1)

    def test_passive_html_rejects_active_elements_attributes_and_remote_assets(self):
        additions = (
            '<script>alert(1)</script>', '<script type="application/json">{}</script>',
            '<img src="https://example.test/pixel">', '<svg><path></path></svg>',
            '<iframe src="https://example.test/frame"></iframe>',
            '<object data="file:///private/example"></object>',
            '<link rel="stylesheet" href="https://example.test/style">',
            '<link rel="preconnect" href="https://example.test">',
            '<meta http-equiv="refresh" content="0;url=https://example.test">',
            '<form action="https://example.test"></form>',
            '<p onclick="alert(1)">Active</p>',
            '<p style="background:url(https://example.test/pixel)">Inline CSS</p>',
            '<a href="https://example.test" ping="https://example.test/ping">Docs</a>',
            '<a href="javascript:alert(1)">Active link</a>',
            '<a href="https://user:password@example.test">Credentials</a>',
            '<a href="https://example.test?token=synthetic">Query</a>',
            '<div background="https://example.test/pixel">Old HTML</div>',
            '<base href="https://example.test/">',
        )
        for addition in additions:
            with self.subTest(addition=addition):
                self.assertEqual(self.check(fixture().replace('</head>', addition + '</head>')).returncode, 1)

    def test_csp_and_embedded_styles_fonts_are_required_and_tamper_evident(self):
        document = fixture()
        mutations = (
            document.replace("script-src 'none'", "script-src https:"),
            document.replace("default-src 'none';", "default-src *;"),
            document.replace("font-src data:", "font-src https:"),
            document.replace("Content-Security-Policy", "Not-CSP"),
            document.replace('</style>', '@import "https://example.test/remote.css";</style>'),
            document.replace('</style>', 'p{background:url(https://example.test/pixel)}</style>'),
            document.replace('</style>', r'p{background:u\72l(https://example.test/pixel)}</style>'),
            document.replace('data:font/woff2;base64,', 'https://example.test/font?data=', 1),
            document.replace('data:font/woff2;base64,d09GMg', 'data:font/woff2;base64,AAAAAA', 1),
            document.replace('</head>', '<style>p{color:red}</style></head>'),
        )
        for mutated in mutations:
            with self.subTest(index=mutations.index(mutated)):
                self.assertNotEqual(mutated, document)
                self.assertEqual(self.check(mutated).returncode, 1)

    def test_required_disclosures_and_no_logo(self):
        document = fixture()
        for old in ('Community-maintained · Unofficial',
                    'Not an official Vercel product or endorsed by Vercel.',
                    'not a security certification or a guarantee of compliance.',
                    'Not endorsed by Vercel.'):
            with self.subTest(disclosure=old):
                self.assertEqual(self.check(document.replace(old, '')).returncode, 1)
        self.assertEqual(self.check(document.replace('</header>', '<span class="official-logo">Vercel</span></header>')).returncode, 1)

    def test_no_json_does_not_claim_parity_and_single_evidence_is_partial(self):
        result = self.check(fixture(), summary=None)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("not checked", json.loads(result.stdout)["summary_parity"])
        result = self.check(fixture(), summary=None, evidence={
            "topic_id": "CRE-01", "status": "not_reviewed",
            "scope_alias": "example-team", "observed": {"expiry_visibility": "not_shown"},
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output["evidence_parity"], "matched 1 of 28 checks; partial source")
        self.assertIn("not checked", output["summary_parity"])

    def test_structured_evidence_checks_ids_statuses_and_complete_parity(self):
        records = [{"topic_id": topic, "status": STATES[index % 5]} for index, topic in enumerate(CORE)]
        records += [{"topic_id": topic, "status": "not_reviewed"} for topic in OPTIONAL]
        result = self.check(fixture(), evidence=records)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["evidence_parity"], "matched all 28 checks")
        for invalid in ([], {}, {"checks": records}, records + [records[0]],
                        {"topic_id": "CRE-01", "status": "satisfactory"},
                        {"topic_id": "ZZZ-01", "status": "not_reviewed"},
                        {"topic_id": "CRE-01", "status": "unknown"}):
            with self.subTest(invalid=invalid):
                self.assertEqual(self.check(fixture(), evidence=invalid).returncode, 1)

    def test_repository_example_works_without_a_new_report_schema(self):
        source = (ROOT / "examples" / "security-audit.md").read_text(encoding="utf-8")
        expected = {
            "core": dict(zip(STATES, (12, 2, 6, 3, 1))),
            "optional": dict(zip(STATES, (0, 0, 0, 4, 0))),
        }
        result = self.check(RENDERER.render_report(source), summary=expected)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["counts"], expected)

    def test_appendix_records_must_be_directly_in_main_not_nested_or_elsewhere(self):
        document = fixture()
        heading = '<h3>IAM-01 - Synthetic check</h3>'
        for mutated in (
            document.replace(heading, '<div>' + heading + '</div>'),
            document.replace('</footer>', '<section class="appendix"><h3>IAM-01 - Duplicate</h3></section></footer>'),
        ):
            with self.subTest(mutated=mutated[-80:]):
                self.assertNotEqual(mutated, document)
                self.assertEqual(self.check(mutated).returncode, 1)

    def test_malformed_html_and_input_json_fail_without_echoing_content(self):
        for document in ('', 'SYNTHETIC_SECRET_CANARY', fixture()[:-20],
                         fixture().replace('<html lang="en">', '<html lang="en" lang="fr">'),
                         fixture().replace('</body>', '<div>' * 70 + '</div>' * 70 + '</body>')):
            result = self.check(document)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, '')
            self.assertNotIn('SYNTHETIC_SECRET_CANARY', result.stderr)
            self.assertNotIn('Traceback', result.stderr)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report, summary = root / 'report.html', root / 'summary.json'
            report.write_text(fixture(), encoding='utf-8')
            for data in (b'{', b'\xff', b'{}\x00', b'{"core":{},"core":{},"optional":{}}'):
                summary.write_bytes(data)
                result = subprocess.run([sys.executable, '-B', str(CHECKER), str(report),
                                         '--expected-summary', str(summary)], capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, '')
                self.assertNotIn('Traceback', result.stderr)

    def test_checker_never_launches_a_browser_process_or_network_operation(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / 'report.html'
            report.write_text(fixture(), encoding='utf-8')
            with ExitStack() as stack:
                stack.enter_context(patch.dict(sys.modules, {'render_report': RENDERER}))
                for target in ('socket.socket', 'socket.create_connection', 'socket.getaddrinfo',
                               'subprocess.Popen', 'subprocess.run', 'os.system', 'os.popen'):
                    stack.enter_context(patch(target, side_effect=AssertionError('Forbidden checker I/O')))
                output = stack.enter_context(redirect_stdout(io.StringIO()))
                errors = stack.enter_context(redirect_stderr(io.StringIO()))
                spec = importlib.util.spec_from_file_location('offline_checker', CHECKER)
                checker = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(checker)
                self.assertEqual(checker.main([str(report)]), 0)
                self.assertEqual(json.loads(output.getvalue())['counts'], SUMMARY)
                self.assertEqual(errors.getvalue(), '')


if __name__ == "__main__":
    unittest.main()
