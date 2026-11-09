// The UI-state playbook covers client-side tabs (#50); offline document contract.
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
function indexOf(text, sub) {
  const index = text.indexOf(sub);
  if (index < 0) throw new Error(`substring not found: ${JSON.stringify(sub)}`);
  return index;
}

test("tab switch must be confirmed before reading", () => {
  const text = readFileSync(new URL("browser-evidence.md", REFS), "utf8");
  const playbook = after(text, "## UI-state playbook");
  const tabs = before(after(playbook, "### Tabs and client-side views"), "\n### ");
  for (const clause of ['aria-selected="true"', 'role="tabpanel"', "privacy gate before selecting it",
    "Each panel is its own destination", "record needs_confirmation",
    "Never attribute the previous panel's content", "do not retry by clicking repeatedly"]) {
    assert.ok(tabs.includes(clause), clause);
  }
  assert.ok(indexOf(playbook, "### Tabs and client-side views") < indexOf(playbook, "### Per-check interpretation"));
});
