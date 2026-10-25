# Browser evidence safety

Read this before any browser navigation, reload, snapshot or screenshot. Apply the [collection plan](collection-plan.md) and the host's ownership rules. This reference specifies a privacy gate; it does not implement filtering or prove any host capability.

## Pre-model privacy gate

Use the minimum evidence necessary for a specific checklist setting: state, aggregate count, scope alias and provenance. Classify the actual destination page and its possible contents, not just its title. Verify exposure behavior from tool schemas/host guarantees before navigation. If sensitivity or behavior is unknown, treat the destination as sensitive and skip automated observation until safe collection is established.

A screenshot-only host that automatically captures the full viewport cannot prefilter that capture. A later crop, blur, redaction or promise to redact after saving is not a repair. The gate must apply before content reaches the model, transcript, tool logs or disk. Automatic images during navigation, reload, human takeover or tool completion are part of the gate, even when no explicit screenshot was requested. Text snapshots and accessibility trees can also expose personal data or secrets.

For a sensitive destination, proceed only if the host demonstrably suppresses automatic exposure and supports an allow-listed metadata selection before model exposure and saving. Otherwise skip the page and use a safe owner statement or not_reviewed. Full-viewport capture may be used only for a verified non-sensitive destination when every visible field is within scope and necessary; an optional screenshot is never a reason to collect extra information. Disable network-body/HAR and full-session recording where supported; if unavoidable recording breaks the gate, skip collection.

## Sensitive destinations and safe alternatives

These are risk categories, not claims about current UI names or routes. Apply them to the actual page; other pages may be sensitive too.

- IAM-01 / IAM-03: Members, invitations, access groups and membership lists can reveal names, emails, individual roles and invite links. Skip automatic full-viewport capture; request role totals, completeness and invitation age bands only.
- A Security Dashboard may list users and projects. Never classify a Security Dashboard as blanket safe. Classify its actual contents before navigation; unknown or personal rows require the same gate as Members. Even project names may exceed selected-project authorisation.
- CRE-01: credential/token views can expose token values, identifiers or access-bearing URLs. Use scope categories, expiry availability, purpose aliases and aggregate counts only.
- DEP-02: sharing, access and bypass views can expose usable links or bypass credentials. Ask only whether exceptions exist, their scope category and purpose; never request the links or values.
- SEC-01 / SEC-02: environment pages may reveal secrets even when some fields look masked. Request target-environment counts, branch-category coverage, protection flags and lifecycle responsibility, never values or raw variable names.
- CRE-02 / CRE-03: integration pages may include secrets, webhook destinations and credential-bearing configuration. Request permission categories, project aliases, lifecycle totals and continuing purpose, not configuration dumps.
- Firewall rules, notifications, activity and domain views also require classification: shared-secret conditions, recipient addresses, personal event rows and sensitive hostnames must not enter evidence. Use action summaries, destination types, aggregate events and scope aliases.

A human navigating to a page does not authorise automatic model exposure. Use a user-only handoff with automatic capture suppressed and verified, or let the owner inspect independently without streaming the page to the agent. If the host cannot guarantee that separation, do not navigate or ask the owner to open it in the captured session. Ask the non-sensitive questions below through the conversation instead.

## Safe owner-statement questions per check

Ask only applicable questions for the authorised scope. The owner should answer with aggregates, policy categories and synthetic aliases, not screenshots, copied rows, names, emails, raw IDs, URLs, tokens or secrets. Ask them to omit details they cannot safely summarise. These prompts are evidence requests, not instructions to change settings.

