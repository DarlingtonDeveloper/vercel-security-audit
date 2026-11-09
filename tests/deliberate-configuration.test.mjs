// Offline contracts for codebase intent checks and owner-accepted settings (issue #41).
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as MODEL from "../skills/vercel-security-audit/scripts/manage-report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = path.join(ROOT, "skills/vercel-security-audit");
const CHECKER = path.join(SKILL, "scripts/check-report.mjs");
const read = (relative) => fs.readFileSync(path.join(SKILL, relative), "utf8");

/** Python text.split(start, 1)[1].split(end, 1)[0]; a missing start raises, as IndexError did. */
function section(text, start, end) {
  const at = text.indexOf(start);
  if (at < 0) throw new Error(`section start not found: ${start}`);
  const rest = text.slice(at + start.length);
  const stop = rest.indexOf(end);
  return stop < 0 ? rest : rest.slice(0, stop);
}

function entry(identifier, sourceKind, observedAt = "2026-10-25T12:00:00Z", observed = "Synthetic setting.") {
  return {
    id: identifier, observed_at: observedAt, source_kind: sourceKind,
    source_description: "Synthetic " + sourceKind + " record", scope_alias: "example-project",
    observed, limitation: "Synthetic fixture; no account or repository was read.",
  };
}

function acceptedReport() {
  let report = MODEL.newReport("example-team", "Synthetic configuration review");
  const patch = {
    expected_revision: 1, checks: [{
      id: "DEP-01", status: "needs_confirmation", statement: "Preview protection is off by design.",
      rationale: "Owner accepted public previews; no change is proposed.",
      evidence_log: [entry("ev-dep-01", "browser"),
        entry("ev-dep-02", "source_review", "2026-10-25T12:05:00Z", "Config file sets the observed state."),
        entry("ev-dep-03", "owner_statement", "2026-10-25T12:10:00Z",
          "Previews are public marketing builds; Team Owner role accepted this.")],
    }],
  };
  report = MODEL.appendEvidence(report, patch);
  report.review_summary.owner_accepted = [{ check_id: "DEP-01", evidence_ref: "ev-dep-03" }];
  MODEL.validateReport(report);
  return report;
}

