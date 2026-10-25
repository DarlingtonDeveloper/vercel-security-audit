"""Synthetic, offline tests at the report model API and local CLI boundaries."""
from contextlib import redirect_stderr, redirect_stdout
import copy
import io
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/vercel-security-audit/scripts/manage_report.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("report_model", SCRIPT)
MODEL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODEL)

CORE_IDS = tuple(f"{domain}-{index:02}" for domain in
                 ("IAM", "CRE", "DEP", "FWB", "SRC", "SEC", "DOM", "OPS")
                 for index in (1, 2, 3))
OPTIONAL_IDS = ("DEP-04", "SRC-04", "SEC-04", "OPS-04")


def report():
    return MODEL.new_report("example-team", "Synthetic configuration review")


def evidence(identifier="ev-001", observed_at="2026-10-25T12:00:00Z", **changes):
    value = {"id": identifier, "observed_at": observed_at, "source_kind": "browser",
             "source_description": "Synthetic owner-visible metadata",
             "scope_alias": "example-project", "observed": "Expiry is not shown.",
             "limitation": "An absent field does not establish disabled expiry."}
    value.update(changes)
    return value


def patch_value(revision=1, check_id="CRE-01", **changes):
    check = {"id": check_id, "status": "needs_confirmation",
             "statement": "Expiry visibility is unresolved.",
             "rationale": "Metadata is incomplete.", "evidence_log": [evidence()]}
    check.update(changes)
    return {"expected_revision": revision, "checks": [check]}


def recommendation():
    return {"title": "Confirm credential metadata", "check_ids": ["CRE-01"],
            "evidence_and_rationale": "ev-001 leaves expiry visibility unresolved.",
            "benefit": "Clarify the applicable requirement.", "responsible_role": "Team Owner",
            "prerequisites": ["Confirm authorized scope."], "where_to_start": "Location not yet verified.",
            "steps": ["Confirm supported metadata visibility.", "Record the owner requirement."],
            "done_when": "Visibility and intent are documented.",
            "impact": "Confirmation only; no configuration changes.", "docs": "Verification pending."}


