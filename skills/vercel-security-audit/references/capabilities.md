# Vercel plugin, CLI and browser capabilities

## Routing

1. Prefer an existing authenticated MCP connector for supported safe account reads. Discover actual capabilities and verify schemas, response contracts, permissions, selected identity and server-side scope before invocation. Read the complete [per-check map](mcp-check-map.md); its capability descriptions are not executable tool names. Installing a plugin does not authenticate an account or make its tools read-only; names copied from reports are not safety evidence.
2. If no authenticated plugin or MCP connector is available, recommend connecting one before any account reads, and explain that it is the preferred route for structured, selectable metadata. Point to the public plugin source below; the user installs and authenticates it through their host. Never install, connect or authenticate it yourself. Record the user's choice.
3. Use the authenticated Vercel CLI only if the user declines or cannot connect a plugin or connector. Inspect current help before executing an unfamiliar command. Missing CLI commands are version/capability gaps, not permission to install or upgrade software silently. A safe connector/browser route can proceed without a CLI.
4. Use an authorised browser last: only for dashboard-only states and evidence confirmation that no connector or CLI read covers, subject to the same pre-exposure privacy and scope gates. Do not use the browser as a substitute for an available connector or CLI read. An isolated/remote browser, including one supplied by the host, is suitable. Use that host's login and takeover controls; agent-browser is an option, not a required tool name.
5. If no safe surface exposes a check, retain not_reviewed or needs_confirmation with the reason. Do not substitute privileged access or another person's session.

Plugin skill names currently include vercel-cli and vercel-firewall. Their guidance covers both reads and writes. Load relevant guidance for discovery, but select only inspection operations for this audit. Examples that stage, publish, edit or enable settings are not audit operations.

## Mandatory preflight

Before inventory or configuration collection, complete [collection-plan.md](collection-plan.md). Record host browser capabilities, connector read OAuth scopes or equivalent grants, browser authentication through user handoff, and connector/CLI-to-browser account/team match. Do not assume a working browser from an authenticated API connection. Browser authentication or privacy failures require an explicit limited-scope API-only confirmation or a pause, not silent fallback or permanent exclusion of portable Markdown hosts.

## CLI version

Minimum tested CLI version: 62.7.0 (help checked) and 65.0.0 (guided test run). Older versions can lack whole command groups: CLI 54.18.0 has no `security` command at all. Newer versions can change defaults and output shapes; for example, CLI 65 defaults to non-interactive mode when it detects an agent.

When using the CLI fallback, check the installed version first:

```sh
vercel --version
```

If it is older than the minimum tested version, or not the latest release, recommend that the user updates the CLI themselves before collection and say why (missing commands, changed output). This is guidance, not a requirement: do not install, upgrade or download the CLI yourself, and continue with the installed version if the user declines. Record the version used in the report's sources.

