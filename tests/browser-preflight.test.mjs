// Offline instruction contracts; no browser, OAuth or account execution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../skills/vercel-security-audit/", import.meta.url));
const read = (relative) => readFileSync(ROOT + relative, "utf8");

const skill = read("SKILL.md");
const plan = read("references/collection-plan.md");
const capabilities = read("references/capabilities.md");

function split1(text, sep) {
  const index = text.indexOf(sep);
  if (index < 0) throw new Error(`separator not found: ${JSON.stringify(sep)}`);
  return [text.slice(0, index), text.slice(index + sep.length)];
}

test("preflight is before inventory and linked from capabilities", () => {
  const [preflight, collection] = split1(skill, "### 2. Inventory");
  assert.ok(preflight.includes("references/collection-plan.md"));
  assert.ok(preflight.includes("Before inventory or product checks"));
  assert.ok(capabilities.includes("collection-plan.md"));
  assert.ok(collection.includes("one planned collection pass"));
});

test("identity and permissions are separate preconditions", () => {
  for (const rule of [
    "read OAuth scopes or equivalent role/grants", "pre-model field selection",
    "automatic screenshots on navigation/reload", "connector/CLI account and team",
    "before combining evidence", "Do not auto-login", "MFA, device policy",
    "match/mismatch and scope aliases", "A login page is not proof",
  ]) {
    assert.ok(plan.includes(rule), rule);
  }
});

test("blocked browser has explicit portable choice", () => {
  for (const rule of [
    "continue API-only", "pause for user handoff", "explicit user confirmation",
    "silence is not consent", "noninteractive host pauses", "Markdown remains available",
    "separately confirmed authorised connector identity",
  ]) {
    assert.ok(plan.includes(rule), rule);
  }
});

test("plan covers every id and routes before report", () => {
  for (const rule of [
    "24 core IDs", "separately authorised optional ID", "API-readable:",
    "dashboard-only:", "owner statement:", "unavailable:", "fallback route or none",
    "allowed evidence fields", "completeness criteria", "one planned pass",
    "before drafting the first report", "not_reviewed", "needs_confirmation",
    "Never imply that planned reads or unavailable browser features worked",
  ]) {
    assert.ok(plan.includes(rule), rule);
  }
});
