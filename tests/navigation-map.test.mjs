// Navigation map lists the OPS/SEC destinations without guessed routes (#52).
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

const map = () =>
  before(after(readFileSync(new URL("capabilities.md", REFS), "utf8"), "## Browser navigation map"), "\n## ");

test("drains alerts and notifications are listed with checks", () => {
  const text = map();
  for (const [entry, checks] of [["Drains", ["SEC-03", "OPS-02"]], ["Alerts", ["OPS-01"]],
    ["Notifications", ["OPS-01"]]]) {
    const line = new RegExp(`^- ${entry} \\(([^)]*)\\): (.+)$`, "m").exec(text);
    assert.notEqual(line, null, entry);
    for (const check of checks) {
      assert.ok(line[1].includes(check), `${entry} ${check}`);
    }
    assert.ok(line[2].includes("use observed team Settings navigation"), entry);
    assert.ok(!line[2].includes("/~/"), "routes are not verified; do not guess them");
  }
});

test("entries keep selection limits", () => {
  const text = map();
  assert.ok(text.includes("select destination type, enabled state and scope only"));
  assert.ok(text.includes("never recipient addresses or webhook URLs"));
  assert.ok(text.includes("do not treat one person's preferences as team coverage"));
});
