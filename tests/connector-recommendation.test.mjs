// Routing recommends a connector before CLI/browser fallbacks (#43); offline document contracts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SKILL = new URL("../skills/vercel-security-audit/", import.meta.url);
const REFS = new URL("references/", SKILL);

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

test("routing recommends connector then cli then browser", () => {
  const text = readFileSync(new URL("capabilities.md", REFS), "utf8");
  const routing = before(after(text, "## Routing"), "\n## ");
  const recommend = indexOf(routing, "recommend connecting one before any account reads");
  const cli = indexOf(routing, "only if the user declines or cannot connect");
  const browser = indexOf(routing, "Use an authorised browser last");
  assert.ok(recommend < cli);
  assert.ok(cli < browser);
  assert.ok(routing.includes("Never install, connect or authenticate it yourself."));
  assert.ok(routing.includes("Record the user's choice."));
  assert.ok(routing.includes("Do not use the browser as a substitute"));
});

test("check map has no connector path", () => {
  const text = readFileSync(new URL("mcp-check-map.md", REFS), "utf8");
  const contract = before(after(text, "## Selection contract"), "## Routing entries");
  assert.ok(contract.includes("No connector:"));
  assert.ok(contract.includes("skip every MCP entry below"));
  assert.ok(contract.includes("rather than browser work by default"));
});

test("skill step one recommends without installing", () => {
  const text = readFileSync(new URL("SKILL.md", SKILL), "utf8");
  const step = before(after(text, "### 1."), "### 2.");
  assert.ok(step.includes("recommend that the user connect one before collection"));
  assert.ok(step.includes("never install or connect it yourself"));
  assert.ok(step.includes("Use the CLI only if they decline"));
});
