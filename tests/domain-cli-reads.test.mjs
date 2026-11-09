// Domain CLI reads are routed with selection gates; env and cert listings stay excluded (#44).
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

// Python: dict(re.findall(r"^- ([^:]+): (.+)$", body, re.M)); later keys win.
function route(text, checkId) {
  const body = before(after(text, `### ${checkId}\n`), "\n### ");
  return Object.fromEntries([...body.matchAll(/^- ([^:]+): (.+)$/gm)].map((m) => [m[1], m[2]]));
}

const capabilities = readFileSync(new URL("capabilities.md", REFS), "utf8");
const map = readFileSync(new URL("mcp-check-map.md", REFS), "utf8");

test("domains list is a documented json pattern", () => {
  // Run through the bundled reader (#32), which assigns the synthetic aliases.
  assert.ok(capabilities.includes("domains                  vercel domains list --scope <team> --limit 100"));
  assert.ok(capabilities.includes("requires explicit team-wide read authorisation"));
  assert.ok(capabilities.includes("synthetic aliases"));
});

test("domain routes use domains list with gates", () => {
  for (const checkId of ["DOM-01", "DOM-03"]) {
    const cli = route(map, checkId).CLI;
    assert.ok(cli.startsWith("domains list "), checkId);
    assert.ok(cli.includes("team-wide authorisation"), checkId);
    assert.ok(cli.includes("pre-exposure selection"), checkId);
    assert.ok(cli.includes("actually returns"), checkId);
    // domains list carries no verification or DNS configuration status (#81).
    assert.ok(!cli.includes("verification fields"), checkId);
    assert.ok(!cli.includes("configuration fields"), checkId);
    assert.ok(cli.includes("nameservers mode"), checkId);
    assert.ok(cli.includes("domains inspect"), checkId);
  }
});

test("certificates and environment stay unsupported", () => {
  assert.ok(route(map, "DOM-02").CLI.startsWith("Unsupported"));
  const sec = route(map, "SEC-01").CLI;
  assert.ok(sec.startsWith("Unsupported"));
  assert.ok(sec.includes("readable values"));
  assert.ok(capabilities.includes("do not run env list/ls"));
  assert.doesNotMatch(capabilities, /^vercel (?:env|certs) /, "no env/cert command patterns");
  assert.doesNotMatch(capabilities, /^vercel (?:env|certs) /m);
});
