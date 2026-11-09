// Synthetic governance regressions at the model, CLI and optional public QA seams.
//
// Set REPORT_QA_SCRIPT to an existing checkout's check-report.mjs for cross-issue
// integration. The checker is imported read-only, never copied or modified.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { MODEL, OPTIONAL_IDS, evidence, patchValue, recommendation, report } from "./report-model-fixtures.mjs";
import { renderReport } from "../skills/vercel-security-audit/scripts/render-report.mjs";

const UTC = "2026-10-25T12:00:00Z";
const EARLIER = "2026-10-25T11:00:00Z";
const deepcopy = (value) => structuredClone(value);

function consent(checkId = "DEP-04", decision = "accepted") {
  return {
    check_id: checkId, decision,
    materials: [{ alias: "example-source", scope_alias: "example-project", read_boundaries: ["auth-config"] }],
    exclusions: ["unapproved-source"], source_kind: "owner_statement",
    owner_alias: "owner-role-1", provenance: "Owner supplied scoped read permission.",
    statement_at: EARLIER, approved_at: EARLIER,
  };
}

function authorize(value, checkId = "DEP-04", decision = "accepted") {
  value.scope.optional_consent = value.scope.optional_consent.map((c) => (c.check_id === checkId ? consent(checkId, decision) : c));
  return value;
}

function window() {
  return { requested_start: EARLIER, requested_end: UTC, covered_start: null, covered_end: null, retention_boundary: null };
}

function feed(identifier = "coverage-1", changes = {}) {
  return {
    id: identifier, feed_id: "metadata-feed", usage: "used", check_ids: ["CRE-01"],
    source_kind: "cli", source_description: "Synthetic metadata inventory",
    scope_alias: "example-project", material_alias: null, read_boundary: null,
    observed_at: UTC, window: window(), reported_total: 100, count_basis: "Product aggregate, not proof of inspection.",
    received: 10, inspected: 2, page_cap: 10, overall_cap: null,
    next_available: null, exhausted: null, truncated: true, outcome: "partial",
    failure_kind: "none", missing_sources: "Earlier window unavailable.",
    assessment_effect: "CRE-01 remains needs_confirmation; no absence claim.", retries: [],
    ...changes,
  };
}

function retry(identifier = "retry-1", changes = {}) {
  return {
    id: identifier, attempted_at: UTC, window: window(),
    outcome: "timed_out", failure_kind: "timeout", remaining_gaps: "Window remains incomplete.",
    ...changes,
  };
}

function answer(identifier = "owner-answer-1", checkId = "CRE-01", changes = {}) {
  return {
    id: identifier, check_id: checkId, scope_alias: "example-project",
    owner_alias: "owner-role-1", source_kind: "owner_statement", statement_at: UTC,
    metadata_observed_at: null, evidence_refs: [], answer: "Scoped count unavailable; expiry visibility unresolved.",
    ...changes,
  };
}

function invalid(value) {
  const before = deepcopy(value);
  let caught = null;
  try {
    MODEL.validateReport(value);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof MODEL.ModelError, `expected ModelError, got ${caught}`);
  assert.ok(!String(caught.message).includes("SYNTHETIC_CANARY"));
  assert.deepEqual(value, before);
}

const count = (text, part) => text.split(part).length - 1;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "report-governance-"));
}

/** Run MODEL.main with stdout/stderr captured, like redirect_stdout/redirect_stderr. */
async function runMain(args) {
  const writes = { stdout: process.stdout.write, stderr: process.stderr.write };
  let stdout = "";
  let stderr = "";
  process.stdout.write = (chunk) => {
    stdout += chunk;
    return true;
  };
  process.stderr.write = (chunk) => {
    stderr += chunk;
    return true;
  };
  try {
    const code = await MODEL.main(args);
    return { code, stdout, stderr };
  } finally {
    process.stdout.write = writes.stdout;
    process.stderr.write = writes.stderr;
  }
}

const reportFiles = (directory) => fs.readdirSync(directory).filter((name) => name.startsWith(".report-"));

