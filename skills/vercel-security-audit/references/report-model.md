# Optional versioned report model

Keep pre-sanitised evidence in a local JSON revision and rebuild the guided Markdown report with `scripts/manage_report.py`. Python 3 and its standard library are sufficient. JSON is optional: readable Markdown remains the mandatory deliverable and portable fallback when this script or file writing is unavailable. Follow the [report template](report-template.md) in either workflow.

This is a community-maintained, unofficial reporting utility, not an evidence collector, secret scanner, semantic truth checker, or assurance of application security. It does not authenticate, request credentials, read account configuration, fetch URLs, execute commands from evidence, apply recommendations, or send reports. You must approve and sanitise metadata before it reaches the utility. Validation cannot establish that free text contains no secrets or personal information.

## Commands and fresh output paths

Resolve `skill_dir` from the installed skill location. Use an existing, trusted private directory (directory mode 0700 where supported) and new output filenames. The following aliases and observations are synthetic. No account access is needed.

Initialize an unreviewed draft:

```sh
python3 "$skill_dir/scripts/manage_report.py" init --scope-alias example-team --title "Synthetic configuration review" -o report-v1.json
python3 "$skill_dir/scripts/manage_report.py" validate report-v1.json
```

`init` creates schema version 1, revision 1, all 28 exact checklist IDs with status `not_reviewed`, empty evidence logs, no recommendations, and no authorization for optional source/application review. Replace the draft's scope and owner-authored narrative fields with verified, pre-sanitised content before sharing. Initial creation is not evidence or consent. `validate` checks structure without writing files or changing statuses.

Save the following as a new private `patch.json`. The example appends metadata to one core check, without claiming expiry is disabled:

```json
{
  "expected_revision": 1,
  "checks": [
    {
      "id": "CRE-01",
      "status": "needs_confirmation",
      "statement": "Expiry visibility is unresolved.",
      "rationale": "The inspected metadata does not show expiry; this does not establish that expiry is disabled.",
      "missing_evidence": "Ask the Team Owner to confirm supported visibility and the intended policy.",
      "evidence_log": [
        {
          "id": "ev-001",
          "observed_at": "2026-10-25T12:00:00Z",
          "source_kind": "browser",
          "source_description": "Synthetic owner-visible credential metadata",
          "scope_alias": "example-project",
          "observed": "Expiry field is not shown.",
          "limitation": "Only the selected metadata view was inspected. No credential values were collected."
        }
      ]
    }
  ]
}
```

Append and rebuild, using fresh paths for each command:

```sh
python3 "$skill_dir/scripts/manage_report.py" append report-v1.json --patch patch.json -o report-v2.json
python3 "$skill_dir/scripts/manage_report.py" build report-v2.json -o security-audit-v2.md
python3 "$skill_dir/scripts/manage_report.py" build report-v2.json --format html -o security-audit-v2.html
python3 "$skill_dir/scripts/manage_report.py" export-summary report-v2.json -o coverage-v2.json
```

Each successful file-producing command prints `New private report artifact created. Review before sharing; Markdown remains required.` Validation prints `Report model is valid. Evidence truth and sanitisation still require human review.` Exit status is 0 on success, 1 on validation or I/O failure, and 2 on invalid command arguments. Diagnostics do not include source values, unknown keys, evidence, or paths. Use the schema reference below to resolve a structural failure; do not paste raw evidence into logs for debugging.

`build` defaults to Markdown. HTML uses the existing `render_report` function, bundled assets, escaping, link filtering, and community branding unchanged. No arbitrary template or asset URL option is accepted. Only the HTML branch uses `--lang` (default `en`); shell and status labels remain English. Always retain and review the Markdown even when exporting HTML. Follow [report design](report-design.md) for optional PDF export and visual inspection; no browser is launched by this utility.

## Schema version 1

All objects have exactly the fields listed below, unless a field is explicitly marked optional. Unknown fields, missing fields, duplicate JSON object keys, non-finite numbers, wrong types, and unsupported versions fail validation. There is no permissive migration or silent field removal.

