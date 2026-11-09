// Accidental exposure has a severe and a proportionate low-severity path (#47).
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

const incident = () =>
  before(after(readFileSync(new URL("browser-evidence.md", REFS), "utf8"), "## Accidental exposure:"), "\n## ");

test("classification defaults to severe", () => {
  const intro = before(incident(), "### Severe exposure");
  for (const clause of ["CLI output or a connector response", "without re-reading the content",
    "personal data", "environment variable values",
    "environment variable names without values", "If in doubt, treat the exposure as severe."]) {
    assert.ok(intro.includes(clause), clause);
  }
});

test("low severity path has containment and resume rule", () => {
  const low = after(incident(), "### Low-severity exposure");
  for (const clause of ["do not repeat it", "keep it out of evidence", "metadata only",
    "Never repeat the exposed values", "needs their approval", "fix it before continuing",
    "explicitly confirms", "Silence is not confirmation", "treat it as severe"]) {
    assert.ok(low.includes(clause), clause);
  }
});

test("cli output points to the procedure", () => {
  const text = readFileSync(new URL("capabilities.md", REFS), "utf8");
  assert.ok(text.includes("(browser-evidence.md#accidental-exposure-stop-and-hand-off)"));
});