If `vercel security --help` (or another documented command's help) reports an unknown command or subcommand, record a capability gap for the affected checks with an "upgrade the CLI" note in the report. Do not retry, guess equivalent commands, call the REST API or substitute another tool to fill the gap; the affected checks stay not_reviewed unless another verified safe route covers them.

## Identity and scope

Start with these read-only checks after discovering the executable, through the [bundled reader](#cli-account-reads-bundled-reader-only):

```sh
python3 -I -B "$skill_dir/scripts/cli_read.py" version
python3 -I -B "$skill_dir/scripts/cli_read.py" whoami
```

Team discovery (`vercel teams list`) is also an account read: never run it directly. Confirm the intended team slug and approved project list with the user. Pass explicit --scope and --project flags where supported by current help. Use the CLI's existing secure authentication or the host's managed connector. Never place credential values in arguments, chat, generated examples or evidence. Do not use debug mode or generate authenticated curl commands.

A token inherits its user's role and scope; the token's presence is not proof of read-only permissions. Choose least-privilege access available for the requested checks. An Owner may need to confirm identity settings through their own browser; this does not justify obtaining their credentials.

Do not automatically run login, switch, link, pull, setup or installation commands. Normal user-completed authentication is separate from collecting evidence. Prefer explicit scope and project flags to relinking the user's workspace. Never invoke bare vercel: its default command is deploy.

## CLI account reads: bundled reader only

Every CLI account read goes through the bundled reader, `scripts/cli_read.py` in the installed skill directory. It runs one documented read command as an argument list (no shell), always adds `--json` and `--non-interactive`, keeps the raw output inside its own process and prints only that read's allow-listed fields as JSON. CLI error text is never echoed; failures are reported as fixed kinds such as `permission`, `not_authenticated`, `unknown_command`, `timeout` or `invalid_json`, always with `coverage.complete: false`.

Never run a documented account read directly, even for discovery. In agent hosts the CLI defaults to non-interactive mode, and a plain `vercel security check` (no `--json`, no `--findings`) has printed full JSON including finding samples: project names and IDs and environment variable names. Do not pipe a read through your own filter, redirect it, use tee or record a terminal session instead of the reader. Help output is not an account read and may be inspected directly:

```sh
vercel security check --help
vercel project ls --help
vercel firewall status --help
vercel firewall rules list --help
vercel firewall traffic list --help
vercel activity --help
```

Reader usage, with identifiers already agreed with the user (identifiers that look like flags are rejected):

```sh
python3 -I -B "$skill_dir/scripts/cli_read.py" version
python3 -I -B "$skill_dir/scripts/cli_read.py" whoami
python3 -I -B "$skill_dir/scripts/cli_read.py" security-check --scope "$team_slug"
python3 -I -B "$skill_dir/scripts/cli_read.py" firewall-status --scope "$team_slug" --project "$project_id"
```

Team-wide security checks, project inventory, activity, webhook listings and integration listings require explicit team-wide read authorisation, separately from any selected-project review. Use the reader's `--project` filter for a project-only scope where the read supports it; if a read cannot filter to the agreed scope, skip it or ask for broader read permission first. If the reader is unavailable (for example no Python 3), CLI account reads are unavailable: use selected dashboard evidence, owner statements or record the gap. If unselected output does reach the transcript, follow the [accidental exposure procedure](browser-evidence.md#accidental-exposure-stop-and-hand-off).

Each reader read maps to exactly one underlying command. These were checked against CLI 62.7.0 help, and their JSON shapes against a keys-and-types-only probe of a real team; see [CLI version](#cli-version). They are listed for traceability, not for direct execution:

```text
version                  vercel --version
whoami                   vercel whoami
security-check           vercel security check --scope <team> [--project <id>]
project-ls               vercel project ls --scope <team>
firewall-status          vercel firewall status --scope <team> --project <id>
firewall-overview        vercel firewall overview --scope <team> --project <id>
firewall-rules           vercel firewall rules list --scope <team> --project <id>
firewall-system-bypass   vercel firewall system-bypass list --scope <team> --project <id>
firewall-bot-management  vercel firewall bot-management --scope <team> --project <id>
firewall-traffic         vercel firewall traffic list --scope <team> --project <id> --since <window> --dimension action
firewall-alerts          vercel firewall alerts list --scope <team> --project <id> --since <window>
activity                 vercel activity --scope <team> --all --since <window> --limit 100
webhooks                 vercel webhooks list --scope <team>
integrations             vercel integration list --scope <team> --all
domains                  vercel domains list --scope <team> --limit 100
```

What each read keeps, and what it drops before output:

- whoami: username only; email, display name and current team are dropped.
- security-check: per product check slug, violationsCount, totalCount, sampleType and the number of samples received. Samples (project, deployment, member and environment variable names and IDs) are dropped.
- project-ls: project id, name, deprecated flag, Node.js version and updatedAt; production URLs are dropped. Inventory identifiers appear only after team-wide inventory authorisation.
- firewall-status: enabled states, actions, rule counts, draft changes, IP block count, bypass counts and states, request-flow step and ruleset IDs and states, and the ruleset unavailable reason (for example plan). Labels, descriptions, bypass skips and upgrade URLs are dropped.
- firewall-overview: period, granularity, Attack Mode state, attacks mitigated, whether a draft exists and counts of top rules and annotations.
- firewall-rules: draft flag, pending changes, custom rule count and each rule's active state, and managed ruleset IDs and actions. Custom rule names, conditions, header values and paths are dropped.
- firewall-system-bypass: entry count only.
- firewall-bot-management: managed ruleset IDs and actions, and the number of unknown-bot traffic rows.
- firewall-traffic: period and, per top list, the dimension and rows keeping only enum-shaped keys (such as an action name) and numbers. IPs, hosts and paths become unknown.
- firewall-alerts: active and resolved counts.
- activity: event count and counts per event type.
- webhooks: webhook count and response status; destination URLs are dropped.
- integrations: per resource, marketplace product name, status and number of connected projects; resource names and IDs are dropped.
- domains: domain count and, per domain, a synthetic alias (`domain-1`, `domain-2`, ...) assigned in the reader with only that domain's boolean flags (for example verification state). Domain names, IDs, nameservers and other strings are dropped before output.

Missing or mistyped fields are reported as `unknown`, never zero or false. Shapes for custom firewall rules, system bypass entries, traffic rows, alerts, activity events and webhooks were empty when verified; the reader therefore keeps only counts and states for them. Re-check with a newer CLI before widening any allow-list, and widen it only in the bundled reader with tests, never with an ad-hoc filter during an audit.

Important distinctions:

- security check reports product check statuses, risk, violation counts and muted findings. --findings and --limit control individual findings; use only when necessary. Exact total counts do not mean all individual findings were inspected. A successful exit code means the report was produced, not that checks passed. Map failing to an evidence-backed review candidate; passing applies only to that product check and its explicit scope. Muted means findings were suppressed or accepted, not that the underlying gap was resolved: preserve the reason and request confirmation. No access and error are unavailable evidence, never satisfactory. Inspect the actual response and pagination rather than assuming the CLI help and documentation describe the same finding cap.
- project ls defaults to a page of 20 in the checked version. Follow returned pagination with the supported --next flag; a first page is not the whole estate.
- firewall status is configuration; overview includes the last day's activity. traffic list has its own window and plan-dependent retention. Do not label an overview as 30-day traffic.
- traffic list aggregates into time buckets. In a test run on CLI 65, --since 24h returned a period end one hour after the request time, consistent with hourly buckets. Record the returned period start and end as the covered window, not the requested relative window, and note that the final bucket may extend past the observation time. For an exact window, pass explicit ISO 8601 --since and --until values on hour boundaries where installed help supports them. Bucket size is not documented in the checked help; if the response does not state it, record it as unknown.
- firewall rules list may include unpublished drafts. Separate published configuration from drafts; never publish or discard either during an audit.
- Firewall output can contain shared-secret header conditions. Keep actions, counts, enabled states, scope and exception purpose; discard condition values and sensitive paths. System Bypass entries describe system-mitigation exceptions, not a bypass of every custom rule.
- Alert history and alert subscriptions are different. Verify recipients/subscriptions in the browser or a documented read tool.
- Marketplace resource listings do not establish the complete inventory of Git applications, deploy hooks or other third-party access.
- Activity payloads, webhook destination URLs and integration configurations can contain sensitive material. Keep only necessary event types, aggregate counts and verified configuration flags. A missing event is not proof an action never happened.
- domains list is team-wide domain inventory and requires explicit team-wide read authorisation. Use the reader's `domains` read: it replaces domain names with synthetic aliases in the same selection step (hostnames can be sensitive) and keeps only each domain's boolean flags and the count. Only the outer shape (a `domains` list plus pagination) was verified, against a team with no domains; widen the per-domain allow-list in the reader, with tests, once a real item shape is observed. A page of 20 or 100 is not the whole inventory. Project association, certificate detail and warnings beyond the selected fields stay with the browser or owner routes.
- Certificate listing: certs list in the checked version has no JSON output option, so its table cannot be allow-listed before exposure. Treat it as unsupported unless the installed help documents a structured output that can be selected before exposure.
- Environment variables: do not run env list/ls. In the checked version its JSON output includes readable environment variable values, so selecting fields afterwards still fetches secrets. Agent hosts may switch plain commands to JSON automatically. SEC-01 stays with the connector, browser or owner routes.
- Runtime version settings and recent deploy dates do not establish deployed dependency versions, application authentication or whether a site is still used.

## Pagination and bounded collection

For every source/feed, including activity, deployments and observability, inspect the actual read-tool schemas, returned pagination metadata and installed help before collection. Discover supported windows, retention, page/finding caps, cursor fields and end-of-list semantics for that specific feed. Do not invent pagination flags or reuse one command's cursor mechanism for another. Follow only verified pagination within authorised scope, retaining pre-exposure redaction. Do not expand collection or bypass access/retention limits to obtain completeness.

Record each source/feed in the report's [Coverage limits](report-template.md#coverage-limits) block: window, product-reported total if available, received count, individually inspected count, page/finding cap, truncation, cursor availability, whether the end is known, missing sources, timeouts/failures and retries with outcomes. Count unique records where deduplication is possible and disclose overlap or uncertainty. Summary totals, received records and inspected records are different measures. Receiving 100 records is not proof of completeness, even if the request succeeded. Confirm the end from documented response semantics rather than a round number or a missing cursor field alone.

If there is no usable cursor without verified end-of-list evidence, or a partial bounded result after failure, record a coverage gap, never a negative finding about the unobserved scope (for example, no changes, incidents or deployments). Keep completeness-dependent conclusions needs_confirmation; a source never collected remains not_reviewed. Preserve useful bounded observations with their exact scope. Record each attempted retry and its outcome, or that no retry was attempted and why; do not retry indefinitely. A successful narrower retry does not fill the original window silently. Missing fields are unknown, not zero or none; raw cursor values and sensitive failure payloads need not be saved.

## Browser navigation map

Construct URLs only from team/project slugs already verified by inventory. Prefer observed navigation if the UI moves. The team base is https://vercel.com/{team_slug}.

- Team Settings > Security & Privacy: /~/settings/security.
- Team Members: /~/settings/members.
- Access Groups: use observed Settings navigation.
- Team deployment protection: /~/settings/deployment-protection.
- Security Dashboard: /~/security.
- Team Domains: /~/domains.
- Project Firewall overview: /{project_slug}/firewall.
- Project Firewall rules: /{project_slug}/firewall/rules.
- Drains (SEC-03, OPS-02): use observed team Settings navigation; drains have appeared in the settings sidebar. Destination URLs and headers can carry credentials, so select destination type, enabled state and scope only.
- Alerts (OPS-01): use observed team Settings navigation. Select subscription state and destination type, never recipient addresses or webhook URLs.
- Notifications (OPS-01): use observed team Settings navigation. Notification preferences can be per user; record whose view it is as a role alias and do not treat one person's preferences as team coverage.
- Firewall traffic, audit history, notification settings, integrations and Git controls: follow actual navigation and verify the destination before reading.

Read the [UI-state playbook](browser-evidence.md#ui-state-playbook) before interpreting controls. Use safely available live switch/input semantics such as aria-checked or checked without toggling; color alone is not proof. Candidate text such as Configure, Save, Require Separate Values or Owner count is balanced is not itself an enabled state or exact count and is not a claim about current official UI names. Role icons/+N do not enumerate scope. Bound readiness waits to verified host capabilities; at most one safe reload requires no form change and a passing privacy gate. Persistent Loading needs_confirmation; a missing control or 404 is not disabled. Follow the observed Rules view, not a guessed configuration route.

Before any browser navigation or capture, read [browser-evidence.md](browser-evidence.md) for actual-page sensitivity classification, screenshot-only constraints, per-check safe owner questions and incident handling. A Security Dashboard may include users/projects and is not blanket safe. Credential/token, sharing/bypass, environment and integration pages need the same pre-model gate as member views. Human navigation does not grant automatic model exposure.

Browser fallback has the same pre-exposure gate as CLI output. Verify that navigation, snapshots and automatic screenshots do not expose the full sensitive page before field selection. A crop after an image or body has already entered model context is too late. If safe pre-output selection is unavailable, do not automate member, credential or environment views; ask for non-sensitive aggregate metadata, label it as an owner statement, or record not_reviewed. This skill provides instructions, not a browser redaction implementation.

Screenshots are optional evidence, not a reason to capture full pages of member emails or credential settings. Crop/select safe controls before any model exposure or saving; otherwise record non-sensitive state and provenance instead. Disable network-body/HAR recording and avoid token-management pages that reveal values.

## Operation boundary

Read the complete [MCP metadata boundary](mcp-boundary.md) before connector account reads. Its explicit denylist and conditional metadata allowlist govern every candidate in the routing map. Unknown tools are denied by default pending verified input schemas and metadata-only response contracts; read-only annotations and arbitrary GETs do not establish safety. No named tool is unconditionally allowed.

Identity confirmation, scoped list/inspect/status/check metadata, bounded traffic/event aggregates and safe browser navigation are candidate operations only when their authorisation and pre-exposure gates are met. Secret-returning reads and sharing-access creation/reuse are denied even if labelled read-only. Never fetch actual account/environment values to test a collector. Current sharing/automation-bypass counts require a proven non-mutating current-metadata read; otherwise use owner dashboard metadata behind the pre-exposure gate or record a gap. Event history is never a current active count, even as an estimate, and cannot drive a current-inventory finding.

Excluded operations include deploying, staging/publishing/discarding firewall drafts, changing rules or Attack Mode, pausing mitigations, creating/revoking tokens, buying products, editing roles, pulling environment values, changing DNS and sending/posting reports. Avoid generic API calls: this skill does not need an arbitrary REST escape hatch. GET responses can reveal secrets, so the HTTP method alone is not a safety check.

## Public sources

- Plugin installation and supported tools: https://github.com/vercel/vercel-plugin
- CLI security checks: https://vercel.com/docs/cli/security
- CLI firewall reference: https://vercel.com/docs/cli/firewall
- Agent Skills format and host install paths: https://github.com/vercel-labs/skills/blob/main/docs/creating-skills.md and https://github.com/vercel-labs/skills/blob/main/docs/agents.md

The CLI help was inspected without querying a live account. Compatibility and public documentation links should be rechecked before release and during real audits.
