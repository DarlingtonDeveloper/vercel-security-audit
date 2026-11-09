// Bucketed traffic windows are recorded as returned, not as requested (#48).
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

test("capabilities explain bucket boundaries", () => {
  const text = readFileSync(new URL("capabilities.md", REFS), "utf8");
  for (const clause of ["traffic list aggregates into time buckets", "returned period start and end",
    "not the requested relative window", "explicit ISO 8601 --since and --until",
    "record it as unknown"]) {
    assert.ok(text.includes(clause), clause);
  }
});

test("coverage window field uses returned period", () => {
  const text = readFileSync(new URL("report-template.md", REFS), "utf8");
  const block = before(after(text, "## Coverage limits"), "\n## ");
  assert.ok(block.includes("using the returned period for bucketed feeds"));
  assert.ok(block.includes("bucket size"));
});
