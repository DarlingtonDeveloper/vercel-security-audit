// check-report.mjs compares the status matrix with appendix outcomes (#87); synthetic inputs only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as RENDERER from "../skills/vercel-security-audit/scripts/render-report.mjs";
import * as MODEL from "../skills/vercel-security-audit/scripts/manage-report.mjs";
import * as QA from "../skills/vercel-security-audit/scripts/check-report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = path.join(ROOT, "skills", "vercel-security-audit");
const SCRIPTS = path.join(SKILL, "scripts");
const CHECKER = path.join(SCRIPTS, "check-report.mjs");

const CANARY = "SYNTHETIC_MATRIX_CANARY";
const CORE = ["IAM", "CRE", "DEP", "FWB", "SRC", "SEC", "DOM", "OPS"]
  .flatMap((d) => [1, 2, 3].map((n) => `${d}-${String(n).padStart(2, "0")}`));
const OPTIONAL = ["DEP-04", "SRC-04", "SEC-04", "OPS-04"];
const STATES = ["satisfactory", "action_recommended", "needs_confirmation", "not_reviewed", "not_applicable"];

function appendixStatuses() {
  const statuses = Object.fromEntries(CORE.map((topic, index) => [topic, STATES[index % 5]]));
  for (const topic of OPTIONAL) statuses[topic] = "not_reviewed";
  return statuses;
}

/** Matrix rows default to `| ID name | status | Team-wide |`; rows overrides cells after the ID. */
function source({ appendix = null, rows = null, drop = [], extraRows = [], opening = "## Status at a glance", later = "" } = {}) {
  appendix = appendix || appendixStatuses();
  const cells = Object.fromEntries(Object.entries(appendix).map(([topic, status]) => [topic, `${status} | Team-wide`]));
  Object.assign(cells, rows || {});
  let text = `# Synthetic review\n\n${opening}\n\n`;
  for (const [label, topics] of [["Check", CORE], ["Optional check", OPTIONAL]]) {
    text += `| ${label} | Team | \`example-site\` |\n| --- | --- | --- |\n`;
    text += topics.filter((topic) => !drop.includes(topic)).map((topic) => `| ${topic} Synthetic check | ${cells[topic]} |\n`).join("");
    text += label === "Check" ? extraRows.map((row) => row + "\n").join("") : "";
    text += "\n";
  }
  text += `## Review summary\n\n${CANARY}\n\n${later}\n## Appendix: check outcomes\n`;
  for (const topic of [...CORE, ...OPTIONAL]) {
    text += `\n### ${topic} - Synthetic check\nStatus: ${appendix[topic]}\n\nRationale: ${CANARY}.\n`;
  }
  return text;
}

function runChecker(html) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-parity-"));
  let result;
  try {
    const file = path.join(directory, "report.html");
    fs.writeFileSync(file, html, "utf8");
    const run = spawnSync(process.execPath, [CHECKER, file], { encoding: "utf8", timeout: 20000 });
    result = { returncode: run.status, stdout: run.stdout, stderr: run.stderr };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  assert.ok(!(result.stdout + result.stderr).includes(CANARY));
  // Python checked for "Traceback"; an uncaught Node error prints a stack with "    at ".
  assert.ok(!result.stderr.includes("Traceback"));
  assert.ok(!/\n\s+at /.test(result.stderr), result.stderr);
  return result;
}

const checkSource = (text) => runChecker(RENDERER.renderReport(text));

function assertFails(text, ...phrases) {
  const result = checkSource(text);
  assert.equal(result.returncode, 1, result.stdout);
  assert.equal(result.stdout, "");
  for (const phrase of phrases) assert.ok(result.stderr.includes(phrase), `${phrase} in ${result.stderr}`);
  return result.stderr;
}

test("consistent matrix passes and reports parity", () => {
  const result = checkSource(source());
  assert.equal(result.returncode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).matrix_parity, "matched all 28 checks");
});