- IAM-01: What are the role totals, is that count complete for the agreed scope, and which responsible role reviews access?
- IAM-02: Separately, what are MFA enrolment/enforcement coverage counts, SAML configuration/enforcement states, provisioning/group-mapping coverage, exception totals and recovery responsibility?
- IAM-03: How many invitations are pending by broad age band, and which role owns recurring access reviews?
- CRE-01: By purpose alias, what scope category and expiry availability apply, how many credentials are covered, and is their continued need confirmed? Omit token strings, identifiers and URLs.
- CRE-02: What integration permission categories and project aliases are covered, and what purpose requires each category? Omit provider secrets and destination URLs.
- CRE-03: What are lifecycle-state totals, the accountable role and the offboarding/continued-need process?
- DEP-01: What protection states cover production and preview, what audience is intended, and how many exceptions apply by scope category?
- DEP-02: What sharing policy categories apply, do access/bypass exceptions exist, and what audience/purpose justifies them? Do not provide usable links or bypass values.
- DEP-03: Is inventory complete, what are the deployment age bands and retention intent, and which scope aliases remain needed?
- FWB-01: What are published rule action totals, enabled-state totals, scope categories and traffic requirements? Omit condition values and sensitive paths.
- FWB-02: What bot-control modes and coverage categories apply, with exception totals and legitimate automation requirements?
- FWB-03: What exception scope categories exist, and which role owns their purpose and periodic review? Omit match values.
- SRC-01: What connection type and project aliases apply, and does the responsible role confirm repository control?
- SRC-02: What production-source category, restriction states and approval responsibility apply? Omit repository and branch names.
- SRC-03: What contributor/fork policy categories apply and what trust scope is intended?
- SEC-01: What aggregate variable counts target each environment/branch category, and what protection states are known? Do not send names or values.
- SEC-02: What broad change-age bands, responsible role and rotation/revocation process apply? Do not send secret material.
- SEC-03: What access categories, export destination types and retention requirements apply? Do not send logs or destination addresses.
- DOM-01: Which synthetic domain/project aliases are associated, what verification states are shown, and is control confirmed?
- DOM-02: For each scope alias, what certificate state, expiry age band if visible and transport requirement apply? Do not send certificate bodies or hostnames.
- DOM-03: What warning categories and alias/redirect relationships need lifecycle review, and by which role?
- OPS-01: Which subscription states and destination types are configured, and which role owns escalation? Do not send recipient addresses or test notifications.
- OPS-02: What event categories, observation window, retention/access limits and review process are available? Do not paste event rows.
- OPS-03: Which role owns recovery, what rollback intent is documented, and what is the review cadence? Do not perform a recovery exercise.

Optional authorised checks DEP-04, SRC-04, SEC-04 and OPS-04 require separately agreed, sanitised design summaries for their named scope. If no safe question can obtain the required evidence, mark that portion not_reviewed rather than requesting raw source or configuration.

Label every answer as an owner statement with UTC time, role category, scope alias, question and limits. Owner value summaries remain labelled statements, never browser observations. Missing observed data stays unknown; a statement does not establish list completeness, enforcement or satisfactory state without adequate evidence for that requirement. An unobserved setting is not disabled. Preserve needs_confirmation for attempted but incomplete evidence and not_reviewed for skipped collection.

## Accidental exposure: stop and hand off

If unexpected sensitive content is captured, stop all further collection immediately. Do not re-read values, zoom, OCR, quote, copy or inspect the exposed content again to decide how bad it is. Do not treat redact-after-saving as a repair or continue on another page.

Follow the host/organisation incident process and notify the user using metadata only: UTC time, tool/action category, scope alias, affected artifact category and containment status. Never include the exposed value, row, raw URL or screenshot in the notice or incident record. If no process is available, pause for user-directed incident handling. Identify possible model/transcript/log/disk exposure without opening affected artifacts. Restrict further access through approved host controls where authorised; credential rotation, artifact deletion and external notification require the appropriate separate approval. This audit does not perform incident investigation or remediation. Resume only after authorised incident handling and renewed scope/privacy confirmation.

## UI-state playbook

Apply the privacy gate above before every observation, wait result or reload. This playbook is host-capability-based: no browser tool, DOM access, timing primitive or control label is assumed available. Labels below are candidate labels to verify in the observed UI, not official/current control names. Record the actual safe label and setting scope; never invent a missing control from a candidate label.

### Read state without changing it

- Prefer read-only structured semantics when the host safely exposes them: a switch's `aria-checked`, a checkbox/input's current `checked` property, input type and associated accessible label, or a selected radio/option and its group label. A static HTML `checked` attribute may describe the initial default rather than current state; prefer live input semantics and record uncertainty if these differ. `aria-checked="mixed"`, missing attributes or contradictory labels require needs_confirmation. A disabled attribute describes interactivity, not necessarily a policy being off.
- Never click or toggle to discover state, focus a secret field, reveal a value, submit a form or press Save/Configure. Read a safe control's label, current state and scope together. Color alone is not enabled-state proof; a green icon, a Configure/Save button or positive nearby text cannot establish enforcement. If only a screenshot is available and state is ambiguous, keep unknown/needs_confirmation instead of testing the switch.
- Distinguish current published policy from drafts, inherited defaults and unsaved form state. If a form has changes, do not reload, discard, save or navigate away to recover evidence. Pause that check for the user; an audit never repairs UI state by mutating it.
- Scope is part of the evidence: record team/project/environment aliases and which policy/control the state belongs to. Role icons and a `+N` summary are not scope enumeration, exact role totals or a complete member list. Collapsed chips, a truncated snapshot or one page of results cannot establish complete coverage; use only an authorised safe complete read or request confirmation.

