// Friendly summary times: fixed zones only, so results never depend on the test host.
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as MODEL from "../skills/vercel-security-audit/scripts/manage-report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = path.join(ROOT, "skills", "vercel-security-audit");
const SCRIPT = path.join(SKILL, "scripts", "manage-report.mjs");

let PARIS = null;
try {
  PARIS = new MODEL.ZoneInfo("Europe/Paris");
} catch {
  PARIS = null; // No local tz database: zoneinfo-backed cases are skipped.
}
const needsTzdata = PARIS === null ? "No local time zone database for Europe/Paris" : false;
let LONDON = null;
try {
  LONDON = new MODEL.ZoneInfo("Europe/London");
} catch {
  LONDON = null;
}
const needsLondon = LONDON === null || MODEL.readerZone("Europe/London") === null
  ? "No local time zone database entry for Europe/London" : false;
const EVIDENCE = "- Evidence collected between (from observations): ";

function utc(text) {
  return BigInt(Date.parse(text)) * 1000n;
}

function reportWithEvidence(...times) {
  const value = MODEL.newReport("example-team", "Synthetic configuration review");
  const log = times.map((moment, index) => ({
    id: `ev-${String(index + 1).padStart(3, "0")}`, observed_at: moment, source_kind: "browser",
    source_description: "Synthetic metadata", scope_alias: "example-project",
    observed: "Synthetic.", limitation: "Synthetic.",
  }));
  const patchValue = { expected_revision: 1, checks: [{
    id: "CRE-01", status: "needs_confirmation", statement: "Synthetic.",
    rationale: "Synthetic.", evidence_log: log }] };
  return MODEL.appendEvidence(value, patchValue);
}

/** Run fn with process.env patched like unittest.mock.patch.dict(os.environ, values). */
function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function tempDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "friendly-times-")));
}

function summaryOf(markdown) {
  const marker = "## Review summary";
  return markdown.slice(markdown.indexOf(marker) + marker.length).split("\n## ")[0];
}

function afterFirst(text, marker) {
  return text.slice(text.indexOf(marker) + marker.length);
}

describe("FriendlyWindowTests", () => {
  test("issue example in a named zone", { skip: needsTzdata }, () => {
    assert.equal(
      MODEL.friendlyWindow(utc("2026-10-26T12:44:00Z"), utc("2026-10-26T13:40:00Z"), PARIS, "Europe/Paris"),
      "26 Oct 2026, 13:44-14:40 local time (CET, Europe/Paris; 12:44-13:40 UTC)");
  });

  test("summer time abbreviation and midnight crossing", { skip: needsTzdata }, () => {
    assert.equal(
      MODEL.friendlyWindow(utc("2026-07-01T12:00:00Z"), utc("2026-07-01T12:30:59Z"), PARIS, "Europe/Paris"),
      "1 Jul 2026, 14:00-14:30 local time (CEST, Europe/Paris; 12:00-12:30 UTC)");
    assert.equal(
      MODEL.friendlyWindow(utc("2026-10-26T22:30:00Z"), utc("2026-10-26T23:10:00Z"), PARIS, "Europe/Paris"),
      "26 Oct 2026, 23:30 - 27 Oct 2026, 00:10 local time (CET, Europe/Paris; 26 Oct 2026, 22:30-23:10 UTC)");
  });

  test("daylight saving change names both abbreviations", { skip: needsTzdata }, () => {
    const text = MODEL.friendlyWindow(utc("2026-10-25T00:30:00Z"), utc("2026-10-25T01:30:00Z"), PARIS, "Europe/Paris");
    assert.equal(text, "25 Oct 2026, 02:30-02:30 local time (CEST to CET, Europe/Paris; 00:30-01:30 UTC)");
  });

  test("fixed offset zone without a tz database", () => {
    let zone = new MODEL.FixedOffset(5 * 3600 + 30 * 60);
    assert.equal(MODEL.friendlyWindow(utc("2026-10-26T12:44:00Z"), utc("2026-10-26T12:44:30Z"), zone),
      "26 Oct 2026, 18:14 local time (UTC+05:30; 12:44 UTC)");
    zone = new MODEL.FixedOffset(-3 * 3600);
    assert.equal(MODEL.friendlyWindow(utc("2026-10-26T01:00:00Z"), utc("2026-10-26T02:00:00Z"), zone),
      "25 Oct 2026, 22:00-23:00 local time (UTC-03:00; 26 Oct 2026, 01:00-02:00 UTC)");
  });

  test("unconvertible times fall back to UTC only", () => {
    const zone = new MODEL.FixedOffset(2 * 3600);
    assert.equal(MODEL.friendlyWindow(utc("9999-12-31T23:00:00Z"), utc("9999-12-31T23:30:00Z"), zone),
      "31 Dec 9999, 23:00-23:30 UTC (local time unavailable)");
  });

  test("local zone reads TZ then falls back without network", { skip: needsTzdata }, () => {
    const network = () => {
      throw new assert.AssertionError({ message: "network" });
    };
    const mocks = [mock.method(net.Socket.prototype, "connect", network), mock.method(dns, "lookup", network)];
    let zone;
    let key;
    try {
      [zone, key] = withEnv({ TZ: "Europe/Paris" }, () => MODEL.localZone());
    } finally {
      for (const item of mocks) item.mock.restore();
    }
    assert.deepEqual([key, zone?.key ?? null], ["Europe/Paris", "Europe/Paris"]);
    for (const value of ["Not/AZone", "../../etc/passwd", "CET-1CEST"]) {
      assert.deepEqual(withEnv({ TZ: value }, () => MODEL.localZone()), [null, null], value);
    }
  });
});

