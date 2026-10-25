# Preflight and collection plan

Read this before inventory, product checks or dashboard evidence collection. Authentication checks are preflight, not configuration collection. This is a portable instruction contract, not an implemented browser or OAuth adapter.

## 1. Establish the host and identity

- Discover actual read-tool schemas, CLI help and host browser capabilities. Record whether the host supports an isolated session, human takeover, safe identity-only observation, pre-model field selection, automatic screenshots on navigation/reload, bounded waits and read-only control semantics. Unknown capabilities stay unknown; do not test them by exposing a sensitive page.
- Record connector/CLI authentication and its selected account/team. Record read OAuth scopes or equivalent role/grants from safe metadata where available; a connected OAuth session is not proof of read-only access. Choose only verified read operations. Never collect access or refresh tokens, cookies or credential-bearing URLs.
- Before collection, authenticate the browser using the host's normal user handoff on an identity-only surface whose exposure is safe. Confirm browser account and authorised team against connector/CLI account and team before combining evidence. Record only match/mismatch and scope aliases, not personal account identifiers. If only the browser is used, match it to the user's authorised account/team.
- Do not auto-login, run login commands, change account settings, switch another active session or extract credentials. For MFA, device policy, missing browser authentication or mismatched accounts, pause the affected surface for user takeover. Resume only after the safe identity check agrees. A login page is not proof of an authenticated session.

## 2. Choose the coverage boundary before collection

If browser authentication cannot be completed or privacy gates prevent browser evidence, record limited scope and the affected IDs upfront. Present two choices: continue API-only with those gaps, or pause for user handoff. Obtain explicit user confirmation before API-only collection; silence is not consent. A noninteractive host pauses with these choices rather than collecting anyway. Do not block portable Markdown hosts forever: after confirmation, supported safe API reads can proceed and Markdown remains available without a browser, PDF or file-writing capability.

An account mismatch never authorises combining the sessions. API-only work can proceed only with a separately confirmed authorised connector identity and the same explicit limited-scope confirmation. Owner statements may supplement the agreed scope, not silently replace observed dashboard evidence.

## 3. Plan every check

Read the complete [checklist](checklist.md). Create one record for each of the 24 core IDs and each separately authorised optional ID. Declined optional checks remain explicitly not_reviewed. Assign one primary collection route per record:

- API-readable: a verified plugin/CLI read, with schema/help evidence, required read OAuth scopes or equivalent grants, server-side scope filter, safe output fields and pagination limits.
- dashboard-only: verified browser identity/team, observed navigation destination, required role and a pre-model privacy gate that the host actually supports.
- owner statement: an explicit non-sensitive question, responsible role and statement provenance; observed data remains unknown where absent.
- unavailable: reason, affected setting and whether not_reviewed or needs_confirmation applies. Do not substitute guessed endpoints or UI paths.

Each record includes check ID, authorised team/project/environment aliases, required settings, primary route, fallback route or none, host capability/permission prerequisites, privacy classification, allowed evidence fields, UTC observation time placeholder, completeness criteria and a bounded collection budget. The capability map includes unsupported and unknown capabilities, not only successful ones.

Synthetic record (a plan, not collected evidence):

```text
check_id: IAM-02
scope_alias: example-team
required_settings: enrolment, enforcement, SAML, provisioning where applicable
primary_route: dashboard-only
fallback_route: owner statement
host_capability: safe pre-model selection required; not yet verified
permission: authorised Owner view; read OAuth mapping unknown
privacy: classify actual destination before navigation
allowed_fields: policy state, coverage counts, plan constraint
completion: each applicable setting has scoped state or explicit gap
budget: one planned pass; unresolved settings remain unknown
observed_at_utc: not collected
```

## 4. Execute one planned pass before the first report

Preflight is complete only when scope, identity match or confirmed limited-scope choice, capability map and per-check collection routes are recorded. Then execute one planned pass across all authorised IDs before drafting the first report. Log each attempted route, source, timestamp, outcome and coverage limit. A failed route is a gap, not a successful check. Use only pre-agreed safe fallbacks; ask before expanding scope or collecting another pass. Bounded UI-state retries within a planned check are not a new estate-wide pass.

Reconcile the plan against collected evidence: every ID has a result or an explicit gap, partial settings remain needs_confirmation, uncollected checks stay not_reviewed. The first report states actual coverage, excluded browser checks, owner-statement provenance and limitations. Never imply that planned reads or unavailable browser features worked.
