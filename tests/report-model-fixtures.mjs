// Shared, side-effect-free fixtures for the report model tests (ported from tests/test_report_model.py).
// Python keyword overrides (**changes) become a trailing plain object:
//   evidence(identifier = "ev-001", observedAt = "2026-10-25T12:00:00Z", changes = {})
//   patchValue(revision = 1, checkId = "CRE-01", changes = {})
import * as MODEL from "../skills/vercel-security-audit/scripts/manage-report.mjs";

export { MODEL };

export const CORE_IDS = Object.freeze(["IAM", "CRE", "DEP", "FWB", "SRC", "SEC", "DOM", "OPS"]
  .flatMap((domain) => [1, 2, 3].map((index) => `${domain}-${String(index).padStart(2, "0")}`)));
export const OPTIONAL_IDS = Object.freeze(["DEP-04", "SRC-04", "SEC-04", "OPS-04"]);

export function report() {
  return MODEL.newReport("example-team", "Synthetic configuration review");
}

export function evidence(identifier = "ev-001", observedAt = "2026-10-25T12:00:00Z", changes = {}) {
  return {
    id: identifier, observed_at: observedAt, source_kind: "browser",
    source_description: "Synthetic owner-visible metadata",
    scope_alias: "example-project", observed: "Expiry is not shown.",
    limitation: "An absent field does not establish disabled expiry.",
    ...changes,
  };
}

export function patchValue(revision = 1, checkId = "CRE-01", changes = {}) {
  const check = {
    id: checkId, status: "needs_confirmation",
    statement: "Expiry visibility is unresolved.",
    rationale: "Metadata is incomplete.", evidence_log: [evidence()],
    ...changes,
  };
  return { expected_revision: revision, checks: [check] };
}

export function recommendation() {
  return {
    title: "Confirm credential metadata", check_ids: ["CRE-01"],
    evidence_and_rationale: "ev-001 leaves expiry visibility unresolved.",
    benefit: "Clarify the applicable requirement.", responsible_role: "Team Owner",
    prerequisites: ["Confirm authorized scope."], where_to_start: "Location not yet verified.",
    steps: ["Confirm supported metadata visibility.", "Record the owner requirement."],
    done_when: "Visibility and intent are documented.",
    impact: "Confirmation only; no configuration changes.", docs: "Verification pending.",
  };
}