test("matrix satisfactory but appendix needs_confirmation fails naming the ID", () => {
  const appendix = appendixStatuses();
  appendix["IAM-02"] = "needs_confirmation";
  const stderr = assertFails(source({ appendix, rows: { "IAM-02": "satisfactory | Team-wide" } }),
    "Status matrix shows a better result than the appendix.",
    "check ID IAM-02", "matrix satisfactory", "appendix needs_confirmation");
  assert.ok(!stderr.includes("IAM-01"));
});

test("matrix worse than appendix also fails", () => {
  assertFails(source({ rows: { "IAM-01": "action_recommended | Team-wide" } }),
    "Status matrix shows a worse result than the appendix.", "check ID IAM-01",
    "matrix action_recommended", "appendix satisfactory");
});

test("every status pair that differs fails", () => {
  for (const matrix of STATES) {
    for (const appendix of STATES) {
      const statuses = appendixStatuses();
      statuses["DOM-02"] = appendix;
      const result = checkSource(source({ appendix: statuses, rows: { "DOM-02": `${matrix} | Team-wide` } }));
      assert.equal(result.returncode, matrix === appendix ? 0 : 1, `${matrix}/${appendix}: ${result.stderr}`);
    }
  }
});

test("multi-column row summarises to its least favourable status", () => {
  const appendix = appendixStatuses();
  appendix["DEP-01"] = "needs_confirmation";
  for (const [cells, expected] of [["By project | needs_confirmation", 0],
    ["satisfactory | needs_confirmation", 0],
    ["not_applicable | satisfactory", 1],
    ["needs_confirmation | not_reviewed", 0],
    ["needs_confirmation | action_recommended", 1],
    ["By project | satisfactory", 1]]) {
    const result = checkSource(source({ appendix, rows: { "DEP-01": cells } }));
    assert.equal(result.returncode, expected, `${cells}: ${result.stderr}`);
    if (expected) assert.ok(result.stderr.includes("check ID DEP-01"), cells);
  }
});

test("check missing from matrix or listed twice names the ID", () => {
  assertFails(source({ drop: ["SEC-04"] }),
    "Status matrix is missing a check that the appendix contains.", "check ID SEC-04");
  assertFails(source({ extraRows: ["| CRE-03 Again | satisfactory | Team-wide |"] }),
    "Status matrix lists a check more than once.", "check ID CRE-03");
});

test("unknown or ambiguous IDs fail without echoing them", () => {
  const stderr = assertFails(source({ extraRows: ["| ZZZ-97 Invented | satisfactory | Team-wide |"] }),
    "not in the bundled checklist");
  assert.ok(!stderr.includes("ZZZ-97"));
  assertFails(source({ extraRows: [`| ${CANARY} | satisfactory | Team-wide |`] }),
    "exactly one check ID in its first cell");
  assertFails(source({ rows: { "IAM-01": "satisfactory | Team-wide" },
    extraRows: ["| IAM-03 and SRC-03 | satisfactory | Team-wide |"] }),
  "exactly one check ID in its first cell");
});

test("cells hold one status key, Team-wide or By project", () => {
  for (const cells of [`${CANARY} | Team-wide`, "`satisfactory` | Team-wide", "satisfactory | ",
    "satisfactory | Team wide", "**satisfactory** | Team-wide"]) {
    assertFails(source({ rows: { "IAM-01": cells } }),
      "Status matrix cells must hold exactly one status key, Team-wide or By project.");
  }
  assertFails(source({ rows: { "IAM-01": "By project | Team-wide" } }),
    "Status matrix row has no status", "check ID IAM-01");
});

test("optional checks need their own table", () => {
  assertFails(source({ drop: ["OPS-04"], extraRows: ["| OPS-04 Optional | not_reviewed | Team-wide |"] }),
    "Optional checks need their own status matrix table");
});

