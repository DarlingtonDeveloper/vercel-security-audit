// Offline contracts for the inline owner round (issue #40); no owner is contacted.
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
const section = (text, start, end) => before(after(text, start), end);

const skill = read("SKILL.md");
const step4 = section(skill, "### 4. Assess findings", "### 5. Draft the guided report");
const round = section(read("references/browser-evidence.md"),
  "### Inline owner round before the first report", "## Accidental exposure");

test("round sits in step four before drafting", () => {
  assert.ok(step4.includes("#### Inline owner round before the first report"));
  assert.ok(step4.includes("before drafting the first report"));
  assert.ok(step4.includes("browser-evidence.md#inline-owner-round-before-the-first-report"));
});

test("round reconciles with single collection pass", () => {
  for (const text of [step4, round]) {
    assert.ok(text.includes("not a second collection pass"));
  }
  assert.ok(step4.includes("collection still finishes before the first report"));
  assert.ok(after(skill, "### 5.").includes("Finish one planned collection pass"));
});

test("round is batched scoped and skippable", () => {
  for (const clause of ["one batched round", "still needs_confirmation", "owner statement could resolve",
    "Owner confirmation question groups", '"skip" or "don\'t know"', "Do not run follow-up rounds"]) {
    assert.ok(step4.includes(clause), clause);
  }
  for (const clause of ["one batched message", "grouped by domain",
    "needs_confirmation checks whose missing fact an owner statement could resolve",
    "safe per-check questions", "Owner confirmation question groups",
    '"skip" or "don\'t know"', "Do not ask follow-up rounds"]) {
    assert.ok(round.includes(clause), clause);
  }
});

test("unavailable not reviewed checks are included but unauthorised are not", () => {
  for (const text of [step4, round]) {
    for (const clause of ["not_reviewed checks whose collection was unavailable",
      "no acceptable pre-exposure selection mechanism",
      text === step4 ? "unauthorised (including declined or unauthorised optional checks)"
        : "unauthorised, including declined or unauthorised optional checks",
      "out of scope", "never use the round to expand scope"]) {
      assert.ok(text.toLowerCase().includes(clause.toLowerCase()), clause);
    }
  }
  assert.ok(round.includes("when a safe per-check question exists for that check in the list above"));
  assert.ok(round.includes("no per-check questions for the optional checks"));
  const policy = section(read("references/evidence-assessment.md"),
    "## Owner statements from the inline round", "\n## ");
  for (const clause of ["still only an owner statement", "keep the observed setting unknown",
    "Keep the collection gap and its reason recorded", "leaves the check not_reviewed",
    "unauthorised or out of scope are never asked"]) {
    assert.ok(policy.includes(clause), clause);
  }
});

test("answers are labelled statements without broader access", () => {
  for (const clause of ["timestamped owner statement", "separately from observed evidence",
    "never becomes observed configuration", "never authorises broader access"]) {
    assert.ok(step4.includes(clause), clause);
  }
  for (const clause of ["UTC statement time", "role alias", "never become observed configuration",
    "never authorise broader access", "neither changes the status"]) {
    assert.ok(round.includes(clause), clause);
  }
});

test("secrets are never requested and only present user is asked", () => {
  assert.ok(step4.includes("Never request secrets, credentials"));
  assert.ok(step4.includes("never contact other Owners"));
  for (const clause of ["never secrets, credentials, recovery codes", "Ask only the person already in the conversation",
    "Do not contact other Owners", "do not repeat, quote or record it",
    "accidental exposure procedure"]) {
    assert.ok(round.includes(clause), clause);
  }
});

test("noninteractive hosts skip and keep handoff questionnaire", () => {
  for (const text of [step4, round]) {
    assert.ok(text.includes("Noninteractive hosts"));
    assert.ok(text.includes("skip"));
  }
  const step6 = after(skill, "### 6. Human review and handoff");
  for (const clause of ["Reuse answers from the step 4 inline owner round", "without re-asking",
    "questionnaire carries every unresolved question", "do not contact Owners"]) {
    assert.ok(step6.includes(clause), clause);
  }
});

test("assessment policy keeps statements from promoting status", () => {
  const text = section(read("references/evidence-assessment.md"),
    "## Owner statements from the inline round", "\n## ");
  for (const clause of ["never observed configuration", "the answer itself does not promote a check status",
    "cannot establish list completeness, enforcement", "leaves the status unchanged",
    "never authorises broader access"]) {
    assert.ok(text.includes(clause), clause);
  }
});

test("report records round and reuses answers", () => {
  const template = read("references/report-template.md");
  assert.ok(template.includes("inline owner round run with UTC time, or skipped with reason"));
  assert.ok(template.includes("including inline owner round answers, without re-asking"));
  const model = read("references/report-model.md");
  assert.ok(model.includes("inline owner round"));
  assert.ok(model.includes("needs no new field or schema version"));
});
