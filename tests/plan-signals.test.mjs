// Structured plan entitlement signals can support not_applicable under conditions (#49).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const REFS = new URL("../skills/vercel-security-audit/references/", import.meta.url);

function after(text, sep) {
  const index = text.indexOf(sep);
  if (index < 0) throw new Error(`separator not found: ${JSON.stringify(sep)}`);
  return text.slice(index + sep.length);
}
function before(text, sep) {
  const index = text.indexOf(sep);
  return index < 0 ? text : text.slice(0, index);
}

function load() {
  const text = readFileSync(new URL("evidence-assessment.md", REFS), "utf8");
  const policy = after(text, "## Plan and per-feature applicability");
  const signal = before(after(policy, "Structured plan entitlement signals"), "A managed ruleset entry");
  return { policy, signal };
}

test("signal counts only with all conditions", () => {
  const { signal } = load();
  for (const clause of ["counts as the scoped account fact for that feature",
    "selected, authorised identity and team/project scope",
    "Current public documentation, with its verification date, agrees",
    "No other source shows the feature as enabled",
    "UTC observation time are recorded"]) {
    assert.ok(signal.includes(clause), clause);
  }
});

test("signal is bounded and never drives purchases", () => {
  const { signal } = load();
  for (const clause of ["covers only the named feature in that scope", "keep both observations and needs_confirmation",
    "upgrade prompt, 403, hidden control or tool error is still not enough",
    "never a reason to recommend buying an upgrade"]) {
    assert.ok(signal.includes(clause), clause);
  }
});

test("managed ruleset and template reference the signal", () => {
  const { policy } = load();
  assert.ok(policy.includes("a structured plan signal meeting the conditions above satisfies this part"));
  const template = readFileSync(new URL("report-template.md", REFS), "utf8");
  assert.ok(template.includes("a structured plan entitlement field from a verified read can"));
});