test("empty draft has mandatory unknown coverage, per-ID consent and three questions", () => {
  const value = report();
  assert.deepEqual(value.coverage_limits, []);
  assert.deepEqual(value.owner_confirmations, []);
  assert.ok(value.scope.limitations.includes("coverage is unknown"));
  assert.ok(!("optional_authorized" in value.scope));
  const ledger = value.scope.optional_consent;
  assert.deepEqual(ledger.map((item) => item.check_id), [...OPTIONAL_IDS]);
  assert.ok(ledger.every((item) => item.decision === "not_requested" && !item.materials.length));
  const markdown = MODEL.buildMarkdown(value);
  for (const heading of ["## Coverage limits", "### Optional scope decisions", "### Owner confirmation questionnaire"]) {
    assert.equal(count(markdown, heading), 1);
  }
  assert.ok(markdown.includes("No collection recorded; coverage is unknown"));
  assert.ok(!markdown.toLowerCase().includes("coverage is complete"));
  for (const identifier of ["CRE-01", "IAM-02", "OPS-01"]) {
    assert.ok(markdown.includes("#### " + identifier + " - "));
  }
  assert.equal(count(markdown, "Answer state: not answered"), 3);
  for (const phrase of ["token values", "recovery codes", "webhook URLs", "owner_statement", "No automatic", "not observed configuration"]) {
    assert.ok(markdown.includes(phrase), phrase);
  }
});

