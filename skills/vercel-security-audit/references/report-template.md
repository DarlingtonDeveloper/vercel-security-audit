# Security configuration review - [scope alias]

Local draft. Replace bracketed placeholders with verified observations before sharing. This template contains no audit results. Publication or sending requires separate approval of the final content and destination.

## Review summary

Your review identifies confirmed configuration strengths and practical improvements within the scope below. Unknowns are recorded separately so that missing access does not become an unsupported finding.

- Reviewed at: [UTC timestamp or observation window].
- Authorized scope: [owner-confirmed account/team aliases and included project/environment aliases].
- Method: read-only public Vercel plugin/CLI supported reads, with browser verification in your own-team dashboard.
- Overall takeaway: [brief, evidence-grounded statement; no unconditional claim that the account or application is safe].
- Core coverage: [counts for each status across all 24 required core checks].
- Optional coverage: [authorized/not authorized; counts for the four optional checks, kept separate].
- Changes made: none. Recommendations below are proposed actions for your team, not actions performed during this review.

This is a point-in-time configuration review. It is not a penetration test, security certification, compliance assessment, or ongoing monitoring service. A satisfactory setting does not establish application security.

## Initial priorities

List at most three evidence-backed priorities, ordered by owner-relevant impact and confidence. Use fewer when evidence supports fewer. Do not promote unknowns to confirmed vulnerabilities.

1. [Short action or confirmation request; topic ID; benefit; responsible role].
2. [Optional second priority; delete if unnecessary].
3. [Optional third priority; delete if unnecessary].

## Confirmed strengths

- [Topic ID]: [confirmed good setting and its limited benefit]. Evidence: [sanitized reference and UTC observation time].
- [Repeat only for confirmed satisfactory checks; omit unsupported reassurance].

## Scope, missing evidence, and limitations

- Included: [project/environment aliases, sample boundaries, list completeness, observation window].
- Excluded: [teams/projects/environments outside permission, unreviewed time ranges, application/source review unless separately authorized].
- Authorization: [owner authority confirmed; optional source/application scope and consent boundary if applicable].
- Sources used: [verified plugin/CLI capability descriptions and browser views; refer to `capabilities.md`, not guessed commands or UI paths].
- Missing evidence: [topic ID, unavailable field/view, access or plan limit, and exact question remaining].
- Conflicting or stale evidence: [topic ID, conflicting observations/times, and what would resolve the difference].
- Owner statements: [process/ownership claims distinguished from observed configuration].
- Source/application review: [not authorized, not reviewed, or explicitly authorized materials and coverage].
- Observed plan: [plan label, scope alias, source and observation date; unknown if unavailable].
- Verified current per-feature entitlements: [feature, effective scope, account-specific/custom features or add-ons, role visibility, current public documentation and verification date, account facts and date; otherwise verification pending].
- Applicability decisions: [feature/subfeature, verified rationale and evidence; a 403, upgrade prompt or plan label alone does not establish not_applicable; mixed-check unresolved settings remain visible].
- Documentation verification: [verified canonical public sources with dates, or verification pending].

Unavailable fields mean unknown, not disabled. An optional policy being off is not automatically a vulnerability. Plan limitations are not misconfigurations. A metadata change does not prove credential rotation; age does not prove a project is unused. Code or Git organization names do not prove ownership. Platform API authentication does not establish application authentication.

### Optional scope decisions

Record consent per checklist ID and named source/application, not a global yes/no. Reuse established decisions; a full review request does not authorize optional reads. For each record include not_requested/accepted/declined/partial, Owner self-statement provenance and UTC approval time when accepted, named material aliases, approved read boundaries, exclusions, and coverage/status. Declined or unrequested checks remain not_reviewed with no collected optional evidence. Partial review identifies both inspected material and the unreviewed remainder.

- DEP-04 - Application authentication boundaries: [decision; named material/scope aliases; consent provenance/date; read boundaries; exclusions; coverage/status].
- SRC-04 - Repository governance evidence: [decision; named material/scope aliases; consent provenance/date; read boundaries; exclusions; coverage/status].
- SEC-04 - Secret handling and log redaction design: [decision; named material/scope aliases; consent provenance/date; read boundaries; exclusions; coverage/status].
- OPS-04 - Application recovery design: [decision; named material/scope aliases; consent provenance/date; read boundaries; exclusions; coverage/status].

