"""Synthetic governance regressions at the model, CLI and optional public QA seams.

Set REPORT_QA_SCRIPT to an existing checkout's check_report.py for cross-issue
integration. The checker is imported read-only, never copied or modified.
"""
from contextlib import redirect_stderr, redirect_stdout
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest

from test_report_model import MODEL, OPTIONAL_IDS, evidence, patch_value, recommendation, report

UTC = "2026-10-25T12:00:00Z"
EARLIER = "2026-10-25T11:00:00Z"


def consent(check_id="DEP-04", decision="accepted"):
    return {"check_id": check_id, "decision": decision,
            "materials": [{"alias": "example-source", "scope_alias": "example-project",
                           "read_boundaries": ["auth-config"]}],
            "exclusions": ["unapproved-source"], "source_kind": "owner_statement",
            "owner_alias": "owner-role-1", "provenance": "Owner supplied scoped read permission.",
            "statement_at": EARLIER, "approved_at": EARLIER}


def authorize(value, check_id="DEP-04", decision="accepted"):
    value["scope"]["optional_consent"] = [consent(check_id, decision) if c["check_id"] == check_id else c
                                            for c in value["scope"]["optional_consent"]]
    return value


def window():
    return {"requested_start": EARLIER, "requested_end": UTC, "covered_start": None,
            "covered_end": None, "retention_boundary": None}


def feed(identifier="coverage-1", **changes):
    value = {"id": identifier, "feed_id": "metadata-feed", "usage": "used", "check_ids": ["CRE-01"],
             "source_kind": "cli", "source_description": "Synthetic metadata inventory",
             "scope_alias": "example-project", "material_alias": None, "read_boundary": None,
             "observed_at": UTC, "window": window(), "reported_total": 100, "count_basis": "Product aggregate, not proof of inspection.",
             "received": 10, "inspected": 2, "page_cap": 10, "overall_cap": None,
             "next_available": None, "exhausted": None, "truncated": True, "outcome": "partial",
             "failure_kind": "none", "missing_sources": "Earlier window unavailable.",
             "assessment_effect": "CRE-01 remains needs_confirmation; no absence claim.", "retries": []}
    value.update(changes)
    return value


def retry(identifier="retry-1", **changes):
    value = {"id": identifier, "attempted_at": UTC, "window": window(),
             "outcome": "timed_out", "failure_kind": "timeout", "remaining_gaps": "Window remains incomplete."}
    value.update(changes)
    return value


def answer(identifier="owner-answer-1", check_id="CRE-01", **changes):
    value = {"id": identifier, "check_id": check_id, "scope_alias": "example-project",
             "owner_alias": "owner-role-1", "source_kind": "owner_statement", "statement_at": UTC,
             "metadata_observed_at": None, "evidence_refs": [], "answer": "Scoped count unavailable; expiry visibility unresolved."}
    value.update(changes)
    return value


