// Synthetic, offline tests at the report model API and local CLI boundaries.
import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL, CORE_IDS, OPTIONAL_IDS, report, evidence, patchValue, recommendation } from "./report-model-fixtures.mjs";
import * as checker from "../skills/vercel-security-audit/scripts/check-report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "skills/vercel-security-audit/scripts/manage-report.mjs");
const clone = (value) => structuredClone(value);
const SYNTHETIC_CANARY = "SYNTHETIC_CANARY";

function matrixLines(value) {
  const statuses = Object.fromEntries(value.checks.map((check) => [check.id, check.status]));
  const lines = [];
  for (const [label, identifiers] of [["Check", CORE_IDS], ["Optional check", OPTIONAL_IDS]]) {
    lines.push(`| ${label} | ${value.scope_alias} |`, "| --- | --- |");
    lines.push(...identifiers.map((identifier) => `| ${identifier} ${MODEL.CHECK_TITLES[identifier]} | ${statuses[identifier]} |`));
  }
  return lines;
}

const pipeLines = (markdown) => markdown.split("\n").filter((line) => line.startsWith("|"));

describe("ReportModelTests", () => {
  test("append changes only supplied checks, retains history and owned fields", () => {
    const original = report();
    original.review_summary.overall_takeaway = "Owner-authored summary: preserve café.";
    original.recommendations = [recommendation()];
    const before = clone(original);
    const firstPatch = patchValue();
    firstPatch.checks.push(patchValue(1, "DEP-01", { evidence_log: [evidence("ev-002")] }).checks[0]);
    const first = MODEL.appendEvidence(original, firstPatch);
    assert.deepEqual(original, before);
    assert.equal(first.revision, 2); // One increment for the whole patch.
    const byId = Object.fromEntries(first.checks.map((check) => [check.id, check]));
    for (const old of original.checks) {
      if (!["CRE-01", "DEP-01"].includes(old.id)) assert.deepEqual(byId[old.id], old);
    }
    assert.deepEqual(first.review_summary, original.review_summary);
    assert.deepEqual(first.recommendations, original.recommendations);
    assert.deepEqual(first.scope, original.scope);
    assert.deepEqual(first.follow_up, original.follow_up);
    const second = MODEL.appendEvidence(first, patchValue(2, "CRE-01", {
      statement: "Later view shows an expiry; conflict unresolved.",
      evidence_log: [evidence("ev-003", "2026-10-25T12:01:00Z", { observed: "Expiry is shown." })],
    }));
    const updated = second.checks.find((check) => check.id === "CRE-01");
    assert.deepEqual(updated.evidence_log, [evidence(), evidence("ev-003", "2026-10-25T12:01:00Z", { observed: "Expiry is shown." })]);
    assert.equal(updated.status, "needs_confirmation");
    assert.equal(second.revision, 3);
    assert.equal(first.revision, 2);
    assert.equal(MODEL.buildSummary(second).core.needs_confirmation, 2);
  });

  test("markdown is deterministic, complete and guided without promotions", () => {
    const value = MODEL.appendEvidence(report(), patchValue());
    value.recommendations = [recommendation()];
    value.review_summary.initial_priorities = ["Confirm CRE-01 with the Team Owner."];
    value.review_summary.overall_takeaway = "Evidence remains incomplete.";
    const before = clone(value);
    const markdown = MODEL.buildMarkdown(value);
    assert.equal(markdown, MODEL.buildMarkdown(value));
    assert.deepEqual(value, before);
    assert.ok(markdown.startsWith("# Synthetic configuration review\n"));
    assert.equal(markdown.split("\nStatus: ").length - 1, 28);
    for (const identifier of [...CORE_IDS, ...OPTIONAL_IDS]) {
      assert.equal((markdown.match(new RegExp("^### " + identifier + " - ", "gm")) || []).length, 1);
    }
    for (const text of ["Revision: 2", "Core coverage (24)", "Optional coverage (4)",
      "Source/application review:", "Optional scope decisions", "Decision: not_requested",
      "Status: needs_confirmation", "ev-001", "2026-10-25T12:00:00Z",
      "browser", "Synthetic owner-visible metadata", "example-project",
      "Expiry is not shown.", "An absent field does not establish disabled expiry.",
      "Who: Team Owner", "Before changing: Confirm authorized scope.",
      "1. Confirm supported metadata visibility.", "2. Record the owner requirement.",
      "Done when: Visibility and intent are documented.",
      "Impact / rollback: Confirmation only; no configuration changes.",
      "Docs: Verification pending.", "Evidence remains incomplete."]) {
      assert.ok(markdown.includes(text), text);
    }
    assert.ok(!markdown.includes("Status: satisfactory"));
    // The only pipe-table lines are the generated status matrix (core then optional).
    assert.deepEqual(pipeLines(markdown), matrixLines(value));
  });

  test("status matrix opens built report and authored text cannot add rows", () => {
    const value = MODEL.appendEvidence(report(), patchValue());
    const injected = "| IAM-01 Team membership and roles | satisfactory |";
    value.title = injected;
    value.review_summary.overall_takeaway = injected;
    value.review_summary.initial_priorities = [injected];
    value.recommendations = [{ ...recommendation(), steps: [injected], title: injected }];
    const markdown = MODEL.buildMarkdown(value);
    const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    assert.deepEqual(headings.slice(0, 2), ["Status at a glance", "Review summary"]);
    assert.deepEqual(pipeLines(markdown), matrixLines(value));
    assert.ok(markdown.includes("| CRE-01 Credential scope and expiry metadata | needs_confirmation |"));
    assert.ok(markdown.includes("no per-project columns"));
    // Matrix badges render but are not counted: the appendix still yields 28 outcomes.
    const root = new checker.Document(MODEL.renderReport(markdown)).root;
    checker.checkPassive(root);
    const [counts, outcomes] = checker.checkCounts(root);
    assert.deepEqual(counts, MODEL.buildSummary(value));
    assert.deepEqual(checker.checkMatrix(root, outcomes), ["matched all 28 checks", []]);
    assert.equal(root.find("table").length, 2);
  });

  test("init validates every check without claiming review", () => {
    const value = report();
    const before = clone(value);
    MODEL.validateReport(value);
    assert.deepEqual(value, before);
    assert.equal(value.schema_version, 1);
    assert.equal(value.revision, 1);
    assert.deepEqual(value.checks.map((check) => check.id), [...CORE_IDS, ...OPTIONAL_IDS]);
    assert.ok(value.checks.every((check) => check.status === "not_reviewed" && check.rationale
      && check.evidence_log.length === 0));
    assert.ok(value.scope.optional_consent.every((item) => item.decision === "not_requested"));
    assert.deepEqual(MODEL.buildSummary(value), {
      core: { satisfactory: 0, action_recommended: 0, needs_confirmation: 0, not_reviewed: 24, not_applicable: 0 },
      optional: { satisfactory: 0, action_recommended: 0, needs_confirmation: 0, not_reviewed: 4, not_applicable: 0 },
    });
  });
});