class ReportModelTests(unittest.TestCase):
    def test_append_changes_only_supplied_checks_retains_history_and_owned_fields(self):
        original = report()
        original["review_summary"]["overall_takeaway"] = "Owner-authored summary: preserve café."
        original["recommendations"] = [recommendation()]
        before = copy.deepcopy(original)
        first_patch = patch_value()
        first_patch["checks"].append(patch_value(check_id="DEP-01", evidence_log=[evidence("ev-002")])["checks"][0])
        first = MODEL.append_evidence(original, first_patch)
        self.assertEqual(original, before)
        self.assertEqual(first["revision"], 2)  # One increment for the whole patch.
        by_id = {c["id"]: c for c in first["checks"]}
        for old in original["checks"]:
            if old["id"] not in ("CRE-01", "DEP-01"):
                self.assertEqual(by_id[old["id"]], old)
        self.assertEqual(first["review_summary"], original["review_summary"])
        self.assertEqual(first["recommendations"], original["recommendations"])
        self.assertEqual(first["scope"], original["scope"])
        self.assertEqual(first["follow_up"], original["follow_up"])
        second = MODEL.append_evidence(first, patch_value(
            revision=2, statement="Later view shows an expiry; conflict unresolved.",
            evidence_log=[evidence("ev-003", "2026-10-25T12:01:00Z", observed="Expiry is shown.")]))
        updated = next(c for c in second["checks"] if c["id"] == "CRE-01")
        self.assertEqual(updated["evidence_log"], [evidence(), evidence("ev-003", "2026-10-25T12:01:00Z", observed="Expiry is shown.")])
        self.assertEqual(updated["status"], "needs_confirmation")
        self.assertEqual(second["revision"], 3)
        self.assertEqual(first["revision"], 2)
        self.assertEqual(MODEL.build_summary(second)["core"]["needs_confirmation"], 2)

    def test_markdown_is_deterministic_complete_and_guided_without_promotions(self):
        value = MODEL.append_evidence(report(), patch_value())
        value["recommendations"] = [recommendation()]
        value["review_summary"]["initial_priorities"] = ["Confirm CRE-01 with the Team Owner."]
        value["review_summary"]["overall_takeaway"] = "Evidence remains incomplete."
        before = copy.deepcopy(value)
        markdown = MODEL.build_markdown(value)
        self.assertEqual(markdown, MODEL.build_markdown(value))
        self.assertEqual(value, before)
        self.assertTrue(markdown.startswith("# Synthetic configuration review\n"))
        self.assertEqual(markdown.count("\nStatus: "), 28)
        for identifier in CORE_IDS + OPTIONAL_IDS:
            self.assertEqual(markdown.count("### " + identifier + " - "), 1)
        for text in ("Revision: 2", "Core coverage (24)", "Optional coverage (4)",
                     "Source/application review:", "Optional review authorized: no",
                     "Status: needs_confirmation", "ev-001", "2026-10-25T12:00:00Z",
                     "browser", "Synthetic owner-visible metadata", "example-project",
                     "Expiry is not shown.", "An absent field does not establish disabled expiry.",
                     "Who: Team Owner", "Before changing: Confirm authorized scope.",
                     "1. Confirm supported metadata visibility.", "2. Record the owner requirement.",
                     "Done when: Visibility and intent are documented.",
                     "Impact / rollback: Confirmation only; no configuration changes.",
                     "Docs: Verification pending.", "Evidence remains incomplete."):
            self.assertIn(text, markdown)
        self.assertNotIn("Status: satisfactory", markdown)
        self.assertFalse(any(line.startswith("|") for line in markdown.splitlines()))

    def test_init_validates_every_check_without_claiming_review(self):
        value = report()
        before = copy.deepcopy(value)
        MODEL.validate_report(value)
        self.assertEqual(value, before)
        self.assertEqual(value["schema_version"], 1)
        self.assertEqual(value["revision"], 1)
        self.assertEqual([c["id"] for c in value["checks"]], list(CORE_IDS + OPTIONAL_IDS))
        self.assertTrue(all(c["status"] == "not_reviewed" and c["rationale"]
                            and c["evidence_log"] == [] for c in value["checks"]))
        self.assertFalse(value["scope"]["optional_authorized"])
        self.assertEqual(MODEL.build_summary(value), {
            "core": {"satisfactory": 0, "action_recommended": 0,
                     "needs_confirmation": 0, "not_reviewed": 24, "not_applicable": 0},
            "optional": {"satisfactory": 0, "action_recommended": 0,
                         "needs_confirmation": 0, "not_reviewed": 4, "not_applicable": 0},
        })


class DocumentationTests(unittest.TestCase):
    def test_documented_patch_runs_and_exports_the_documented_summary(self):
        reference = SCRIPT.parents[1] / "references/report-model.md"
        blocks = re.findall(r"```json\n(.*?)\n```", reference.read_text(), re.S)
        self.assertEqual(len(blocks), 2)
        change, expected_counts = map(json.loads, blocks)
        updated = MODEL.append_evidence(report(), change)
        self.assertEqual(updated["revision"], 2)
        self.assertEqual(MODEL.build_summary(updated), expected_counts)
        self.assertIn("Status: needs_confirmation", MODEL.build_markdown(updated))
        for identifier in OPTIONAL_IDS:
            self.assertIn("### " + identifier + " - ", MODEL.build_markdown(updated))
        checklist = (SCRIPT.parents[1] / "references/checklist.md").read_text()
        self.assertEqual(dict(re.findall(r"^### ([A-Z]{3}-[0-9]{2}) - (.+)$", checklist, re.M)), MODEL.CHECK_TITLES)

    def test_build_order_is_canonical_without_reordering_input(self):
        value = report()
        expected = MODEL.build_markdown(value)
        value["checks"].reverse()
        old = copy.deepcopy(value)
        self.assertEqual(MODEL.build_markdown(value), expected)
        self.assertEqual(value, old)