test("matrix must open the report", () => {
  const text = source();
  // Python re.sub(r"## Status at a glance\n\n(\|.*\n|\n)*", "", text); "." excludes only \n there.
  const missing = text.replace(/## Status at a glance\n\n(?:\|[^\n]*\n|\n)*/g, "");
  assertFails(missing, "No status matrix found.");
  // A matrix moved below the opening section is not the status matrix.
  const moved = text.split("## Status at a glance").join("## Introduction\n\nSynthetic.\n\n## Status at a glance");
  assertFails(moved, "No status matrix found.");
  // Draft notices before the first heading are fine; so is a matrix without its own heading.
  assert.equal(checkSource(text.split("## Status at a glance").join("> Local draft.")).returncode, 0);
});

test("later and appendix tables are neither matrix rows nor outcomes", () => {
  const later = "| Check | Status |\n| --- | --- |\n| IAM-01 | action_recommended |\n";
  let result = checkSource(source({ later }));
  assert.equal(result.returncode, 0, result.stderr);
  const text = source().replace("Rationale: " + CANARY + ".\n", "Rationale: synthetic.\n\n" + later);
  result = checkSource(text);
  assert.equal(result.returncode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).counts.core.satisfactory, 5);
});

test("manage-report build with every status passes unchanged", () => {
  let report = MODEL.newReport("example-team", "Synthetic configuration review");
  const checks = [];
  // Optional checks stay not_reviewed: the model rejects evidence without optional consent.
  CORE.forEach((topic, index) => {
    checks.push({
      id: topic, status: STATES[index % 5], statement: "Synthetic statement.",
      rationale: "Synthetic rationale.",
      evidence_log: [{
        id: `ev-${String(index).padStart(3, "0")}`, observed_at: "2026-10-25T12:00:00Z",
        source_kind: "browser", source_description: "Synthetic metadata",
        scope_alias: "example-project", observed: "Synthetic observation.",
        limitation: "Synthetic limitation.",
      }],
    });
  });
  report = MODEL.appendEvidence(report, { expected_revision: 1, checks });
  const statuses = Object.fromEntries(report.checks.map((check) => [check.id, check.status]));
  assert.deepEqual(new Set(Object.values(statuses)), new Set(STATES));
  for (const value of [MODEL.newReport("example-team", "Synthetic configuration review"), report]) {
    const result = runChecker(MODEL.renderReport(MODEL.buildMarkdown(value)));
    assert.equal(result.returncode, 0, `revision ${value.revision}: ${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).matrix_parity, "matched all 28 checks");
  }
});

test("named errors only carry checklist IDs and status keys", () => {
  assert.equal(new QA.CheckError("Rule.", CANARY, CANARY, "satisfactory").message, "Rule. (appendix satisfactory).");
  assert.equal(new QA.CheckError("Rule.", "ZZZ-99").message, "Rule.");
  assert.equal(new QA.CheckError("Rule.", "IAM-01", "not_reviewed").message,
    "Rule. (check ID IAM-01; matrix not_reviewed).");
  // Python walked the AST for CheckError(...) calls; this scans the module source for the same shape:
  // a string literal first, then only plain identifiers, and no keyword-style (object) arguments.
  const text = fs.readFileSync(CHECKER, "utf8");
  const calls = [...text.matchAll(/new CheckError\(/g)];
  assert.ok(calls.length >= 5, `only ${calls.length} CheckError calls`);
  for (const call of calls) {
    const line = text.slice(0, call.index).split("\n").length;
    const rest = text.slice(call.index + call[0].length);
    assert.match(rest, /^\s*"(?:[^"\\\n]|\\.)*"(?:\s*,\s*[A-Za-z_$][\w$]*)*\s*\)/, `line ${line}`);
  }
});

test("status order is defined in the template in the checker order", () => {
  const template = fs.readFileSync(path.join(SKILL, "references", "report-template.md"), "utf8");
  const line = template.split("\n").find((item) => item.startsWith("Status order"));
  assert.ok(line !== undefined, "Status order line");
  assert.deepEqual(Array.from(line.matchAll(/`([a-z_]+)`/g), (match) => match[1]), [...QA.STATUS_ORDER]);
  const design = fs.readFileSync(path.join(SKILL, "references", "report-design.md"), "utf8");
  assert.ok(design.includes("### Status matrix comparison"));
});
