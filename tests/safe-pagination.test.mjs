// Pagination guidance: use the reader, never a shell loop; failures are incomplete (#36).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CAPABILITIES = readFileSync(
  new URL("../skills/vercel-security-audit/references/capabilities.md", import.meta.url), "utf8");

test("reader follows pages not a shell loop", () => {
  assert.ok(CAPABILITIES.includes("### Safe pagination with the reader"));
  assert.ok(CAPABILITIES.includes("Do not write your own shell loop"));
  assert.ok(CAPABILITIES.includes('`echo "$json"`'));
  assert.ok(CAPABILITIES.includes("unquoted `$FLAGS` does not word-split"));
});

test("only an explicit null cursor ends the list", () => {
  assert.ok(CAPABILITIES.includes("`pagination.next` is explicitly null"));
  assert.ok(CAPABILITIES.includes("It is never end-of-list"));
  assert.ok(CAPABILITIES.includes("`partialResult`"));
  assert.ok(CAPABILITIES.includes("never as a negative finding about the unread pages"));
});