function runChecker(html) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deliberate-"));
  try {
    const file = path.join(directory, "report.html");
    fs.writeFileSync(file, html, "utf8");
    const result = spawnSync(process.execPath, [CHECKER, file], { encoding: "utf8", timeout: 20000 });
    return { returncode: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe("GuidanceTests", () => {
  let step4;
  let policy;
  before(() => {
    const skill = read("SKILL.md");
    step4 = section(skill, "#### Check the codebase before flagging deliberate configuration", "#### Inline owner round");
    policy = section(read("references/evidence-assessment.md"), "## Deliberate configuration and owner acceptance", "\n## ");
  });

  test("codebase check precedes owner round and drafting", () => {
    const skill = read("SKILL.md");
    const index = (needle) => {
      const at = skill.indexOf(needle);
      assert.ok(at >= 0, needle);
      return at;
    };
    assert.ok(index("#### Check the codebase") < index("#### Inline owner round"));
    assert.ok(index("#### Inline owner round") < index("### 5. Draft"));
  });

  test("read needs confirmed repository and explicit agreement", () => {
    for (const clause of ["owner-controlled and is the source of an in-scope project alias",
      "An open workspace, or a matching repository or organisation name, does not establish this",
      "explicitly agreed to a config-intent read", "No answer, or a noninteractive host without prior agreement, means no read",
      "covers only its own ID and does not count"]) {
      assert.ok(step4.includes(clause), clause);
    }
  });

  test("read is limited to named config files", () => {
    for (const clause of ["current local working tree", "`vercel.json`", "`next.config.*`", "`middleware.*`",
      "Never read `.env*` files", "Git history", "Do not run repository commands",
      "DEP-04, SRC-04, SEC-04 and OPS-04", "Do not quote or record a secret-looking value"]) {
      assert.ok(step4.includes(clause), clause);
    }
  });

  test("config-intent read is a named gate exception", () => {
    const gate = section(read("references/capabilities.md"), "## What counts as field selection before exposure", "\n## ");
    const exception = section(gate, "One named exception", "These do not count");
    for (const clause of ["Config-intent read", "confirm that the listed files contain no inline secrets",
      "Without it, there is no read", "stop the read at once",
      "(browser-evidence.md#accidental-exposure-stop-and-hand-off)", "never covers `.env*` files",
      "chosen over a bundled config parser (issue #80)"]) {
      assert.ok(exception.includes(clause), clause);
    }
    for (const clause of ["contain no inline secrets", "No confirmation means no read",
      "one named exception to the pre-exposure gate",
      "(references/browser-evidence.md#accidental-exposure-stop-and-hand-off) as a secret exposure"]) {
      assert.ok(step4.includes(clause), clause);
    }
  });

  test("intent is not acceptance and no new status", () => {
    for (const clause of ["`source_review` evidence", "Source-code evidence of intent is not owner acceptance",
      "stays needs_confirmation with the reason and date recorded",
      "out of the initial priorities and recommendations", "There is no separate accepted status",
      "codebase intent not checked"]) {
      assert.ok(step4.includes(clause), clause);
    }
    for (const clause of ["does not show that anyone accepted the risk", "silence are not acceptance",
      "The check stays needs_confirmation", "There is no separate accepted status",
      "Remove it from the initial priorities and recommendations",
      "never accepts a risk on the owner's behalf", "A reason without a statement time or role"]) {
      assert.ok(policy.includes(clause), clause);
    }
    const text = read("SKILL.md");
    // Python str.splitlines() also breaks on \r, \v, \f and Unicode separators; these docs use \n.
    const states = text.split(/\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/)
      .filter((line) => line.startsWith("- ") && Object.hasOwn(MODEL.STATUSES, line.split(":")[0].slice(2)));
    assert.equal(states.length, 5);
  });

  test("template moves accepted settings out of action list", () => {
    const template = read("references/report-template.md");
    assert.ok(section(template, "## Initial priorities", "\n## ").includes("Leave out owner-accepted settings"));
    assert.ok(template.includes("Do not write a recommendation for an owner-accepted setting"));
    const note = section(template, "### Deliberate or owner-accepted settings", "### Owner confirmation questionnaire");
    for (const clause of ["stay needs_confirmation", "Owner reason:", "UTC statement time", "Codebase intent:",
      "Source-code evidence of intent alone does not belong here"]) {
      assert.ok(note.includes(clause), clause);
    }
    assert.ok(template.includes("config-intent read"));
    assert.ok(read("references/browser-evidence.md").includes("ask whether it is deliberate"));
  });
});

describe("ModelTests", () => {
  const assertInvalid = (report) => assert.throws(() => MODEL.validateReport(report), MODEL.ModelError);

  test("absent field stays valid and renders empty note", () => {
    const report = MODEL.newReport("example-team", "Synthetic configuration review");
    assert.ok(!("owner_accepted" in report.review_summary));
    assert.equal(report.schema_version, 1);
    const markdown = MODEL.buildMarkdown(report);
    assert.equal(markdown.split("### Deliberate or owner-accepted settings").length - 1, 1);
    assert.ok(markdown.includes("No owner-accepted settings recorded."));
  });

  test("accepted setting renders reason and keeps counts", () => {
    const report = acceptedReport();
    const markdown = MODEL.buildMarkdown(report);
    const note = section(markdown, "### Deliberate or owner-accepted settings", "### Owner confirmation questionnaire");
    for (const clause of ["DEP-01 - Deployment protection scope", "status needs_confirmation", "owner_statement",
      "ev-dep-03", "Statement UTC: 2026-10-25T12:10:00Z", "Previews are public marketing builds"]) {
      assert.ok(note.includes(clause), clause);
    }
    assert.ok(note.includes("Source-code evidence of intent alone is not owner acceptance"));
    const summary = MODEL.buildSummary(report);
    assert.deepEqual(new Set(Object.keys(summary.core)), new Set(Object.keys(MODEL.STATUSES)));
    assert.equal(summary.core.needs_confirmation, 1);
  });

  test("acceptance requires needs_confirmation status", () => {
    for (const status of ["satisfactory", "action_recommended", "not_applicable"]) {
      const report = acceptedReport();
      report.checks.find((c) => c.id === "DEP-01").status = status;
      assertInvalid(report);
    }
  });

  test("acceptance requires owner statement on same check", () => {
    for (const reference of ["ev-dep-02", "ev-dep-01", "missing-ref"]) {
      const report = acceptedReport();
      report.review_summary.owner_accepted[0].evidence_ref = reference;
      assertInvalid(report);
    }
    const report = acceptedReport();
    report.review_summary.owner_accepted[0].check_id = "DEP-02";
    assertInvalid(report);
  });

  test("rejects duplicates, extra fields and recommendations", () => {
    let report = acceptedReport();
    report.review_summary.owner_accepted.push(structuredClone(report.review_summary.owner_accepted[0]));
    assertInvalid(report);
    report = acceptedReport();
    report.review_summary.owner_accepted[0].accepted = true;
    assertInvalid(report);
    report = acceptedReport();
    report.review_summary.owner_accepted = { "DEP-01": "ev-dep-03" };
    assertInvalid(report);
    report = acceptedReport();
    report.recommendations = [{
      title: "Protect previews", check_ids: ["DEP-01"], evidence_and_rationale: "ev-dep-01.",
      benefit: "Synthetic.", responsible_role: "Team Owner", prerequisites: ["Confirm intent."],
      where_to_start: "Location not yet verified.", steps: ["Confirm intent."],
      done_when: "Intent recorded.", impact: "None.", docs: "Verification pending.",
    }];
    assertInvalid(report);
  });

  test("append cannot silently move an accepted check", () => {
    const report = acceptedReport();
    const patch = {
      expected_revision: report.revision, checks: [{
        id: "DEP-01", status: "action_recommended", statement: "Changed.", rationale: "Changed.",
        evidence_log: [entry("ev-dep-04", "browser", "2026-10-25T13:00:00Z")],
      }],
    };
    assert.throws(() => MODEL.appendEvidence(report, patch), MODEL.ModelError);
    patch.checks[0].status = "needs_confirmation";
    const updated = MODEL.appendEvidence(report, patch);
    assert.deepEqual(updated.review_summary.owner_accepted, report.review_summary.owner_accepted);
  });

  test("rendered HTML passes report QA", () => {
    const result = runChecker(MODEL.renderReport(MODEL.buildMarkdown(acceptedReport())));
    assert.equal(result.returncode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).owner_accepted_markers, ["DEP-01"]);
  });
});

describe("MatrixMarkerTests", () => {
  // An owner-accepted check is visibly marked in the matrix while its status stays needs_confirmation (#80).
  // Python ran this checker under `python -I`; Node has no equivalent flag, so it runs normally.
  const check = (markdown) => runChecker(MODEL.renderReport(markdown));

  test("matrix marks only the accepted check", () => {
    const markdown = MODEL.buildMarkdown(acceptedReport());
    const rows = markdown.split("\n").filter((line) => line.startsWith("| ") && line.includes("-0"));
    const marked = rows.filter((line) => line.includes("(owner-accepted)"));
    assert.deepEqual(marked, ["| DEP-01 Deployment protection scope (owner-accepted) | needs_confirmation |"]);
    assert.ok(markdown.includes("(owner-accepted) marks a setting the owner has confirmed as deliberate"));
    const unaccepted = MODEL.buildMarkdown(MODEL.newReport("example-team", "Synthetic configuration review"));
    assert.ok(!unaccepted.includes("(owner-accepted)"));
  });

  test("checker rejects a marker on another status", () => {
    const report = MODEL.newReport("example-team", "Synthetic configuration review");
    const markdown = MODEL.buildMarkdown(report).replace(
      "| IAM-01 Team membership and roles |", "| IAM-01 Team membership and roles (owner-accepted) |");
    const result = check(markdown);
    assert.equal(result.returncode, 1);
    assert.ok(result.stderr.includes("Owner-accepted marker is on a check whose status is not needs_confirmation"), result.stderr);
    assert.ok(result.stderr.includes("check ID IAM-01; matrix not_reviewed; appendix not_reviewed"), result.stderr);
  });

  test("checker rejects a misspelt or misplaced marker", () => {
    const markdown = MODEL.buildMarkdown(acceptedReport());
    for (const replacement of ["| DEP-01 Deployment protection scope (Owner-Accepted) |",
      "| DEP-01 (owner-accepted) Deployment protection scope |",
      "| DEP-01 Deployment protection scope (owner-accepted) (owner-accepted) |"]) {
      const result = check(markdown.split("| DEP-01 Deployment protection scope (owner-accepted) |").join(replacement));
      assert.equal(result.returncode, 1, replacement);
      assert.ok(result.stderr.includes("Owner-accepted marker must be exactly (owner-accepted)"), replacement);
    }
  });

  test("marker is documented for template and checker", () => {
    const template = read("references/report-template.md");
    const design = read("references/report-design.md");
    assert.ok(template.includes("ending its Check cell with exactly `(owner-accepted)`"));
    assert.ok(template.includes("the marker is not a status"));
    assert.ok(design.includes("`owner_accepted_markers`"));
  });
});
