// Static privacy contracts; no screenshots, real accounts or customer data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../skills/vercel-security-audit/", import.meta.url));
const read = (relative) => readFileSync(ROOT + relative, "utf8");

function after(text, sep) {
  const index = text.indexOf(sep);
  if (index < 0) throw new Error(`separator not found: ${JSON.stringify(sep)}`);
  return text.slice(index + sep.length);
}
function before(text, sep) {
  const index = text.indexOf(sep);
  return index < 0 ? text : text.slice(0, index);
}

const evidence = read("references/browser-evidence.md");

test("required reference is reachable before capture", () => {
  for (const relative of ["SKILL.md", "references/capabilities.md"]) {
    assert.ok(read(relative).includes("browser-evidence.md"), relative);
  }
  assert.ok(evidence.startsWith("# Browser evidence safety"));
  assert.ok(evidence.includes("before any browser navigation, reload, snapshot or screenshot"));
});

test("screenshot only host cannot repair post exposure", () => {
  for (const rule of [
    "full viewport cannot prefilter", "redact after saving is not a repair",
    "before content reaches the model, transcript, tool logs or disk",
    "navigation, reload, human takeover or tool completion",
    "Otherwise skip the page", "Text snapshots and accessibility trees",
  ]) {
    assert.ok(evidence.includes(rule), rule);
  }
});

test("actual page classification includes high risk destinations", () => {
  const section = before(after(evidence, "## Sensitive destinations"), "## Safe owner");
  for (const marker of [
    "IAM-01 / IAM-03", "Security Dashboard", "users and projects", "blanket safe",
    "CRE-01", "DEP-02", "SEC-01 / SEC-02", "CRE-02 / CRE-03",
    "shared-secret conditions", "actual page",
  ]) {
    assert.ok(section.includes(marker), marker);
  }
  assert.ok(evidence.includes("If sensitivity or behavior is unknown"));
});

test("safe questions cover all core ids", () => {
  const checklist = before(read("references/checklist.md"), "## Optional deeper");
  const ids = new Set([...checklist.matchAll(/^### ([A-Z]{3}-\d{2})/gm)].map((m) => m[1]));
  const questions = before(after(evidence, "## Safe owner-statement questions per check"), "## Accidental");
  assert.deepEqual(new Set([...questions.matchAll(/^- ([A-Z]{3}-\d{2}):/gm)].map((m) => m[1])), ids);
  for (const rule of ["aggregates, policy categories and synthetic aliases", "not screenshots",
    "never browser observations", "Missing observed data stays unknown"]) {
    assert.ok(questions.includes(rule), rule);
  }
});

test("human navigation does not bypass gate", () => {
  for (const rule of ["does not authorise automatic model exposure", "without streaming",
    "do not navigate or ask the owner to open it in the captured session"]) {
    assert.ok(evidence.includes(rule), rule);
  }
});

test("exposure stops collection without rereading values", () => {
  const incident = after(evidence, "## Accidental exposure:");
  for (const rule of [
    "stop all further collection immediately", "Do not re-read values", "OCR",
    "metadata only", "UTC time", "containment status", "without opening affected artifacts",
    "pause for user-directed incident handling", "separate approval",
    "renewed scope/privacy confirmation",
  ]) {
    assert.ok(incident.includes(rule), rule);
  }
});