class ValidationTests(unittest.TestCase):
    def assert_invalid(self, value):
        before = copy.deepcopy(value)
        with self.assertRaises(MODEL.ModelError) as caught:
            MODEL.validate_report(value)
        self.assertNotIn("SYNTHETIC_CANARY", str(caught.exception))
        self.assertEqual(value, before)

    def test_exact_schema_types_ids_statuses_and_required_structures(self):
        mutations = [
            lambda r: r.update(schema_version=2), lambda r: r.update(schema_version=True),
            lambda r: r.update(revision=0), lambda r: r.update(revision=True),
            lambda r: r.update(revision=1.5), lambda r: r.update(revision="1"),
            lambda r: r.update(checks=r["checks"][:-1]),
            lambda r: r["checks"].append(copy.deepcopy(r["checks"][0])),
            lambda r: r["checks"][1].update(id="IAM-01"),
            lambda r: r["checks"][0].update(id="iam-01"),
            lambda r: r["checks"][0].update(id="IAM-04"),
            lambda r: r["checks"][0].update(id="IAM-01_suffix"),
            lambda r: r["checks"][0].update(id="XYZ-01"),
            lambda r: r["checks"][0].update(status="satisfactory_extra"),
            lambda r: r["checks"][0].update(status=[]),
            lambda r: r["checks"][0].update(status="satisfactory"),  # No evidence.
            lambda r: r["checks"][0].update(rationale="  "),
            lambda r: r["checks"][0].update(evidence_log={}),
            lambda r: r["checks"][0].pop("statement"),
            lambda r: r["scope"].update(optional_authorized="yes"),
            lambda r: r["scope"].pop("source_application_review"),
            lambda r: r["review_summary"].update(initial_priorities=["One"] * 4),
            lambda r: r.update(recommendations={}),
            lambda r: r.update(title="New\n# Injected"),
            lambda r: r.update(title="x" * 241),
            lambda r: r.update(scope_alias="example/team"),
            lambda r: r.update(title="NUL\x00canary"),
            lambda r: r.update(title="Synthetic\u2028## heading"),
            lambda r: r.update(title="\ud800"),
            lambda r: r.update(summary={"core": {}, "optional": {}}),  # Derived export only.
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(case=index):
                value = report()
                mutate(value)
                self.assert_invalid(value)
        for path in ((), ("scope",), ("review_summary",), ("follow_up",), ("checks", 0)):
            with self.subTest(unknown_at=path):
                value = report()
                target = value
                for key in path:
                    target = target[key]
                target["SYNTHETIC_CANARY"] = "SYNTHETIC_CANARY"
                self.assert_invalid(value)

    def test_evidence_strict_fields_utc_unique_ids_and_chronology(self):
        invalid_entries = [
            evidence(id="bad id"), evidence(id=42), evidence(observed={"setting": "unknown"}),
            evidence(observed=" "), evidence(source_kind="automated_scan"),
            evidence(source_kind=[]), evidence(scope_alias="example/team"),
            evidence(source_description=""), evidence(limitation=""),
            evidence(observed_at="2026-10-25T12:00:00+00:00"),
            evidence(observed_at="2026-10-25T12:00:00"),
            evidence(observed_at="2026-10-25T13:00:00+01:00"),
            evidence(observed_at="2026-02-30T12:00:00Z"),
            evidence(observed_at="2026-10-25T12:00:60Z"),
            evidence(observed_at="2026-10-25T12:00:00.1234567Z"),
            evidence(SYNTHETIC_CANARY="SYNTHETIC_CANARY"),
        ]
        missing = evidence()
        del missing["limitation"]
        invalid_entries.append(missing)
        for entry in invalid_entries:
            with self.subTest(entry=entry):
                value = report()
                value["checks"][3]["evidence_log"] = [entry]
                self.assert_invalid(value)
        for log in ([evidence(), evidence()],
                    [evidence(), evidence("ev-002", "2026-10-25T11:59:59Z")]):
            value = report()
            value["checks"][0]["evidence_log"] = log
            self.assert_invalid(value)
        value = report()
        value["checks"][0]["evidence_log"] = [evidence()]
        value["checks"][1]["evidence_log"] = [evidence()]
        self.assert_invalid(value)  # IDs unique across the entire report, not just one log.
        value["checks"][1]["evidence_log"] = [evidence("ev-002")]
        value["checks"][0]["evidence_log"].append(evidence("ev-003", "2026-10-25T12:00:00.000001Z"))
        MODEL.validate_report(value)  # Compare instants, not timestamp strings.

    def test_optional_requires_explicit_intent_and_defaults_stay_unreviewed(self):
        value = report()
        change = patch_value(check_id="DEP-04")
        with self.assertRaises(MODEL.ModelError):
            MODEL.append_evidence(value, change)
        value["scope"]["optional_authorized"] = True
        value["scope"]["source_application_review"] = "Owner-authorized synthetic configuration material only."
        updated = MODEL.append_evidence(value, change)
        self.assertEqual(MODEL.build_summary(updated)["optional"], {
            "satisfactory": 0, "action_recommended": 0, "needs_confirmation": 1,
            "not_reviewed": 3, "not_applicable": 0})
        self.assertTrue(all(c["status"] == "not_reviewed" for c in updated["checks"] if c["id"] in CORE_IDS))

    def test_each_status_is_explicit_and_counts_are_derived(self):
        value = report()
        patches = []
        for index, status in enumerate(("satisfactory", "action_recommended", "needs_confirmation", "not_reviewed", "not_applicable")):
            patches.append(patch_value(check_id=CORE_IDS[index], status=status,
                                       evidence_log=[evidence(f"ev-{index}")])["checks"][0])
        updated = MODEL.append_evidence(value, {"expected_revision": 1, "checks": patches})
        self.assertEqual(MODEL.build_summary(updated)["core"], {
            "satisfactory": 1, "action_recommended": 1, "needs_confirmation": 1,
            "not_reviewed": 20, "not_applicable": 1})
        self.assertEqual(updated["revision"], 2)

    def test_recommendations_require_all_guided_fields_and_exact_related_ids(self):
        mutations = [lambda r: r.update(responsible_role=""), lambda r: r.update(prerequisites=[]),
                     lambda r: r.update(steps=[]), lambda r: r.update(check_ids=["CRE-01", "CRE-01"]),
                     lambda r: r.update(check_ids=["CRE-01_extra"]), lambda r: r.pop("done_when"),
                     lambda r: r.pop("impact"), lambda r: r.pop("docs"),
                     lambda r: r.update(SYNTHETIC_CANARY="SYNTHETIC_CANARY")]
        for mutate in mutations:
            value = report()
            rec = recommendation()
            mutate(rec)
            value["recommendations"] = [rec]
            self.assert_invalid(value)

    def test_append_rejects_stale_duplicate_replacement_and_incomplete_patches_atomically(self):
        original = MODEL.append_evidence(report(), patch_value())
        mutations = [lambda p: p.update(expected_revision=1), lambda p: p.update(expected_revision=True),
                     lambda p: p.update(checks=[]), lambda p: p.update(revision=3),
                     lambda p: p.update(review_summary={}), lambda p: p["checks"][0].pop("status"),
                     lambda p: p["checks"][0].pop("rationale"), lambda p: p["checks"][0].pop("statement"),
                     lambda p: p["checks"][0].update(id="CRE-04"),
                     lambda p: p["checks"][0].update(evidence_log=[]),
                     lambda p: p["checks"][0].update(evidence_log=[evidence()]),
                     lambda p: p["checks"][0].update(evidence_log=[evidence("ev-002"), evidence("ev-002")]),
                     lambda p: p["checks"][0].update(evidence_log=[evidence("ev-002", "2026-10-25T11:00:00Z")]),
                     lambda p: p["checks"].append(copy.deepcopy(p["checks"][0])),
                     lambda p: p["checks"][0].update(evidence_log=[evidence("ev-002", SYNTHETIC_CANARY="SYNTHETIC_CANARY")])]
        for index, mutate in enumerate(mutations):
            with self.subTest(case=index):
                change = patch_value(revision=2, evidence_log=[evidence("ev-002", "2026-10-25T13:00:00Z")])
                mutate(change)
                old_report, old_patch = copy.deepcopy(original), copy.deepcopy(change)
                with self.assertRaises(MODEL.ModelError):
                    MODEL.append_evidence(original, change)
                self.assertEqual(original, old_report)
                self.assertEqual(change, old_patch)
        # A good first check and an invalid second check publish nothing and mutate neither.
        change = patch_value(revision=2, evidence_log=[evidence("ev-002")])
        change["checks"].append(patch_value(check_id="DEP-01", status="invalid")["checks"][0])
        before = copy.deepcopy(original)
        with self.assertRaises(MODEL.ModelError):
            MODEL.append_evidence(original, change)
        self.assertEqual(original, before)


class ReportCLITests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.source = self.directory / "report-v1.json"
        self.source.write_bytes(MODEL.json_bytes(report()))
        self.patch_path = self.directory / "patch.json"
        self.patch_path.write_bytes(MODEL.json_bytes(patch_value()))

    def cli(self, *args):
        return subprocess.run([sys.executable, "-B", str(SCRIPT), *map(str, args)],
                              cwd=self.directory, capture_output=True, text=True,
                              encoding="utf-8", timeout=20, check=False)

    def assert_failure(self, result):
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "Could not manage report. Check the pre-sanitised schema, revision, bundled assets "
                         "and fresh output path. Inputs and existing files were not modified.\n")
        self.assertNotIn("SYNTHETIC_CANARY", result.stderr)
        self.assertNotIn(str(self.directory), result.stderr)
        self.assertFalse(list(self.directory.glob(".report-*")))

    def test_input_and_patch_two_megabyte_boundaries_and_nonfinite_values(self):
        old = self.source.read_bytes()
        self.source.write_bytes(old + b" " * (2_000_000 - len(old)))
        result = self.cli("validate", self.source)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.source.write_bytes(self.source.read_bytes() + b" ")
        self.assert_failure(self.cli("validate", self.source))
        self.source.write_bytes(old)
        old_patch = self.patch_path.read_bytes()
        self.patch_path.write_bytes(old_patch + b" " * (2_000_000 - len(old_patch)))
        output = self.directory / "bounded-v2.json"
        result = self.cli("append", self.source, "--patch", self.patch_path, "-o", output)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.patch_path.write_bytes(self.patch_path.read_bytes() + b" ")
        failed = self.directory / "oversized.json"
        self.assert_failure(self.cli("append", self.source, "--patch", self.patch_path, "-o", failed))
        self.assertFalse(failed.exists())
        self.assertEqual(self.source.read_bytes(), old)
        for number in (float("nan"), float("inf"), float("-inf")):
            value = report()
            value["revision"] = number
            with self.assertRaises(MODEL.ModelError):
                MODEL.validate_report(value)
        value = report()
        value["review_summary"]["overall_takeaway"] = "x" * 2_000_001
        with self.assertRaises(MODEL.ModelError):
            MODEL.validate_report(value)

    def test_cli_rejects_invalid_json_without_leaking_or_publishing(self):
        valid = MODEL.json_bytes(report())
        invalid = [b"", b"SYNTHETIC_CANARY", b"\xffSYNTHETIC_CANARY", b"{}\x00SYNTHETIC_CANARY",
                   b" " * 2_000_001, b"[" * 2000 + b"]" * 2000,
                   valid.replace(b'"revision": 1', b'"revision": 1, "revision": 2', 1),
                   valid.replace(b'"revision": 1', b'"revision": NaN', 1),
                   valid.replace(b'"revision": 1', b'"revision": Infinity', 1),
                   valid.replace(b'"not_reviewed"', b'"not_reviewed", "status": "satisfactory"', 1),
                   valid.replace(b'"schema_version": 1', b'"SYNTHETIC_CANARY": "SYNTHETIC_CANARY"', 1)]
        output = self.directory / "must-not-exist.md"
        for index, data in enumerate(invalid):
            with self.subTest(case=index):
                self.source.write_bytes(data)
                self.assert_failure(self.cli("build", self.source, "-o", output))
                self.assertEqual(self.source.read_bytes(), data)
                self.assertFalse(output.exists())
        self.source.write_bytes(valid)
        self.patch_path.write_bytes(b'{"expected_revision":1,"checks":[],"checks":[]}')
        self.assert_failure(self.cli("append", self.source, "--patch", self.patch_path, "-o", output))
        self.assertFalse(output.exists())

    def test_cli_rejects_stale_and_partly_valid_append_without_artifacts(self):
        output = self.directory / "report-v2.json"
        old = self.source.read_bytes()
        changes = [patch_value(revision=2), patch_value(evidence_log=[evidence(), evidence()])]
        partial = patch_value()
        partial["checks"].append(patch_value(check_id="DEP-01", status="invalid")["checks"][0])
        changes.append(partial)
        for value in changes:
            self.patch_path.write_bytes(MODEL.json_bytes(value))
            self.assert_failure(self.cli("append", self.source, "--patch", self.patch_path, "-o", output))
            self.assertFalse(output.exists())
            self.assertEqual(self.source.read_bytes(), old)

    def test_cli_fresh_paths_refuse_files_symlinks_directories_and_input_paths(self):
        target = self.directory / "preserve.txt"
        target.write_bytes(b"Preserve exactly.\x00\xff")
        os.chmod(target, 0o640)
        link = self.directory / "link.json"
        link.symlink_to(target)
        dangling = self.directory / "dangling.json"
        dangling.symlink_to(self.directory / "missing-target")
        original = self.source.read_bytes()
        original_patch = self.patch_path.read_bytes()
        for output in (target, link, dangling, self.source, self.patch_path, self.directory):
            with self.subTest(output=output.name):
                self.assert_failure(self.cli("append", self.source, "--patch", self.patch_path, "-o", output))
                self.assertEqual(self.source.read_bytes(), original)
                self.assertEqual(self.patch_path.read_bytes(), original_patch)
                self.assertEqual(target.read_bytes(), b"Preserve exactly.\x00\xff")
                self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o640)
                self.assertTrue(link.is_symlink())
                self.assertTrue(dangling.is_symlink())
        self.assert_failure(self.cli("build", self.source, "-o", self.source))

    def test_io_and_renderer_failures_leave_no_partial_publication(self):
        old = self.source.read_bytes()
        output = self.directory / "new.json"
        for operation in ("fsync", "link"):
            with self.subTest(operation=operation), patch.object(MODEL.os, operation, side_effect=OSError("SYNTHETIC_CANARY")):
                stdout, stderr = io.StringIO(), io.StringIO()
                with redirect_stdout(stdout), redirect_stderr(stderr):
                    code = MODEL.main(["append", str(self.source), "--patch", str(self.patch_path), "-o", str(output)])
                self.assertEqual(code, 1)
                self.assertEqual(stdout.getvalue(), "")
                self.assertNotIn("SYNTHETIC_CANARY", stderr.getvalue())
                self.assertFalse(output.exists())
                self.assertEqual(self.source.read_bytes(), old)
                self.assertFalse(list(self.directory.glob(".report-*")))
        with patch.object(Path, "read_bytes", side_effect=OSError("SYNTHETIC_CANARY")):
            stdout, stderr = io.StringIO(), io.StringIO()
            with redirect_stdout(stdout), redirect_stderr(stderr):
                code = MODEL.main(["build", str(self.source), "--format", "html", "-o", str(output)])
        self.assertEqual(code, 1)
        self.assertNotIn("SYNTHETIC_CANARY", stderr.getvalue())
        self.assertFalse(output.exists())
        self.assertFalse(list(self.directory.glob(".report-*")))

    def test_concurrent_same_path_has_one_winner_and_distinct_paths_can_branch(self):
        old = self.source.read_bytes()
        expected = MODEL.append_evidence(report(), patch_value())
        for index in range(3):
            output = self.directory / f"winner-{index}.json"
            command = [sys.executable, "-B", str(SCRIPT), "append", str(self.source),
                       "--patch", str(self.patch_path), "-o", str(output)]
            processes = [subprocess.Popen(command, cwd=self.directory, stdout=subprocess.PIPE,
                                          stderr=subprocess.PIPE, text=True) for _ in range(2)]
            for process in processes:
                process.communicate(timeout=20)
            self.assertEqual(sorted(p.returncode for p in processes), [0, 1])
            self.assertEqual(json.loads(output.read_bytes()), expected)
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
        branches = [self.directory / f"branch-{index}.json" for index in range(2)]
        processes = [subprocess.Popen(
            [sys.executable, "-B", str(SCRIPT), "append", str(self.source), "--patch", str(self.patch_path), "-o", str(output)],
            cwd=self.directory, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for output in branches]
        for process in processes:
            process.communicate(timeout=20)
            self.assertEqual(process.returncode, 0)
        self.assertEqual(branches[0].read_bytes(), branches[1].read_bytes())
        self.assertEqual(self.source.read_bytes(), old)
        self.assertFalse(list(self.directory.glob(".report-*")))

    def test_html_reuses_escaping_and_brand_without_templates_or_url_loading(self):
        value = report()
        value["review_summary"]["overall_takeaway"] = ('{{BODY}} <script>synthetic()</script> '
            '[unsafe](javascript:alert) [private](https://user:synthetic@example.test/docs) '
            '![pixel](https://example.test/pixel) $(touch never-execute)')
        self.source.write_bytes(MODEL.json_bytes(value))
        output = self.directory / "safe.html"
        result = self.cli("build", self.source, "--format", "html", "-o", output)
        self.assertEqual(result.returncode, 0, result.stderr)
        document = output.read_text()
        self.assertEqual(document, MODEL.render_report(MODEL.build_markdown(value)))
        self.assertIn("&lt;script&gt;synthetic()&lt;/script&gt;", document)
        self.assertNotIn("<script", document)
        self.assertNotIn('href="javascript:', document)
        self.assertNotIn('href="https://user:', document)
        self.assertNotIn("<img", document)
        self.assertIn("{{BODY}}", document)
        self.assertIn("Community-maintained", document)
        self.assertIn("Not endorsed by Vercel", document)
        self.assertFalse((self.directory / "never-execute").exists())
        self.assert_failure(self.cli("build", self.source, "--format", "html", "--lang", 'en" onload="synthetic', "-o", self.directory / "bad.html"))
        self.assertFalse((self.directory / "bad.html").exists())

    def test_private_permissions_even_with_restrictive_umask_and_safe_parser_errors(self):
        output = self.directory / "private.md"
        previous = os.umask(0o777)
        try:
            result = self.cli("build", self.source, "-o", output)
        finally:
            os.umask(previous)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
        result = self.cli("build", self.source, "--format", "SYNTHETIC_CANARY", "-o", output)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr, "Invalid report command. Use --help for usage.\n")
        self.assertNotIn("SYNTHETIC_CANARY", result.stderr)

    def test_cli_init_validate_append_build_and_export_summary(self):
        initial = self.directory / "initialized.json"
        result = self.cli("init", "--scope-alias", "example-team", "--title", "Synthetic configuration review", "-o", initial)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(initial.read_bytes(), self.source.read_bytes())
        result = self.cli("validate", initial)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("valid", result.stdout)
        original = self.source.read_bytes()
        revision = self.directory / "report-v2.json"
        result = self.cli("append", self.source, "--patch", self.patch_path, "-o", revision)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.source.read_bytes(), original)
        expected = MODEL.append_evidence(report(), patch_value())
        self.assertEqual(json.loads(revision.read_bytes()), expected)
        markdown = self.directory / "report.md"
        result = self.cli("build", revision, "-o", markdown)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(markdown.read_text(), MODEL.build_markdown(expected))
        html = self.directory / "report.html"
        result = self.cli("build", revision, "--format", "html", "-o", html)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(html.read_text(), MODEL.render_report(markdown.read_text()))
        summary = self.directory / "counts.json"
        result = self.cli("export-summary", revision, "-o", summary)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(summary.read_bytes()), MODEL.build_summary(expected))
        for path in (initial, revision, markdown, html, summary):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertFalse(list(self.directory.glob(".report-*")))


if __name__ == "__main__":
    unittest.main()