### Loading, missing controls and navigation

1. When a control is pending or shows Loading, record that transient state. Use a bounded wait and a small observation budget chosen from verified host capabilities and the collection plan, not a blanket 30-second sleep. Prefer a safe readiness signal for the specific control; a loaded page shell is insufficient. If no safe wait/readiness capability exists, stop this attempt with needs_confirmation.
2. Allow at most one safe reload in that check's planned attempt, only when there is no form change, no unsaved input and no submission in progress; the host must guarantee it is a read-only reload and the destination still passes the privacy gate. Check identity/team again after reload. If safety cannot be established, do not reload. Human navigation is still subject to the privacy gate.
3. After the bounded wait and optional single reload, a still-pending Loading state becomes needs_confirmation, with the specific setting unknown and budget exhausted. Do not loop, auto-retry across pages or treat pending as disabled. Pause/handoff is available; a browser timeout does not prove a platform fault.
4. A missing control, permission-limited view, 404 or unavailable feature is not a disabled setting and does not alone establish not_applicable or action_recommended. Record the observed limitation; use needs_confirmation for attempted ambiguous evidence and not_reviewed for collection not performed. Ask about role/plan/scope constraints without changing them.
5. Follow the observed Rules view or verified navigation for firewall rules; do not guess `/firewall/config` or infer missing policy from a guessed URL's 404. Use only a previously verified safe destination or owner handoff. Read-only navigation is not permission to open an unknown sensitive destination.

### Per-check interpretation

- IAM-02: distinguish MFA enrolment from enforcement, and SAML configuration from enforcement. Verify provisioning/group mapping separately where applicable. An enabled switch with unknown scope or exception coverage leaves the check incomplete. Role icons and +N cannot prove which roles/projects a policy covers. Recovery and exceptions need their own evidence; the owner's policy intent is a statement.
- SEC-01: on an already privacy-approved metadata surface, a candidate label such as Require Separate Values must be verified in context and its switch/input semantics read without toggling. A label or masked field alone proves neither protection nor value separation. Record environment/branch targeting separately; do not reveal or compare values. If metadata cannot be selected before exposure, use the safe question above and leave observed state unknown.
- OPS-01 / OPS-02 / OPS-03: notification subscription state differs from alert history; a candidate Notifications label is not proof of enabled delivery. Record destination type and accountable role without recipient identifiers. Loading subscriptions remain needs_confirmation after the budget; never send a test notification. Event-window completeness and recovery responsibility are separate checks, not consequences of a green status icon.
- CRE-01: token/credential pages retain the sensitive-page gate even for scope and expiry. Candidate scope/expiry labels must be verified against the specific credential purpose alias, not inferred from a token name or creation date. An absent expiry is unknown, not proof of no expiry; never reveal/copy token values, raw credential IDs or access-bearing URLs to resolve ambiguity.
- DOM-02: tie the displayed certificate/TLS state to the covered domain alias and observation time, with expiry only if safely shown. A candidate Valid label or green icon is not proof for every hostname, transport path or certificate. Loading or missing certificate details stay unknown; no active TLS scan is implied.
- FWB-01: follow the observed Rules view and distinguish published enabled rules, drafts, actions, order and applicable project/environment scope. Rule counts alone do not prove enforcement or coverage. Omit secret header conditions, match values and sensitive paths. No rules or a missing view is not itself a vulnerability.
- FWB-02: read the observed bot mode, scope and exception summaries separately from custom firewall rule state. Candidate bot-policy labels require verification; feature availability and legitimate automation needs must be confirmed before recommending a change. Role/plan limitations or optional modes off are not misconfigurations by themselves.
- Attack Mode context: associate any observed Attack Mode state with its scope, observation time, incident context and owner requirement. Off alone is not a finding; on alone does not prove a particular bot policy or every rule is enabled. Never toggle Attack Mode or generate traffic to test it. Do not conflate Attack Mode with FWB-01 published rules or FWB-02 bot mode.

### Minimal state record

For each applicable setting, keep check ID, UTC observation time, scope aliases, safe Control label, source kind, semantic state or unknown, completeness limits, retry outcome and rationale. Use the safe scope/Control label as the reference, not unstable DOM IDs, nonce IDs, raw URLs or credential identifiers. If a label itself contains personal data or secrets, replace it with a synthetic alias before exposure or skip observation. No secret belongs in the record. A statement and an observed state are separate evidence entries; unresolved contradictions remain needs_confirmation.
