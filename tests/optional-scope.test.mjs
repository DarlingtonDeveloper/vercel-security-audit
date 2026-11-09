// Offline scope-consent contracts, not a test of agent conversations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SKILL = new URL("../skills/vercel-security-audit/", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, SKILL), "utf8");
const OPTIONAL = ["DEP-04", "SRC-04", "SEC-04", "OPS-04"];

function after(text, sep) {
  const index = text.indexOf(sep);
  if (index < 0) throw new Error(`separator not found: ${JSON.stringify(sep)}`);
  return text.slice(index + sep.length);
}
function before(text, sep) {
  const index = text.indexOf(sep);
  return index < 0 ? text : text.slice(0, index);
}

const scopeStep = () => before(after(read("SKILL.md"), "### 1. Agree scope and discover capabilities"), "### 2.");

test("step one names all four optional checks", () => {
  const text = scopeStep();
  for (const topic of OPTIONAL) {
    assert.ok(text.includes(topic), topic);
  }
  assert.ok(text.includes("per named source/application"));
});

test("full review asks once without implicit consent", () => {
  const text = scopeStep();
  for (const clause of ['"full"', "ask once", "not automatic authorisation",
    "accept", "decline", "partial", "already explicit", "do not repeat"]) {
    assert.ok(text.includes(clause), clause);
  }
});

test("declined and partial decisions are recorded separately", () => {
  const text = after(read("references/checklist.md"), "## Optional deeper authorized source/application review");
  for (const clause of ["per named source/application", "accepted, declined or partial",
    "not_reviewed", "unauthorised", "does not fail the core review"]) {
    assert.ok(text.includes(clause), clause);
  }
});

test("report has a consent ledger not just a global yes no", () => {
  const text = read("references/report-template.md");
  const block = before(after(text, "### Optional scope decisions"), "\n## ");
  for (const topic of OPTIONAL) {
    assert.ok(block.includes(topic), topic);
  }
  for (const clause of ["named source/application", "accepted/declined/partial",
    "consent provenance", "exclusions", "not_reviewed", "unauthorised"]) {
    assert.ok(block.includes(clause), clause);
  }
});
