# Example team security review

> Synthetic, illustrative report for layout preview only. All teams, observations and evidence are fictional; no account was audited.

## Review summary

Several safeguards meet the example team's requirements. The first improvements are two-factor sign-in and protected review deployments. Alert ownership needs confirmation.

- Scope: `example-team`, projects `example-site` and `example-portal`; production and review deployments.
- Example window: 25 October 2026, 12:00 to 12:30 UTC. This is not an actual collection timestamp.
- Method: synthetic fixtures only. No account or application was accessed.
- Changes made: none. The recommendations are proposed actions, not completed work.
- Core checks (24): 12 satisfactory, 2 action recommended, 6 need confirmation, 3 not reviewed, 1 not applicable.
- Optional checks (4, kept separate): 4 not reviewed.

This is a point-in-time configuration review, not a penetration test, security certification, compliance assessment or ongoing monitoring. A satisfactory setting does not establish application security.

## Initial priorities

1. Require two-factor sign-in with a staged rollout, IAM-02. The team Owner coordinates recovery readiness before enforcement.
2. Protect internal review deployments, DEP-01. The project maintainer confirms access needs before changing coverage.
3. Confirm who receives and owns incident alerts, OPS-01. The operations lead resolves missing evidence; the unknown does not prove alerts are absent.

## Confirmed strengths

These are confirmed within the fictional evidence only, not observations about a real team.

- IAM-01: the complete fixture membership list matches the agreed responsibilities; no role changes are proposed. Source: synthetic fixture E01.
- SEC-01: environment targeting matches the example team's separation requirement. This does not establish secret strength or application use. Source: synthetic fixture E16.
- DOM-02: displayed certificate coverage meets the example hostname requirement. This does not establish end-to-end encryption or application security. Source: synthetic fixture E20.

## Scope and evidence limits

All E01 to E24 references are invented, sanitized fixture records for the example window and scope above. They model configuration summaries and separately labelled owner statements; they are not screenshots, tool output, or customer evidence. An omitted field means unknown, not disabled. Optional controls being off are not automatically vulnerabilities.

Source code, provider-side repository settings, log contents, credential values, application requests, and recovery exercises are excluded. No actual owner authorization is asserted. No external messages were sent. Public documentation URLs below are known reference locations, not live-verified sources; current instructions and feature availability must be checked before real implementation.

- Plan and entitlements: no plan label is modelled in the fixtures; feature availability and role requirements are verification pending.
- Applicability: FWB-03 is not applicable because the complete fixture inventory contains no custom rules or exceptions, not because access was missing.
- Owner statements: labelled as such in each appendix record and never treated as observed configuration.

### Optional scope decisions

No optional source or application review was requested in this fictional scenario, so no optional evidence was collected and none of these affects the core outcomes.

- DEP-04 - Application authentication boundaries: not requested; no material named; not reviewed.
- SRC-04 - Repository governance evidence: not requested; no material named; not reviewed.
- SEC-04 - Secret handling and log redaction design: not requested; no material named; not reviewed.
- OPS-04 - Application recovery design: not requested; no material named; not reviewed.

## Coverage limits

### Synthetic fixture set

- Source/feed: fictional fixtures E01 to E24 for `example-team`, used for all 24 core checks; no product feed was read.
- Window: the example window above; no retention boundary applies to fixtures.
- Reported total: not applicable to fixtures; no product-reported counts exist.
- Received: 24 fixture records. Inspected: all 24, individually.
- Page/finding cap: none; fixtures are not paginated. Truncation: no. Cursor availability: not applicable. End known: yes, the fixture set is fixed.
- Missing sources: contributor, logging and activity collection are excluded (SRC-03, SEC-03, OPS-02).
- Timeouts/failures: none. Retries and outcomes: not attempted; nothing failed.
- Assessment effect: the three excluded areas stay not reviewed; nothing is inferred about them.

## Recommendations

### 1 Enable 2FA with rollout

**Related check:** IAM-02, action_recommended. Fictional E02 records incomplete two-factor enrolment and no team enforcement against an agreed requirement for all interactive members. Other identity controls are accounted for in the appendix.

