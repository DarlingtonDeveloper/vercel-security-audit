# Security configuration review - [scope alias]

Local draft. Replace bracketed placeholders with verified observations before sharing. This template contains no audit results. Publication or sending requires separate approval of the final content and destination.

This layout is one example that satisfies the [required components](#required-components) defined near the end of this template. Those components are the contract, not this exact layout: keep every mandatory component and its fixed rules, and adapt order, headings, grouping and presentation to the audience where the contract allows.

## Status at a glance

[One plain-language sentence saying what the table covers and when.] Each cell shows one of the five statuses. Team-wide means the check was recorded once for the whole scope; By project means see the project columns.

| Check | Team | [project alias] | [project alias] |
| --- | --- | --- | --- |
| [ID] [short plain-language check name] | [status key or By project] | [status key or Team-wide] | [status key or Team-wide] |

Optional checks, kept separate from the 24 core checks:

| Optional check | Team | [project alias] | [project alias] |
| --- | --- | --- | --- |
| [ID] [short plain-language check name] | [status key or By project] | [status key or Team-wide] | [status key or Team-wide] |

Write one row per check, all 24 core checks in checklist order, and the four optional checks in their own table. Use exactly one status key per cell (`satisfactory`, `action_recommended`, `needs_confirmation`, `not_reviewed` or `not_applicable`), which renders as its labelled badge, or the words Team-wide or By project. Do not use pass, warning, fail, symbols or colour alone, and do not leave cells blank. Add one column per in-scope project alias; split projects across several tables if a table would exceed 16 columns. The appendix status stays the authoritative, counted outcome for each check: the matrix must not show a better result than the appendix supports, and differences between columns are explained in that check's appendix record.

## Review summary

Keep this short and in plain language: a few sentences or bullets a non-technical reader can follow. Leave evidence references, field names and other technical detail to the appendix.

Show summary times in a friendly form in the agent host's local time zone, followed by UTC, for example `26 Oct 2026, 13:44-14:40 local time (CET, Europe/Paris; 12:44-13:40 UTC)`. Read the zone from the host itself (for example its configured zone name, or `date '+%Z %z'`), and name it: an abbreviation such as BST or CET and the zone name such as Europe/London when the host exposes them, otherwise the UTC offset. Do not infer the zone from the team's, customer's or reader's location. Include the date on both ends when the window crosses midnight. If the host zone is unknown, give the UTC window alone and say local time is unavailable. Keep exact UTC timestamps in evidence records, coverage limits, Owner statement times and the appendix.

Your review identifies confirmed configuration strengths and practical improvements within the scope below. Unknowns are recorded separately so that missing access does not become an unsupported finding.

- Reviewed at: [friendly local window naming the zone, then UTC; for example 26 Oct 2026, 13:44-14:40 local time (CET, Europe/Paris; 12:44-13:40 UTC)].
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
- Applicability decisions: [feature/subfeature, verified rationale and evidence; a 403, upgrade prompt or plan label alone does not establish not_applicable, but a structured plan entitlement field from a verified read can when current documentation agrees (see evidence assessment); mixed-check unresolved settings remain visible].
- Documentation verification: [verified canonical public sources with dates, or verification pending].

Unavailable fields mean unknown, not disabled. An optional policy being off is not automatically a vulnerability. Plan limitations are not misconfigurations. A metadata change does not prove credential rotation; age does not prove a project is unused. Code or Git organization names do not prove ownership. Platform API authentication does not establish application authentication.

### Optional scope decisions

Record consent per checklist ID and named source/application, not one global optional-scope yes/no. Reuse explicit decisions already given; do not repeat resolved questions. A full review request alone does not authorise these reads. Keep optional coverage separate from all 24 core outcomes. For each record include not_requested/accepted/declined/partial, Owner self-statement provenance and UTC approval time when accepted, named material aliases, authorised read boundaries and exclusions. Unauthorised checks stay not_reviewed with no collected optional evidence and reason unauthorised, not a core failure; partial coverage must identify both the inspected material and unreviewed remainder.

- DEP-04 - Application authentication boundaries: [decision; named source/application; consent provenance/date; included material; exclusions; coverage/status].
- SRC-04 - Repository governance evidence: [decision; named source/application; consent provenance/date; included material; exclusions; coverage/status].
- SEC-04 - Secret handling and log redaction design: [decision; named source/application; consent provenance/date; included material; exclusions; coverage/status].
- OPS-04 - Application recovery design: [decision; named source/application; consent provenance/date; included material; exclusions; coverage/status].

## Coverage limits

This block is mandatory even when there are no known limits, including in a draft with no collection. Record every source/feed used or planned, including unavailable sources. Write unknown for unavailable facts, not zero; if no collection occurred, say so. No feeds recorded means coverage is unknown, not complete. If no known limits remain, explicitly state that conclusion and its verified basis. Follow [pagination and bounded collection](capabilities.md#pagination-and-bounded-collection) and see [report model](report-model.md#coverage-feed-records) for the optional structured representation.

### [Source/feed alias]

- Source/feed: [verified tool/view description, scoped aliases, observation UTC and associated check IDs; planned or used].
- Window: [requested and actually covered start/end UTC, using the returned period for bucketed feeds such as firewall traffic; bucket size and retention boundary, or unknown].
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

Include all three question groups in the report handed to the user, for each Owner within the agreed scope; do not collect other Owners' personal metadata through one person's account. Reuse already supplied confirmations without re-asking resolved questions. No automatic DMs, emails, bot requests or other outreach: any communication requires separate approval of the exact final content and destination. Do not send test messages or notification events during the review.

Keep replies as Owner self-statements (`source_kind: owner_statement`), separate from directly observed configuration. For each question record the related check, scope alias, responding role alias, answer or unavailable, UTC statement time, UTC metadata observation time if known, and any separately observed evidence reference. Missing dates remain unknown, not inferred from the report date. Unanswered groups remain explicitly not answered; an answer does not promote a check status. Do not collect personal identifiers to prove authorship. State precisely which facts are still unresolved; an attempted review with unavailable or conflicting facts remains needs_confirmation (or not_reviewed if never collected). An Owner statement is not a substitute for missing direct visibility. Apply [evidence assessment](evidence-assessment.md) to conflicts and not_applicable claims; do not broaden access or request elevated credentials to complete the questionnaire.

```text
Owner confirmation questions for [approved scope alias]

1. CRE-01: Using only your own current metadata in the agreed scope, what is your scoped token count, and what scope and expiry metadata is visible? Give redacted aggregate counts and expiry coverage only, or say unavailable. If expiry is not_applicable, state the verified reason (for example, a verified zero-token inventory); missing visibility is not non-applicability. Do not supply token values, token strings, sensitive token names or screenshots revealing credentials. Metadata dates alone do not prove rotation or actual use.

2. IAM-02: Does your own MFA posture meet the agreed policy [record the agreed requirement, or mark it unresolved], and is recoverability arranged within that policy? Confirm policy compliance, recoverability and any unresolved exception at a non-secret level only. Do not provide passwords, recovery codes, authentication method secrets, device identifiers or setup details. Your statement does not establish team-wide enrolment or enforcement.

3. OPS-01: Can you confirm incident delivery ownership and escalation responsibility for this scope? Identify responsible roles and non-sensitive subscription/delivery arrangements, not endpoints, webhook URLs, email addresses or other recipient identifiers. Distinguish configured subscription metadata from an Owner statement about delivery readiness. If actual delivery has not been verified through a separately approved procedure, say that it remains unverified; this questionnaire does not authorise a delivery test.

For every answer, give the scope alias, role alias, UTC statement time and current metadata observation time if known. Say unavailable for facts you cannot confirm. Do not obtain broader access or inspect another Owner's credentials to answer.
```

## Appendix: check outcomes

Repeat this compact record for every required core check, grouped under the eight domains in `checklist.md`. Include optional checks separately, even when not reviewed. Keep the topic IDs and give each check its own third-level heading.

If you group checks under their own domain headings, make each one a second-level heading that begins `Appendix:`, for example `## Appendix: Identity and access` and `## Appendix: optional checks`. The renderer and `check_report.py` count check outcomes only under second-level headings that begin with Appendix; a check under any other heading is not counted and QA fails.

### [ID] - [Check title]

Status: [satisfactory / action_recommended / needs_confirmation / not_reviewed / not_applicable]

- Requirement or intent: [owner requirement or intended exposure; record when unconfirmed].
- Observed evidence: [sanitised setting, UTC time, scope alias, source kind and evidence reference].
- Rationale: [why the status follows, with coverage and inference limits].
- Missing evidence / next confirmation: [question and responsible role, or none].

Status meanings: satisfactory meets the scoped requirement; action_recommended has a supported improvement; needs_confirmation has unresolved evidence; not_reviewed was not inspected; not_applicable has verified facts establishing non-applicability. Always provide a rationale. Missing access is not non-applicability.

## Required components

Every report must contain the mandatory components below. The layout above is one example that satisfies them; the repository's synthetic `examples/security-audit.md`, which is not installed with the skill, is another. A capable drafter may choose a different order, headings, grouping, prose or list style, and level of detail for the requested audience, provided each mandatory component stays present, findable and faithful to the evidence. Where a weaker or less certain drafter is in use, follow the example layout above closely.

Mandatory components and their fixed rules:

1. Title: the first line is one `# ` heading naming the reviewed scope alias. The renderer requires this.
2. Status matrix: opens the report, directly after the title and any draft notice, before the review summary. It is a pipe table with one row per check (24 core checks, then the four optional checks in a separate table), a Team column and one column per in-scope project alias. Each cell holds exactly one of the five status keys, or Team-wide or By project. It uses the five statuses, never pass, warning or fail. It summarises the appendix and must not show a better result than the appendix supports; its badges are not counted as outcomes.
3. Review summary: short and plain-language, with technical detail left to the appendix. It gives the review time or window in friendly local time with UTC alongside (exact UTC stays in the evidence and appendix), the authorised scope, the method, an evidence-grounded overall takeaway with no unconditional safety claim, separate core and optional status counts, `Changes made: none`, and the point-in-time statement that this is not a penetration test, certification, compliance assessment or monitoring. Place it before the recommendations.
4. Initial priorities: at most three evidence-backed priorities, each with its topic ID and responsible role, placed before the recommendations. Use fewer when the evidence supports fewer; never promote an unknown to a confirmed weakness.
5. Confirmed strengths: only checks recorded as satisfactory, each with its limited benefit and evidence reference, or an explicit statement that none are confirmed. It may be merged into the summary.
6. Scope and limitations: included and excluded scope, authorisation, sources used, missing, conflicting or stale evidence, labelled Owner statements, observed plan and entitlements, applicability decisions and documentation verification, with the inference cautions from the example layout.
7. Optional scope decisions: one record for each of DEP-04, SRC-04, SEC-04 and OPS-04, kept separate from core outcomes.
8. Coverage limits: the per-source/feed block, present even when no limits are known or no collection occurred.
9. Actions: each recommendation gives its related checks and statuses, evidence and rationale, benefit, responsible role, prerequisites before changing, where to start, numbered single-action steps, a completion check (`Done when`), impact and rollback, and verified documentation or `Verification pending`. Confirmation tasks are labelled as confirmation. Field labels may be list items or bold labels.
10. Follow-up: Owner decisions needed, deferred checks and a suggested recheck, without implying monitoring or completed remediation.
11. Owner confirmation questionnaire: all three question groups (CRE-01, IAM-02, OPS-01) with provided answers or explicit not-answered states.
12. Appendix check outcomes: every one of the 24 core and four optional IDs exactly once, each as a third-level `ID - Title` heading with exactly one `Status:` line using the five statuses, inside second-level sections whose headings begin `Appendix`. This structure is fixed because the [report checker](report-design.md#count-comparison-contract) counts it. Keep technical evidence detail here rather than in the summary.
13. Disclaimers: community-maintained and unofficial identity, not a certification or guarantee, no changes made, and nothing published or sent. The HTML shell adds its own header and footer; the Markdown must still carry these statements.

Flexible, provided the fixed rules hold:

- Order of components 5 to 11, and whether related components share a section.
- Section headings, except that the renderer gives meaning to three: a section headed exactly `Recommendations` makes each third-level heading an action card, a heading containing `Initial priorities` gets priority styling, and headings beginning `Appendix` are counted. Renaming those changes rendering or QA.
- Wording, tone, sentence length and technical depth, in the requested language and level. Use plain language outside the appendix.
- Prose or list presentation, provided recommendation steps stay a flat numbered list.
- Grouping matrix rows by domain, with a domain label in the Check cell or one table per domain, provided each check keeps its own row and status.

Not allowed in any layout: dropping or hiding a mandatory component, more than three initial priorities, statuses other than the five defined states, merging core and optional counts, presenting unknowns, Owner statements or planned reads as observed results, or collapsing several checks into one matrix cell.

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

## Private alias legend (optional)

Synthetic aliases stay mandatory in the report itself. When the report is for the account owner alone, they may ask for a private legend that maps aliases back to resources so they can act on findings. Offer it only on request or when the audience is just the owner, and record their choice.

- Keep the legend in a separate file in the same private output location, for example `alias-legend.txt`. Never embed it in the Markdown, JSON model, HTML or PDF, and never pass it to the renderer or QA script.
- Map only team, project, environment and domain aliases to resource names already returned by authorised inventory reads. Never include people (member names, emails, handles, role holders), credentials, URLs with tokens, environment values or anything collected outside the agreed scope.
- Start the file with: "Private alias legend. Do not share, attach or publish. Shared copies of the report must not include this file."
- Tell the user where it is and that any shared or forwarded version of the report must leave it out. Write it only to a new file; never overwrite an existing one.

## Deliverable format

Markdown is mandatory and remains the source deliverable. Styled HTML uses the bundled community template when Python 3 is available; read [report design](report-design.md) before rendering. PDF is optional, exported from that same HTML through an already-installed browser or renderer. Do not use a renderer that adds official Vercel branding or fetches remote assets. If rendering is unavailable, deliver Markdown without installing tools. Review all rendered pages for redaction and layout. An export is not permission to publish or send.
