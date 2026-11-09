// Offline contracts for required report components; no model or account is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const SKILL = new URL("skills/vercel-security-audit/", ROOT);
const TEMPLATE = new URL("references/report-template.md", SKILL);
const EXAMPLE = new URL("examples/security-audit.md", ROOT);

function after(text, sep) {
  const index = text.indexOf(sep);
  if (index < 0) throw new Error(`separator not found: ${JSON.stringify(sep)}`);
  return text.slice(index + sep.length);
}
function before(text, sep) {
  const index = text.indexOf(sep);
  return index < 0 ? text : text.slice(0, index);
}
const count = (text, sub) => text.split(sub).length - 1;
const findall = (text, regex) => [...text.matchAll(regex)].map((m) => (m.length === 2 ? m[1] : m.slice(1)));

// Python str.splitlines(): splits on every Unicode line boundary, no trailing empty item.
function splitlines(text) {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
// Python str.strip(chars) for a set of literal characters.
function stripChars(text, chars) {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start])) start += 1;
  while (end > start && chars.includes(text[end - 1])) end -= 1;
  return text.slice(start, end);
}
const isSubset = (a, b) => [...a].every((item) => b.has(item));

function components() {
  const text = readFileSync(TEMPLATE, "utf8");
  return before(after(text, "\n## Required components\n"), "\n## ");
}

test("template layout is one example of the contract", () => {
  const text = readFileSync(TEMPLATE, "utf8");
  const intro = before(text, "\n## ");
  assert.ok(intro.includes("one example that satisfies the [required components](#required-components)"));
  assert.ok(intro.includes("not this exact layout"));
  assert.equal(count(text, "\n## Required components\n"), 1);
});

test("mandatory components are enumerated with fixed rules", () => {
  const block = components();
  const mandatory = before(after(block, "Mandatory components and their fixed rules:"), "Flexible,");
  const names = findall(mandatory, /^\d+\. ([A-Z][^:]+):/gm);
  assert.deepEqual(names, [
    "Title", "Status matrix", "Review summary", "Initial priorities", "Confirmed strengths",
    "Scope and limitations", "Optional scope decisions", "Coverage limits", "Actions",
    "Follow-up", "Owner confirmation questionnaire", "Appendix check outcomes", "Disclaimers"]);
  for (const rule of ["at most three", "numbered single-action steps", "`Done when`",
    "present even when no limits are known", "all three question groups",
    "exactly once", "exactly one `Status:` line", "headings begin `Appendix`",
    "separate core and optional status counts", "`Changes made: none`"]) {
    assert.ok(mandatory.includes(rule), rule);
  }
});

test("flexibility is bounded", () => {
  const block = components();
  const flexible = after(block, "Flexible, provided the fixed rules hold:");
  for (const phrase of ["Order of components 5 to 11", "exactly `Recommendations`", "Grouping matrix rows by domain",
    "collapsing several checks into one matrix cell",
    "`Initial priorities`", "beginning `Appendix` are counted",
    "Not allowed in any layout", "dropping or hiding a mandatory component",
    "merging core and optional counts"]) {
    assert.ok(flexible.includes(phrase), phrase);
  }
});