describe("DocumentationTests", () => {
  test("documented patch runs and exports the documented summary", () => {
    const references = path.join(path.dirname(SCRIPT), "..", "references");
    const blocks = [...fs.readFileSync(path.join(references, "report-model.md"), "utf8").matchAll(/```json\n([\s\S]*?)\n```/g)]
      .map((match) => match[1]);
    assert.equal(blocks.length, 2);
    const [change, expectedCounts] = blocks.map((block) => JSON.parse(block));
    const updated = MODEL.appendEvidence(report(), change);
    assert.equal(updated.revision, 2);
    assert.deepEqual(MODEL.buildSummary(updated), expectedCounts);
    assert.ok(MODEL.buildMarkdown(updated).includes("Status: needs_confirmation"));
    for (const identifier of OPTIONAL_IDS) assert.ok(MODEL.buildMarkdown(updated).includes("### " + identifier + " - "));
    const checklist = fs.readFileSync(path.join(references, "checklist.md"), "utf8");
    assert.deepEqual(Object.fromEntries([...checklist.matchAll(/^### ([A-Z]{3}-[0-9]{2}) - (.+)$/gm)].map((m) => [m[1], m[2]])),
      { ...MODEL.CHECK_TITLES });
  });

  test("build order is canonical without reordering input", () => {
    const value = report();
    const expected = MODEL.buildMarkdown(value);
    value.checks.reverse();
    const old = clone(value);
    assert.equal(MODEL.buildMarkdown(value), expected);
    assert.deepEqual(value, old);
  });
});

describe("ValidationTests", () => {
  function assertInvalid(value) {
    const before = clone(value);
    assert.throws(() => MODEL.validateReport(value), (error) => {
      assert.ok(error instanceof MODEL.ModelError, String(error));
      assert.ok(!String(error.message).includes(SYNTHETIC_CANARY));
      return true;
    });
    assert.deepEqual(value, before);
  }

  test("exact schema types, IDs, statuses and required structures", () => {
    const mutations = [
      (r) => Object.assign(r, { schema_version: 2 }), (r) => Object.assign(r, { schema_version: true }),
      (r) => Object.assign(r, { revision: 0 }), (r) => Object.assign(r, { revision: true }),
      (r) => Object.assign(r, { revision: 1.5 }), (r) => Object.assign(r, { revision: "1" }),
      (r) => Object.assign(r, { checks: r.checks.slice(0, -1) }),
      (r) => r.checks.push(clone(r.checks[0])),
      (r) => Object.assign(r.checks[1], { id: "IAM-01" }),
      (r) => Object.assign(r.checks[0], { id: "iam-01" }),
      (r) => Object.assign(r.checks[0], { id: "IAM-04" }),
      (r) => Object.assign(r.checks[0], { id: "IAM-01_suffix" }),
      (r) => Object.assign(r.checks[0], { id: "XYZ-01" }),
      (r) => Object.assign(r.checks[0], { status: "satisfactory_extra" }),
      (r) => Object.assign(r.checks[0], { status: [] }),
      (r) => Object.assign(r.checks[0], { status: "satisfactory" }), // No evidence.
      (r) => Object.assign(r.checks[0], { rationale: "  " }),
      (r) => Object.assign(r.checks[0], { evidence_log: {} }),
      (r) => delete r.checks[0].statement,
      (r) => Object.assign(r.scope, { optional_authorized: "yes" }),
      (r) => delete r.scope.source_application_review,
      (r) => Object.assign(r.review_summary, { initial_priorities: Array(4).fill("One") }),
      (r) => Object.assign(r, { recommendations: {} }),
      (r) => Object.assign(r, { title: "New\n# Injected" }),
      (r) => Object.assign(r, { title: "x".repeat(241) }),
      (r) => Object.assign(r, { scope_alias: "example/team" }),
      (r) => Object.assign(r, { title: "NUL\x00canary" }),
      (r) => Object.assign(r, { title: "Synthetic\u2028## heading" }),
      (r) => Object.assign(r, { title: "\ud800" }),
      (r) => Object.assign(r, { summary: { core: {}, optional: {} } }), // Derived export only.
    ];
    mutations.forEach((mutate, index) => {
      const value = report();
      mutate(value);
      assert.doesNotThrow(() => assertInvalid(value), `case ${index}`);
    });
    for (const keys of [[], ["scope"], ["review_summary"], ["follow_up"], ["checks", 0]]) {
      const value = report();
      let target = value;
      for (const key of keys) target = target[key];
      target[SYNTHETIC_CANARY] = SYNTHETIC_CANARY;
      assertInvalid(value);
    }
  });

  test("evidence strict fields, UTC, unique IDs and chronology", () => {
    const invalidEntries = [
      evidence(undefined, undefined, { id: "bad id" }), evidence(undefined, undefined, { id: 42 }),
      evidence(undefined, undefined, { observed: { setting: "unknown" } }),
      evidence(undefined, undefined, { observed: " " }), evidence(undefined, undefined, { source_kind: "automated_scan" }),
      evidence(undefined, undefined, { source_kind: [] }), evidence(undefined, undefined, { scope_alias: "example/team" }),
      evidence(undefined, undefined, { source_description: "" }), evidence(undefined, undefined, { limitation: "" }),
      evidence(undefined, "2026-10-25T12:00:00+00:00"),
      evidence(undefined, "2026-10-25T12:00:00"),
      evidence(undefined, "2026-10-25T13:00:00+01:00"),
      evidence(undefined, "2026-02-30T12:00:00Z"),
      evidence(undefined, "2026-10-25T12:00:60Z"),
      evidence(undefined, "2026-10-25T12:00:00.1234567Z"),
      evidence(undefined, undefined, { [SYNTHETIC_CANARY]: SYNTHETIC_CANARY }),
    ];
    const missing = evidence();
    delete missing.limitation;
    invalidEntries.push(missing);
    for (const entry of invalidEntries) {
      const value = report();
      value.checks[3].evidence_log = [entry];
      assert.doesNotThrow(() => assertInvalid(value), JSON.stringify(entry));
    }
    for (const log of [[evidence(), evidence()], [evidence(), evidence("ev-002", "2026-10-25T11:59:59Z")]]) {
      const value = report();
      value.checks[0].evidence_log = log;
      assertInvalid(value);
    }
    const value = report();
    value.checks[0].evidence_log = [evidence()];
    value.checks[1].evidence_log = [evidence()];
    assertInvalid(value); // IDs unique across the entire report, not just one log.
    value.checks[1].evidence_log = [evidence("ev-002")];
    value.checks[0].evidence_log.push(evidence("ev-003", "2026-10-25T12:00:00.000001Z"));
    MODEL.validateReport(value); // Compare instants, not timestamp strings.
  });

  test("optional requires explicit intent and defaults stay unreviewed", () => {
    const value = report();
    const change = patchValue(1, "DEP-04");
    assert.throws(() => MODEL.appendEvidence(value, change), MODEL.ModelError);
    Object.assign(value.scope.optional_consent[0], {
      decision: "accepted", materials: [{ alias: "example-source", scope_alias: "example-project", read_boundaries: ["auth-config"] }],
      owner_alias: "owner-role-1", provenance: "Owner supplied scoped permission.",
      statement_at: "2026-10-25T11:00:00Z", approved_at: "2026-10-25T11:00:00Z",
    });
    value.scope.source_application_review = "Owner-authorized synthetic configuration material only.";
    Object.assign(change.checks[0].evidence_log[0], { material_alias: "example-source", read_boundary: "auth-config" });
    const updated = MODEL.appendEvidence(value, change);
    assert.deepEqual(MODEL.buildSummary(updated).optional, {
      satisfactory: 0, action_recommended: 0, needs_confirmation: 1, not_reviewed: 3, not_applicable: 0 });
    assert.ok(updated.checks.filter((check) => CORE_IDS.includes(check.id)).every((check) => check.status === "not_reviewed"));
  });

  test("each status is explicit and counts are derived", () => {
    const value = report();
    const patches = ["satisfactory", "action_recommended", "needs_confirmation", "not_reviewed", "not_applicable"]
      .map((status, index) => patchValue(1, CORE_IDS[index], { status, evidence_log: [evidence(`ev-${index}`)] }).checks[0]);
    const updated = MODEL.appendEvidence(value, { expected_revision: 1, checks: patches });
    assert.deepEqual(MODEL.buildSummary(updated).core, {
      satisfactory: 1, action_recommended: 1, needs_confirmation: 1, not_reviewed: 20, not_applicable: 1 });
    assert.equal(updated.revision, 2);
  });

  test("recommendations require all guided fields and exact related IDs", () => {
    const mutations = [(r) => Object.assign(r, { responsible_role: "" }), (r) => Object.assign(r, { prerequisites: [] }),
      (r) => Object.assign(r, { steps: [] }), (r) => Object.assign(r, { check_ids: ["CRE-01", "CRE-01"] }),
      (r) => Object.assign(r, { check_ids: ["CRE-01_extra"] }), (r) => delete r.done_when,
      (r) => delete r.impact, (r) => delete r.docs,
      (r) => Object.assign(r, { [SYNTHETIC_CANARY]: SYNTHETIC_CANARY })];
    for (const mutate of mutations) {
      const value = report();
      const rec = recommendation();
      mutate(rec);
      value.recommendations = [rec];
      assertInvalid(value);
    }
  });

  test("append rejects stale, duplicate, replacement and incomplete patches atomically", () => {
    const original = MODEL.appendEvidence(report(), patchValue());
    const mutations = [(p) => Object.assign(p, { expected_revision: 1 }), (p) => Object.assign(p, { expected_revision: true }),
      (p) => Object.assign(p, { checks: [] }), (p) => Object.assign(p, { revision: 3 }),
      (p) => Object.assign(p, { review_summary: {} }), (p) => delete p.checks[0].status,
      (p) => delete p.checks[0].rationale, (p) => delete p.checks[0].statement,
      (p) => Object.assign(p.checks[0], { id: "CRE-04" }),
      (p) => Object.assign(p.checks[0], { evidence_log: [] }),
      (p) => Object.assign(p.checks[0], { evidence_log: [evidence()] }),
      (p) => Object.assign(p.checks[0], { evidence_log: [evidence("ev-002"), evidence("ev-002")] }),
      (p) => Object.assign(p.checks[0], { evidence_log: [evidence("ev-002", "2026-10-25T11:00:00Z")] }),
      (p) => p.checks.push(clone(p.checks[0])),
      (p) => Object.assign(p.checks[0], { evidence_log: [evidence("ev-002", undefined, { [SYNTHETIC_CANARY]: SYNTHETIC_CANARY })] })];
    mutations.forEach((mutate, index) => {
      const change = patchValue(2, "CRE-01", { evidence_log: [evidence("ev-002", "2026-10-25T13:00:00Z")] });
      mutate(change);
      const oldReport = clone(original);
      const oldPatch = clone(change);
      assert.throws(() => MODEL.appendEvidence(original, change), MODEL.ModelError, `case ${index}`);
      assert.deepEqual(original, oldReport);
      assert.deepEqual(change, oldPatch);
    });
    // A good first check and an invalid second check publish nothing and mutate neither.
    const change = patchValue(2, "CRE-01", { evidence_log: [evidence("ev-002")] });
    change.checks.push(patchValue(1, "DEP-01", { status: "invalid" }).checks[0]);
    const before = clone(original);
    assert.throws(() => MODEL.appendEvidence(original, change), MODEL.ModelError);
    assert.deepEqual(original, before);
  });
});

describe("ReportCLITests", () => {
  let temporary;
  let directory;
  let source;
  let patchPath;

  beforeEach(() => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "report-model-"));
    directory = fs.realpathSync(temporary);
    source = path.join(directory, "report-v1.json");
    fs.writeFileSync(source, MODEL.jsonBytes(report()));
    patchPath = path.join(directory, "patch.json");
    fs.writeFileSync(patchPath, MODEL.jsonBytes(patchValue()));
  });

  afterEach(() => {
    fs.rmSync(temporary, { recursive: true, force: true });
  });

  const cli = (...args) => {
    const result = spawnSync(process.execPath, [SCRIPT, ...args.map(String)], {
      cwd: directory, encoding: "utf8", timeout: 20000,
    });
    return { returncode: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  const stagingFiles = () => fs.readdirSync(directory).filter((name) => name.startsWith(".report-"));

  function assertFailure(result) {
    assert.equal(result.returncode, 1, result.stderr);
    assert.equal(result.stdout, "");
    // Specific, value-free diagnostics on one line (#29).
    assert.ok(result.stderr.startsWith("Could not manage report"), result.stderr);
    assert.ok(result.stderr.endsWith("Inputs and existing files were not modified.\n"), result.stderr);
    assert.equal(result.stderr.split("\n").length - 1, 1);
    assert.ok(!result.stderr.includes(SYNTHETIC_CANARY));
    assert.ok(!result.stderr.includes(directory));
    assert.deepEqual(stagingFiles(), []);
  }

  test("input and patch two-megabyte boundaries and nonfinite values", () => {
    const old = fs.readFileSync(source);
    fs.writeFileSync(source, Buffer.concat([old, Buffer.alloc(2_000_000 - old.length, " ")]));
    let result = cli("validate", source);
    assert.equal(result.returncode, 0, result.stderr);
    fs.appendFileSync(source, " ");
    assertFailure(cli("validate", source));
    fs.writeFileSync(source, old);
    const oldPatch = fs.readFileSync(patchPath);
    fs.writeFileSync(patchPath, Buffer.concat([oldPatch, Buffer.alloc(2_000_000 - oldPatch.length, " ")]));
    const output = path.join(directory, "bounded-v2.json");
    result = cli("append", source, "--patch", patchPath, "-o", output);
    assert.equal(result.returncode, 0, result.stderr);
    fs.appendFileSync(patchPath, " ");
    const failed = path.join(directory, "oversized.json");
    assertFailure(cli("append", source, "--patch", patchPath, "-o", failed));
    assert.ok(!fs.existsSync(failed));
    assert.deepEqual(fs.readFileSync(source), old);
    for (const number of [NaN, Infinity, -Infinity]) {
      const value = report();
      value.revision = number;
      assert.throws(() => MODEL.validateReport(value), MODEL.ModelError);
    }
    const value = report();
    value.review_summary.overall_takeaway = "x".repeat(2_000_001);
    assert.throws(() => MODEL.validateReport(value), MODEL.ModelError);
  });

  test("CLI rejects invalid JSON without leaking or publishing", () => {
    const valid = MODEL.jsonBytes(report());
    const replace = (from, to) => Buffer.from(valid.toString("latin1").replace(from, to), "latin1");
    const invalid = [Buffer.from(""), Buffer.from(SYNTHETIC_CANARY), Buffer.concat([Buffer.from([0xff]), Buffer.from(SYNTHETIC_CANARY)]),
      Buffer.from("{}\x00" + SYNTHETIC_CANARY), Buffer.alloc(2_000_001, " "), Buffer.from("[".repeat(2000) + "]".repeat(2000)),
      replace('"revision": 1', '"revision": 1, "revision": 2'),
      replace('"revision": 1', '"revision": NaN'),
      replace('"revision": 1', '"revision": Infinity'),
      replace('"not_reviewed"', '"not_reviewed", "status": "satisfactory"'),
      replace('"schema_version": 1', `"${SYNTHETIC_CANARY}": "${SYNTHETIC_CANARY}"`)];
    const output = path.join(directory, "must-not-exist.md");
    invalid.forEach((data, index) => {
      fs.writeFileSync(source, data);
      assert.doesNotThrow(() => assertFailure(cli("build", source, "-o", output)), `case ${index}`);
      assert.deepEqual(fs.readFileSync(source), data);
      assert.ok(!fs.existsSync(output));
    });
    fs.writeFileSync(source, valid);
    fs.writeFileSync(patchPath, '{"expected_revision":1,"checks":[],"checks":[]}');
    assertFailure(cli("append", source, "--patch", patchPath, "-o", output));
    assert.ok(!fs.existsSync(output));
  });

  test("CLI rejects stale and partly valid append without artifacts", () => {
    const output = path.join(directory, "report-v2.json");
    const old = fs.readFileSync(source);
    const changes = [patchValue(2), patchValue(1, "CRE-01", { evidence_log: [evidence(), evidence()] })];
    const partial = patchValue();
    partial.checks.push(patchValue(1, "DEP-01", { status: "invalid" }).checks[0]);
    changes.push(partial);
    for (const value of changes) {
      fs.writeFileSync(patchPath, MODEL.jsonBytes(value));
      assertFailure(cli("append", source, "--patch", patchPath, "-o", output));
      assert.ok(!fs.existsSync(output));
      assert.deepEqual(fs.readFileSync(source), old);
    }
  });

  test("CLI fresh paths refuse files, symlinks, directories and input paths", () => {
    const target = path.join(directory, "preserve.txt");
    fs.writeFileSync(target, Buffer.from("Preserve exactly.\x00\xff", "latin1"));
    fs.chmodSync(target, 0o640);
    const link = path.join(directory, "link.json");
    fs.symlinkSync(target, link);
    const dangling = path.join(directory, "dangling.json");
    fs.symlinkSync(path.join(directory, "missing-target"), dangling);
    const original = fs.readFileSync(source);
    const originalPatch = fs.readFileSync(patchPath);
    for (const output of [target, link, dangling, source, patchPath, directory]) {
      assert.doesNotThrow(() => assertFailure(cli("append", source, "--patch", patchPath, "-o", output)), path.basename(output));
      assert.deepEqual(fs.readFileSync(source), original);
      assert.deepEqual(fs.readFileSync(patchPath), originalPatch);
      assert.deepEqual(fs.readFileSync(target), Buffer.from("Preserve exactly.\x00\xff", "latin1"));
      assert.equal(fs.statSync(target).mode & 0o7777, 0o640);
      assert.ok(fs.lstatSync(link).isSymbolicLink());
      assert.ok(fs.lstatSync(dangling).isSymbolicLink());
    }
    assertFailure(cli("build", source, "-o", source));
  });

  test("IO and renderer failures leave no partial publication", () => {
    const old = fs.readFileSync(source);
    const output = path.join(directory, "new.json");
    const osError = (syscall) => Object.assign(new Error(SYNTHETIC_CANARY), { code: "EIO", errno: -5, syscall });
    for (const [operation, syscall] of [["fsyncSync", "fsync"], ["linkSync", "link"]]) {
      const failing = mock.method(fs, operation, () => {
        throw osError(syscall);
      });
      const stdout = [];
      const stderr = [];
      const writes = [mock.method(process.stdout, "write", (chunk) => stdout.push(String(chunk)) || true),
        mock.method(process.stderr, "write", (chunk) => stderr.push(String(chunk)) || true)];
      let code;
      try {
        code = MODEL.main(["append", source, "--patch", patchPath, "-o", output]);
      } finally {
        for (const restore of [failing, ...writes]) restore.mock.restore();
      }
      assert.equal(code, 1, operation);
      assert.equal(stdout.join(""), "");
      assert.ok(!stderr.join("").includes(SYNTHETIC_CANARY));
      assert.ok(!fs.existsSync(output));
      assert.deepEqual(fs.readFileSync(source), old);
      assert.deepEqual(stagingFiles(), []);
    }
    // The renderer reads bundled assets through primitives captured at load, so fail them in a child process.
    const preload = "import fs from 'node:fs'; const open = fs.openSync; fs.openSync = (file, ...rest) => {"
      + " if (String(file).includes('/assets/')) throw Object.assign(new Error('SYNTHETIC_CANARY'), { code: 'EIO', errno: -5, syscall: 'open' });"
      + " return open(file, ...rest); };";
    const result = spawnSync(process.execPath, ["--import", "data:text/javascript," + encodeURIComponent(preload), SCRIPT,
      "build", source, "--format", "html", "-o", output], { cwd: directory, encoding: "utf8", timeout: 20000 });
    assert.equal(result.status, 1, result.stderr);
    assert.ok(!result.stderr.includes(SYNTHETIC_CANARY));
    assert.ok(!fs.existsSync(output));
    assert.deepEqual(stagingFiles(), []);
  });

  test("concurrent same path has one winner and distinct paths can branch", async () => {
    const old = fs.readFileSync(source);
    const expected = MODEL.appendEvidence(report(), patchValue());
    const run = (output) => new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, "append", source, "--patch", patchPath, "-o", output],
        { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.resume();
      child.stderr.resume();
      child.on("close", (code) => resolve(code));
    });
    for (let index = 0; index < 3; index += 1) {
      const output = path.join(directory, `winner-${index}.json`);
      const codes = await Promise.all([run(output), run(output)]);
      assert.deepEqual(codes.sort(), [0, 1]);
      assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), expected);
      assert.equal(fs.statSync(output).mode & 0o7777, 0o600);
    }
    const branches = [0, 1].map((index) => path.join(directory, `branch-${index}.json`));
    const codes = await Promise.all(branches.map(run));
    for (const code of codes) assert.equal(code, 0);
    assert.deepEqual(fs.readFileSync(branches[0]), fs.readFileSync(branches[1]));
    assert.deepEqual(fs.readFileSync(source), old);
    assert.deepEqual(stagingFiles(), []);
  });

  test("HTML reuses escaping and brand without templates or URL loading", () => {
    const value = report();
    value.review_summary.overall_takeaway = "{{BODY}} <script>synthetic()</script> "
      + "[unsafe](javascript:alert) [private](https://user:synthetic@example.test/docs) "
      + "![pixel](https://example.test/pixel) $(touch never-execute)";
    fs.writeFileSync(source, MODEL.jsonBytes(value));
    const output = path.join(directory, "safe.html");
    const result = cli("build", source, "--format", "html", "-o", output);
    assert.equal(result.returncode, 0, result.stderr);
    const document = fs.readFileSync(output, "utf8");
    assert.equal(document, MODEL.renderReport(MODEL.buildMarkdown(value)));
    assert.ok(document.includes("&lt;script&gt;synthetic()&lt;/script&gt;"));
    assert.ok(!document.includes("<script"));
    assert.ok(!document.includes('href="javascript:'));
    assert.ok(!document.includes('href="https://user:'));
    assert.ok(!document.includes("<img"));
    assert.ok(document.includes("{{BODY}}"));
    assert.ok(document.includes("Read-only configuration review"));
    assert.ok(document.includes("does not certify security or compliance"));
    assert.ok(!fs.existsSync(path.join(directory, "never-execute")));
    assertFailure(cli("build", source, "--format", "html", "--lang", 'en" onload="synthetic', "-o", path.join(directory, "bad.html")));
    assert.ok(!fs.existsSync(path.join(directory, "bad.html")));
  });

  test("private permissions even with restrictive umask and safe parser errors", () => {
    const output = path.join(directory, "private.md");
    const previous = process.umask(0o777);
    let result;
    try {
      result = cli("build", source, "-o", output);
    } finally {
      process.umask(previous);
    }
    assert.equal(result.returncode, 0, result.stderr);
    assert.equal(fs.statSync(output).mode & 0o7777, 0o600);
    result = cli("build", source, "--format", SYNTHETIC_CANARY, "-o", output);
    assert.equal(result.returncode, 2);
    assert.equal(result.stderr, "Invalid report command. Use --help for usage.\n");
    assert.ok(!result.stderr.includes(SYNTHETIC_CANARY));
  });

  test("CLI init, validate, append, build and export-summary", () => {
    const initial = path.join(directory, "initialized.json");
    let result = cli("init", "--scope-alias", "example-team", "--title", "Synthetic configuration review", "-o", initial);
    assert.equal(result.returncode, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(initial), fs.readFileSync(source));
    result = cli("validate", initial);
    assert.equal(result.returncode, 0, result.stderr);
    assert.ok(result.stdout.includes("valid"));
    const original = fs.readFileSync(source);
    const revision = path.join(directory, "report-v2.json");
    result = cli("append", source, "--patch", patchPath, "-o", revision);
    assert.equal(result.returncode, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(source), original);
    const expected = MODEL.appendEvidence(report(), patchValue());
    assert.deepEqual(JSON.parse(fs.readFileSync(revision, "utf8")), expected);
    const markdown = path.join(directory, "report.md");
    result = cli("build", revision, "-o", markdown);
    assert.equal(result.returncode, 0, result.stderr);
    assert.equal(fs.readFileSync(markdown, "utf8"), MODEL.buildMarkdown(expected));
    const html = path.join(directory, "report.html");
    result = cli("build", revision, "--format", "html", "-o", html);
    assert.equal(result.returncode, 0, result.stderr);
    assert.equal(fs.readFileSync(html, "utf8"), MODEL.renderReport(fs.readFileSync(markdown, "utf8")));
    const summary = path.join(directory, "counts.json");
    result = cli("export-summary", revision, "-o", summary);
    assert.equal(result.returncode, 0, result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(summary, "utf8")), MODEL.buildSummary(expected));
    for (const file of [initial, revision, markdown, html, summary]) assert.equal(fs.statSync(file).mode & 0o7777, 0o600);
    assert.deepEqual(stagingFiles(), []);
  });
});
