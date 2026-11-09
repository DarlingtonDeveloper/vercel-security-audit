// Offline UI-state instruction contracts, not live DOM or browser tests.
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

const playbook = after(read("references/browser-evidence.md"), "## UI-state playbook");

test("state playbook is linked from all entry points", () => {
  for (const relative of ["SKILL.md", "references/capabilities.md", "references/checklist.md"]) {
    assert.ok(read(relative).includes("browser-evidence.md#ui-state-playbook"), relative);
  }
});

test("read only semantics and ambiguity rules", () => {
  for (const rule of [
    "aria-checked", "current `checked` property", "input type", "accessible label",
    "initial default rather than current state", 'aria-checked="mixed"',
    "Never click or toggle to discover state", "Color alone is not enabled-state proof",
    "disabled attribute describes interactivity", "unknown/needs_confirmation",
    "current published policy", "Role icons", "not scope enumeration",
  ]) {
    assert.ok(playbook.includes(rule), rule);
  }
});

test("loading is bounded by capability and single safe reload", () => {
  const loading = before(after(playbook, "### Loading, missing controls and navigation"), "### Per-check");
  for (const rule of [
    "bounded wait", "verified host capabilities", "not a blanket 30-second sleep",
    "no safe wait/readiness capability", "at most one safe reload",
    "no form change", "no unsaved input", "no submission in progress",
    "read-only reload", "privacy gate", "Check identity/team again",
    "still-pending Loading state becomes needs_confirmation", "Do not loop",
  ]) {
    assert.ok(loading.includes(rule), rule);
  }
});

test("missing is unknown not disabled or guessed route", () => {
  for (const rule of [
    "404 or unavailable feature is not a disabled setting", "not_reviewed",
    "Follow the observed Rules view", "do not guess `/firewall/config`",
    "not_applicable or action_recommended", "not permission to open an unknown sensitive destination",
  ]) {
    assert.ok(playbook.includes(rule), rule);
  }
});

test("per id interpretation and attack mode context", () => {
  const section = before(after(playbook, "### Per-check interpretation"), "### Minimal state record");
  for (const check of ["IAM-02", "SEC-01", "OPS-01 / OPS-02 / OPS-03", "CRE-01", "DOM-02", "FWB-01", "FWB-02"]) {
    assert.ok(section.includes(`- ${check}:`), check);
  }
  for (const rule of [
    "enrolment from enforcement", "SAML configuration from enforcement",
    "never send a test notification", "never reveal/copy token values",
    "no active TLS scan", "Attack Mode context", "Off alone is not a finding",
    "Never toggle Attack Mode", "not conflate Attack Mode",
  ]) {
    assert.ok(section.includes(rule), rule);
  }
});

test("candidate labels and minimal records do not claim live ui", () => {
  for (const rule of [
    "candidate labels", "not official/current control names", "host-capability-based",
    "safe Control label", "scope aliases", "nonce IDs", "No secret belongs in the record",
    "A statement and an observed state are separate evidence entries",
  ]) {
    assert.ok(playbook.includes(rule), rule);
  }
});