test("status matrix opens the report with the five existing statuses", () => {
  const text = readFileSync(TEMPLATE, "utf8");
  const headings = findall(text, /^## (.+)$/gm);
  assert.deepEqual(headings.slice(0, 2), ["Status at a glance", "Review summary"]);
  const matrix = before(after(text, "## Status at a glance"), "\n## ");
  for (const phrase of ["| Check | Team | [project alias]", "| Optional check | Team |",
    "`satisfactory`, `action_recommended`, `needs_confirmation`, `not_reviewed` or `not_applicable`",
    "Do not use pass, warning, fail", "Team-wide", "By project",
    "authoritative, counted outcome", "must not show a better result than the appendix supports"]) {
    assert.ok(matrix.includes(phrase), phrase);
  }
  const mandatory = before(components(), "Flexible,");
  assert.ok(mandatory.includes("2. Status matrix: opens the report"));
  assert.ok(mandatory.includes("never pass, warning or fail"));
  assert.ok(mandatory.includes("its badges are not counted as outcomes"));
  const summary = before(after(text, "## Review summary"), "\n## ");
  assert.ok(summary.includes("short and in plain language"));
  assert.ok(summary.includes("technical detail to the appendix"));
});

test("example matrix opens report and agrees with the appendix", () => {
  const text = readFileSync(EXAMPLE, "utf8");
  assert.deepEqual(findall(text, /^## (.+)$/gm).slice(0, 2), ["Status at a glance", "Review summary"]);
  const matrix = before(after(text, "## Status at a glance"), "\n## ");
  const appendix = Object.fromEntries(findall(text, /^### ([A-Z]{3}-\d{2}) - .+\nStatus: ([a-z_]+)$/gm));
  assert.equal(Object.keys(appendix).length, 28);
  const rows = {};
  for (const line of splitlines(matrix)) {
    const cells = stripChars(line, "|").split("|").map((cell) => cell.trim());
    if (/^[A-Z]{3}-\d{2} /.test(cells[0])) {
      rows[cells[0].slice(0, 6)] = cells.slice(1);
    }
  }
  assert.deepEqual(new Set(Object.keys(rows)), new Set(Object.keys(appendix)));
  const statuses = new Set(Object.values(appendix));
  for (const [identifier, cells] of Object.entries(rows)) {
    assert.equal(cells.length, 3, identifier);
    if (cells[0] === "By project") {
      assert.deepEqual(new Set(cells.slice(1)), new Set([appendix[identifier]]), identifier);
    } else {
      assert.deepEqual(cells, [appendix[identifier], "Team-wide", "Team-wide"], identifier);
    }
    assert.ok(isSubset(new Set(cells), new Set([...statuses, "By project", "Team-wide"])), identifier);
  }
});

test("skill step five treats template as contract plus example", () => {
  const text = readFileSync(new URL("SKILL.md", SKILL), "utf8");
  const step = before(after(text, "### 5. Draft the guided report"), "\n### ");
  assert.ok(step.includes("required components are the contract and its layout is one example"));
  assert.ok(step.includes("Open with the status matrix"));
  assert.ok(step.includes("keep technical detail in the appendix"));
});

test("repository example satisfies mandatory components in its own layout", () => {
  const text = readFileSync(EXAMPLE, "utf8");
  assert.ok(text.startsWith("# "));
  for (const marker of ["## Review summary", "Changes made: none", "Core checks (24):",
    "Optional checks (4, kept separate):", "not a penetration test",
    "## Initial priorities", "## Confirmed strengths", "### Optional scope decisions",
    "## Coverage limits", "## Recommendations", "**Done when:**",
    "## Appendix: required core checks", "### Owner confirmation questionnaire",
    "Not a security certification", "nothing has been published or sent"]) {
    assert.ok(text.includes(marker), marker);
  }
  for (const identifier of ["DEP-04", "SRC-04", "SEC-04", "OPS-04"]) {
    assert.ok(text.includes("- " + identifier + " - "), identifier);
  }
  const questionnaire = after(text, "### Owner confirmation questionnaire");
  for (const identifier of ["CRE-01", "IAM-02", "OPS-01"]) {
    assert.ok(questionnaire.includes("- " + identifier + " - "), identifier);
  }
  const priorities = before(after(text, "## Initial priorities"), "\n## ");
  assert.ok([...priorities.matchAll(/^\d+\. /gm)].length <= 3);
});

test("counter test is documented as not yet run", () => {
  const text = readFileSync(new URL("evals/scenarios.md", ROOT), "utf8");
  const scenario = before(after(text, "## 13. Unformatted counter-test for report components"), "\n## ");
  for (const phrase of ["Not yet run", "no report format, template or component list",
    "same evidence", "Neither arm reads the account again",
    "stay mandatory", "are relaxed", "Pass:"]) {
    assert.ok(scenario.includes(phrase), phrase);
  }
});
