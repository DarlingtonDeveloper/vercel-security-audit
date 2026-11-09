// Offline entitlement-policy contracts; no current entitlement claims or live reads.
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

const policy = () => after(read("references/evidence-assessment.md"), "## Plan and per-feature applicability");

test("plan is recorded without treating it as entitlement", () => {
  const text = policy();
  for (const clause of ["observed plan", "per-feature entitlements", "account-specific",
    "custom features", "role visibility", "current public documentation",
    "verification date", "account facts"]) {
    assert.ok(text.includes(clause), clause);
  }
  for (const path of ["SKILL.md", "references/report-template.md"]) {
    assert.ok(read(path).includes("per-feature"), path);
  }
});

test("access errors are not nonapplicability", () => {
  const text = policy();
  for (const clause of ["not_applicable only", "feature-specific", "403", "upgrade prompt",
    "not_reviewed", "needs_confirmation", "not proof of non-applicability"]) {
    assert.ok(text.includes(clause), clause);
  }
});

test("mixed iam subchecks do not inherit a pass", () => {
  const text = policy();
  for (const clause of ["IAM-02", "MFA", "SAML", "directory provisioning",
    "one non-applicable subfeature", "cannot make the whole check satisfactory"]) {
    assert.ok(text.includes(clause), clause);
  }
});

test("managed ruleset requires effective state and intent", () => {
  const text = policy();
  for (const clause of ["managed ruleset", "entitlement", "published", "effective plan",
    "intent", "inert", "mismatch", "confirmation, not an assertion"]) {
    assert.ok(text.includes(clause), clause);
  }
  assert.ok(text.includes("Do not hardcode plan-to-feature mappings"));
  assert.doesNotMatch(text, /Pro (?:does not|cannot|never) (?:support|include|use)/);
});
