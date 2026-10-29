"""Friendly summary times: fixed zones only, so results never depend on the test host."""
from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "vercel-security-audit"
SCRIPT = SKILL / "scripts" / "manage_report.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("friendly_time_model", SCRIPT)
MODEL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODEL)

try:
    from zoneinfo import ZoneInfo
    PARIS = ZoneInfo("Europe/Paris")
except Exception:  # No local tz database: zoneinfo-backed cases are skipped.
    PARIS = None
needs_tzdata = unittest.skipIf(PARIS is None, "No local time zone database for Europe/Paris")
try:
    LONDON = ZoneInfo("Europe/London")
except Exception:
    LONDON = None
needs_london = unittest.skipIf(LONDON is None or MODEL.reader_zone("Europe/London") is None,
                               "No local time zone database entry for Europe/London")
EVIDENCE = "- Evidence collected between (from observations): "


def utc(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def report_with_evidence(*times):
    value = MODEL.new_report("example-team", "Synthetic configuration review")
    log = [{"id": f"ev-{index:03}", "observed_at": moment, "source_kind": "browser",
            "source_description": "Synthetic metadata", "scope_alias": "example-project",
            "observed": "Synthetic.", "limitation": "Synthetic."} for index, moment in enumerate(times, 1)]
    patch_value = {"expected_revision": 1, "checks": [{
        "id": "CRE-01", "status": "needs_confirmation", "statement": "Synthetic.",
        "rationale": "Synthetic.", "evidence_log": log}]}
    return MODEL.append_evidence(value, patch_value)


class FriendlyWindowTests(unittest.TestCase):
    @needs_tzdata
    def test_issue_example_in_a_named_zone(self):
        self.assertEqual(
            MODEL.friendly_window(utc("2026-10-26T12:44:00Z"), utc("2026-10-26T13:40:00Z"), PARIS, "Europe/Paris"),
            "26 Oct 2026, 13:44-14:40 local time (CET, Europe/Paris; 12:44-13:40 UTC)")

    @needs_tzdata
    def test_summer_time_abbreviation_and_midnight_crossing(self):
        self.assertEqual(
            MODEL.friendly_window(utc("2026-07-01T12:00:00Z"), utc("2026-07-01T12:30:59Z"), PARIS, "Europe/Paris"),
            "1 Jul 2026, 14:00-14:30 local time (CEST, Europe/Paris; 12:00-12:30 UTC)")
        self.assertEqual(
            MODEL.friendly_window(utc("2026-10-26T22:30:00Z"), utc("2026-10-26T23:10:00Z"), PARIS, "Europe/Paris"),
            "26 Oct 2026, 23:30 - 27 Oct 2026, 00:10 local time (CET, Europe/Paris; 26 Oct 2026, 22:30-23:10 UTC)")

    @needs_tzdata
    def test_daylight_saving_change_names_both_abbreviations(self):
        text = MODEL.friendly_window(utc("2026-10-25T00:30:00Z"), utc("2026-10-25T01:30:00Z"), PARIS, "Europe/Paris")
        self.assertEqual(text, "25 Oct 2026, 02:30-02:30 local time (CEST to CET, Europe/Paris; 00:30-01:30 UTC)")

    def test_fixed_offset_zone_without_a_tz_database(self):
        zone = timezone(timedelta(hours=5, minutes=30))
        self.assertEqual(MODEL.friendly_window(utc("2026-10-26T12:44:00Z"), utc("2026-10-26T12:44:30Z"), zone),
                         "26 Oct 2026, 18:14 local time (UTC+05:30; 12:44 UTC)")
        zone = timezone(timedelta(hours=-3))
        self.assertEqual(MODEL.friendly_window(utc("2026-10-26T01:00:00Z"), utc("2026-10-26T02:00:00Z"), zone),
                         "25 Oct 2026, 22:00-23:00 local time (UTC-03:00; 26 Oct 2026, 01:00-02:00 UTC)")

    def test_unconvertible_times_fall_back_to_utc_only(self):
        zone = timezone(timedelta(hours=2))
        self.assertEqual(MODEL.friendly_window(utc("9999-12-31T23:00:00Z"), utc("9999-12-31T23:30:00Z"), zone),
                         "31 Dec 9999, 23:00-23:30 UTC (local time unavailable)")

    @needs_tzdata
    def test_local_zone_reads_tz_then_falls_back_without_network(self):
        with patch.dict(os.environ, {"TZ": "Europe/Paris"}), \
                patch("socket.socket", side_effect=AssertionError("network")), \
                patch("socket.getaddrinfo", side_effect=AssertionError("network")):
            zone, key = MODEL.local_zone()
        self.assertEqual((key, getattr(zone, "key", None)), ("Europe/Paris", "Europe/Paris"))
        for value in ("Not/AZone", "../../etc/passwd", "CET-1CEST"):
            with self.subTest(value=value), patch.dict(os.environ, {"TZ": value}):
                self.assertEqual(MODEL.local_zone(), (None, None))


class BuiltSummaryTests(unittest.TestCase):
    @needs_tzdata
    def test_summary_shows_friendly_window_and_appendix_keeps_exact_utc(self):
        value = report_with_evidence("2026-10-26T12:44:10Z", "2026-10-26T13:40:59Z")
        markdown = MODEL.build_markdown(value, PARIS)
        summary = markdown.split("## Review summary", 1)[1].split("\n## ", 1)[0]
        self.assertIn(EVIDENCE + "26 Oct 2026, 13:44-14:40 local time "
                      "(CET, Europe/Paris; 12:44-13:40 UTC), first to last logged observation.", summary)
        self.assertNotRegex(summary, r"\d{4}-\d{2}-\d{2}T")
        appendix = markdown.split("## Appendix: required core checks", 1)[1]
        self.assertIn("UTC: 2026-10-26T12:44:10Z", appendix)
        self.assertIn("UTC: 2026-10-26T13:40:59Z", appendix)
        self.assertEqual(markdown, MODEL.build_markdown(value, PARIS))

    def test_fixed_offset_zone_and_empty_evidence(self):
        value = report_with_evidence("2026-10-26T12:44:00Z")
        markdown = MODEL.build_markdown(value, timezone(timedelta(hours=1)))
        self.assertIn(EVIDENCE + "26 Oct 2026, 13:44 local time (UTC+01:00; 12:44 UTC)", markdown)
        empty = MODEL.new_report("example-team", "Synthetic configuration review")
        self.assertIn(EVIDENCE + "no observations logged yet.",
                      MODEL.build_markdown(empty, timezone.utc))

    @needs_tzdata
    def test_cli_build_uses_the_host_zone_from_tz(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output = root / "report.json", root / "report.md"
            source.write_bytes(MODEL.json_bytes(report_with_evidence("2026-07-01T12:00:00Z")))
            env = dict(os.environ, TZ="Europe/Paris")
            result = subprocess.run([sys.executable, "-I", "-B", str(SCRIPT), "build", str(source), "-o", str(output)],
                                    cwd=root, env=env, capture_output=True, text=True, timeout=20, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("1 Jul 2026, 14:00 local time (CEST, Europe/Paris; 12:00 UTC)", output.read_text())


def build_cli(root, value, tz, *, command="build"):
    source, output = root / "report.json", root / "report.md"
    source.write_bytes(json.dumps(value).encode("utf-8"))
    args = [sys.executable, "-I", "-B", str(SCRIPT), command, str(source)]
    if command == "build":
        args += ["-o", str(output)]
    result = subprocess.run(args, cwd=root, env=dict(os.environ, TZ=tz),
                            capture_output=True, text=True, timeout=20, check=False)
    return result, (output.read_text() if output.exists() else None)


def summary_of(markdown):
    return markdown.split("## Review summary", 1)[1].split("\n## ", 1)[0]


class ReaderTimeZoneTests(unittest.TestCase):
    @needs_london
    def test_recorded_zone_wins_over_tz_utc(self):
        value = report_with_evidence("2026-07-01T12:00:00Z", "2026-07-01T12:30:00Z")
        value["review_summary"]["time_zone"] = "Europe/London"
        MODEL.validate_report(value)
        with tempfile.TemporaryDirectory() as directory:
            result, markdown = build_cli(Path(directory), value, "UTC")
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = summary_of(markdown)
        self.assertIn("- Times shown in: Europe/London, the reader's time zone agreed at scope.", summary)
        self.assertIn(EVIDENCE + "1 Jul 2026, 13:00-13:30 local time (BST, Europe/London; 12:00-12:30 UTC)", summary)
        self.assertIn("UTC: 2026-07-01T12:00:00Z", markdown.split("## Appendix: required core checks", 1)[1])
        # The Python API also prefers the recorded zone over a host stand-in.
        with patch.dict(os.environ, {"TZ": "UTC"}):
            self.assertIn("(BST, Europe/London;", MODEL.build_markdown(value, timezone.utc))

    @needs_london
    def test_init_records_the_zone_and_append_preserves_it(self):
        value = MODEL.new_report("example-team", "Synthetic configuration review", "Europe/London")
        self.assertEqual(value["review_summary"]["time_zone"], "Europe/London")
        patch_value = {"expected_revision": 1, "checks": [{
            "id": "CRE-01", "status": "needs_confirmation", "statement": "Synthetic.", "rationale": "Synthetic.",
            "evidence_log": [{"id": "ev-001", "observed_at": "2026-10-26T12:44:00Z", "source_kind": "browser",
                              "source_description": "Synthetic metadata", "scope_alias": "example-project",
                              "observed": "Synthetic.", "limitation": "Synthetic."}]}]}
        self.assertEqual(MODEL.append_evidence(value, patch_value)["review_summary"]["time_zone"], "Europe/London")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "report.json"
            result = subprocess.run([sys.executable, "-I", "-B", str(SCRIPT), "init", "--scope-alias", "example-team",
                                     "--title", "Synthetic", "--time-zone", "Europe/London", "-o", str(output)],
                                    capture_output=True, text=True, timeout=20, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(output.read_text())["review_summary"]["time_zone"], "Europe/London")

    def test_invalid_zone_fails_validation_naming_the_field(self):
        for bad in ("Not/AZone", "europe/london", "../../etc/passwd", "/etc/localtime", "", " ", "Europe", 5, None,
                    "A" * 65):
            with self.subTest(bad=bad):
                value = MODEL.new_report("example-team", "Synthetic configuration review")
                value["review_summary"]["time_zone"] = bad
                with self.assertRaises(MODEL.ModelError) as caught:
                    MODEL.validate_report(value)
                self.assertIn("review_summary.time_zone", str(caught.exception))
        with self.assertRaises(MODEL.ModelError):
            MODEL.new_report("example-team", "Synthetic configuration review", "Not/AZone")
        value = MODEL.new_report("example-team", "Synthetic configuration review")
        value["review_summary"]["time_zone"] = "Not/AZone"
        with tempfile.TemporaryDirectory() as directory:
            for command in ("validate", "build"):
                with self.subTest(command=command):
                    result, markdown = build_cli(Path(directory), value, "UTC", command=command)
                    self.assertEqual(result.returncode, 1)
                    self.assertIn("review_summary.time_zone must be an IANA time zone name", result.stderr)
                    self.assertNotIn("Traceback", result.stderr)
                    self.assertNotIn("Not/AZone", result.stderr)
                    self.assertIsNone(markdown)
            output = Path(directory) / "init.json"
            result = subprocess.run([sys.executable, "-I", "-B", str(SCRIPT), "init", "--scope-alias", "example-team",
                                     "--title", "Synthetic", "--time-zone", "Mars/Olympus", "-o", str(output)],
                                    capture_output=True, text=True, timeout=20, check=False)
            self.assertEqual(result.returncode, 1)
            self.assertIn("review_summary.time_zone", result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertFalse(output.exists())

    @needs_tzdata
    def test_missing_zone_falls_back_to_the_host_zone_labelled_as_such(self):
        value = report_with_evidence("2026-07-01T12:00:00Z")
        self.assertNotIn("time_zone", value["review_summary"])
        with tempfile.TemporaryDirectory() as directory:
            result, markdown = build_cli(Path(directory), value, "Europe/Paris")
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = summary_of(markdown)
        self.assertIn("- Times shown in: the agent host's time zone (Europe/Paris); "
                      "no reader time zone was recorded.", summary)
        self.assertIn(EVIDENCE + "1 Jul 2026, 14:00 local time (CEST, Europe/Paris; 12:00 UTC)", summary)

    def test_host_fallback_label_without_a_zone_name(self):
        value = report_with_evidence("2026-10-26T12:44:00Z")
        summary = summary_of(MODEL.build_markdown(value, timezone(timedelta(hours=1))))
        self.assertIn("- Times shown in: the agent host's time zone (named by its UTC offset below)", summary)
        with patch.object(MODEL, "local_zone", return_value=(None, None)):
            summary = summary_of(MODEL.build_markdown(value))
        self.assertIn("- Times shown in: the agent host's local time zone (name unavailable)", summary)


class SummaryTimeLabelTests(unittest.TestCase):
    ZONE = timezone(timedelta(hours=1))

    def summary(self, reviewed_at, *times):
        value = report_with_evidence(*times) if times else MODEL.new_report("example-team", "Synthetic")
        value["review_summary"]["reviewed_at"] = reviewed_at
        return summary_of(MODEL.build_markdown(value, self.ZONE))

    def test_labels_are_distinct_and_old_labels_are_gone(self):
        text = self.summary("26 Oct 2026, 13:40-14:50 local time (UTC+01:00; 12:40-13:50 UTC)",
                            "2026-10-26T12:44:00Z", "2026-10-26T13:40:00Z")
        self.assertIn("- Review window (stated): 26 Oct 2026, 13:40-14:50 local time (UTC+01:00; 12:40-13:50 UTC)", text)
        self.assertIn(EVIDENCE + "26 Oct 2026, 13:44-14:40 local time (UTC+01:00; 12:44-13:40 UTC)", text)
        self.assertLess(text.index("Review window (stated)"), text.index("Evidence collected between"))
        for old in ("Reviewed at:", "Evidence recorded:", "Time check"):
            self.assertNotIn(old, text)

    def test_non_overlapping_windows_are_flagged(self):
        flag = "- Time check: the stated review window and the logged observation times do not overlap."
        cases = (
            ("26 Oct 2026, 09:00-09:30 local time (UTC+01:00; 08:00-08:30 UTC)", True),
            ("27 Oct 2026, 13:44 local time (UTC+01:00; 12:44 UTC)", True),
            ("26 Oct 2026, 23:30 - 27 Oct 2026, 00:10 local time (UTC+01:00; 26 Oct 2026, 22:30-23:10 UTC)", True),
            ("26 Oct 2026, 08:00-08:30 UTC (local time unavailable)", True),
            ("26 Oct 2026, 14:40 local time (UTC+01:00; 13:40 UTC)", False),  # Same minute as the last observation.
            ("26 Oct 2026, 13:00-13:44 local time (UTC+01:00; 12:00-12:44 UTC)", False),  # Touches the first.
            ("26 Oct 2026, morning", False),  # Not the friendly form: not parsed, no check.
            ("Not reviewed.", False),
        )
        for reviewed_at, flagged in cases:
            with self.subTest(reviewed_at=reviewed_at):
                text = self.summary(reviewed_at, "2026-10-26T12:44:00Z", "2026-10-26T13:40:59.900Z")
                self.assertEqual(flag in text, flagged)
        self.assertNotIn("Time check", self.summary("26 Oct 2026, 09:00-09:30 local time (UTC+01:00; 08:00-08:30 UTC)"))


class FriendlyTimeGuidanceTests(unittest.TestCase):
    def test_template_requires_friendly_local_summary_times_with_utc_elsewhere(self):
        text = (SKILL / "references" / "report-template.md").read_text(encoding="utf-8")
        summary = text.split("## Review summary", 1)[1].split("\n## ", 1)[0]
        for phrase in ("reader's time zone agreed at scope (recorded as `review_summary.time_zone`",
                       "followed by UTC",
                       "If no reader time zone was agreed, use the agent host's local time zone and say so",
                       "26 Oct 2026, 13:44-14:40 local time (CET, Europe/Paris; 12:44-13:40 UTC)",
                       "Do not infer the zone from the team's, customer's or reader's location",
                       "If the host zone is unknown, give the UTC window alone",
                       "Keep exact UTC timestamps in evidence records, coverage limits"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, summary)
        self.assertIn("friendly local time with UTC alongside", text.split("## Required components", 1)[1])

    def test_template_and_model_document_the_labels_and_zone(self):
        text = (SKILL / "references" / "report-template.md").read_text(encoding="utf-8")
        summary = text.split("## Review summary", 1)[1].split("\n## ", 1)[0]
        for phrase in ("- Times shown in:", "- Review window (stated):", "- Evidence collected between (from observations):",
                       "The review window is the period the author states the review took place; the evidence line is "
                       "derived from the timestamps of the logged observations", "add a `Time check` line"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, summary)
        self.assertNotIn("Reviewed at", text)
        model = (SKILL / "references" / "report-model.md").read_text(encoding="utf-8")
        for phrase in ("- `time_zone` (optional): the reader's IANA time zone name", "Never set it from team",
                       "`init --time-zone Europe/London`", "labelled as the agent host's zone"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, model)
        self.assertNotIn("Evidence recorded", model)

    def test_scope_step_asks_for_the_zone_once_with_a_host_default(self):
        text = (SKILL / "SKILL.md").read_text(encoding="utf-8")
        step = text.split("### 1. Agree scope", 1)[1].split("\n### ", 1)[0]
        ask = step.split("\n\n", 2)[1]
        self.assertIn("the reader's time zone for report times (an IANA name such as Europe/London; "
                      "default to the agent host's zone if they give none, and never infer it from team data)", ask)
        self.assertIn("in the same exchange", ask)
        self.assertEqual(text.count("reader's time zone"), 1)

    def test_example_summary_uses_the_friendly_form(self):
        text = (ROOT / "examples" / "security-audit.md").read_text(encoding="utf-8")
        summary = text.split("## Review summary", 1)[1].split("\n## ", 1)[0]
        self.assertIn("25 Oct 2026, 13:00-13:30 local time (CET, Europe/Paris; 12:00-12:30 UTC)", summary)

    @needs_tzdata
    def test_documented_examples_are_correct_for_their_zone(self):
        self.assertEqual(
            MODEL.friendly_window(utc("2026-10-25T12:00:00Z"), utc("2026-10-25T12:30:00Z"), PARIS, "Europe/Paris"),
            "25 Oct 2026, 13:00-13:30 local time (CET, Europe/Paris; 12:00-12:30 UTC)")


if __name__ == "__main__":
    unittest.main()
