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

`build` defaults to Markdown. The built report opens with the status matrix required by the [report template](report-template.md#required-components): one row per check, core then optional, with a single status column for the report's scope alias. Schema version 1 stores one status per check for the whole scope, so it cannot produce per-project columns; add those by hand to the reviewed Markdown only from separately recorded per-project outcomes. Authored text never starts a line, so it cannot add matrix rows. The summary also gains a derived `Evidence recorded` line: the span from the first to the last logged evidence observation, in a friendly form in the host's local time zone with UTC alongside, for example `26 Oct 2026, 13:44-14:40 local time (CET, Europe/Paris; 12:44-13:40 UTC)`. The zone comes from the `TZ` environment variable or the host's `/etc/localtime` link and the standard-library time zone database; nothing is fetched. Set `TZ` to choose a different zone. If no zone database is available the host's C-library local time and UTC offset are used, and if a time cannot be converted only UTC is shown. Times are shown to the minute; exact UTC timestamps stay in the appendix evidence log. The authored `reviewed_at` text is printed unchanged, so write it in the same friendly form. HTML uses the existing `render_report` function, bundled assets, escaping, link filtering, and community branding unchanged. No arbitrary template or asset URL option is accepted. Only the HTML branch uses `--lang` (default `en`); shell and status labels remain English. Always retain and review the Markdown even when exporting HTML. Follow [report design](report-design.md) for optional PDF export and visual inspection; no browser is launched by this utility.

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
- `coverage_limits`: append-only list of zero to 1,000 feed records, described below. An empty list means no collection recorded and coverage unknown, never complete.
- `owner_confirmations`: append-only list of zero to 1,000 Owner self-statement records, described below. An empty list means all three questionnaire groups are not answered.

### Scope and owner-authored narrative

`scope` requires these text fields:

- `included`: project/environment aliases, sampling boundaries, and observation window.
- `excluded`: material outside permission or coverage.
- `authorization`: owner authority and explicit scope boundaries, or confirmation pending.
- `sources_used`: verified capability/view descriptions; no guessed commands or sensitive paths.
- `limitations`: collection gaps, list completeness, and unresolved scope-wide contradictions.
- `source_application_review`: explicit authorized material and coverage, or not authorized/not reviewed.
- `documentation_verification`: verified sources and dates, or verification pending.

`scope` also requires `optional_consent`, a four-entry per-ID ledger, described below. `init` sets all decisions to `not_requested`. Optional scope is never inferred from a global boolean, core evidence, an Owner questionnaire answer, code names, or a repository connection.

This unpublished schema version 1 has been corrected in place. Legacy files containing `optional_authorized`, whether false or true, or missing either governance list fail closed. There is no automatic migration from a global true value to consent. Retain the old file unchanged, create a fresh draft, and deliberately transfer only approved, pre-sanitised metadata. Establish per-ID provenance and named material boundaries before importing optional evidence; preserve unapproved historical files privately rather than treating them as authorized evidence in a new model. Populate the two new lists explicitly, even when empty. Missing coverage or questionnaire facts remain unknown.

`review_summary` requires:

- `reviewed_at`, `method`, `overall_takeaway`: text. State the actual review window or that review has not occurred.
- `confirmed_strengths`: a list of zero to 100 text entries. Include only evidence-backed strengths; the utility does not infer them from statuses.
- `initial_priorities`: a list of zero to three text entries, ordered by owner-relevant impact and confidence.
- `owner_accepted` (optional): a list of zero to 28 objects, each with exactly `check_id` and `evidence_ref`, for settings the owner has confirmed as deliberate with a reason. `check_id` is an exact checklist ID, unique in the list, whose check status is `needs_confirmation`. `evidence_ref` names an `owner_statement` evidence entry on that same check, which holds the reason, statement time and scope. An accepted check cannot appear in any recommendation's `check_ids`. Omitting the field is the same as an empty list, so existing version 1 files stay valid. Source-code (`source_review`) evidence alone cannot be referenced as acceptance.

`follow_up` requires three text fields: `owner_decisions`, `deferred_checks`, and `suggested_recheck`. They describe proposed next actions, not actions completed by the utility.

The builder always prints a `Deliberate or owner-accepted settings` subsection under Follow-up, listing each `owner_accepted` record with its check status and the referenced owner statement, or `No owner-accepted settings recorded.` It adds no status: the five statuses and derived counts are unchanged. Because `owner_accepted` is an owner-authored narrative field, an append cannot edit it. An append that moves an accepted check away from `needs_confirmation`, or that would otherwise break these rules, is rejected until the narrative is deliberately updated in a new draft.

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

No evidence entry automatically sets or promotes a check status. Every check patch must state its intended status and rationale explicitly, even when they remain unchanged. Metadata-only appends leave every check status untouched. Contradictory observations stay in the log and should remain `needs_confirmation` until a human resolves them. Structural validation cannot determine whether observations conflict or whether a reviewer's status judgment is justified.

### Metadata-only evidence log

Every evidence entry requires:

- `id`: stable identifier, globally unique across all checks and their history. Existing IDs cannot be reused for corrections, even on another check.
- `observed_at`: real UTC calendar time in `YYYY-MM-DDTHH:MM:SSZ` form, optionally with one to six fractional-second digits before `Z`. Offsets, naive local times, and invalid dates fail.
- `source_kind`: exactly `plugin`, `cli`, `browser`, `owner_statement`, `source_review`, or `documentation`.
- `source_description`: verified view/capability description, not raw command output, source code, log bodies, personal rows, or credentials.
- `scope_alias`: alias identifier for the observation's actual project/team/environment scope. It may differ from the report alias.
- `observed`: concise pre-sanitised metadata text, not an arbitrary nested object or secret-bearing artifact.
- `limitation`: explicit visibility, completeness, or inference limits; write an explicit scoped statement even when no additional limit was identified.

Only `material_alias` and `read_boundary` are optional extra evidence fields, each an alias identifier when supplied. Both are mandatory for optional-check evidence and must exactly match a named material, scope alias, and approved read boundary in that check's consent record. Evidence observation time must be on or after approval. No prefix, wildcard, or same-name material in another scope expands consent.

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

## Governance records and mandatory report sections

The builder always includes `Coverage limits`, `Optional scope decisions`, and the `Owner confirmation questionnaire`, even in a new draft. Records survive JSON serialization, append, Markdown rebuild, and the existing HTML renderer. Governance metadata does not infer or promote check statuses. All free text remains pre-sanitised metadata, not proof of collection or consent; validation is structural and is not a secret scanner.

### Per-ID optional consent ledger

`scope.optional_consent` contains exactly one record for each of `DEP-04`, `SRC-04`, `SEC-04`, and `OPS-04`. Each record requires exactly:

- `check_id`: one of those four exact IDs, unique in the ledger.
- `decision`: `not_requested`, `accepted`, `declined`, or `partial`.
- `materials`: zero to 100 objects, each with exactly `alias`, `scope_alias`, and `read_boundaries`. The first two are identifiers; `read_boundaries` is a nonempty unique identifier list. Each boundary names a specific approved metadata read, not arbitrary source bodies. Material/scope pairs are unique. These identifiers are exact-match boundaries, not path or URL patterns.
- `exclusions`: unique identifiers for excluded materials; an excluded alias cannot also be approved. An empty list does not grant more scope. Describe any unreviewed remainder in the check's `missing_evidence` and scope limitations.
- `source_kind`: exactly `owner_statement`, identifying consent provenance rather than directly observed configuration.
- `owner_alias`: responding role alias, or null when not requested. Never a personal name or identifier.
- `provenance`: nonempty metadata-only description of the Owner's explicit decision, or null when not requested. No raw messages or credentials.
- `statement_at`: UTC statement timestamp, or null when not requested.
- `approved_at`: UTC approval timestamp for accepted/partial decisions, at or after the statement timestamp; null for not requested or declined.

Not-requested records have no materials or Owner provenance. Declined records require provenance and statement time but have no approved materials. Both decisions require their check to remain `not_reviewed` with an empty evidence history. Accepted and partial records require at least one named material, role alias, provenance, statement time, and approval time. They do not authorize other IDs, scopes, materials, or read boundaries. Every optional evidence entry and collected optional feed must match that check's named material/scope/boundary and must not precede approval. Partial review requires at least one excluded material alias and retains unresolved coverage explicitly.

Reuse established consent; do not contact an Owner or broaden access to complete the ledger. Consent is established deliberately in a draft, not edited by `append_evidence`. Removing an approval never silently erases previously collected history; preserve the old revision and resolve incompatible history separately before validating another draft.

### Coverage feed records

`coverage_limits` is an ordered list of immutable feed snapshots. Record every source used or planned, including unavailable sources. Each record requires exactly:

- `id`: globally unique record identifier; `feed_id`: stable identifier for the source/feed across snapshots.
- `usage`: `planned` or `used`; `check_ids`: nonempty unique list of exact checklist IDs.
- `source_kind`: one of the evidence source kinds; `source_description`: nonempty verified metadata view/tool description.
- `scope_alias`: actual observed scope identifier; `material_alias` and `read_boundary`: identifiers or null. Both must match consent for a collected optional feed; planning a not-collected feed never grants access.
- `observed_at`: UTC time of the feed record. Snapshots are chronological for each feed/scope.
- `window`: exactly `requested_start`, `requested_end`, `covered_start`, `covered_end`, and `retention_boundary`, each UTC or null. Each start/end pair is either both unknown or ordered known times. A known covered window must fall within a known requested window. Null means unknown, not the report date.
- `reported_total`, `received`, `inspected`, `page_cap`, `overall_cap`: each a nonnegative integer or null; booleans are invalid counts. Null means unknown, not zero. When both counts are known, inspected cannot exceed received. Product totals may measure different things from individually received/inspected records.
- `count_basis`: nonempty description of what the counts measure, including deduplication, overlap, and sampling limits.
- `next_available`, `exhausted`, `truncated`: each true, false, or null (unknown). No raw cursors are accepted. These are reported facts, never inferred from a page count or missing cursor.
- `outcome`: `not_collected`, `complete`, `partial`, `failed`, or `timed_out`.
- `failure_kind`: `none`, `permission`, `unavailable`, `timeout`, `limit`, `other`, or `unknown`. No raw exception strings or error objects are accepted.
- `missing_sources`: metadata-only description of unavailable feeds/windows and the reason, or an explicit verified statement that none remain.
- `assessment_effect`: bounded conclusions, unresolved checks and remaining coverage; no absence claim from partial results.
- `retries`: zero to 100 immutable attempt objects, each requiring exactly `id`, `attempted_at`, `window`, `outcome`, `failure_kind`, and `remaining_gaps`. The window and state vocabularies are the same as above. UTC attempt times are chronological and no later than the containing feed record. `remaining_gaps` is bounded pre-sanitised text. Use a new feed record and new attempt IDs to record later retries without rewriting an earlier snapshot.

A planned feed has outcome `not_collected`. Uncollected feeds have unknown received/inspected counts, covered window, cursor, exhaustion, and truncation, and cannot contain retry attempts. Collected optional retries must also occur on or after the matching per-ID approval. A complete collection requires received count, verified exhausted true, next available false, and truncated false. Completion does not imply every received item was individually inspected. `failed` requires a failure kind other than none; `timed_out` requires timeout. Complete/not-collected outcomes require failure kind none. These checks reject contradictory structure; they cannot independently prove a product's end-of-list claim. A zero result is not automatically completeness.

The report prints every supplied feed, window, count/cap, tri-state, outcome, failure kind, retry and remaining gap. With no records it prints that no collection was recorded and coverage is unknown. It never omits the block or turns absent records into a complete review.

### Owner confirmation records

`owner_confirmations` preserves provided answers in an append-only list. The static questionnaire always includes the three groups in the [report template](report-template.md): `CRE-01` own token count/scope/expiry metadata only; `IAM-02` own MFA policy and recoverability without secrets; and `OPS-01` delivery ownership and responsible roles without endpoints or personal recipients. Groups without supplied records display `not answered` and unknown times. Existing answers are reused, not overwritten or re-requested.

Each answer requires exactly:

- `id`: globally unique identifier; `check_id`: exactly `CRE-01`, `IAM-02`, or `OPS-01`.
- `scope_alias` and `owner_alias`: approved scope and responding role aliases, not personal identifiers.
- `source_kind`: exactly `owner_statement`. An answer is not directly observed configuration and never changes access or status.
- `statement_at`: UTC self-statement time. Missing time is not inferred; retain an undated response outside this validated record until confirmed, leaving the questionnaire unanswered.
- `metadata_observed_at`: UTC if known, otherwise null. It cannot postdate the statement.
- `evidence_refs`: unique IDs of separately observed evidence already in the report for the same check and scope. Owner statements cannot reference another statement as a direct observation. An empty list means no separate evidence supplied.
- `answer`: nonempty single-line pre-sanitised text, at most 8,000 characters. Use unavailable for facts the Owner cannot confirm; do not supply credential values, recovery codes, authentication method secrets, webhook URLs, email addresses, or names.

Records are chronological per question/scope/role. Keep multiple Owners' supplied scoped answers distinct without accessing another Owner's personal metadata. No DMs, emails, bot requests, test notification events or other outreach occurs. Any communication still requires separate approval of exact final content and destination. An answer does not replace missing direct visibility or broaden optional consent.

Answers from the SKILL.md step 4 inline owner round use these records for the three questionnaire groups. Answers to other safe per-check questions are appended as evidence entries on that check with `source_kind` `owner_statement`. Skipped questions get no record and stay not answered; this needs no new field or schema version.

## Atomic append contract

The patch top level requires `expected_revision` (integer at least 1). Its only optional keys are `checks`, `coverage_limits`, and `owner_confirmations`, each a list. At least one list must contain a new mutation; omitted or empty lists make no change. Metadata-only patches are supported. A combined patch increments the revision exactly once, not once per record type. New record IDs must be globally unique across evidence, feed snapshots, retry attempts, and Owner answers; existing records are retained as unchanged prefixes. Duplicates, replacement attempts, and out-of-scope records reject the whole patch.

`checks` contains up to 28 unique check patches. Each requires `id`, `status`, `statement`, `rationale`, and a nonempty `evidence_log` of new entries. Only `requirement` and `missing_evidence` are optional check patch fields. Narrative, recommendations, consent edits, and all other keys remain disallowed.

The complete patch is validated before publishing anything. An unknown/duplicate check ID, reused evidence ID, malformed later check, stale revision, missing explicit status, or out-of-order observation rejects the whole patch. Success changes only supplied checks, appends supplied governance records, and increments the report revision once. Existing log entries remain an unchanged prefix; a changed statement or correction adds evidence with a new ID instead of overwriting the old observation. Untouched checks, old timestamps, aliases, source descriptions, rationale text, and limitations are retained without rewriting their values. The new file uses deterministic JSON indentation; input bytes remain untouched, rather than promising identical JSON whitespace between revisions.

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
python3 -B -m unittest discover -s tests -p test_report_governance.py -v
```

For cross-checkout structural integration, set `REPORT_QA_SCRIPT` to an existing public checkout's `scripts/check_report.py` when running the governance tests. The test imports it read-only, supplies derived core/optional counts, and validates the JSON-to-Markdown-to-HTML result. It does not copy or modify that tool; without the explicit path, only that integration test is skipped.

The deterministic tests cover normal and adversarial schema/CLI behavior, append-only history, governance roundtrips, per-ID consent boundaries, provided Owner answers, conflicts, exclusive concurrent publication, permissions, failure cleanup, and reuse of the renderer. They do not authenticate, perform a live audit, validate business intent, run a browser, or prove absence of secrets. The [report template](report-template.md) remains usable without JSON or Python.
