// Scope is agreed before long reference reads (#45); offline document contracts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SKILL = new URL("../skills/vercel-security-audit/SKILL.md", import.meta.url);

function after(text, sep) {
  const index = text.indexOf(sep);
  if (index < 0) throw new Error(`separator not found: ${JSON.stringify(sep)}`);
  return text.slice(index + sep.length);
}
function before(text, sep) {
  const index = text.indexOf(sep);
  return index < 0 ? text : text.slice(0, index);
}
function indexOf(text, sub) {
  const index = text.indexOf(sub);
  if (index < 0) throw new Error(`substring not found: ${JSON.stringify(sub)}`);
  return index;
}

const load = () => readFileSync(SKILL, "utf8");

test("startup checks presence without full reads", () => {
  const startup = before(after(load(), "## Startup: installation integrity\n"), "\n## ");
  assert.ok(startup.includes("Do not read them in full yet"));
  assert.ok(!startup.includes("Read all four essential references in full at startup"));
});

test("scope question precedes reference reads", () => {
  const step = before(after(load(), "### 1."), "### 2.");
  const ask = indexOf(step, "Ask for scope first; it needs no account reads or reference reads.");
  const read = indexOf(step, "Then read [capabilities](references/capabilities.md)");
  assert.ok(ask < read);
  assert.ok(step.includes("in full before any account read"));
});

test("report references load at step five", () => {
  const step = before(after(load(), "### 5."), "### 6.");
  assert.ok(step.includes("[report template](references/report-template.md) and "
    + "[report design](references/report-design.md) in full now"));
});
