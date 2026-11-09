// Offline policy-contract checks, not executed agent/account behaviour tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SKILL = new URL("../skills/vercel-security-audit/", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, SKILL), "utf8");
const policy = () => read("references/evidence-assessment.md");

function after(text, sep) {
  const index = text.indexOf(sep);
  if (index < 0) throw new Error(`separator not found: ${JSON.stringify(sep)}`);
  return text.slice(index + sep.length);
}
function before(text, sep) {
  const index = text.indexOf(sep);
  return index < 0 ? text : text.slice(0, index);
}

test("conflict policy is required context", () => {
  for (const path of ["SKILL.md", "references/checklist.md"]) {
    const text = read(path);
    assert.ok(text.includes("evidence-assessment.md"), path);
    assert.ok(text.includes("before assigning statuses"), path);
  }
});

test("conflicts preserve provenance and uncertainty", () => {
  const text = policy();
  for (const clause of ["No source is universally authoritative", "both observations",
    "observation and documentation verification dates", "scope",
    "product names", "redacted", "needs_confirmation"]) {
    assert.ok(text.includes(clause), clause);
  }
});

test("aggregate pass cannot override personal token evidence", () => {
  const text = before(after(policy(), "## Personal access tokens"), "\n## ");
  for (const clause of ["PAT", "aggregate pass", "personal token count",
    "cannot override", "each Owner", "needs_confirmation"]) {
    assert.ok(text.includes(clause), clause);
  }
});

test("project count is not a complete id inventory", () => {
  const text = before(after(policy(), "## Project inventory"), "\n## ");
  for (const clause of ["reported project count", "listed project IDs", "incomplete",
    "needs_confirmation", "no missing project names"]) {
    assert.ok(text.includes(clause), clause);
  }
});

test("associations and historical metadata have narrow meaning", () => {
  const text = policy();
  const integration = before(after(text, "## Integration and environment metadata"), "\n## ");
  assert.ok(integration.includes("resource associations are not proof of environment-variable metadata"));
  assert.ok(integration.includes("SEC-01"));
  const git = before(after(text, "## Current Git connection"), "\n## ");
  assert.ok(git.includes("historical Git metadata does not establish a current Git link"));
  assert.ok(git.includes("SRC-01"));
  assert.ok(git.includes("needs_confirmation"));
});
