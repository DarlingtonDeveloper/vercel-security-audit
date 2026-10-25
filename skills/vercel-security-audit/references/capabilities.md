# Vercel plugin, CLI and browser capabilities

## Routing

1. Prefer an existing authenticated MCP connector for supported safe account reads. Discover actual capabilities and verify schemas, response contracts, permissions, selected identity and server-side scope before invocation. Read the complete [per-check map](mcp-check-map.md); its capability descriptions are not executable tool names. Installing a plugin does not authenticate an account or make its tools read-only; names copied from reports are not safety evidence.
2. Use the authenticated Vercel CLI as a fallback, not a requirement. Inspect current help before executing an unfamiliar command. Missing CLI commands are version/capability gaps, not permission to install or upgrade software silently. A safe connector/browser route can proceed without a CLI.
3. Use an authorised browser for dashboard-only states and evidence confirmation, subject to the same pre-exposure privacy and scope gates. An isolated/remote browser, including one supplied by the host, is suitable. Use that host's login and takeover controls; agent-browser is an option, not a required tool name.
4. If no safe surface exposes a check, retain not_reviewed or needs_confirmation with the reason. Do not substitute privileged access or another person's session.

Plugin skill names currently include vercel-cli and vercel-firewall. Their guidance covers both reads and writes. Load relevant guidance for discovery, but select only inspection operations for this audit. Examples that stage, publish, edit or enable settings are not audit operations.

## Identity and scope

Start with these read-only checks after discovering the executable:

```sh
vercel whoami
vercel teams list
```

Confirm the intended team slug and approved project list with the user. Pass explicit --scope and --project flags where supported by current help. Use the CLI's existing secure authentication or the host's managed connector. Never place credential values in arguments, chat, generated examples or evidence. Do not use debug mode or generate authenticated curl commands.

A token inherits its user's role and scope; the token's presence is not proof of read-only permissions. Choose least-privilege access available for the requested checks. An Owner may need to confirm identity settings through their own browser; this does not justify obtaining their credentials.

Do not automatically run login, switch, link, pull, setup or installation commands. Normal user-completed authentication is separate from collecting evidence. Prefer explicit scope and project flags to relinking the user's workspace. Never invoke bare vercel: its default command is deploy.

## Discovery examples, not an executable collection script

These command families and flags were checked against CLI 62.7.0 help. Re-check installed help because support and retention change. All examples below are reads, but their raw output is still potentially sensitive.

```sh
vercel security check --help
vercel project ls --help
vercel firewall status --help
vercel firewall rules list --help
vercel firewall traffic list --help
vercel activity --help
```

For the following patterns, substitute a confirmed team/project identifier as a single quoted argument. Team-wide security checks, project inventory, activity --all, webhook listings and integration --all require explicit team-wide read authorisation, separately from any selected-project review. Use supported server-side project filters for a project-only scope; if a command still returns team-level findings or cannot filter, omit it or ask for broader read permission before execution. Process the result through the host's field-selection/redaction facility before exposing it to the model or saving it. Do not redirect unfiltered JSON, use tee, or record a full terminal/browser session. If safe selection cannot happen before output reaches the transcript, use selected dashboard evidence instead.

```sh
vercel security check --scope "$team_slug" --json
vercel security check --scope "$team_slug" --project "$project_id" --json
vercel project ls --scope "$team_slug" --json
vercel firewall status --scope "$team_slug" --project "$project_id" --json
vercel firewall overview --scope "$team_slug" --project "$project_id" --json
vercel firewall rules list --scope "$team_slug" --project "$project_id" --json
vercel firewall system-bypass list --scope "$team_slug" --project "$project_id" --json
vercel firewall bot-management --scope "$team_slug" --project "$project_id" --json
vercel firewall traffic list --scope "$team_slug" --project "$project_id" --since 24h --dimension action --json
vercel firewall alerts list --scope "$team_slug" --project "$project_id" --since 24h --json
vercel activity --scope "$team_slug" --all --since 7d --limit 100 --json
vercel webhooks list --scope "$team_slug" --json
vercel integration list --scope "$team_slug" --all --json
```

