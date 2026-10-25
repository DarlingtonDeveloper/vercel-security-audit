# Public security configuration checklist

Review configuration visible through the user's own authenticated Vercel account and explicitly authorised teams. Use the least-privilege role available; ask an appropriate team administrator to confirm restricted controls through their own session. This is a point-in-time, read-only review, not a penetration test, certification, or ongoing monitoring service.

## Scope and evidence rules

- Required core: assess all 24 core checks across the eight domains below. Record a status and rationale for every check, including unavailable checks; required does not mean every optional control must be enabled.
- Optional deeper review: four additional checks require explicit authorization for named, owner-controlled source/application material. Record them separately; declining them does not fail the core review.
- Use public Vercel plugin/CLI capabilities for supported reads. Use the browser in the owner's own-team dashboard to verify gaps. Resolve actual tools and supported reads through sibling [capabilities.md](capabilities.md). This reference supplies no command flags or assumed UI paths.
- If that mapping is missing or a read is unsupported, use only a verified read-only dashboard view; otherwise record the gap. Do not guess commands, API endpoints, or UI labels.
- Confirm owner authority and selected account/team before collecting evidence. Stop at an ownership, permission, or scope boundary; never switch to employee tooling, impersonation, another tenant, or elevated credentials.
- No internal services, customer case records, scans, exploit tests, authentication bypass attempts, traffic generation, or configuration changes. Browser navigation is limited to normal authorized reads.
- Capture the observation time in UTC, scope alias, source kind, verified view/tool description, observed setting, visibility limits, and rationale. Distinguish owner statements from directly observed evidence.
- Keep evidence minimal and redacted. Do not reveal/copy secret values, credential-bearing URLs, environment values, log bodies, personal details, or source code into public artifacts. Public examples use synthetic aliases only.
- Record a missing field as unknown, not disabled. Partial lists, permission limits, stale views, conflicting sources, and unavailable plan features must remain explicit. Before interpreting any browser state, read [browser evidence safety and UI-state playbook](browser-evidence.md#ui-state-playbook): verify control semantics and scope without toggling, bound loading attempts, and follow observed navigation. Candidate labels are not claims about current UI names. Apply the same rules to every check; per-ID cautions there cover IAM-02, SEC-01, OPS-01/02/03, CRE-01, DOM-02, FWB-01/02 and Attack Mode context.
- Evaluate settings against a documented owner requirement, intended exposure, and verified feature availability. An optional policy being off is not itself a vulnerability; a plan lacking a feature is not a misconfiguration.
- Verify current canonical public documentation before making feature, behaviour, pricing or plan claims. If unavailable, mark the claim unverified and omit invented details.
- A check can contain several applicable settings. Record each separately and keep the overall result needs_confirmation until every applicable setting has enough evidence; one passing subcheck cannot hide another unreviewed setting.

## Status vocabulary

Use exactly one status per check, plus a concise evidence-based rationale and evidence reference(s).
- `satisfactory`: observed evidence meets the stated requirement within the inspected scope; not a claim that the application is secure.
- `action_recommended`: evidence supports a specific improvement against an agreed requirement or documented risk; explain the benefit and tradeoff without claiming exploitability.
- `needs_confirmation`: attempted review has missing, ambiguous, conflicting, or owner-dependent evidence; state the precise unanswered question.
- `not_reviewed`: not inspected; state why, including declined optional scope, unavailable capability, or time boundary.
- `not_applicable`: verified facts establish that the check does not apply; name those facts. Unavailable access alone is not this status.

## Required core: identity and access

### IAM-01 - Team membership and roles
- Primary read source: plugin/CLI supported membership metadata; browser verifies role visibility and gaps.
- Evidence needed: redacted role counts, list completeness, and owner-confirmed access responsibilities.
- Cannot infer: a role is excessive from its title alone; names do not prove identity or current employment.
### IAM-02 - Sign-in policy coverage
- Primary read source: browser owner-visible authentication policy metadata; plugin/CLI only where mapped.
- Evidence needed: separate state and coverage for MFA enrolment and enforcement, SAML configuration and enforcement, and directory provisioning/group mapping where applicable. Record recovery arrangements, exceptions and plan constraints without conflating these controls.
- Cannot infer: hidden per-member authentication state, enforcement from an account preference, or vulnerability from an optional policy being off.
### IAM-03 - Invitations and access review
- Primary read source: browser membership/invitation metadata; plugin/CLI supported reads supplement it.
- Evidence needed: pending invitation counts/age bands, review responsibility, and owner-confirmed review process.
- Cannot infer: an old invitation was accepted, a dormant account is compromised, or process effectiveness from a stated policy alone.

## Required core: credential and integration metadata

### CRE-01 - Credential scope and expiry metadata
- Primary read source: browser owner-visible credential metadata; plugin/CLI only for mapped non-secret reads.
- Evidence needed: visible scope, expiry availability, purpose alias, and owner-confirmed need; never reveal a credential.
- Cannot infer: rotation from a metadata change timestamp, actual use from creation age, or expiry from an absent field.
### CRE-02 - Integration permissions and purpose
- Primary read source: plugin/CLI supported integration metadata; browser verifies visible permission summaries.
- Evidence needed: integration type, scope summary, affected project aliases, and owner-confirmed purpose.
- Cannot infer: compromise from broad permissions alone, provider-side permissions from a summary, or ownership from a display name.
### CRE-03 - Integration lifecycle accountability
- Primary read source: browser installation/status metadata; plugin/CLI supported reads supplement it.
- Evidence needed: redacted lifecycle state, responsible role, and owner confirmation of continuing need and offboarding process.
- Cannot infer: unused integration from an old installation date or successful revocation/rotation from edited metadata.

## Required core: deployment and preview exposure

### DEP-01 - Deployment protection scope
- Primary read source: plugin/CLI supported protection metadata; browser verifies environment coverage and exceptions.
- Evidence needed: visible protection state for production/preview scope, intended audience, and exceptions without bypass values.
- Cannot infer: application authentication from platform API authentication, or identical coverage across every deployment URL.
### DEP-02 - Preview collaboration and sharing
- Primary read source: browser sharing/access metadata; plugin/CLI where mapped.
- Evidence needed: available sharing policy, exception existence, intended audience, and owner rationale; exclude access-bearing links.
- Cannot infer: unauthorized access merely because previews are shareable, or no bypass routes because one view lists none.
### DEP-03 - Deployment inventory and retention intent
- Primary read source: plugin/CLI supported project/deployment metadata; browser verifies inventory gaps.
- Evidence needed: scope completeness, lifecycle policy, age bands, and owner-confirmed continued need.
- Cannot infer: an old project is unused, an old deployment is exposed, or deletion is safe from age alone.

## Required core: firewall and bot controls

### FWB-01 - Firewall policy intent and scope
- Primary read source: browser visible firewall configuration; plugin/CLI supported metadata reads supplement it.
- Evidence needed: rule action summaries, enabled state, relevant scope/order if visible, and owner-stated traffic needs.
- Cannot infer: actual blocking efficacy, application authorization, or a vulnerability from no custom rules.
### FWB-02 - Bot control posture
- Primary read source: browser bot policy metadata; plugin/CLI only where mapped.
- Evidence needed: visible mode, coverage, exceptions, legitimate automation needs, and feature availability.
- Cannot infer: malicious activity from bot classification, or misconfiguration from unavailable plan features or optional controls being off.
### FWB-03 - Exceptions and rule review
- Primary read source: browser firewall exception metadata; plugin/CLI supported reads supplement it.
- Evidence needed: sanitized exception scope, intended owner, review intent, and visible rule relationship.
- Cannot infer: traffic passed a rule without evidence, an exception is abusive, or recorded activity proves all routes are covered.

## Required core: source control governance

### SRC-01 - Repository connection and authority
- Primary read source: plugin/CLI supported connection metadata; browser verifies linked repository scope.
- Evidence needed: anonymized connection type, project association, and owner confirmation of repository control.
- Cannot infer: ownership from code, a Git organization name, or a matching account/repository label.
### SRC-02 - Production deployment governance
- Primary read source: browser deployment-source and visible governance settings; plugin/CLI mapped reads supplement it.
- Evidence needed: configured production source, visible restrictions, and owner-stated approval responsibility.
- Cannot infer: branch protection or mandatory peer review from a production branch label or successful deployment history.
### SRC-03 - Contribution and build trust boundaries
- Primary read source: browser visible contribution/build authorization metadata; plugin/CLI where mapped.
- Evidence needed: observable contributor restrictions, fork-related policy if exposed, and intended trusted contributor scope.
- Cannot infer: provider-side governance from Vercel metadata, or safe execution of every build without source review.

## Required core: secrets and logs metadata

### SEC-01 - Environment variable targeting
- Primary read source: plugin/CLI metadata-only reads if supported; otherwise browser metadata without revealing values.
- Evidence needed: redacted variable aliases/counts, environment/branch targeting, and visible protection attributes.
- Cannot infer: value correctness, application use, absence of client-side exposure, or secret strength from metadata.
### SEC-02 - Secret lifecycle responsibility
- Primary read source: browser environment metadata; plugin/CLI supported metadata reads supplement it.
- Evidence needed: visible change-time metadata, responsible role, and owner-stated rotation/revocation process.
- Cannot infer: actual rotation from metadata changes, revocation at an external provider, or a leak from age alone.
### SEC-03 - Log access, export, and retention
- Primary read source: browser logging/export configuration metadata; plugin/CLI supported reads supplement it.
- Evidence needed: visible access scope, sanitized destination type, retention visibility, and owner-stated requirements; exclude log contents.
- Cannot infer: absence of secrets/personal data in logs, external destination security, or longer retention than the view confirms.

## Required core: domains and TLS

### DOM-01 - Domain association and intended ownership
- Primary read source: plugin/CLI supported domain metadata; browser verifies association/status gaps.
- Evidence needed: redacted domain aliases, project association, visible verification state, and owner-confirmed control.
- Cannot infer: registrar ownership or ongoing DNS control solely from an association or matching organization name.
### DOM-02 - Certificate and transport status
- Primary read source: plugin/CLI supported certificate metadata; browser verifies displayed TLS status.
- Evidence needed: visible certificate state, covered domain scope, expiry if shown, and documented transport requirements.
- Cannot infer: end-to-end encryption, every hostname's TLS behavior, or application security from a valid certificate; no active TLS scans.
### DOM-03 - Domain lifecycle and configuration warnings
- Primary read source: browser domain warnings/configuration metadata; plugin/CLI supported reads supplement it.
- Evidence needed: visible warning summaries, intended aliases/redirect relationships, and responsible role for domain lifecycle.
- Cannot infer: takeover exploitability from a warning, unused domains from age, or registrar renewal state from Vercel status alone.

## Required core: operational readiness

### OPS-01 - Incident notifications, ownership and escalation
- Primary read source: browser notification subscription and team metadata; plugin/CLI supported reads supplement it.
- Evidence needed: configured alert subscriptions, redacted destination type, responsible role and escalation process. An empty alert history does not establish absent subscriptions. Verify delivery only through a separately approved procedure; do not send test messages as part of collection.
- Cannot infer: response effectiveness or round-the-clock coverage from a named role or stated plan.
### OPS-02 - Change traceability and review
- Primary read source: browser available activity/audit metadata; plugin/CLI mapped reads supplement it.
- Evidence needed: visible event categories, observation window, access/retention limits, and owner-stated review process.
- Cannot infer: complete historical coverage from a partial feed, no changes from missing events, or wrongdoing from an event alone.
### OPS-03 - Recovery and configuration follow-up
- Primary read source: plugin/CLI supported deployment lifecycle metadata; browser verifies recovery-related visibility.
- Evidence needed: owner-confirmed recovery responsibility, documented rollback intent, and review cadence; no recovery exercise during this review.
- Cannot infer: tested recovery, external data restoration, or ongoing monitoring from rollback availability or this report.

## Optional deeper authorized source/application review

Inspect only explicitly authorized owner-controlled material, read-only. No repository commands, application requests, scans, test execution, or exploit reproduction are implied. Unavailable material remains a recorded gap.
### DEP-04 - Application authentication boundaries
- Primary read source: browser authorized source viewer; plugin/CLI contributes only supported deployment context reads.
- Evidence needed: redacted description of reviewed authentication/authorization configuration, files/routes covered, and exclusions.
- Cannot infer: application authentication from API credentials, runtime enforcement from configuration alone, or coverage of unreviewed routes.
### SRC-04 - Repository governance evidence
- Primary read source: browser explicitly authorized owner-controlled repository settings; plugin/CLI contributes supported Vercel connection context.
- Evidence needed: visible review/branch restrictions, scope, exceptions, and owner-confirmed repository authority.
- Cannot infer: organization ownership from its name, all repositories' governance from one repository, or bypass resistance without testing.
### SEC-04 - Secret handling and log redaction design
- Primary read source: browser authorized source/configuration viewer; plugin/CLI supplies metadata-only deployment context.
- Evidence needed: sanitized description of reviewed client/server boundaries and redaction configuration, with review coverage.
- Cannot infer: absence of leaks, log content, deployed behavior, or complete source coverage; do not search for or copy secret values.
### OPS-04 - Application recovery design
- Primary read source: browser authorized owner-provided recovery/configuration documentation; plugin/CLI supplies supported lifecycle metadata.
- Evidence needed: documented application/data recovery dependencies, responsible roles, and claimed test dates labeled as owner statements.
- Cannot infer: successful recovery, backup integrity, or compliance from documents; no restore or failover tests.
