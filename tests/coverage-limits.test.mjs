// Offline coverage-report contracts; pagination is not exercised against accounts.
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

test("report requires per feed collection accounting", () => {
  const text = read("references/report-template.md");
  const block = before(after(text, "## Coverage limits"), "\n## ");
  for (const field of ["Source/feed:", "Window:", "Reported total:", "Received:",
    "Inspected:", "Page/finding cap:", "Truncation:",
    "Cursor availability:", "End known:", "Missing sources:",
    "Timeouts/failures:", "Retries and outcomes:"]) {
    assert.ok(block.includes(field), field);
  }
  assert.ok(block.includes("mandatory even when there are no known limits"));
  assert.ok(block.includes("unknown"));
});

test("completion requires coverage block even without limits", () => {
  const text = read("SKILL.md");
  const completion = before(after(text, "### 5. Draft the guided report"), "### 6.");
  assert.ok(completion.includes("Completion:"));
  assert.ok(completion.includes("mandatory Coverage limits block"));
  assert.ok(completion.includes("even when none are known"));
});

test("feed pagination uses discovery not invented flags", () => {
  const text = read("references/capabilities.md");
  const block = before(after(text, "## Pagination and bounded collection"), "\n## ");
  for (const clause of ["activity", "deployments", "observability", "schemas", "installed help",
    "Do not invent pagination flags", "cursor", "Coverage limits"]) {
    assert.ok(block.includes(clause), clause);
  }
});

test("caps and failures cannot support absence claims", () => {
  const text = read("references/capabilities.md");
  const block = before(after(text, "## Pagination and bounded collection"), "\n## ");
  for (const clause of ["100 records is not proof of completeness", "no usable cursor",
    "partial bounded result after failure", "coverage gap",
    "never a negative finding", "needs_confirmation"]) {
    assert.ok(block.includes(clause), clause);
  }
});
