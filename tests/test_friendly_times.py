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
        self.assertIn("- Evidence recorded: 26 Oct 2026, 13:44-14:40 local time "
                      "(CET, Europe/Paris; 12:44-13:40 UTC), first to last logged observation.", summary)
        self.assertNotRegex(summary, r"\d{4}-\d{2}-\d{2}T")
        appendix = markdown.split("## Appendix: required core checks", 1)[1]
        self.assertIn("UTC: 2026-10-26T12:44:10Z", appendix)
        self.assertIn("UTC: 2026-10-26T13:40:59Z", appendix)
        self.assertEqual(markdown, MODEL.build_markdown(value, PARIS))

    def test_fixed_offset_zone_and_empty_evidence(self):
        value = report_with_evidence("2026-10-26T12:44:00Z")
        markdown = MODEL.build_markdown(value, timezone(timedelta(hours=1)))
        self.assertIn("- Evidence recorded: 26 Oct 2026, 13:44 local time (UTC+01:00; 12:44 UTC)", markdown)
        empty = MODEL.new_report("example-team", "Synthetic configuration review")
        self.assertIn("- Evidence recorded: no observations logged yet.",
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


class FriendlyTimeGuidanceTests(unittest.TestCase):
    def test_template_requires_friendly_local_summary_times_with_utc_elsewhere(self):
        text = (SKILL / "references" / "report-template.md").read_text(encoding="utf-8")
        summary = text.split("## Review summary", 1)[1].split("\n## ", 1)[0]
        for phrase in ("agent host's local time zone, followed by UTC",
                       "26 Oct 2026, 13:44-14:40 local time (CET, Europe/Paris; 12:44-13:40 UTC)",
                       "Do not infer the zone from the team's, customer's or reader's location",
                       "If the host zone is unknown, give the UTC window alone",
                       "Keep exact UTC timestamps in evidence records, coverage limits"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, summary)
        self.assertIn("friendly local time with UTC alongside", text.split("## Required components", 1)[1])

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
