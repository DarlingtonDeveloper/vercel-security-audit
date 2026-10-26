# Evidence assessment

Read this policy before assigning statuses. Apply it to every checklist check and subcheck; it does not expand collection authority.

## Resolve claims, not source rankings

No source is universally authoritative. A product check, CLI response, dashboard control and Owner statement can answer different questions. Evaluate each claim by its meaning, selected identity, scope, observation time, visibility and completeness, rather than always preferring one surface.

Preserve both observations when sources disagree: source descriptions, observation and documentation verification dates, scope aliases, exact public product names/check labels, redacted counts or states, and visibility limits. Keep identifiers redacted with stable synthetic aliases; do not retain personal names, real project names, credential values or raw output. A later observation does not silently erase an earlier one. If scopes or dates differ, explain that difference rather than declaring a contradiction resolved.

An unresolved conflict stays needs_confirmation. State the precise missing fact and the responsible role who can confirm it within existing authority. Only reconciled, sufficiently complete evidence can support satisfactory; do not average counts or use a majority vote. If collection never occurred, use not_reviewed with the reason.

## Personal access tokens

A PAT security-dashboard aggregate pass cannot override an Owner's personal token count or expiry metadata. The aggregate may cover a different identity, team, token class, rule or observation window; it is not a complete personal token inventory for each Owner. Keep the product result and the Owner statement separately, with both dates and scopes. For CRE-01, unresolved personal count/expiry coverage remains needs_confirmation. Ask each Owner to confirm only their own scoped, current non-secret metadata; never collect token values or assume one Owner can see all others' tokens.

## Project inventory

A reported project count that exceeds the listed project IDs means the inspected inventory is incomplete, not that the unlisted projects are safe or unused. Record reported, received and individually inspected counts separately, with list scope and dates. Resolve pagination or visibility only through supported authorised reads; invent no missing project names. Keep completeness-dependent conclusions needs_confirmation until reconciled, and state the inspected subset explicitly.

## Integration and environment metadata

Integration resource associations are not proof of environment-variable metadata. A resource linked to a project establishes only that association, not environment targeting, protected attributes, variable existence or values. Preserve the association as CRE-02 context. SEC-01 needs a separate, authorised metadata-only observation; if unavailable, use not_reviewed, or needs_confirmation for an attempted but inconclusive review. Do not reveal values to resolve the gap.

## Current Git connection

Deployment historical Git metadata does not establish a current Git link. Historical repository/commit metadata describes a deployment's origin, not necessarily the project's present connection. For SRC-01, keep the historical observation separate from current project connection metadata, with both dates and scopes. If current evidence is absent or disagrees, retain needs_confirmation after an attempted review; do not infer present connection or repository authority from old deployment metadata. Confirm through an authorised current connection view or a labelled Owner statement, retaining any remaining observation gap.

## Plan and per-feature applicability

Record the observed plan and its observation date, then verify current per-feature entitlements independently. Include account-specific entitlements, custom features or add-ons, effective project/environment scope and role visibility. Record current public documentation with its verification date and the scoped account facts supporting each conclusion. A plan name is context, not evidence of every feature's availability. Do not hardcode plan-to-feature mappings, including OWASP managed rulesets: features and packaging change. If documentation or account facts are unavailable, label availability unverified and defer the conclusion.

Use not_applicable only for verified, feature-specific non-applicability supported by current public documentation and account facts. A 403, upgrade prompt, hidden control or tool error alone is not proof of non-applicability: it may reflect role visibility, account configuration or incomplete collection. Retain not_reviewed when collection was unavailable, or needs_confirmation for an attempted but ambiguous assessment. State the exact missing verification, not an assumed plan restriction.

Structured plan entitlement signals are different from upgrade prompts. When a verified read's structured response states that a specific feature is unavailable because of the plan (for example, in the checked CLI, firewall status returning `owasp.requiresUpgrade: true` or a ruleset with `unavailable.reason = "plan"`), that field counts as the scoped account fact for that feature. It supports not_applicable for that feature only when all of these hold:

- The response comes from the selected, authorised identity and team/project scope.
- Current public documentation, with its verification date, agrees that the feature is not included for that plan or scope.
- No other source shows the feature as enabled, configured or entitled for that scope.
- The field, source, scope alias and UTC observation time are recorded as evidence.

The signal covers only the named feature in that scope, not other features, projects or the whole check; mixed checks still assess each subfeature. If documentation disagrees or is unavailable, or another source conflicts, keep both observations and needs_confirmation. A dashboard upgrade prompt, 403, hidden control or tool error is still not enough on its own. A not_applicable outcome on this basis is not a finding and never a reason to recommend buying an upgrade.

For mixed checks such as IAM-02, assess MFA enrolment and enforcement, SAML configuration and enforcement, and directory provisioning/group mapping separately against the agreed policy. Verified non-applicability removes only that subfeature from assessment, with its evidence retained. One passing setting or one non-applicable subfeature cannot make the whole check satisfactory. Every remaining applicable setting must have sufficient evidence; unresolved applicability or coverage leaves the overall check needs_confirmation. Mark the whole check not_applicable only if every subfeature has verified non-applicability.

A managed ruleset entry may be an inert configuration artifact, but conclude that only after verifying entitlement (a structured plan signal meeting the conditions above satisfies this part), published state (not merely a draft or listed entry), effective plan and runtime scope, and owner intent. Confirm the documented effect of that combination before calling the entry active or inert. A mismatch between listed state and expected availability is a request for confirmation, not an assertion of misconfiguration or a recommendation to remove the entry. Keep both observations and needs_confirmation until reconciled; do not publish, enable, discard or purchase anything.

## Owner statements from the inline round

Inline owner round answers are owner statements, kept as separate evidence entries with UTC statement time, role alias, scope alias and the question asked. They are never observed configuration. A statement can supply a requirement, intended audience, responsible role, process or aggregate the owner can see. The status then follows from comparing that requirement with the observed evidence: the answer itself does not promote a check status.

A statement alone cannot establish list completeness, enforcement, a setting's current state or satisfactory where the requirement needs direct observation. If it conflicts with observed evidence, keep both and use needs_confirmation. Skip, don't know or no answer leaves the status unchanged and the question open for the handoff questionnaire. A statement never authorises broader access or optional scope.

For a not_reviewed check included because collection was unavailable or had no acceptable pre-exposure selection mechanism, an answer is still only an owner statement. Keep the collection gap and its reason recorded, and keep the observed setting unknown. Reassess the status with the rules above. Skip or don't know leaves the check not_reviewed. Checks not_reviewed because they are unauthorised or out of scope are never asked in the round.
