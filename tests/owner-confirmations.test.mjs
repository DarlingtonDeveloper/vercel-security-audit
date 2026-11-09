// Offline handoff-questionnaire contracts; no messages are sent to Owners.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SKILL = new URL("../skills/vercel-security-audit/", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, SKILL), "utf8");

function after(text, sep) {
  const index = text.indexOf(sep);
  if (index < 0) throw new Error(`separator not found: ${JSON.stringify(sep)}`);
  return text.slice(index + sep.length);
}
function before(text, sep) {
  const index = text.indexOf(sep);
  return index < 0 ? text : text.slice(0, index);
}

const questionnaire = () =>
  before(after(read("references/report-template.md"), "### Owner confirmation questionnaire"), "\n## ");

test("each owner confirms only own current token metadata", () => {
  const text = questionnaire();
  for (const clause of ["each Owner", "only your own", "scoped token count",
    "expiry", "not_applicable", "current metadata", "CRE-01",
    "token values", "rotation"]) {
    assert.ok(text.includes(clause), clause);
  }
});

test("mfa questions ask for policy and recoverability not secrets", () => {
  const text = questionnaire();
  for (const clause of ["IAM-02", "MFA", "agreed policy", "recoverability",
    "recovery codes", "method secrets"]) {
    assert.ok(text.includes(clause), clause);
  }
});

test("incident confirmation asks roles not endpoints", () => {
  const text = questionnaire();
  for (const clause of ["OPS-01", "incident delivery ownership", "responsible roles",
    "not endpoints", "Do not send test messages"]) {
    assert.ok(text.includes(clause), clause);
  }
});

test("statements are timestamped and missing facts stay unresolved", () => {
  const text = questionnaire();
  for (const clause of ["Owner self-statement", "directly observed", "UTC",
    "needs_confirmation", "unavailable", "do not broaden access"]) {
    assert.ok(text.includes(clause), clause);
  }
});

test("report handoff does not contact owners", () => {
  const text = questionnaire();
  for (const clause of ["handed to the user", "No automatic DMs", "exact final content and destination"]) {
    assert.ok(text.includes(clause), clause);
  }
  const skill = after(read("SKILL.md"), "### 6. Human review and handoff");
  assert.ok(skill.includes("Owner confirmation questionnaire"));
  assert.ok(skill.includes("do not contact Owners"));
});