class GovernanceTests(unittest.TestCase):
    def invalid(self, value):
        before = copy.deepcopy(value)
        with self.assertRaises(MODEL.ModelError) as caught:
            MODEL.validate_report(value)
        self.assertNotIn("SYNTHETIC_CANARY", str(caught.exception))
        self.assertEqual(value, before)

    def test_empty_draft_has_mandatory_unknown_coverage_per_id_consent_and_three_questions(self):
        value = report()
        self.assertEqual(value["coverage_limits"], [])
        self.assertEqual(value["owner_confirmations"], [])
        self.assertIn("coverage is unknown", value["scope"]["limitations"])
        self.assertNotIn("optional_authorized", value["scope"])
        ledger = value["scope"]["optional_consent"]
        self.assertEqual([item["check_id"] for item in ledger], list(OPTIONAL_IDS))
        self.assertTrue(all(item["decision"] == "not_requested" and not item["materials"] for item in ledger))
        markdown = MODEL.build_markdown(value)
        for heading in ("## Coverage limits", "### Optional scope decisions", "### Owner confirmation questionnaire"):
            self.assertEqual(markdown.count(heading), 1)
        self.assertIn("No collection recorded; coverage is unknown", markdown)
        self.assertNotIn("coverage is complete", markdown.lower())
        for identifier in ("CRE-01", "IAM-02", "OPS-01"):
            self.assertIn("#### " + identifier + " - ", markdown)
        self.assertEqual(markdown.count("Answer state: not answered"), 3)
        for phrase in ("token values", "recovery codes", "webhook URLs", "owner_statement", "No automatic", "not observed configuration"):
            self.assertIn(phrase, markdown)

    def test_all_feed_fields_roundtrip_and_render_with_failures_retries_and_unknowns(self):
        value = report()
        value["coverage_limits"] = [feed(retries=[retry()])]
        value["owner_confirmations"] = [answer()]
        MODEL.validate_report(value)
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "draft.json"
            source.write_bytes(MODEL.json_bytes(value))
            restored = MODEL.load_json(source)
        self.assertEqual(restored, value)
        markdown = MODEL.build_markdown(restored)
        labels = ("Source/feed:", "Window:", "Reported total:", "Received:", "Inspected:",
                  "Page/finding cap:", "Truncation:", "Cursor availability:", "End known:",
                  "Missing sources:", "Timeouts/failures:", "Retries and outcomes:", "Assessment effect:")
        for label in labels:
            self.assertIn(label, markdown)
        for text in ("coverage-1", "metadata-feed", "used", "partial", "cli", "Synthetic metadata inventory",
                     "example-project", UTC, EARLIER, "100", "10", "2", "unknown", "retry-1", "timed_out", "timeout",
                     "Window remains incomplete.", "Product aggregate, not proof of inspection.",
                     "Earlier window unavailable.", "CRE-01 remains needs_confirmation; no absence claim."):
            self.assertIn(text, markdown)
        self.assertIn("Source: owner_statement", markdown)
        self.assertIn("owner-role-1", markdown)
        self.assertIn("Metadata observed at: unknown", markdown)
        self.assertEqual(markdown.count("Answer state: not answered"), 2)
        self.assertIn(answer()["answer"], markdown)
        self.assertTrue(all(c["status"] == "not_reviewed" for c in value["checks"]))

    def test_tri_states_nullable_counts_and_planned_feed_are_not_inferred_complete(self):
        for state in (None, False, True):
            value = report()
            value["coverage_limits"] = [feed(next_available=state, exhausted=state, truncated=state)]
            MODEL.validate_report(value)
            self.assertIn("partial", MODEL.build_markdown(value))
        value = report()
        value["coverage_limits"] = [feed(usage="planned", outcome="not_collected", received=None, inspected=None,
                                        reported_total=None, page_cap=None, truncated=None)]
        MODEL.validate_report(value)
        self.assertIn("not_collected", MODEL.build_markdown(value))
        self.assertIn("unknown", MODEL.build_markdown(value))
        complete = feed(outcome="complete", next_available=False, exhausted=True, truncated=False)
        value["coverage_limits"] = [complete]
        MODEL.validate_report(value)
        self.assertEqual(value["coverage_limits"][0]["inspected"], 2)  # Collection != individual inspection.
        complete["exhausted"] = None
        self.invalid(value)

    def test_feed_validation_strict_counts_windows_states_outcomes_and_failure_metadata(self):
        changes = [dict(received=-1), dict(received=True), dict(inspected=11), dict(inspected=1.5),
                   dict(reported_total="100"), dict(page_cap=True), dict(overall_cap=-1),
                   dict(next_available="unknown"), dict(exhausted=0), dict(truncated="yes"),
                   dict(outcome="successful"), dict(usage="unknown"), dict(source_kind="scan"),
                   dict(check_ids=["CRE-04"]), dict(check_ids=["CRE-01", "CRE-01"]),
                   dict(observed_at="2026-10-25T12:00:00+00:00"), dict(failure_kind="SYNTHETIC_CANARY"),
                   dict(outcome="timed_out", failure_kind="none"), dict(raw_error="SYNTHETIC_CANARY"),
                   dict(window={"requested_start": UTC}), dict(retries=[retry(raw_error="SYNTHETIC_CANARY")])]
        for change in changes:
            with self.subTest(change=change):
                value = report()
                value["coverage_limits"] = [feed(**change)]
                self.invalid(value)
        for fields in ({"requested_start": UTC, "requested_end": EARLIER},
                       {"covered_start": EARLIER, "covered_end": None},
                       {"covered_start": EARLIER, "covered_end": "2026-10-25T13:00:00Z"}):
            value = report()
            w = window()
            w.update(fields)
            value["coverage_limits"] = [feed(window=w)]
            self.invalid(value)
        value = report()
        value["coverage_limits"] = [feed(), feed()]
        self.invalid(value)
        value["coverage_limits"] = [feed(retries=[retry(), retry()])]
        self.invalid(value)

    def test_per_id_accepted_and_partial_consent_never_grants_other_ids_or_material(self):
        for decision in ("accepted", "partial"):
            value = authorize(report(), decision=decision)
            entry = evidence(material_alias="example-source", read_boundary="auth-config")
            change = patch_value(check_id="DEP-04", evidence_log=[entry])
            updated = MODEL.append_evidence(value, change)
            self.assertEqual(MODEL.build_summary(updated)["optional"]["needs_confirmation"], 1)
            markdown = MODEL.build_markdown(updated)
            self.assertIn("Decision: " + decision, markdown)
            for text in ("example-source", "auth-config", "unapproved-source", "Owner supplied scoped read permission.", EARLIER):
                self.assertIn(text, markdown)
            for wrong in (dict(scope_alias="unapproved-project"), dict(material_alias="unapproved-source"),
                          dict(read_boundary="source-bodies"), dict(observed_at="2026-10-25T10:59:59Z")):
                before = copy.deepcopy(value)
                with self.assertRaises(MODEL.ModelError):
                    MODEL.append_evidence(value, patch_value(check_id="DEP-04", evidence_log=[evidence(
                        **(dict(material_alias="example-source", read_boundary="auth-config") | wrong))]))
                self.assertEqual(value, before)
            with self.assertRaises(MODEL.ModelError):
                MODEL.append_evidence(value, patch_value(check_id="SRC-04", evidence_log=[entry]))

    def test_declined_and_not_requested_require_unreviewed_empty_history(self):
        for decision in ("declined", "not_requested"):
            value = report()
            item = value["scope"]["optional_consent"][0]
            item["decision"] = decision
            if decision == "declined":
                item.update(owner_alias="owner-role-1", provenance="Owner declined.", statement_at=UTC)
            MODEL.validate_report(value)
            self.assertIn("Decision: " + decision, MODEL.build_markdown(value))
            for status, log in (("needs_confirmation", []), ("not_reviewed", [evidence()])):
                draft = copy.deepcopy(value)
                draft["checks"][24].update(status=status, evidence_log=log)
                self.invalid(draft)

    def test_consent_is_strict_complete_and_legacy_global_boolean_fails_closed(self):
        for flag in (False, True):
            value = report()
            del value["scope"]["optional_consent"]
            value["scope"]["optional_authorized"] = flag
            self.invalid(value)
        for change in (dict(decision="yes"), dict(approved_at=None), dict(owner_alias=None),
                       dict(provenance=None), dict(statement_at=None), dict(source_kind="browser"),
                       dict(materials=[]), dict(exclusions=["example-source"]), dict(extra="SYNTHETIC_CANARY")):
            value = authorize(report())
            value["scope"]["optional_consent"][0].update(change)
            self.invalid(value)
        for transform in (lambda l: l.pop(), lambda l: l.append(copy.deepcopy(l[0])),
                          lambda l: l[0].update(check_id="DEP-03")):
            value = report()
            transform(value["scope"]["optional_consent"])
            self.invalid(value)

    def test_optional_coverage_cannot_cross_consent_boundaries(self):
        value = authorize(report())
        value["coverage_limits"] = [feed(check_ids=["DEP-04"], material_alias="example-source", read_boundary="auth-config")]
        MODEL.validate_report(value)
        value["coverage_limits"][0]["check_ids"].append("SRC-04")
        self.invalid(value)

    def test_retries_cannot_claim_collection_before_consent_or_on_uncollected_feeds(self):
        value = authorize(report())
        value["coverage_limits"] = [feed(check_ids=["DEP-04"], material_alias="example-source", read_boundary="auth-config",
                                       retries=[retry(attempted_at="2026-10-25T10:59:59Z")])]
        self.invalid(value)
        value = report()
        value["coverage_limits"] = [feed(usage="planned", outcome="not_collected", received=None, inspected=None,
                                        reported_total=None, page_cap=None, truncated=None, retries=[retry()])]
        self.invalid(value)
        value = authorize(report(), decision="partial")
        value["scope"]["optional_consent"][0]["exclusions"] = []
        self.invalid(value)

    def test_governance_history_is_chronological_and_record_ids_are_global(self):
        value = report()
        value["coverage_limits"] = [feed(), feed("coverage-2", observed_at=EARLIER)]
        self.invalid(value)
        value["coverage_limits"] = [feed()]
        value["owner_confirmations"] = [answer(identifier="coverage-1")]
        self.invalid(value)
        value["owner_confirmations"] = [answer(), answer("owner-answer-2", statement_at=EARLIER)]
        self.invalid(value)
        value = MODEL.append_evidence(report(), patch_value())
        value["coverage_limits"] = [feed(identifier="ev-001")]
        self.invalid(value)
        value = MODEL.append_evidence(report(), patch_value())
        value["owner_confirmations"] = [answer(evidence_refs=["ev-001"], metadata_observed_at=UTC)]
        MODEL.validate_report(value)
        self.assertIn("Separately observed evidence: ev-001", MODEL.build_markdown(value))
        value["owner_confirmations"][0]["scope_alias"] = "different-project"
        self.invalid(value)

    def test_metadata_only_cli_publication_is_private_complete_and_preserves_input(self):
        value = report()
        change = {"expected_revision": 1, "coverage_limits": [feed(retries=[retry()])],
                  "owner_confirmations": [answer(), answer("owner-answer-2", "IAM-02"), answer("owner-answer-3", "OPS-01")]}
        with tempfile.TemporaryDirectory() as directory:
            source, patch_path, output = (Path(directory) / name for name in ("input.json", "patch.json", "revision-2.json"))
            source.write_bytes(MODEL.json_bytes(value))
            patch_path.write_bytes(MODEL.json_bytes(change))
            old_source, old_patch = source.read_bytes(), patch_path.read_bytes()
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                code = MODEL.main(["append", str(source), "--patch", str(patch_path), "-o", str(output)])
            self.assertEqual(code, 0)
            restored = MODEL.load_json(output)
            self.assertEqual(restored["coverage_limits"], change["coverage_limits"])
            self.assertEqual(restored["owner_confirmations"], change["owner_confirmations"])
            self.assertEqual(restored["checks"], value["checks"])
            self.assertEqual(restored["revision"], 2)
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(source.read_bytes(), old_source)
            self.assertEqual(patch_path.read_bytes(), old_patch)
            self.assertFalse(list(Path(directory).glob(".report-*")))

    def test_owner_records_strict_self_statements_dates_and_no_access_or_status_changes(self):
        value = report()
        value["owner_confirmations"] = [answer(), answer("owner-answer-2", "IAM-02"), answer("owner-answer-3", "OPS-01")]
        MODEL.validate_report(value)
        markdown = MODEL.build_markdown(value)
        self.assertNotIn("Answer state: not answered", markdown)
        self.assertEqual(value["checks"], report()["checks"])
        for changes in (dict(source_kind="browser"), dict(owner_alias="personal/name"), dict(check_id="DEP-04"),
                        dict(statement_at=None), dict(statement_at="not UTC"), dict(answer=" "), dict(answer="x" * 8001),
                        dict(metadata_observed_at="2026-02-30T00:00:00Z"), dict(evidence_refs=["missing-evidence"]),
                        dict(raw_message="SYNTHETIC_CANARY")):
            draft = report()
            draft["owner_confirmations"] = [answer(**changes)]
            self.invalid(draft)

    def test_metadata_only_and_mixed_append_preserve_history_narratives_and_revision_once(self):
        original = report()
        original["recommendations"] = [recommendation()]
        original["review_summary"]["overall_takeaway"] = "Keep this Owner-authored narrative."
        before = copy.deepcopy(original)
        change = {"expected_revision": 1, "coverage_limits": [feed()], "owner_confirmations": [answer()]}
        updated = MODEL.append_evidence(original, change)
        self.assertEqual(original, before)
        self.assertEqual(updated["revision"], 2)
        self.assertEqual(updated["checks"], original["checks"])
        next_patch = patch_value(revision=2)
        next_patch.update(coverage_limits=[feed("coverage-2")], owner_confirmations=[answer("owner-answer-2")])
        third = MODEL.append_evidence(updated, next_patch)
        self.assertEqual(third["revision"], 3)
        self.assertEqual(third["coverage_limits"], [feed(), feed("coverage-2")])
        self.assertEqual(third["owner_confirmations"], [answer(), answer("owner-answer-2")])
        for key in ("recommendations", "review_summary", "scope", "follow_up"):
            self.assertEqual(third[key], original[key])
        for bad in ({"expected_revision": 2}, {"expected_revision": 2, "checks": [], "coverage_limits": [], "owner_confirmations": []},
                    {"expected_revision": 2, "coverage_limits": [feed()]},
                    {"expected_revision": 2, "owner_confirmations": [answer()]},
                    {"expected_revision": 1, "owner_confirmations": [answer("new-answer")]},
                    {"expected_revision": 2, "optional_consent": []}):
            old = copy.deepcopy(updated)
            with self.assertRaises(MODEL.ModelError):
                MODEL.append_evidence(updated, bad)
            self.assertEqual(updated, old)

    def test_failed_mixed_cli_append_publishes_nothing_and_leaks_no_values(self):
        value = report()
        change = patch_value()
        change.update(coverage_limits=[feed()], owner_confirmations=[answer(source_kind="SYNTHETIC_CANARY")])
        with tempfile.TemporaryDirectory() as directory:
            source, patch_path, output = (Path(directory) / name for name in ("input.json", "patch.json", "new.json"))
            source.write_bytes(MODEL.json_bytes(value))
            patch_path.write_bytes(MODEL.json_bytes(change))
            original = source.read_bytes()
            stdout, stderr = io.StringIO(), io.StringIO()
            with redirect_stdout(stdout), redirect_stderr(stderr):
                code = MODEL.main(["append", str(source), "--patch", str(patch_path), "-o", str(output)])
            self.assertEqual(code, 1)
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(stdout.getvalue(), "")
            self.assertNotIn("SYNTHETIC_CANARY", stderr.getvalue())
            self.assertFalse(output.exists())
            self.assertFalse(list(Path(directory).glob(".report-*")))

    @unittest.skipUnless(os.environ.get("REPORT_QA_SCRIPT"), "Set REPORT_QA_SCRIPT for external current QA integration")
    def test_json_markdown_html_passes_current_public_qa_and_governance_headers(self):
        spec = importlib.util.spec_from_file_location("public_report_qa", os.environ["REPORT_QA_SCRIPT"])
        qa = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(qa)
        value = MODEL.append_evidence(report(), patch_value())
        value = MODEL.append_evidence(value, {"expected_revision": 2, "coverage_limits": [feed()], "owner_confirmations": [answer()]})
        optional = authorize(copy.deepcopy(value), decision="partial")
        optional = MODEL.append_evidence(optional, patch_value(revision=3, check_id="DEP-04", evidence_log=[evidence(
            "ev-optional", material_alias="example-source", read_boundary="auth-config")]))
        self.assertEqual(MODEL.build_summary(optional)["optional"]["needs_confirmation"], 1)
        for case in (report(), value, optional):
            with self.subTest(revision=case["revision"]):
                restored = json.loads(MODEL.json_bytes(case))
                document = qa.Document(MODEL.render_report(MODEL.build_markdown(restored))).root
                qa.check_passive(document)
                counts, outcomes = qa.check_counts(document)
                qa.check_summary(MODEL.build_summary(restored), counts)
                self.assertEqual(sum(counts["core"].values()), 24)
                self.assertEqual(sum(counts["optional"].values()), 4)
                self.assertEqual(qa.check_evidence([{"topic_id": c["id"], "status": c["status"]} for c in restored["checks"]], outcomes), "matched all 28 checks")
                headings = [h.text for level in ("h2", "h3", "h4") for h in document.find(level)]
                for text in ("Coverage limits", "Optional scope decisions", "Owner confirmation questionnaire"):
                    self.assertIn(text, headings)
                for check_id in ("CRE-01", "IAM-02", "OPS-01"):
                    self.assertTrue(any(h.startswith(check_id + " - Owner") for h in headings))


if __name__ == "__main__":
    unittest.main()