test("all feed fields roundtrip and render with failures, retries and unknowns", () => {
  const value = report();
  value.coverage_limits = [feed("coverage-1", { retries: [retry()] })];
  value.owner_confirmations = [answer()];
  MODEL.validateReport(value);
  const directory = tempDir();
  let restored;
  try {
    const source = path.join(directory, "draft.json");
    fs.writeFileSync(source, MODEL.jsonBytes(value));
    restored = MODEL.loadJson(source);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  assert.deepEqual(restored, value);
  const markdown = MODEL.buildMarkdown(restored);
  const labels = ["Source/feed:", "Window:", "Reported total:", "Received:", "Inspected:",
    "Page/finding cap:", "Truncation:", "Cursor availability:", "End known:",
    "Missing sources:", "Timeouts/failures:", "Retries and outcomes:", "Assessment effect:"];
  for (const label of labels) assert.ok(markdown.includes(label), label);
  for (const text of ["coverage-1", "metadata-feed", "used", "partial", "cli", "Synthetic metadata inventory",
    "example-project", UTC, EARLIER, "100", "10", "2", "unknown", "retry-1", "timed_out", "timeout",
    "Window remains incomplete.", "Product aggregate, not proof of inspection.",
    "Earlier window unavailable.", "CRE-01 remains needs_confirmation; no absence claim."]) {
    assert.ok(markdown.includes(text), text);
  }
  assert.ok(markdown.includes("Source: owner_statement"));
  assert.ok(markdown.includes("owner-role-1"));
  assert.ok(markdown.includes("Metadata observed at: unknown"));
  assert.equal(count(markdown, "Answer state: not answered"), 2);
  assert.ok(markdown.includes(answer().answer));
  assert.ok(value.checks.every((c) => c.status === "not_reviewed"));
});

test("tri-states, nullable counts and planned feed are not inferred complete", () => {
  for (const state of [null, false, true]) {
    const value = report();
    value.coverage_limits = [feed("coverage-1", { next_available: state, exhausted: state, truncated: state })];
    MODEL.validateReport(value);
    assert.ok(MODEL.buildMarkdown(value).includes("partial"));
  }
  const value = report();
  value.coverage_limits = [feed("coverage-1", { usage: "planned", outcome: "not_collected", received: null, inspected: null,
    reported_total: null, page_cap: null, truncated: null })];
  MODEL.validateReport(value);
  assert.ok(MODEL.buildMarkdown(value).includes("not_collected"));
  assert.ok(MODEL.buildMarkdown(value).includes("unknown"));
  const complete = feed("coverage-1", { outcome: "complete", next_available: false, exhausted: true, truncated: false });
  value.coverage_limits = [complete];
  MODEL.validateReport(value);
  assert.equal(value.coverage_limits[0].inspected, 2); // Collection != individual inspection.
  complete.exhausted = null;
  invalid(value);
});

test("feed validation: strict counts, windows, states, outcomes and failure metadata", () => {
  const changes = [{ received: -1 }, { received: true }, { inspected: 11 }, { inspected: 1.5 },
    { reported_total: "100" }, { page_cap: true }, { overall_cap: -1 },
    { next_available: "unknown" }, { exhausted: 0 }, { truncated: "yes" },
    { outcome: "successful" }, { usage: "unknown" }, { source_kind: "scan" },
    { check_ids: ["CRE-04"] }, { check_ids: ["CRE-01", "CRE-01"] },
    { observed_at: "2026-10-25T12:00:00+00:00" }, { failure_kind: "SYNTHETIC_CANARY" },
    { outcome: "timed_out", failure_kind: "none" }, { raw_error: "SYNTHETIC_CANARY" },
    { window: { requested_start: UTC } }, { retries: [retry("retry-1", { raw_error: "SYNTHETIC_CANARY" })] }];
  for (const change of changes) {
    const value = report();
    value.coverage_limits = [feed("coverage-1", change)];
    invalid(value);
  }
  for (const fields of [{ requested_start: UTC, requested_end: EARLIER },
    { covered_start: EARLIER, covered_end: null },
    { covered_start: EARLIER, covered_end: "2026-10-25T13:00:00Z" }]) {
    const value = report();
    const w = { ...window(), ...fields };
    value.coverage_limits = [feed("coverage-1", { window: w })];
    invalid(value);
  }
  const value = report();
  value.coverage_limits = [feed(), feed()];
  invalid(value);
  value.coverage_limits = [feed("coverage-1", { retries: [retry(), retry()] })];
  invalid(value);
});

test("per-ID accepted and partial consent never grants other IDs or material", () => {
  for (const decision of ["accepted", "partial"]) {
    const value = authorize(report(), "DEP-04", decision);
    const entry = evidence("ev-001", "2026-10-25T12:00:00Z", { material_alias: "example-source", read_boundary: "auth-config" });
    const change = patchValue(1, "DEP-04", { evidence_log: [entry] });
    const updated = MODEL.appendEvidence(value, change);
    assert.equal(MODEL.buildSummary(updated).optional.needs_confirmation, 1);
    const markdown = MODEL.buildMarkdown(updated);
    assert.ok(markdown.includes("Decision: " + decision));
    for (const text of ["example-source", "auth-config", "unapproved-source", "Owner supplied scoped read permission.", EARLIER]) {
      assert.ok(markdown.includes(text), text);
    }
    for (const wrong of [{ scope_alias: "unapproved-project" }, { material_alias: "unapproved-source" },
      { read_boundary: "source-bodies" }, { observed_at: "2026-10-25T10:59:59Z" }]) {
      const before = deepcopy(value);
      const fields = { material_alias: "example-source", read_boundary: "auth-config", ...wrong };
      // Python passed observed_at through **changes; here it is the positional observedAt argument.
      const { observed_at: observedAt = "2026-10-25T12:00:00Z", ...rest } = fields;
      assert.throws(() => MODEL.appendEvidence(value, patchValue(1, "DEP-04", { evidence_log: [evidence("ev-001", observedAt, rest)] })),
        MODEL.ModelError);
      assert.deepEqual(value, before);
    }
    assert.throws(() => MODEL.appendEvidence(value, patchValue(1, "SRC-04", { evidence_log: [entry] })), MODEL.ModelError);
  }
});

test("declined and not_requested require unreviewed empty history", () => {
  for (const decision of ["declined", "not_requested"]) {
    const value = report();
    const item = value.scope.optional_consent[0];
    item.decision = decision;
    if (decision === "declined") {
      Object.assign(item, { owner_alias: "owner-role-1", provenance: "Owner declined.", statement_at: UTC });
    }
    MODEL.validateReport(value);
    assert.ok(MODEL.buildMarkdown(value).includes("Decision: " + decision));
    for (const [status, log] of [["needs_confirmation", []], ["not_reviewed", [evidence()]]]) {
      const draft = deepcopy(value);
      Object.assign(draft.checks[24], { status, evidence_log: log });
      invalid(draft);
    }
  }
});

test("consent is strict, complete, and the legacy global boolean fails closed", () => {
  for (const flag of [false, true]) {
    const value = report();
    delete value.scope.optional_consent;
    value.scope.optional_authorized = flag;
    invalid(value);
  }
  for (const change of [{ decision: "yes" }, { approved_at: null }, { owner_alias: null },
    { provenance: null }, { statement_at: null }, { source_kind: "browser" },
    { materials: [] }, { exclusions: ["example-source"] }, { extra: "SYNTHETIC_CANARY" }]) {
    const value = authorize(report());
    Object.assign(value.scope.optional_consent[0], change);
    invalid(value);
  }
  for (const transform of [(l) => l.pop(), (l) => l.push(deepcopy(l[0])),
    (l) => Object.assign(l[0], { check_id: "DEP-03" })]) {
    const value = report();
    transform(value.scope.optional_consent);
    invalid(value);
  }
});

test("optional coverage cannot cross consent boundaries", () => {
  const value = authorize(report());
  value.coverage_limits = [feed("coverage-1", { check_ids: ["DEP-04"], material_alias: "example-source", read_boundary: "auth-config" })];
  MODEL.validateReport(value);
  value.coverage_limits[0].check_ids.push("SRC-04");
  invalid(value);
});

test("retries cannot claim collection before consent or on uncollected feeds", () => {
  let value = authorize(report());
  value.coverage_limits = [feed("coverage-1", { check_ids: ["DEP-04"], material_alias: "example-source", read_boundary: "auth-config",
    retries: [retry("retry-1", { attempted_at: "2026-10-25T10:59:59Z" })] })];
  invalid(value);
  value = report();
  value.coverage_limits = [feed("coverage-1", { usage: "planned", outcome: "not_collected", received: null, inspected: null,
    reported_total: null, page_cap: null, truncated: null, retries: [retry()] })];
  invalid(value);
  value = authorize(report(), "DEP-04", "partial");
  value.scope.optional_consent[0].exclusions = [];
  invalid(value);
});

test("governance history is chronological and record IDs are global", () => {
  let value = report();
  value.coverage_limits = [feed(), feed("coverage-2", { observed_at: EARLIER })];
  invalid(value);
  value.coverage_limits = [feed()];
  value.owner_confirmations = [answer("coverage-1")];
  invalid(value);
  value.owner_confirmations = [answer(), answer("owner-answer-2", "CRE-01", { statement_at: EARLIER })];
  invalid(value);
  value = MODEL.appendEvidence(report(), patchValue());
  value.coverage_limits = [feed("ev-001")];
  invalid(value);
  value = MODEL.appendEvidence(report(), patchValue());
  value.owner_confirmations = [answer("owner-answer-1", "CRE-01", { evidence_refs: ["ev-001"], metadata_observed_at: UTC })];
  MODEL.validateReport(value);
  assert.ok(MODEL.buildMarkdown(value).includes("Separately observed evidence: ev-001"));
  value.owner_confirmations[0].scope_alias = "different-project";
  invalid(value);
});

test("metadata-only CLI publication is private, complete and preserves input", async () => {
  const value = report();
  const change = {
    expected_revision: 1, coverage_limits: [feed("coverage-1", { retries: [retry()] })],
    owner_confirmations: [answer(), answer("owner-answer-2", "IAM-02"), answer("owner-answer-3", "OPS-01")],
  };
  const directory = tempDir();
  try {
    const [source, patchPath, output] = ["input.json", "patch.json", "revision-2.json"].map((name) => path.join(directory, name));
    fs.writeFileSync(source, MODEL.jsonBytes(value));
    fs.writeFileSync(patchPath, MODEL.jsonBytes(change));
    const oldSource = fs.readFileSync(source);
    const oldPatch = fs.readFileSync(patchPath);
    const { code } = await runMain(["append", source, "--patch", patchPath, "-o", output]);
    assert.equal(code, 0);
    const restored = MODEL.loadJson(output);
    assert.deepEqual(restored.coverage_limits, change.coverage_limits);
    assert.deepEqual(restored.owner_confirmations, change.owner_confirmations);
    assert.deepEqual(restored.checks, value.checks);
    assert.equal(restored.revision, 2);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assert.deepEqual(fs.readFileSync(source), oldSource);
    assert.deepEqual(fs.readFileSync(patchPath), oldPatch);
    assert.deepEqual(reportFiles(directory), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("owner records: strict self-statements, dates and no access or status changes", () => {
  const value = report();
  value.owner_confirmations = [answer(), answer("owner-answer-2", "IAM-02"), answer("owner-answer-3", "OPS-01")];
  MODEL.validateReport(value);
  const markdown = MODEL.buildMarkdown(value);
  assert.ok(!markdown.includes("Answer state: not answered"));
  assert.deepEqual(value.checks, report().checks);
  for (const changes of [{ source_kind: "browser" }, { owner_alias: "personal/name" }, { check_id: "DEP-04" },
    { statement_at: null }, { statement_at: "not UTC" }, { answer: " " }, { answer: "x".repeat(8001) },
    { metadata_observed_at: "2026-02-30T00:00:00Z" }, { evidence_refs: ["missing-evidence"] },
    { raw_message: "SYNTHETIC_CANARY" }]) {
    const draft = report();
    // Python passed check_id through **changes; here it is the positional checkId argument.
    const { check_id: checkId = "CRE-01", ...rest } = changes;
    draft.owner_confirmations = [answer("owner-answer-1", checkId, rest)];
    invalid(draft);
  }
});

test("metadata-only and mixed append preserve history, narratives and revision once", () => {
  const original = report();
  original.recommendations = [recommendation()];
  original.review_summary.overall_takeaway = "Keep this Owner-authored narrative.";
  const before = deepcopy(original);
  const change = { expected_revision: 1, coverage_limits: [feed()], owner_confirmations: [answer()] };
  const updated = MODEL.appendEvidence(original, change);
  assert.deepEqual(original, before);
  assert.equal(updated.revision, 2);
  assert.deepEqual(updated.checks, original.checks);
  const nextPatch = patchValue(2);
  Object.assign(nextPatch, { coverage_limits: [feed("coverage-2")], owner_confirmations: [answer("owner-answer-2")] });
  const third = MODEL.appendEvidence(updated, nextPatch);
  assert.equal(third.revision, 3);
  assert.deepEqual(third.coverage_limits, [feed(), feed("coverage-2")]);
  assert.deepEqual(third.owner_confirmations, [answer(), answer("owner-answer-2")]);
  for (const key of ["recommendations", "review_summary", "scope", "follow_up"]) {
    assert.deepEqual(third[key], original[key], key);
  }
  for (const bad of [{ expected_revision: 2 }, { expected_revision: 2, checks: [], coverage_limits: [], owner_confirmations: [] },
    { expected_revision: 2, coverage_limits: [feed()] },
    { expected_revision: 2, owner_confirmations: [answer()] },
    { expected_revision: 1, owner_confirmations: [answer("new-answer")] },
    { expected_revision: 2, optional_consent: [] }]) {
    const old = deepcopy(updated);
    assert.throws(() => MODEL.appendEvidence(updated, bad), MODEL.ModelError);
    assert.deepEqual(updated, old);
  }
});

test("failed mixed CLI append publishes nothing and leaks no values", async () => {
  const value = report();
  const change = patchValue();
  Object.assign(change, { coverage_limits: [feed()], owner_confirmations: [answer("owner-answer-1", "CRE-01", { source_kind: "SYNTHETIC_CANARY" })] });
  const directory = tempDir();
  try {
    const [source, patchPath, output] = ["input.json", "patch.json", "new.json"].map((name) => path.join(directory, name));
    fs.writeFileSync(source, MODEL.jsonBytes(value));
    fs.writeFileSync(patchPath, MODEL.jsonBytes(change));
    const original = fs.readFileSync(source);
    const { code, stdout, stderr } = await runMain(["append", source, "--patch", patchPath, "-o", output]);
    assert.equal(code, 1);
    assert.deepEqual(fs.readFileSync(source), original);
    assert.equal(stdout, "");
    assert.ok(!stderr.includes("SYNTHETIC_CANARY"));
    assert.ok(!fs.existsSync(output));
    assert.deepEqual(reportFiles(directory), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("JSON, Markdown and HTML pass the current public QA and governance headers",
  { skip: process.env.REPORT_QA_SCRIPT ? false : "Set REPORT_QA_SCRIPT for external current QA integration" }, async () => {
    const qa = await import(pathToFileURL(path.resolve(process.env.REPORT_QA_SCRIPT)).href);
    const render = typeof MODEL.renderReport === "function" ? MODEL.renderReport : renderReport;
    let value = MODEL.appendEvidence(report(), patchValue());
    value = MODEL.appendEvidence(value, { expected_revision: 2, coverage_limits: [feed()], owner_confirmations: [answer()] });
    let optional = authorize(deepcopy(value), "DEP-04", "partial");
    optional = MODEL.appendEvidence(optional, patchValue(3, "DEP-04", {
      evidence_log: [evidence("ev-optional", "2026-10-25T12:00:00Z", { material_alias: "example-source", read_boundary: "auth-config" })],
    }));
    assert.equal(MODEL.buildSummary(optional).optional.needs_confirmation, 1);
    for (const kase of [report(), value, optional]) {
      const label = `revision ${kase.revision}`;
      const restored = JSON.parse(Buffer.from(MODEL.jsonBytes(kase)).toString("utf8"));
      const document = new qa.Document(render(MODEL.buildMarkdown(restored))).root;
      qa.checkPassive(document);
      const [counts, outcomes] = qa.checkCounts(document);
      qa.checkSummary(MODEL.buildSummary(restored), counts);
      assert.equal(Object.values(counts.core).reduce((a, b) => a + b, 0), 24, label);
      assert.equal(Object.values(counts.optional).reduce((a, b) => a + b, 0), 4, label);
      assert.equal(qa.checkEvidence(restored.checks.map((c) => ({ topic_id: c.id, status: c.status })), outcomes), "matched all 28 checks", label);
      const headings = ["h2", "h3", "h4"].flatMap((level) => document.find(level).map((h) => h.text));
      for (const text of ["Coverage limits", "Optional scope decisions", "Owner confirmation questionnaire"]) {
        assert.ok(headings.includes(text), `${label}: ${text}`);
      }
      for (const checkId of ["CRE-01", "IAM-02", "OPS-01"]) {
        assert.ok(headings.some((h) => h.startsWith(checkId + " - Owner")), `${label}: ${checkId}`);
      }
    }
  });