Unless stated otherwise, text fields are nonempty single-line UTF-8 strings, at most 8,000 characters, with no control characters or Unicode line/paragraph separators. Use separate list entries for steps and prerequisites. Text is preserved without trimming or normalizing. It may contain the renderer's bounded inline Markdown, but is never interpreted as an HTML template or executable code. Alias and evidence identifiers match the complete pattern `[A-Za-z][A-Za-z0-9_-]{0,63}`. They must be non-sensitive aliases, not credential values or identifying account paths.

The full top-level object requires:

- `schema_version`: integer exactly 1. Booleans are not integers in this schema.
- `revision`: integer at least 1, not a boolean. An append increments it exactly once, regardless of how many checks the patch supplies.
- `scope_alias`: alias identifier for the owner-authorized scope.
- `title`: nonempty single-line report title, at most 240 characters.
- `scope`: the scope object below.
- `review_summary`: the owner-authored narrative object below. It is distinct from derived coverage counts.
- `recommendations`: a list of zero to 100 guided recommendation objects.
- `follow_up`: the follow-up object below.
- `checks`: exactly 28 check objects, containing every one of the 24 core and four optional IDs exactly once. Input order is unrestricted; Markdown uses checklist order.

### Scope and owner-authored narrative

`scope` requires these text fields:

- `included`: project/environment aliases, sampling boundaries, and observation window.
- `excluded`: material outside permission or coverage.
- `authorization`: owner authority and explicit scope boundaries, or confirmation pending.
- `sources_used`: verified capability/view descriptions; no guessed commands or sensitive paths.
- `limitations`: collection gaps, list completeness, and unresolved scope-wide contradictions.
- `source_application_review`: explicit authorized material and coverage, or not authorized/not reviewed.
- `documentation_verification`: verified sources and dates, or verification pending.

`scope` also requires `optional_authorized`, a boolean defaulting to false in `init`. True represents separately obtained owner intent for named source/application material, documented in the scope fields. Setting it does not collect evidence or authorize new access by itself. When false, all four optional checks must remain `not_reviewed` with empty evidence logs. When true, they still remain unreviewed until the reviewer explicitly supplies an outcome and evidence. Optional scope is never inferred from core evidence, code names, or a repository connection.

`review_summary` requires:

- `reviewed_at`, `method`, `overall_takeaway`: text. State the actual review window or that review has not occurred.
- `confirmed_strengths`: a list of zero to 100 text entries. Include only evidence-backed strengths; the utility does not infer them from statuses.
- `initial_priorities`: a list of zero to three text entries, ordered by owner-relevant impact and confidence.

`follow_up` requires three text fields: `owner_decisions`, `deferred_checks`, and `suggested_recheck`. They describe proposed next actions, not actions completed by the utility.

These narrative fields, the scope, title, and recommendations are owner-authored fields. An evidence append preserves them exactly as JSON values. Reassess them against the new evidence before sharing; preserved prose may be stale even when derived counts are current. Editing narrative fields is a separate deliberate local drafting operation, not an implicit append side effect.

### Exact check IDs and statuses

The core IDs are exactly:

- Identity: `IAM-01`, `IAM-02`, `IAM-03`.
- Credential/integration metadata: `CRE-01`, `CRE-02`, `CRE-03`.
- Deployment exposure: `DEP-01`, `DEP-02`, `DEP-03`.
- Firewall/bot controls: `FWB-01`, `FWB-02`, `FWB-03`.
- Source control: `SRC-01`, `SRC-02`, `SRC-03`.
- Secrets/logs metadata: `SEC-01`, `SEC-02`, `SEC-03`.
- Domains/TLS: `DOM-01`, `DOM-02`, `DOM-03`.
- Operational readiness: `OPS-01`, `OPS-02`, `OPS-03`.

