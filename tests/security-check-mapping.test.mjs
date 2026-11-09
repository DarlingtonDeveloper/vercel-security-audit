// security check --json mapping uses the fields the CLI actually returns (#34).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const CAPABILITIES = readFileSync(new URL("skills/vercel-security-audit/references/capabilities.md", ROOT), "utf8");
const SCENARIOS = readFileSync(new URL("evals/scenarios.md", ROOT), "utf8");
const SKILL = readFileSync(new URL("skills/vercel-security-audit/SKILL.md", ROOT), "utf8");

test("real output shape is documented", () => {
  assert.ok(CAPABILITIES.includes("has no status or risk fields"));
  assert.ok(!CAPABILITIES.includes("has no status, risk or muted fields"));
  for (const field of ["`unavailable`", "`unavailableReason`", "`mutedCount`", "`posture.mutedCount`"]) {
    assert.ok(CAPABILITIES.includes(field), field);
  }
  for (const field of ["`violationsCount`", "`totalCount` (omitted for some checks)", "`sampleType`", "`samples`"]) {
    assert.ok(CAPABILITIES.includes(field), field);
  }
  assert.ok(!CAPABILITIES.includes("security check reports product check statuses, risk"));
});

test("mapping from counts is conservative", () => {
  for (const phrase of ["`violations_found` (violationsCount above 0)", "not yet a finding",
    "`no_violations` (violationsCount 0 and totalCount above 0)",
    "never for the whole checklist ID or team",
    "`nothing_evaluated` (totalCount 0)", "never satisfactory",
    "`no_violations_total_unreported` (violationsCount 0 and totalCount omitted",
    "record that the total was not reported"]) {
    assert.ok(CAPABILITIES.includes(phrase), phrase);
  }
});

test("muted and unavailable are never passing", () => {
  for (const phrase of ["checking muted and unavailable before any count rule",
    "`muted` (unavailableReason `muted`, or mutedCount above 0 with no unmuted violations): never passing",
    "`unavailable` (unavailable set, or any other unavailableReason)",
    "unrecognised reason strings are never echoed"]) {
    assert.ok(CAPABILITIES.includes(phrase), phrase);
  }
  assert.ok(SCENARIOS.includes("A check reported as muted or unavailable (including no access) is never passing"));
});

test("muted state is unknown when fields are missing", () => {
  assert.ok(CAPABILITIES.includes("Do not infer that nothing is muted from missing fields"));
  assert.ok(SCENARIOS.includes("muted state is unknown when the CLI omits muted fields"));
  for (const text of [CAPABILITIES, SKILL, SCENARIOS]) {
    assert.ok(!text.includes("cannot be detected"));
  }
  assert.ok(!SKILL.includes("Muted findings are not visible in CLI output"));
});
