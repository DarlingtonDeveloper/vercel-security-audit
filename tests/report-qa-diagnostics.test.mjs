// check-report.mjs names the failing rule without echoing content (#46); synthetic inputs only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderReport } from "../skills/vercel-security-audit/scripts/render-report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = path.join(ROOT, "skills", "vercel-security-audit");
const CHECKER = path.join(SKILL, "scripts", "check-report.mjs");
const CANARY = "SYNTHETIC_QA_CANARY";
const CORE = ["IAM", "CRE", "DEP", "FWB", "SRC", "SEC", "DOM", "OPS"]
  .flatMap((d) => [1, 2, 3].map((n) => `${d}-${String(n).padStart(2, "0")}`));
const OPTIONAL = ["DEP-04", "SRC-04", "SEC-04", "OPS-04"];

function source(domainHeading = "## Appendix: Identity and access") {
  let text = "# Synthetic review\n\n## Status at a glance\n\n| Check | Team |\n| --- | --- |\n";
  text += CORE.map((topic) => `| ${topic} | not_reviewed |\n`).join("");
  text += "\n| Optional check | Team |\n| --- | --- |\n";
  text += OPTIONAL.map((topic) => `| ${topic} | not_reviewed |\n`).join("");
  text += `\n## Summary\n${CANARY}\n\n${domainHeading}\n`;
  for (const topic of CORE) text += `\n### ${topic} - Synthetic check ${CANARY}\nStatus: not_reviewed\n`;
  text += "\n## Appendix: optional checks\n";
  for (const topic of OPTIONAL) text += `\n### ${topic} - Optional check\nStatus: not_reviewed\n`;
  return text;
}

function runChecker(html, ...extra) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "report-qa-diag-"));
  let result;
  try {
    const file = path.join(directory, `${CANARY}.html`);
    fs.writeFileSync(file, html, "utf8");
    const args = [];
    for (const [name, value] of extra) {
      const sidecar = path.join(directory, `${CANARY}-${name}.json`);
      fs.writeFileSync(sidecar, value, "utf8");
      args.push(`--${name}`, sidecar);
    }
    const run = spawnSync(process.execPath, [CHECKER, file, ...args], { encoding: "utf8", timeout: 20000 });
    result = { returncode: run.status, stdout: run.stdout, stderr: run.stderr };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  assert.ok(!(result.stdout + result.stderr).includes(CANARY));
  // Python's check was for a "Traceback"; an uncaught Node error prints a stack with "    at ".
  assert.ok(!result.stderr.includes("Traceback"));
  assert.ok(!/\n\s+at /.test(result.stderr));
  return result;
}

test("domain heading with appendix prefix passes", () => {
  const result = runChecker(renderReport(source()));
  assert.equal(result.returncode, 0, result.stderr);
});

test("unprefixed domain heading names the appendix rule", () => {
  const result = runChecker(renderReport(source("## Identity and access")));
  assert.equal(result.returncode, 1);
  assert.ok(result.stderr.includes("Only checks under second-level headings that begin with Appendix are counted."),
    result.stderr);
});

test("missing appendix is reported specifically", () => {
  const result = runChecker(renderReport(`# Synthetic\n\n## Summary\n${CANARY}\n`));
  assert.equal(result.returncode, 1);
  assert.ok(result.stderr.includes("No appendix section found."), result.stderr);
});

test("summary mismatch and bad JSON are distinguishable", () => {
  const html = renderReport(source());
  const zero = Object.fromEntries(["satisfactory", "action_recommended", "needs_confirmation",
    "not_reviewed", "not_applicable"].map((key) => [key, 0]));
  const wrong = JSON.stringify({ core: zero, optional: { ...zero, not_reviewed: 4 } });
  const mismatch = runChecker(html, ["expected-summary", wrong]).stderr;
  assert.ok(mismatch.includes("Expected summary core counts do not match the appendix."), mismatch);
  const invalid = runChecker(html, ["expected-summary", "{" + CANARY]).stderr;
  assert.ok(invalid.includes("a JSON input is not valid JSON."), invalid);
  assert.notEqual(mismatch, invalid);
});

test("missing input names the role, not the path", () => {
  const run = spawnSync(process.execPath, [CHECKER, `/nonexistent/${CANARY}.html`], { encoding: "utf8", timeout: 20000 });
  assert.equal(run.status, 1);
  assert.ok(run.stderr.includes("The input file could not be used"), run.stderr);
  assert.ok(!run.stderr.includes(CANARY));
});

test("printed messages are literal strings", () => {
  // Python walked the AST for ReportError(...) calls; this scans the module source for the same shape.
  const text = fs.readFileSync(CHECKER, "utf8");
  const calls = [...text.matchAll(/new ReportError\(/g)];
  assert.ok(calls.length > 30, `only ${calls.length} ReportError calls`);
  for (const call of calls) {
    const line = text.slice(0, call.index).split("\n").length;
    const rest = text.slice(call.index + call[0].length);
    // Exactly one argument: a single double-quoted string literal with no interpolation or concatenation.
    assert.match(rest, /^\s*"(?:[^"\\\n]|\\.)*"\s*\)/, `line ${line}`);
  }
  const raised = [...text.matchAll(/throw new (?:Error|ValueError|TypeError|RangeError)\(/g)];
  assert.deepEqual(raised, [], "authored failures must use ReportError");
});