The optional IDs are exactly `DEP-04`, `SRC-04`, `SEC-04`, and `OPS-04`. Valid-looking prefixes do not admit other numbers, lowercase spellings, extra suffixes, or new domains. See the [checklist](checklist.md) for each requirement and inference boundary.

Each check requires:

- `id`: one of the exact IDs above, appearing once in the report.
- `status`: exactly one of the five states below.
- `statement`: current interpreted outcome, distinct from observed evidence.
- `requirement`: owner requirement or intent, including when unconfirmed.
- `rationale`: why this status follows, including uncertainty and coverage limits.
- `missing_evidence`: next confirmation and responsible role, or an explicit statement that none is outstanding.
- `evidence_log`: chronological list of evidence objects, possibly empty for `not_reviewed`. Every other status requires at least one evidence entry.

The five exact statuses are:

- `satisfactory`: explicit sufficiently complete evidence meets the scoped requirement, without assuring application security.
- `action_recommended`: evidence supports an improvement against an agreed requirement.
- `needs_confirmation`: evidence is ambiguous, contradictory, incomplete, stale, or dependent on owner intent.
- `not_reviewed`: collection was not performed or was unavailable; explain why.
- `not_applicable`: verified facts establish non-applicability; missing access alone is insufficient.

No evidence entry automatically sets or promotes a check status. Every patch must state its intended status and rationale explicitly, even when they remain unchanged. Contradictory observations stay in the log and should remain `needs_confirmation` until a human resolves them. Structural validation cannot determine whether observations conflict or whether a reviewer's status judgment is justified.

### Metadata-only evidence log

Every evidence entry requires exactly:

- `id`: stable identifier, globally unique across all checks and their history. Existing IDs cannot be reused for corrections, even on another check.
- `observed_at`: real UTC calendar time in `YYYY-MM-DDTHH:MM:SSZ` form, optionally with one to six fractional-second digits before `Z`. Offsets, naive local times, and invalid dates fail.
- `source_kind`: exactly `plugin`, `cli`, `browser`, `owner_statement`, `source_review`, or `documentation`.
- `source_description`: verified view/capability description, not raw command output, source code, log bodies, personal rows, or credentials.
- `scope_alias`: alias identifier for the observation's actual project/team/environment scope. It may differ from the report alias.
- `observed`: concise pre-sanitised metadata text, not an arbitrary nested object or secret-bearing artifact.
- `limitation`: explicit visibility, completeness, or inference limits; write an explicit scoped statement even when no additional limit was identified.

Times must be nondecreasing within each check's evidence log. Equal instants are allowed with distinct IDs; different checks can have different observation windows. New evidence older than that check's last entry is rejected, not silently sorted or backdated. Resolve retrospective observations separately rather than editing history. Owner statements remain labelled as statements and do not become direct observations.

### Guided recommendation objects

Every recommendation requires all of these fields:

- `title`: outcome-focused title.
- `check_ids`: one to 28 unique exact checklist IDs. Related current statuses are derived when building Markdown.
- `evidence_and_rationale`: evidence IDs, scoped observation, and remaining uncertainty.
- `benefit`: practical effect without unproven exploit claims.
- `responsible_role`: role such as Team Owner or developer, without personal details.
- `prerequisites`: one to 100 text entries covering approvals, intended audience, dependencies, verified feature availability, and unresolved questions. Use an explicit confirmation task when necessary.
- `where_to_start`: verified non-secret location or `Location not yet verified.`
- `steps`: one to 100 text entries, each with one action. Markdown numbers them in order. Recommendations do not execute these steps.
- `done_when`: observable completion criterion and scope.
- `impact`: interruption risks, dependencies, and rollback considerations; defer changes when unknown.
- `docs`: verified canonical public documentation, verification date, and supported claim, or `Verification pending.` Omit an unverified URL. URLs are not fetched or independently verified by this utility.

## Atomic append contract