**Benefit:** A second sign-in factor reduces reliance on a password alone; it does not prevent every account compromise.
**Who:** Team Owner, supported by the access administrator and affected members.
**Before changing:** Confirm available enforcement controls, role and plan requirements, recovery readiness, exceptions, automation dependencies, and a separately approved change window. Resolve unknown prerequisites first.
**Where:** Location not yet verified. Have the Owner walk through the team's identity and security settings in their own dashboard; confirm the selected team and observed controls rather than following invented button names.

1. Confirm the approved sign-in requirement with the team Owner.
2. Record the current non-secret policy state for the rollback plan.
3. Confirm recovery readiness for every affected member.
4. Complete two-factor enrolment for the affected members through their own accounts.
5. Apply the separately approved enforcement change after readiness is confirmed.
6. Verify the displayed enforcement state and membership coverage through an approved read-only view.

**Done when:** The observed policy and complete membership coverage meet the agreed requirement, with recovery responsibility recorded. Configuration confirmation is not a tested recovery exercise.
**Impact / rollback:** Unprepared members may lose access. Before changing anything, the Owner must verify an available recovery path and an authorized way to restore the prior policy; do not assume reversal is possible from a locked-out account. Stop if either path is unknown.
**Public docs:** [Two-factor authentication and enforcement](https://vercel.com/docs/two-factor-authentication#enforcing-two-factor-authentication). Known public reference; live verification pending. No current plan entitlement or exact UI is asserted.

### 2 Protect review deployments

**Related check:** DEP-01, action_recommended. Fictional E07 records unprotected review deployments for both projects despite an internal-reviewer-only requirement; public production access remains intentional.

**Benefit:** Restricting review access helps keep unfinished work within its intended audience; it does not replace application sign-in or authorization.
**Who:** Project maintainer, with the team Owner and review coordinator.
**Before changing:** Confirm intended reviewers, available protection methods, plan requirements, automation and callback dependencies, exceptions, approvals, and a change window. Do not copy access-bearing links or bypass values into this report.
**Where:** Location not yet verified. Walk through deployment protection settings for each example project in the team's own dashboard, confirming environment coverage and exceptions from the observed interface.

1. Confirm the intended audience for review deployments on both projects.
2. Record the current non-secret protection scope for rollback planning.
3. Confirm an available protection method that supports the approved review workflow.
4. Apply the separately approved protection change to `example-site` review deployments.
5. Apply the separately approved protection change to `example-portal` review deployments.
6. Verify the displayed coverage and exceptions for both projects in an approved read-only view.

**Done when:** Recorded review-deployment coverage matches the internal audience requirement on both projects and production intent is unchanged. Actual reviewer access and application behavior need a separately approved validation, not a bypass test during this review.
**Impact / rollback:** Reviewers, automated checks, and callbacks may be interrupted. Verify the supported method of restoring prior scope before rollout; pause if it is unknown. Any rollback needs explicit approval and would reintroduce the prior exposure.
**Public docs:** [Deployment Protection](https://vercel.com/docs/deployment-protection). Known public reference; live verification pending. No current plan entitlement or exact UI is asserted.

## Appendix: required core checks

Each heading retains its checklist ID. Status describes only the synthetic scenario. Source references below all use the fictional observation window stated above.

### IAM-01 - Team membership and roles
Status: satisfactory
Observed: Complete role totals match the fictional Owner's responsibility map. Rationale: The scoped access requirement is met, without inferring identity from names.
Source: Synthetic fixture E01, membership summary and labelled Owner statement.

### IAM-02 - Sign-in policy coverage
Status: action_recommended
Observed: Two-factor enrolment is incomplete and enforcement is absent; recovery roles are recorded. Rationale: This conflicts with the stated all-member requirement; rollout readiness remains a prerequisite. SAML and directory provisioning are explicitly outside the fictional team's identity design, not missing observations.
Source: Synthetic fixture E02, policy and coverage summary plus labelled identity-design statement.

### IAM-03 - Invitations and access review
Status: satisfactory
Observed: Complete invitation inventory has no pending entries; an access-review owner and cadence are recorded. Rationale: Current inventory meets the stated requirement; process effectiveness is not tested.
Source: Synthetic fixture E03, invitation summary and labelled process statement.

### CRE-01 - Credential scope and expiry metadata
Status: needs_confirmation
Observed: Purpose and scope are recorded, but expiry visibility is incomplete. Rationale: Ask the access administrator whether expiry can be confirmed; a missing field does not establish no expiry.
Source: Synthetic fixture E04, incomplete credential metadata summary without values.

### CRE-02 - Integration permissions and purpose
Status: satisfactory
Observed: Complete in-scope integration summaries match both projects' approved purposes and scope requirements. Rationale: Visible permissions meet the stated requirement, not a guarantee about provider-side access.
Source: Synthetic fixture E05, integration summaries and labelled purpose statements.

### CRE-03 - Integration lifecycle accountability
Status: satisfactory
Observed: Each listed integration has a responsible role, current need, lifecycle state, and offboarding procedure. Rationale: Accountability meets the requirement; no revocation or rotation was performed.
Source: Synthetic fixture E06, lifecycle summary and labelled accountability statements.

### DEP-01 - Deployment protection scope
Status: action_recommended
Observed: Production is intentionally public; review deployments on both projects lack the required internal access restriction, with no recorded exceptions. Rationale: The specific review-audience mismatch supports recommendation 2, not a claim of compromise.
Source: Synthetic fixture E07, environment coverage summary and labelled audience requirement.

### DEP-02 - Preview collaboration and sharing
Status: needs_confirmation
Observed: A sharing exception is listed, but its audience and continuing purpose are unresolved. Rationale: Ask the review coordinator to confirm intent; shareability alone does not prove unauthorized access.
Source: Synthetic fixture E08, sharing-policy summary without access-bearing links.

### DEP-03 - Deployment inventory and retention intent
Status: satisfactory
Observed: The complete two-project deployment inventory matches the documented retention intent and continuing need. Rationale: The inventory requirement is met; age alone is not a reason to delete anything.
Source: Synthetic fixture E09, inventory age bands and labelled lifecycle statements.

### FWB-01 - Firewall policy intent and scope
Status: satisfactory
Observed: Published action, enabled-state, scope, and order summaries match the stated public-traffic policy on both projects. Rationale: Configuration intent is met; actual blocking effectiveness was not tested.
Source: Synthetic fixture E10, firewall configuration summary and labelled traffic requirement.

### FWB-02 - Bot control posture
Status: needs_confirmation
Observed: An optional bot control is off; legitimate automation needs and feature availability are unresolved. Rationale: Ask the maintainer to confirm those prerequisites; an optional control being off is not itself a vulnerability.
Source: Synthetic fixture E11, partial bot-policy summary.

### FWB-03 - Exceptions and rule review
Status: not_applicable
Observed: The complete scoped inventory contains no custom rules or exceptions; E10 describes managed policy only. Rationale: There are no exception-to-rule relationships to review; this is an explicit empty inventory, not missing access.
Source: Synthetic fixture E12, complete rule and exception inventory summary.

### SRC-01 - Repository connection and authority
Status: satisfactory
Observed: Both project connection types and associations match explicit fictional Owner authority statements. Rationale: Authority is stipulated separately, not inferred from repository labels.
Source: Synthetic fixture E13, connection summary and labelled authority statements.

### SRC-02 - Production deployment governance
Status: needs_confirmation
Observed: Production sources are recorded, but approval responsibilities and applicable restrictions remain incomplete. Rationale: Confirm these with the release lead; a branch label does not prove mandatory peer review.
Source: Synthetic fixture E14, partial deployment-governance summary.

### SRC-03 - Contribution and build trust boundaries
Status: not_reviewed
Observed: Contributor and fork-related authorization metadata was not included in the fixture. Rationale: Collection was excluded from this example; no conclusion about build trust is supported.
Source: Synthetic fixture E15, explicit collection exclusion.

### SEC-01 - Environment variable targeting
Status: satisfactory
Observed: Complete redacted variable aliases, environment targets, branch targets, and visible protection attributes match the stated separation requirement. Rationale: Metadata targeting is satisfactory; values, application use, and client exposure are not assessed.
Source: Synthetic fixture E16, metadata-only environment summary without values.

### SEC-02 - Secret lifecycle responsibility
Status: needs_confirmation
Observed: Change-time metadata is present, but responsibility and rotation evidence are incomplete. Rationale: Ask the maintainer to confirm the process; a metadata update does not prove rotation or provider revocation.
Source: Synthetic fixture E17, partial lifecycle summary.

### SEC-03 - Log access, export, and retention
Status: not_reviewed
Observed: Log access, destination types, and retention metadata were not included. Rationale: This example excludes logging collection; nothing is inferred about log contents or destination security.
Source: Synthetic fixture E18, explicit logging-scope exclusion.

### DOM-01 - Domain association and intended ownership
Status: satisfactory
Observed: Complete domain aliases and project associations show the required verification state, with separate fictional Owner control statements. Rationale: The association requirement is met; registrar ownership and ongoing DNS control are not proven.
Source: Synthetic fixture E19, domain metadata summary and labelled control statements.

### DOM-02 - Certificate and transport status
Status: satisfactory
Observed: Certificate state and coverage for all scoped hostname aliases meet the stated transport requirement; fixture expiry metadata extends beyond the example window. Rationale: This supports displayed certificate status only, without active TLS testing.
Source: Synthetic fixture E20, complete certificate metadata summary.

### DOM-03 - Domain lifecycle and configuration warnings
Status: satisfactory
Observed: Complete warning summaries show no outstanding configuration warnings; alias relationships and a lifecycle owner are documented. Rationale: The stated configuration-review requirement is met, without asserting registrar renewal status.
Source: Synthetic fixture E21, domain warning summary and labelled lifecycle statement.

### OPS-01 - Incident notifications, ownership and escalation
Status: needs_confirmation
Observed: Subscription metadata is visible, but destination ownership and escalation responsibility are incomplete. Rationale: Ask the operations lead who receives and owns alerts; neither missing ownership evidence nor empty history proves absent subscriptions.
Source: Synthetic fixture E22, partial subscription summary; no test notification sent.

### OPS-02 - Change traceability and review
Status: not_reviewed
Observed: Activity categories, retention, and review-process metadata were not collected. Rationale: Historical change review is excluded from this fixture; missing events cannot establish no changes.
Source: Synthetic fixture E23, explicit activity-review exclusion.

### OPS-03 - Recovery and configuration follow-up
Status: satisfactory
Observed: Both projects have a documented recovery role, configuration rollback intent, and review cadence, with lifecycle metadata supporting the intended deployment recovery option. Rationale: The stated planning requirement is met; no recovery exercise or external data restoration was performed.
Source: Synthetic fixture E24, lifecycle summary and labelled recovery-planning statement.

## Appendix: optional checks, excluded from core coverage

These four checks are explicitly not reviewed. Source/application scope was not authorized in this synthetic scenario; none contributes to the 24 core outcomes.

### DEP-04 - Application authentication boundaries
Status: not_reviewed
Observed: No application authentication material was inspected. Rationale: Optional application review is outside scope.
Source: Synthetic optional-scope fixture O01; excluded from core coverage.

### SRC-04 - Repository governance evidence
Status: not_reviewed
Observed: No provider-side repository settings were inspected. Rationale: Optional source governance review is outside scope.
Source: Synthetic optional-scope fixture O02; excluded from core coverage.

### SEC-04 - Secret handling and log redaction design
Status: not_reviewed
Observed: No source or redaction design was inspected. Rationale: Optional source review is outside scope; metadata cannot prove absence of leaks.
Source: Synthetic optional-scope fixture O03; excluded from core coverage.

### OPS-04 - Application recovery design
Status: not_reviewed
Observed: No application recovery documentation was inspected. Rationale: Optional application review is outside scope, independently of the core recovery-scope decision.
Source: Synthetic optional-scope fixture O04; excluded from core coverage.

## Follow-up

Resolve OPS-01 ownership first as a confirmation task. Obtain separate approval before either proposed configuration change. Confirm missing evidence for the other unresolved checks and agree any expanded review scope. Recheck after approved changes at an Owner-chosen time; this report does not establish ongoing monitoring.

### Owner confirmation questionnaire

Hand these three question groups, worded as in the skill's report template, to each in-scope Owner. Nothing was sent; answers would be recorded as Owner statements, separate from observed configuration.

- CRE-01 - Owner token metadata: not answered; statement time and metadata observation time unknown.
- IAM-02 - Owner MFA policy and recovery: not answered; statement time unknown.
- OPS-01 - Owner incident delivery responsibility: not answered; statement time unknown.

Community-maintained, unofficial example. Not an official Vercel audit, endorsement, or certification. Local renderer preview only; nothing has been published or sent.