Important distinctions:

- security check reports product check statuses, risk, violation counts and muted findings. --findings and --limit control individual findings; use only when necessary. Exact total counts do not mean all individual findings were inspected. A successful exit code means the report was produced, not that checks passed. Map failing to an evidence-backed review candidate; passing applies only to that product check and its explicit scope. Muted means findings were suppressed or accepted, not that the underlying gap was resolved: preserve the reason and request confirmation. No access and error are unavailable evidence, never satisfactory. Inspect the actual response and pagination rather than assuming the CLI help and documentation describe the same finding cap.
- project ls defaults to a page of 20 in the checked version. Follow returned pagination with the supported --next flag; a first page is not the whole estate.
- firewall status is configuration; overview includes the last day's activity. traffic list has its own window and plan-dependent retention. Do not label an overview as 30-day traffic.
- firewall rules list may include unpublished drafts. Separate published configuration from drafts; never publish or discard either during an audit.
- Firewall output can contain shared-secret header conditions. Keep actions, counts, enabled states, scope and exception purpose; discard condition values and sensitive paths. System Bypass entries describe system-mitigation exceptions, not a bypass of every custom rule.
- Alert history and alert subscriptions are different. Verify recipients/subscriptions in the browser or a documented read tool.
- Marketplace resource listings do not establish the complete inventory of Git applications, deploy hooks or other third-party access.
- Activity payloads, webhook destination URLs and integration configurations can contain sensitive material. Keep only necessary event types, aggregate counts and verified configuration flags. A missing event is not proof an action never happened.
- Runtime version settings and recent deploy dates do not establish deployed dependency versions, application authentication or whether a site is still used.

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
- Firewall traffic, audit history, notification settings, integrations and Git controls: follow actual navigation and verify the destination before reading.

Read switch state or structured control attributes when available. Text such as Configure, Save, Require Separate Values or Owner count is balanced is not itself an enabled state or exact count. If only bounded text is available, positive-looking results need confirmation until completeness and the control state are established.

Browser fallback has the same pre-exposure gate as CLI output. Verify that navigation, snapshots and automatic screenshots do not expose the full sensitive page before field selection. A crop after an image or body has already entered model context is too late. If safe pre-output selection is unavailable, do not automate member, credential or environment views; ask for non-sensitive aggregate metadata, label it as an owner statement, or record not_reviewed. This skill provides instructions, not a browser redaction implementation.

Screenshots are optional evidence, not a reason to capture full pages of member emails or credential settings. Crop/select safe controls before any model exposure or saving; otherwise record non-sensitive state and provenance instead. Disable network-body/HAR recording and avoid token-management pages that reveal values.

## Operation boundary

Allowed operations are identity confirmation, scoped list/inspect/status/check reads, bounded traffic/event queries and browser navigation to already-authorised pages. Review the schema and response sensitivity even for a tool labelled read-only.

Excluded operations include deploying, staging/publishing/discarding firewall drafts, changing rules or Attack Mode, pausing mitigations, creating/revoking tokens, buying products, editing roles, pulling environment values, changing DNS and sending/posting reports. Avoid generic API calls: this skill does not need an arbitrary REST escape hatch. GET responses can reveal secrets, so the HTTP method alone is not a safety check.

## Public sources

- Plugin installation and supported tools: https://github.com/vercel/vercel-plugin
- CLI security checks: https://vercel.com/docs/cli/security
- CLI firewall reference: https://vercel.com/docs/cli/firewall
- Agent Skills format and host install paths: https://github.com/vercel-labs/skills/blob/main/docs/creating-skills.md and https://github.com/vercel-labs/skills/blob/main/docs/agents.md

The CLI help was inspected without querying a live account. Compatibility and public documentation links should be rechecked before release and during real audits.