The patch top level has exactly `expected_revision` (integer at least 1) and `checks` (one to 28 unique check patches). Each check patch requires `id`, `status`, `statement`, `rationale`, and a nonempty `evidence_log` of new entries. Only `requirement` and `missing_evidence` are optional patch fields. No other fields or report-level narrative edits are accepted.

The complete patch is validated before publishing anything. An unknown/duplicate check ID, reused evidence ID, malformed later check, stale revision, missing explicit status, or out-of-order observation rejects the whole patch. Success changes only supplied checks and the report revision. Existing log entries remain an unchanged prefix; a changed statement or correction adds evidence with a new ID instead of overwriting the old observation. Untouched checks, old timestamps, aliases, source descriptions, rationale text, and limitations are retained without rewriting their values. The new file uses deterministic JSON indentation; input bytes remain untouched, rather than promising identical JSON whitespace between revisions.

`expected_revision` must match the input snapshot. The input file is never mutated, replaced, or locked. Concurrent writers targeting the same fresh output path have one winner, with the other failing without altering that file. Two writers targeting different fresh paths may both produce revision 2 from revision 1: this is branching, not global serialization or a shared latest-revision registry. Choose which branch to continue deliberately. Revision numbers do not provide a content hash, tamper evidence, authentication of timestamps, or protection against manual edits to old files.

All generated files are staged privately, fully written and synced before an atomic, exclusive hard-link publication to the final fresh path. Output mode is 0600, including under restrictive umasks. Existing files, directories, hard links, and symlinks (including dangling links) are refused. A failed validation, render, write, sync, or exclusive publication leaves no new final artifact. Each invocation produces only one file, so a later HTML failure cannot roll back an earlier successful Markdown or JSON command. A missing output directory or filesystem without same-directory hard-link support fails closed. No overwrite flag is available.

Use trusted local private directories. This is not a defence against another actor controlling those directories. Abrupt termination or power loss can leave a private staging file or a complete published file; crash recovery, multi-file transactions, directory durability guarantees, and distributed locking are not implemented.

## Derived coverage interchange

`build_summary(report)` returns exactly a count object with `core` and `optional` keys, each containing all five status counts, including zeros. Core counts sum to 24 and optional counts sum to four. `export-summary` writes that object to a fresh private file. For the example above, its content is:

```json
{
  "core": {
    "satisfactory": 0,
    "action_recommended": 0,
    "needs_confirmation": 1,
    "not_reviewed": 23,
    "not_applicable": 0
  },
  "optional": {
    "satisfactory": 0,
    "action_recommended": 0,
    "needs_confirmation": 0,
    "not_reviewed": 4,
    "not_applicable": 0
  }
}
```

This is the value expected by issue #10's `check_report` summary contract: `summary = {core: {five status counts}, optional: {five status counts}}`. A consumer that expects a top-level `summary` field must place this exported object under that field. The canonical schema does not store or accept a second editable copy of the counts; `review_summary` holds authored prose, not counts. Issue #10's files and checker are not dependencies of this utility.

## Limits and verification

Input JSON and patch reads are bounded to 2,000,000 bytes before parsing. Normalized JSON and generated Markdown must also fit that bound. Excessive nesting, invalid UTF-8, duplicate keys, and non-finite numbers fail without echoing source content. HTML embeds the existing local fonts and can be larger than the JSON or Markdown limit. Rendering escapes raw HTML, omits images, and filters active links using the existing renderer; this does not remove sensitive text from the artifact. Review all outputs for redaction, current narrative, coverage, and layout before sharing. Public examples must stay synthetic.

Focused local tests, from the repository root:

```sh
python3 -B -m unittest discover -s tests -p test_report_model.py -v
```

The deterministic tests cover normal and adversarial schema/CLI behavior, append-only history, conflicts, exclusive concurrent publication, permissions, failure cleanup, and reuse of the renderer. They do not authenticate, perform a live audit, validate business intent, run a browser, or prove absence of secrets. The [report template](report-template.md) remains usable without JSON or Python.
