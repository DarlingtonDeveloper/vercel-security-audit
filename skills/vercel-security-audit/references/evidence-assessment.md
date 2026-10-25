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
