// Offline routing-document contracts, not live tool or host validation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SKILL = new URL("../skills/vercel-security-audit/", import.meta.url);
const REFS = new URL("references/", SKILL);
const read = (url) => readFileSync(url, "utf8");

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
const setOf = (items) => new Set(items);

// Python: re.findall(r"^### ([A-Z]{3}-\d{2})\n(.*?)(?=^### |\Z)", text, re.M | re.S)
function entries(text) {
  const result = {};
  for (const [, checkId, body] of text.matchAll(/^### ([A-Z]{3}-\d{2})\n([\s\S]*?)(?=^### |(?![\s\S]))/gm)) {
    if (Object.hasOwn(result, checkId)) {
      throw new Error(`Duplicate routing ID: ${checkId}`);
    }
    const fields = [...body.matchAll(/^- ([^:]+): (.+)$/gm)].map((m) => [m[1], m[2]]);
    const dict = Object.fromEntries(fields);
    if (Object.keys(dict).length !== fields.length) {
      throw new Error(`Duplicate field: ${checkId}`);
    }
    result[checkId] = dict;
  }
  return result;
}

const text = read(new URL("mcp-check-map.md", REFS));
const routes = entries(text);

test("exact checklist coverage and route shape", () => {
  const checklist = read(new URL("checklist.md", REFS));
  const index = indexOf(checklist, "## Optional deeper");
  const core = checklist.slice(0, index);
  const optional = checklist.slice(index + "## Optional deeper".length);
  const ids = (body) => setOf([...body.matchAll(/^### ([A-Z]{3}-\d{2})/gm)].map((m) => m[1]));
  assert.equal(ids(core).size, 24);
  assert.equal(ids(optional).size, 4);
  assert.deepEqual(setOf(Object.keys(routes)), setOf([...ids(core), ...ids(optional)]));
  for (const [checkId, route] of Object.entries(routes)) {
    assert.deepEqual(setOf(Object.keys(route)), setOf(["MCP", "CLI", "Security Dashboard", "Browser"]), checkId);
    assert.ok(Object.values(route).every((value) => Boolean(value)), checkId);
    // No discovered executable tool claims; every candidate needs a schema gate.
    assert.ok(route.MCP.startsWith("Conditional "), checkId);
    assert.match(route.MCP, /schema|SEC-01/, checkId);
    assert.doesNotMatch(route.MCP, /`[a-z]+_[a-z_]+`/, checkId);
    assert.equal(route["Security Dashboard"],
      "Partial/no equivalent verified; no observed check name.", checkId);
  }
});

test("cli routes use existing documented reads or are unsupported", () => {
  const capabilities = read(new URL("capabilities.md", REFS));
  // Direct help lines and the bundled reader's read -> command mapping (#32).
  const commands = setOf([...capabilities.matchAll(/^(?:[a-z-]+ +)?vercel (.+?)(?: --| \[|$)/gm)].map((m) => m[1]));
  assert.ok(commands.size > 0);
  for (const [checkId, route] of Object.entries(routes)) {
    const value = route.CLI;
    assert.ok(value.startsWith("Unsupported")
      || [...commands].some((command) => value.startsWith(command + " ")), `${checkId}: ${value}`);
    assert.doesNotMatch(value, /\bvercel (?:api|env|pull|deploy)\b/, checkId);
  }
});

test("routing is loaded before collection", () => {
  const skill = read(new URL("SKILL.md", SKILL));
  const discovery = before(after(skill, "### 1."), "### 2.");
  assert.ok(discovery.includes("references/mcp-check-map.md"));
  const routing = before(read(new URL("capabilities.md", REFS)), "## Identity");
  assert.ok(routing.includes("mcp-check-map.md"));
  assert.ok(indexOf(routing, "authenticated MCP") < indexOf(routing, "Vercel CLI"));
});

test("security check baseline runs before per check routing and browser", () => {
  const skill = read(new URL("SKILL.md", SKILL));
  assert.ok(!skill.includes("only as an available fallback"));
  const step2 = before(after(skill, "### 2."), "### 3.");
  const baseline = indexOf(step2, "#### Security check baseline");
  const routing = indexOf(step2, "#### Per-check routing");
  assert.ok(baseline < routing);
  // The baseline (step 2) comes before any browser navigation (step 3).
  assert.ok(indexOf(skill, "#### Security check baseline") < indexOf(skill, "### 3."));
  const section = step2.slice(baseline, routing);
  for (const phrase of ["when the CLI route is in use", "`--scope <team>` when team-wide reads are authorised",
    "otherwise with `--project` for each agreed project only",
    "conservative productResult rules", "do not invent slugs",
    "reuse that evidence when routing those IDs",
    "does not replace review of the subsettings", "upgrade the CLI"]) {
    assert.ok(section.includes(phrase), phrase);
  }
  // Connector-first routing is unchanged.
  assert.ok(step2.slice(routing).includes("authenticated MCP first where verified safe"));
  assert.ok(text.includes("Security check baseline: when the CLI route is in use"));
  assert.ok(text.includes("team-wide only with team-wide read authorisation"));
});

test("sharing inventory cannot be reconstructed from events", () => {
  const route = routes["DEP-02"];
  assert.ok(route.MCP.includes("current-state read"));
  assert.ok(route.MCP.includes("no access-bearing URLs or values"));
  assert.ok(route.CLI.includes("never a current active count"));
  assert.ok(route.CLI.includes("cannot drive a current-state finding"));
  assert.ok(route.Browser.includes("pre-exposure privacy gate"));
});

test("parser rejects duplicate ids and fields", () => {
  assert.throws(() => entries("### IAM-01\n- MCP: x\n### IAM-01\n- MCP: y\n"));
  assert.throws(() => entries("### IAM-01\n- MCP: x\n- MCP: y\n"));
});
