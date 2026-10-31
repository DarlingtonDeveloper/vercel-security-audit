# Per-check collection routing

## Selection contract

Prefer an existing authenticated MCP connector for each supported read; an installed CLI is a fallback, not a prerequisite. Authenticate through the host's normal user handoff only when needed. Discover the selected identity and authorised team/projects before collecting. A connector, CLI and browser must refer to the same confirmed identity/scope before combining evidence.

Every MCP entry below is a capability description, not an executable tool name. No public tool schema/response contract was verified for this map. Tool names in reports, examples or read-only annotations are not proof of safety. Before invoking any discovered candidate, verify its input schema, permissions, server-side scope, side effects and response contract, including field selection before output reaches the model, transcript, logs or artifacts. If any part is unknown, leave that route unavailable. Never fetch account values to discover whether a response is safe.

No connector: if the user declined to connect a plugin or MCP connector (see [routing](capabilities.md#routing)), skip every MCP entry below; each one is conditional and unverified without a connector. Go straight to the CLI entry, then the Browser entry only for dashboard-only evidence, and record unsupported CLI entries as gaps rather than browser work by default.

Use [capabilities](capabilities.md) for the existing CLI patterns and their installed-help, scope and pre-output selection gates. CLI references below are limited to those documented patterns, not additional commands. Unsupported means no verified existing read pattern for the requested evidence; context-only reads cannot establish the whole check. Neither MCP discovery nor a project-only request authorises team-wide reads. Post-collection filtering cannot repair scope or privacy violations.

Security check baseline: when the CLI route is in use, SKILL.md step 2 runs the reader's `security-check` read once before these entries, within the agreed scope (team-wide only with team-wide read authorisation, otherwise per agreed project). Where an entry's CLI or Security Dashboard route is covered by a product check in that baseline, reuse the baseline result and its scope rather than reading it again; route only the remaining evidence through the entry.

The CLI's product check slugs and the checklist ID each one maps to are listed once, in [product check slugs](capabilities.md#product-check-slugs); the reader attaches that ID to each product check, or `unmapped` for a slug not in the table. Security Dashboard entries below repeat no check names, and dashboard labels are not assumed to match the CLI slugs. During an authorised review, record only actual returned/displayed check names, scope, status, pagination and muted reasons. Link a product check to just the subsetting it actually tests. Passing, including a complete zero, applies only to that bounded product check and scope, never to the entire checklist ID or team. Partial, missing, muted, no-access and error results do not establish a pass.

Browser entries are fallbacks, not permission to expose sensitive pages. Apply the pre-exposure gate to navigation, automatic screenshots and snapshots as well as selected controls. If that gate or a verified read-only view is unavailable, use a non-sensitive owner summary labelled as such, or record not_reviewed. Optional source/application checks need separately approved material; they do not authorise requests, scans, tests or repository execution.

## Routing entries

### IAM-01
- MCP: Conditional membership role aggregates with complete pagination; schema must support authorised team scope and omit personal rows before exposure.
- CLI: Unsupported for membership metadata; whoami and teams list confirm identity only.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Owner-visible Members and Access Groups metadata; select role counts and completeness only.

### IAM-02
- MCP: Conditional authentication policy metadata separating enrolment, enforcement, SAML and provisioning; schema must return policy flags and aggregate coverage without member details.
- CLI: Unsupported for authentication policy metadata.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Owner-visible Security & Privacy controls; inspect each applicable policy and exception separately.

### IAM-03
- MCP: Conditional invitation aggregates with age bands and pagination; schema must exclude invite identifiers, addresses and access links.
- CLI: Unsupported for invitation metadata.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Members/invitation view through pre-selected counts; owner confirms review process.

### CRE-01
- MCP: Conditional credential metadata inventory; schema and response must exclude credential values and credential-bearing URLs, exposing only scope, expiry and purpose aliases.
- CLI: Unsupported for credential scope/expiry inventory.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Owner-visible non-secret credential metadata only; avoid token-reveal views and confirm purpose with owner.

### CRE-02
- MCP: Conditional integration permission metadata; schema must restrict to authorised projects or separately authorised team inventory and omit sensitive configuration.
- CLI: integration list is partial inventory only, subject to separate team-wide authorisation and pre-output selection; not complete third-party access evidence.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Integration permission summaries and project associations; owner confirms purpose.

### CRE-03
- MCP: Conditional integration lifecycle metadata; schema must provide scoped installation/status summaries without secret configuration.
- CLI: integration list supplies partial installation context only; no verified read pattern proves continuing need or offboarding.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Integration status metadata and owner-stated lifecycle responsibility.

### DEP-01
- MCP: Conditional project deployment-protection metadata; schema must separate environment coverage and exception flags without returning bypass values or access URLs.
- CLI: security check supplies only actually returned product subchecks; no verified existing direct protection-settings read pattern.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Team/project deployment-protection controls, intended audience and separately observed exceptions.

### DEP-02
- MCP: Conditional current sharing and automation-bypass metadata inventory only if schema/response prove a non-mutating current-state read with no access-bearing URLs or values. Creation/reuse of sharing URLs is not inventory. Event history is not current state.
- CLI: Unsupported for current sharing/automation-bypass inventory. activity is event history, never a current active count, even as an estimate; it cannot drive a current-state finding.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Owner dashboard current sharing/access and automation-bypass metadata only, behind the pre-exposure privacy gate; otherwise owner summary or not_reviewed. Do not create or reveal links.

### DEP-03
- MCP: Conditional project/deployment metadata inventory; schema must bound authorised projects, paginate and select lifecycle timestamps/age bands without sensitive build output.
- CLI: project ls provides paginated project inventory only; unsupported for complete deployment inventory/retention intent in the existing patterns.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Project/deployment inventory gaps and lifecycle settings; owner confirms continued need.

### FWB-01
- MCP: Conditional firewall configuration summary; schema must distinguish published rules from drafts, select enabled/action/order/scope metadata and omit secret conditions.
- CLI: firewall status and firewall rules list provide configuration; distinguish drafts from published policy and omit condition values before exposure.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Project Firewall configuration and rules; owner confirms traffic intent.

### FWB-02
- MCP: Conditional bot policy summary; schema must select mode, coverage and exception metadata without sensitive conditions.
- CLI: firewall bot-management and firewall status provide scoped policy context; firewall overview and firewall traffic list provide bounded activity only, not efficacy.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Bot policy controls, feature availability and legitimate automation requirements.

### FWB-03
- MCP: Conditional firewall exception summary; schema must omit bypass/condition values and expose rule relationships and safe scope metadata only.
- CLI: firewall system-bypass list and firewall rules list supply partial exception metadata; system mitigation bypass is not a bypass of all custom rules.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Firewall exception/rule relationship metadata; owner confirms purpose and review responsibility.

### SRC-01
- MCP: Conditional project repository-connection metadata; schema must select connection type and project alias without source or private repository details.
- CLI: Unsupported for repository authority; project ls is project context only.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Project Git connection settings; owner confirms repository control.

### SRC-02
- MCP: Conditional production-source/governance metadata; schema must select configured source and visible restrictions without build or source contents.
- CLI: Unsupported for production deployment governance in the existing patterns.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Production-source and governance controls; repository branch protection remains separately unverified.

### SRC-03
- MCP: Conditional contribution/build trust policy metadata; schema must expose configured contributor/fork restrictions without executing builds or returning source.
- CLI: Unsupported for contribution/build trust policies.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Visible contributor and fork authorization settings; do not infer provider-side controls.

### SEC-01
- MCP: Conditional environment targeting metadata only if verified schema and response contract exclude values before model exposure; a decrypt=false argument alone is insufficient proof.
- CLI: Unsupported for a proven metadata-only environment read; env list output includes readable values in the checked version, so never run it or pull values.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Pre-selected environment targeting/protection metadata only; no reveal controls or environment values.

### SEC-02
- MCP: Conditional environment lifecycle metadata under the same verified metadata-only schema/response gate as SEC-01; timestamps cannot prove rotation.
- CLI: Unsupported for a proven metadata-only secret lifecycle read.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Safe environment change-time metadata; owner states responsibility and rotation/revocation process.

### SEC-03
- MCP: Conditional logging/export configuration metadata; schema must omit log bodies, destination URLs and credentials while selecting access/retention/destination type.
- CLI: Unsupported for logging/export configuration; no raw log collection.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Logging/export access and retention settings; do not open log contents.

### DOM-01
- MCP: Conditional domain association metadata; schema must restrict project scope and select aliased association/verification state without DNS credential data.
- CLI: domains list provides team domain inventory and, per aliased domain, only what its JSON actually returns and the reader keeps: nameservers mode (external, vercel or unknown), expiresAt and createdAt, subject to team-wide authorisation, pre-exposure selection with synthetic aliases and verified pagination. It returns no verification or DNS configuration status (only the per-domain domains inspect does, and the reader does not wrap it), so verification state and project association need another route.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Project/team domain association and verification status; owner confirms control.

### DOM-02
- MCP: Conditional certificate status metadata; schema must select covered scope, status and expiry without private keys or active probes.
- CLI: Unsupported for certificate metadata: certs list has no structured output to select before exposure in the checked version.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Displayed domain certificate/transport status only; no TLS scanning.

### DOM-03
- MCP: Conditional domain warning/configuration metadata; schema must select safe warning summaries and alias relationships within scope.
- CLI: domains list supplies no per-domain configuration or warning fields: its JSON actually returns only the nameservers mode, expiresAt and createdAt per aliased domain, subject to team-wide authorisation and pre-exposure selection. DNS configuration status, warnings and alias/redirect relationships need another route; domains inspect is not wrapped by the reader.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Domain warnings and alias/redirect settings; owner confirms lifecycle responsibility.

### OPS-01
- MCP: Conditional alert subscription metadata; schema must expose enabled subscriptions and destination types without recipient details, URLs or test delivery.
- CLI: firewall alerts list is bounded history only; unsupported for subscription/recipient configuration.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Notification subscription controls and owner-stated escalation responsibility; no test messages.

### OPS-02
- MCP: Conditional bounded activity/audit aggregates; schema must support authorised server-side filtering and select event categories/time windows without sensitive payloads.
- CLI: activity supplies bounded event context with separate team-wide permission where necessary; omit payloads. It does not prove complete history or current active resources.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Available audit/activity metadata with explicit pagination, retention and access limitations.

### OPS-03
- MCP: Conditional deployment lifecycle metadata; schema must provide scoped recovery-related configuration context without invoking rollback or returning build contents.
- CLI: project ls is inventory context only; unsupported for recovery responsibility or tested rollback evidence.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Visible recovery-related settings and owner-stated rollback intent/review cadence; no exercise.

### DEP-04
- MCP: Conditional deployment context metadata only; schema must limit scope and omit source/secret contents. Not application authentication evidence.
- CLI: Unsupported for application authentication review; project ls is context only.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Separately authorised source viewer with pre-selected safe authentication design descriptions and explicit route/file coverage; no application requests.

### SRC-04
- MCP: Conditional Vercel repository-connection context only; schema must select safe connection metadata. Not repository governance proof.
- CLI: Unsupported for repository governance evidence.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Separately authorised owner-controlled repository settings with scope and exceptions; no repository commands.

### SEC-04
- MCP: Conditional metadata-only deployment context under SEC-01's verified schema/response gate; not source or log-redaction proof.
- CLI: Unsupported for source secret-handling/log-redaction design evidence.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Separately authorised source/configuration viewer with pre-exposure selection of safe design descriptions; no searching for secrets or collecting logs.

### OPS-04
- MCP: Conditional scoped lifecycle context metadata; schema must exclude source/build contents and must not invoke restore/failover. Not recovery design proof.
- CLI: Unsupported for application/data recovery design evidence.
- Security Dashboard: Partial/no equivalent verified; no observed check name.
- Browser: Separately authorised owner-provided recovery documentation; label claimed test dates as owner statements and never execute recovery.