## Coverage limits

This block is mandatory even when there are no known limits, including in a draft with no collection. Record every source/feed used or planned, including unavailable sources. Write unknown for unavailable facts, not zero; if no collection occurred, say so. No feeds recorded means coverage is unknown, not complete. If no known limits remain, explicitly state that conclusion and its verified basis. Follow [pagination and bounded collection](capabilities.md#pagination-and-bounded-collection) and see [report model](report-model.md#coverage-feed-records) for the optional structured representation.

### [Source/feed alias]

- Source/feed: [verified tool/view description, scoped aliases, observation UTC and associated check IDs; planned or used].
- Window: [requested and actually covered start/end UTC; retention boundary or unknown].
- Reported total: [product-reported count and what it measures, or unknown].
- Received: [unique records received; deduplication/overlap limits or unknown].
- Inspected: [records individually inspected, separate from aggregate totals; sample boundaries].
- Page/finding cap: [verified per-page and overall caps, or unknown].
- Truncation: [yes/no/unknown, observed indication and affected scope].
- Cursor availability: [available/unavailable/unknown; supported continuation semantics, without raw cursor values].
- End known: [yes/no/unknown; verified end-of-list evidence, not an assumption from a count or absent cursor].
- Missing sources: [unavailable or uncollected feeds/windows and reason, or none verified].
- Timeouts/failures: [sanitized failure type and outcome, affected window and retained partial coverage; no raw errors; none if verified].
- Retries and outcomes: [attempt time in UTC, approved window, outcome and remaining gaps for each retry; or not attempted and why].
- Assessment effect: [bounded conclusions, needs_confirmation/not_reviewed checks and precise unresolved coverage; no absence claim from partial results].

A count of 100 is not completeness. No cursor without a verified end, truncation, or a bounded retry after a failed wider query remains a coverage gap, not proof that events or resources do not exist. State any verified conclusion that no limits remain and its basis explicitly rather than omitting this block.

## Recommendations

Repeat the following block for each supported recommendation. Keep the initial priorities list limited to three even if this section has more items. Label confirmation tasks as confirmation, not proven weaknesses. The reviewing agent remains read-only; implementation needs separate owner authorization.

### [Recommendation number] - [outcome-focused title]

- Related checks / status: [topic IDs and recorded statuses].
- Evidence and rationale: [observed setting, evidence references, requirement, and remaining uncertainty].
- Benefit: [practical reduction in unwanted exposure or operational uncertainty; avoid unproven exploit claims].
- Who: [responsible role, without personal details].
- Before changing: [confirm intended audience, dependencies, plan availability, approvals, current state, and impact window; if any prerequisite is unknown, resolve it first].
- Where to start: [exact dashboard/repository URL only after verifying it belongs to the authorized scope and contains no credentials or bypass values; otherwise say “Location not yet verified” and give a non-invented capability description].

Numbered action steps: each step contains one action. Replace placeholders with verified instructions; do not guess UI labels or CLI flags. A confirmation-only recommendation stops after the relevant confirmation step.
1. [Confirm one unresolved prerequisite, if applicable].
2. [Record the current non-secret configuration for rollback, if a change is proposed].
3. [Make one separately approved configuration change, if applicable].
4. [Verify one expected result using an approved read-only view].

- Done when: [observable completion criterion and scope; distinguish configured state from tested application behavior].
- Impact / rollback: [possible user/build/automation interruption, dependencies, and verified way to restore prior configuration; if unknown, say so and defer changes].
- Docs: [canonical current public documentation title, verified exact URL, verification date, and claim supported; if not verified, write “Verification pending” and omit the URL].

Verify documentation against current public sources before sharing instructions. Do not invent feature availability, plan entitlements, prices, or guarantees. Omit pricing unless relevant and verified from current official public pricing information. A documentation link supports only the claim it actually addresses.

## Follow-up and completion

- Owner decisions needed: [specific confirmation questions, proposed changes, and responsible roles].
- Deferred checks: [topic IDs and explicit reason for deferral].
- Suggested recheck: [owner-chosen trigger or date, without implying automatic monitoring].
- Completion boundary: [all 24 core statuses recorded, optional scope recorded separately, limitations visible, evidence redacted, and recommendations tied to evidence].

### Owner confirmation questionnaire

Include all three groups for Owners within the agreed scope. Reuse supplied answers without re-asking resolved questions. No automatic DMs, emails, bot requests, notification events or other outreach: any communication requires separate approval of exact final content and destination. Do not inspect another Owner's personal metadata or broaden access to complete an answer.

Keep answers as timestamped Owner self-statements (`source_kind: owner_statement`), not observed configuration. Record related check, scope alias, responding role alias, UTC statement time, metadata observation time if known, and separately observed evidence references. Missing facts and dates remain unavailable/unknown, not inferred from the report date. Unanswered groups remain explicitly not answered; an answer does not promote a check status.

```text
1. CRE-01: Using only your own current metadata in the agreed scope, what is your scoped token count, and what scope and expiry metadata is visible? Give redacted aggregate counts and expiry coverage only, or say unavailable. If expiry is not_applicable, state the verified reason, such as a verified zero-token inventory. Do not supply token values, token strings, sensitive token names or credential screenshots. Metadata dates alone do not prove rotation or actual use.

2. IAM-02: Does your own MFA posture meet the agreed policy, and is recoverability arranged within that policy? Record the agreed requirement or mark it unresolved. Confirm policy compliance, recoverability and unresolved exceptions at a non-secret level only. Do not supply passwords, recovery codes, authentication method secrets, device identifiers or setup details. Your statement does not establish team-wide enrolment or enforcement.

3. OPS-01: Can you confirm incident delivery ownership and escalation responsibility for this scope? Identify responsible roles and non-sensitive subscription/delivery arrangements, not endpoints, webhook URLs, email addresses, names or recipient identifiers. Distinguish configured metadata from an Owner statement about delivery readiness. Actual delivery remains unverified unless separately verified through an approved procedure. This questionnaire does not authorize a delivery test.

For every answer, give the scope alias, role alias, UTC statement time and metadata observation time if known. Say unavailable for facts you cannot confirm; do not request elevated credentials or inspect another Owner's credentials to answer.
```

## Appendix: check outcomes

Repeat this compact record for every required core check, grouped under the eight domains in `checklist.md`. Include optional checks separately, even when not reviewed. Keep the topic IDs and give each check its own third-level heading.

### [ID] - [Check title]

Status: [satisfactory / action_recommended / needs_confirmation / not_reviewed / not_applicable]

- Requirement or intent: [owner requirement or intended exposure; record when unconfirmed].
- Observed evidence: [sanitised setting, UTC time, scope alias, source kind and evidence reference].
- Rationale: [why the status follows, with coverage and inference limits].
- Missing evidence / next confirmation: [question and responsible role, or none].

Status meanings: satisfactory meets the scoped requirement; action_recommended has a supported improvement; needs_confirmation has unresolved evidence; not_reviewed was not inspected; not_applicable has verified facts establishing non-applicability. Always provide a rationale. Missing access is not non-applicability.

## Optional normalized evidence example

JSON is optional; readable Markdown evidence is sufficient. This synthetic example is illustrative, not a required schema. Use the same topic IDs, statuses and evidence fields in both formats. Store only sanitised evidence approved for the intended audience. For the separate canonical schema and optional append/rebuild CLI, read [report model](report-model.md); this compact observation is not a full versioned report or append patch. Portable Markdown remains the mandatory fallback.

```json
{
  "topic_id": "CRE-01",
  "scope_alias": "example-team",
  "observed_at": "2026-10-25T12:00:00Z",
  "source_kind": "browser",
  "source_description": "Owner-visible credential metadata",
  "evidence_ref": "example-evidence-01",
  "observed": { "expiry_visibility": "not_shown" },
  "status": "needs_confirmation",
  "rationale": "An absent expiry field does not establish that expiry is disabled.",
  "limitation": "Confirm supported expiry visibility with the owner."
}
```

## Deliverable format

Markdown is mandatory and remains the source deliverable. Styled HTML uses the bundled community template when Python 3 is available; read [report design](report-design.md) before rendering. PDF is optional, exported from that same HTML through an already-installed browser or renderer. Do not use a renderer that adds official Vercel branding or fetches remote assets. If rendering is unavailable, deliver Markdown without installing tools. Review all rendered pages for redaction and layout. An export is not permission to publish or send.