describe("BuiltSummaryTests", () => {
  test("summary shows friendly window and appendix keeps exact UTC", { skip: needsTzdata }, () => {
    const value = reportWithEvidence("2026-10-26T12:44:10Z", "2026-10-26T13:40:59Z");
    const markdown = MODEL.buildMarkdown(value, PARIS);
    const summary = summaryOf(markdown);
    assert.ok(summary.includes(EVIDENCE + "26 Oct 2026, 13:44-14:40 local time "
      + "(CET, Europe/Paris; 12:44-13:40 UTC), first to last logged observation."));
    assert.doesNotMatch(summary, /\d{4}-\d{2}-\d{2}T/);
    const appendix = afterFirst(markdown, "## Appendix: required core checks");
    assert.ok(appendix.includes("UTC: 2026-10-26T12:44:10Z"));
    assert.ok(appendix.includes("UTC: 2026-10-26T13:40:59Z"));
    assert.equal(markdown, MODEL.buildMarkdown(value, PARIS));
  });

  test("fixed offset zone and empty evidence", () => {
    const value = reportWithEvidence("2026-10-26T12:44:00Z");
    const markdown = MODEL.buildMarkdown(value, new MODEL.FixedOffset(3600));
    assert.ok(markdown.includes(EVIDENCE + "26 Oct 2026, 13:44 local time (UTC+01:00; 12:44 UTC)"));
    const empty = MODEL.newReport("example-team", "Synthetic configuration review");
    assert.ok(MODEL.buildMarkdown(empty, MODEL.UTC).includes(EVIDENCE + "no observations logged yet."));
  });

  test("CLI build uses the host zone from TZ", { skip: needsTzdata }, () => {
    const root = tempDir();
    try {
      const source = path.join(root, "report.json");
      const output = path.join(root, "report.md");
      fs.writeFileSync(source, MODEL.jsonBytes(reportWithEvidence("2026-07-01T12:00:00Z")));
      const result = spawnSync(process.execPath, [SCRIPT, "build", source, "-o", output],
        { cwd: root, env: { ...process.env, TZ: "Europe/Paris" }, encoding: "utf8", timeout: 20000 });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(fs.readFileSync(output, "utf8").includes("1 Jul 2026, 14:00 local time (CEST, Europe/Paris; 12:00 UTC)"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function buildCli(root, value, tz, { command = "build" } = {}) {
  const source = path.join(root, "report.json");
  const output = path.join(root, "report.md");
  fs.writeFileSync(source, JSON.stringify(value));
  const args = [SCRIPT, command, source];
  if (command === "build") args.push("-o", output);
  const result = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, TZ: tz }, encoding: "utf8", timeout: 20000 });
  return [{ returncode: result.status, stdout: result.stdout, stderr: result.stderr },
    fs.existsSync(output) ? fs.readFileSync(output, "utf8") : null];
}

describe("ReaderTimeZoneTests", () => {
  test("recorded zone wins over TZ=UTC", { skip: needsLondon }, () => {
    const value = reportWithEvidence("2026-07-01T12:00:00Z", "2026-07-01T12:30:00Z");
    value.review_summary.time_zone = "Europe/London";
    MODEL.validateReport(value);
    const root = tempDir();
    let result;
    let markdown;
    try {
      [result, markdown] = buildCli(root, value, "UTC");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    assert.equal(result.returncode, 0, result.stderr);
    const summary = summaryOf(markdown);
    assert.ok(summary.includes("- Times shown in: Europe/London, the reader's time zone agreed at scope."));
    assert.ok(summary.includes(EVIDENCE + "1 Jul 2026, 13:00-13:30 local time (BST, Europe/London; 12:00-12:30 UTC)"));
    assert.ok(afterFirst(markdown, "## Appendix: required core checks").includes("UTC: 2026-07-01T12:00:00Z"));
    // The API also prefers the recorded zone over a host stand-in.
    withEnv({ TZ: "UTC" }, () => {
      assert.ok(MODEL.buildMarkdown(value, MODEL.UTC).includes("(BST, Europe/London;"));
    });
  });

  test("init records the zone and append preserves it", { skip: needsLondon }, () => {
    const value = MODEL.newReport("example-team", "Synthetic configuration review", "Europe/London");
    assert.equal(value.review_summary.time_zone, "Europe/London");
    const patchValue = { expected_revision: 1, checks: [{
      id: "CRE-01", status: "needs_confirmation", statement: "Synthetic.", rationale: "Synthetic.",
      evidence_log: [{ id: "ev-001", observed_at: "2026-10-26T12:44:00Z", source_kind: "browser",
        source_description: "Synthetic metadata", scope_alias: "example-project",
        observed: "Synthetic.", limitation: "Synthetic." }] }] };
    assert.equal(MODEL.appendEvidence(value, patchValue).review_summary.time_zone, "Europe/London");
    const root = tempDir();
    try {
      const output = path.join(root, "report.json");
      const result = spawnSync(process.execPath, [SCRIPT, "init", "--scope-alias", "example-team",
        "--title", "Synthetic", "--time-zone", "Europe/London", "-o", output], { encoding: "utf8", timeout: 20000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).review_summary.time_zone, "Europe/London");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("invalid zone fails validation naming the field", () => {
    for (const bad of ["Not/AZone", "europe/london", "../../etc/passwd", "/etc/localtime", "", " ", "Europe", 5, null,
      "A".repeat(65)]) {
      const value = MODEL.newReport("example-team", "Synthetic configuration review");
      value.review_summary.time_zone = bad;
      assert.throws(() => MODEL.validateReport(value), (error) => {
        assert.ok(error instanceof MODEL.ModelError, String(bad));
        assert.ok(error.message.includes("review_summary.time_zone"));
        return true;
      });
    }
    assert.throws(() => MODEL.newReport("example-team", "Synthetic configuration review", "Not/AZone"), MODEL.ModelError);
    const value = MODEL.newReport("example-team", "Synthetic configuration review");
    value.review_summary.time_zone = "Not/AZone";
    const root = tempDir();
    try {
      for (const command of ["validate", "build"]) {
        const [result, markdown] = buildCli(root, value, "UTC", { command });
        assert.equal(result.returncode, 1, command);
        assert.ok(result.stderr.includes("review_summary.time_zone must be an IANA time zone name"));
        assert.ok(!result.stderr.includes("Traceback"));
        assert.ok(!result.stderr.includes("Not/AZone"));
        assert.equal(markdown, null);
      }
      const output = path.join(root, "init.json");
      const result = spawnSync(process.execPath, [SCRIPT, "init", "--scope-alias", "example-team",
        "--title", "Synthetic", "--time-zone", "Mars/Olympus", "-o", output], { encoding: "utf8", timeout: 20000 });
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes("review_summary.time_zone"));
      assert.ok(!result.stderr.includes("Traceback"));
      assert.ok(!fs.existsSync(output));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("missing zone falls back to the host zone labelled as such", { skip: needsTzdata }, () => {
    const value = reportWithEvidence("2026-07-01T12:00:00Z");
    assert.ok(!Object.hasOwn(value.review_summary, "time_zone"));
    const root = tempDir();
    let result;
    let markdown;
    try {
      [result, markdown] = buildCli(root, value, "Europe/Paris");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    assert.equal(result.returncode, 0, result.stderr);
    const summary = summaryOf(markdown);
    assert.ok(summary.includes("- Times shown in: the agent host's time zone (Europe/Paris); "
      + "no reader time zone was recorded."));
    assert.ok(summary.includes(EVIDENCE + "1 Jul 2026, 14:00 local time (CEST, Europe/Paris; 12:00 UTC)"));
  });

  test("host fallback label without a zone name", () => {
    const value = reportWithEvidence("2026-10-26T12:44:00Z");
    let summary = summaryOf(MODEL.buildMarkdown(value, new MODEL.FixedOffset(3600)));
    assert.ok(summary.includes("- Times shown in: the agent host's time zone (named by its UTC offset below)"));
    // ES module exports cannot be patched; an unknown TZ makes localZone() return [null, null] instead.
    summary = withEnv({ TZ: "Not/AZone" }, () => {
      assert.deepEqual(MODEL.localZone(), [null, null]);
      return summaryOf(MODEL.buildMarkdown(value));
    });
    assert.ok(summary.includes("- Times shown in: the agent host's local time zone (name unavailable)"));
  });
});

describe("SummaryTimeLabelTests", () => {
  const ZONE = new MODEL.FixedOffset(3600);
  const summary = (reviewedAt, ...times) => {
    const value = times.length ? reportWithEvidence(...times) : MODEL.newReport("example-team", "Synthetic");
    value.review_summary.reviewed_at = reviewedAt;
    return summaryOf(MODEL.buildMarkdown(value, ZONE));
  };

  test("labels are distinct and old labels are gone", () => {
    const text = summary("26 Oct 2026, 13:40-14:50 local time (UTC+01:00; 12:40-13:50 UTC)",
      "2026-10-26T12:44:00Z", "2026-10-26T13:40:00Z");
    assert.ok(text.includes("- Review window (stated): 26 Oct 2026, 13:40-14:50 local time (UTC+01:00; 12:40-13:50 UTC)"));
    assert.ok(text.includes(EVIDENCE + "26 Oct 2026, 13:44-14:40 local time (UTC+01:00; 12:44-13:40 UTC)"));
    assert.ok(text.indexOf("Review window (stated)") < text.indexOf("Evidence collected between"));
    for (const old of ["Reviewed at:", "Evidence recorded:", "Time check"]) assert.ok(!text.includes(old), old);
  });

  test("non-overlapping windows are flagged", () => {
    const flag = "- Time check: the stated review window and the logged observation times do not overlap.";
    const cases = [
      ["26 Oct 2026, 09:00-09:30 local time (UTC+01:00; 08:00-08:30 UTC)", true],
      ["27 Oct 2026, 13:44 local time (UTC+01:00; 12:44 UTC)", true],
      ["26 Oct 2026, 23:30 - 27 Oct 2026, 00:10 local time (UTC+01:00; 26 Oct 2026, 22:30-23:10 UTC)", true],
      ["26 Oct 2026, 08:00-08:30 UTC (local time unavailable)", true],
      ["26 Oct 2026, 14:40 local time (UTC+01:00; 13:40 UTC)", false], // Same minute as the last observation.
      ["26 Oct 2026, 13:00-13:44 local time (UTC+01:00; 12:00-12:44 UTC)", false], // Touches the first.
      ["26 Oct 2026, morning", false], // Not the friendly form: not parsed, no check.
      ["Not reviewed.", false],
    ];
    for (const [reviewedAt, flagged] of cases) {
      const text = summary(reviewedAt, "2026-10-26T12:44:00Z", "2026-10-26T13:40:59.900Z");
      assert.equal(text.includes(flag), flagged, reviewedAt);
    }
    assert.ok(!summary("26 Oct 2026, 09:00-09:30 local time (UTC+01:00; 08:00-08:30 UTC)").includes("Time check"));
  });
});

describe("FriendlyTimeGuidanceTests", () => {
  test("template requires friendly local summary times with UTC elsewhere", () => {
    const text = fs.readFileSync(path.join(SKILL, "references", "report-template.md"), "utf8");
    const summary = summaryOf(text);
    for (const phrase of ["reader's time zone agreed at scope (recorded as `review_summary.time_zone`",
      "followed by UTC",
      "If no reader time zone was agreed, use the agent host's local time zone and say so",
      "26 Oct 2026, 13:44-14:40 local time (CET, Europe/Paris; 12:44-13:40 UTC)",
      "Do not infer the zone from the team's, customer's or reader's location",
      "If the host zone is unknown, give the UTC window alone",
      "Keep exact UTC timestamps in evidence records, coverage limits"]) {
      assert.ok(summary.includes(phrase), phrase);
    }
    assert.ok(afterFirst(text, "## Required components").includes("friendly local time with UTC alongside"));
  });

  test("template and model document the labels and zone", () => {
    const text = fs.readFileSync(path.join(SKILL, "references", "report-template.md"), "utf8");
    const summary = summaryOf(text);
    for (const phrase of ["- Times shown in:", "- Review window (stated):", "- Evidence collected between (from observations):",
      "The review window is the period the author states the review took place; the evidence line is "
      + "derived from the timestamps of the logged observations", "add a `Time check` line"]) {
      assert.ok(summary.includes(phrase), phrase);
    }
    assert.ok(!text.includes("Reviewed at"));
    const model = fs.readFileSync(path.join(SKILL, "references", "report-model.md"), "utf8");
    for (const phrase of ["- `time_zone` (optional): the reader's IANA time zone name", "Never set it from team",
      "`init --time-zone Europe/London`", "labelled as the agent host's zone"]) {
      assert.ok(model.includes(phrase), phrase);
    }
    assert.ok(!model.includes("Evidence recorded"));
  });

  test("scope step asks for the zone once with a host default", () => {
    const text = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
    const step = afterFirst(text, "### 1. Agree scope").split("\n### ")[0];
    const ask = step.split("\n\n")[1];
    assert.ok(ask.includes("the reader's time zone for report times (an IANA name such as Europe/London; "
      + "default to the agent host's zone if they give none, and never infer it from team data)"));
    assert.ok(ask.includes("in the same exchange"));
    assert.equal(text.split("reader's time zone").length - 1, 1);
  });

  test("example summary uses the friendly form", () => {
    const text = fs.readFileSync(path.join(ROOT, "examples", "security-audit.md"), "utf8");
    assert.ok(summaryOf(text).includes("25 Oct 2026, 13:00-13:30 local time (CET, Europe/Paris; 12:00-12:30 UTC)"));
  });

  test("documented examples are correct for their zone", { skip: needsTzdata }, () => {
    assert.equal(
      MODEL.friendlyWindow(utc("2026-10-25T12:00:00Z"), utc("2026-10-25T12:30:00Z"), PARIS, "Europe/Paris"),
      "25 Oct 2026, 13:00-13:30 local time (CET, Europe/Paris; 12:00-12:30 UTC)");
  });
});
