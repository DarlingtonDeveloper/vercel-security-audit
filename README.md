# Vercel Security Audit skill

An Agent Skill for reviewing your own Vercel team's configuration through the Vercel plugin/CLI and an authenticated browser. It produces an evidence-backed, guided action plan and leaves settings unchanged.

It is a point-in-time configuration review, not a security certification or a continuously running monitoring service. It does not require any Vercel employee access.

## How it works

1. Confirm your account, authorised team, projects and review scope.
2. Discover installed Vercel plugin read tools and CLI support.
3. Run supported product security checks and scoped inventory reads.
4. Use the browser to confirm dashboard-only settings, subscriptions and evidence gaps.
5. Record all 24 core checklist results across eight domains, plus separately authorised deeper checks.
6. Produce security-audit.md and, where supported, sanitised security-audit.json. An installed PDF renderer is optional.
7. Stop for human review. Changes and report delivery are separate actions.

The public CLI already has security check and detailed firewall inspection commands. The skill adds review discipline, coverage tracking and customer-friendly instructions rather than replacing those product checks.

## Required capabilities

- A host that loads standard SKILL.md instructions and reference files.
- Your normal, authorised Vercel account access.
- Vercel plugin read capabilities and/or an installed Vercel CLI. Minimum tested CLI version: 62.7.0 (help checked) and 65.0.0 (guided test run). Specific output shapes were also checked against CLI 65.3.1, and the security check slug list against the CLI 65.7.0 package source, without a further guided run. Updating to the latest CLI before an audit is recommended, not required. Older CLIs can lack the `security` command entirely (54.18.0 does); the skill then records that check as a capability gap with an "upgrade the CLI" note rather than guessing equivalent commands.
- Node.js 22+ (standard library only) for any CLI-based audit, because every CLI account read goes through the bundled reader `scripts/cli-read.mjs`, and for styled HTML export. It is optional only for audits that use an MCP connector, the plugin or the browser alone and produce a Markdown report.
- Browser tools for dashboard-only evidence and human authentication handoff.
- File writing for saved reports, or a conversation-only fallback.

Use an isolated browser supplied by the host when possible. This skill does not need desktop control. Runtime permissions and account roles enforce access; skill instructions alone are not a security boundary.

The Vercel plugin has workflows that write configuration. This audit uses only their verified read subset. It never stages firewall drafts, applies even Log-mode rules, deploys, changes roles, retrieves environment values or sends reports.

## Install

### Project install

Run from the project where you want to use the skill. Without --global, the Skills CLI installs at project scope:

```sh
npx skills add DarlingtonDeveloper/vercel-security-audit --skill vercel-security-audit
```

For an agent-specific install, select the host with --agent (or -a). For example, Eve:

```sh
npx skills add DarlingtonDeveloper/vercel-security-audit --skill vercel-security-audit --agent eve
```

The Skills CLI lists Eve's project location as agent/skills. For Grok Build, the supported agent identifier is grok. Follow each host's instructions for connecting CLI credentials and browser tools.

### Global install

Use --global (or -g) for a user-level install available across projects in supported hosts:

```sh
npx skills add DarlingtonDeveloper/vercel-security-audit --skill vercel-security-audit --global
```

Global scope and agent selection are separate options. For example, target Grok Build globally:

```sh
npx skills add DarlingtonDeveloper/vercel-security-audit --skill vercel-security-audit --global --agent grok
```

The inspected Skills CLI source does not support global installs for Eve; use its project install instead. Global locations vary by host, so use the installer's reported location rather than guessing a loader path.

To list available skills without installing a skill:

```sh
npx skills add DarlingtonDeveloper/vercel-security-audit --list
```

These flags and agent limitations were verified against public Skills CLI [help source](https://github.com/vercel-labs/skills/blob/a80e4c9d12d607631249d4d7d059f835d4b2f13a/src/cli.ts#L174-L183), [option parsing](https://github.com/vercel-labs/skills/blob/a80e4c9d12d607631249d4d7d059f835d4b2f13a/src/add.ts#L2585-L2604) and [agent definitions](https://github.com/vercel-labs/skills/blob/a80e4c9d12d607631249d4d7d059f835d4b2f13a/src/agents.ts#L320-L331). No installer was run to verify them. Running an npx example yourself may download the CLI if it is not cached.

### Manual central agent-library install

For a host-managed central library, copy the complete skills/vercel-security-audit/ directory from a checkout of this repository, not just SKILL.md. Keep references/, scripts/ and assets/ (including assets/fonts/ and its licence/provenance files) beside SKILL.md with their relative layout unchanged. The Skills CLI's [directory installer](https://github.com/vercel-labs/skills/blob/a80e4c9d12d607631249d4d7d059f835d4b2f13a/src/installer.ts#L517-L549) also copies the skill directory recursively.

From the repository root, replace the placeholder below with your host-configured skill-library directory. It is not a universal loader path. The copy runs only if the destination does not already exist; review an existing install separately rather than merging or overwriting it:

```sh
skill_library="/absolute/path/to/your/host-configured-skill-library"
mkdir -p "$skill_library"
test ! -e "$skill_library/vercel-security-audit" &&
  cp -R skills/vercel-security-audit "$skill_library/vercel-security-audit"
```

Use the host's documented library registration/reload procedure, then confirm it loads that directory's SKILL.md and can read its sibling helpers. A directory elsewhere on disk is not automatically discovered by every host. Resolve helper paths from the installed skill directory (following any host-created symlink), never from the audit project's working directory.

At startup the skill confirms that every essential reference (all ten in `references/`, the ones the process links to) is present and readable, but does not read them yet: it asks for scope first and reads each reference in full at the step that needs it. Missing essential references produce an installation integrity error before account reads: reinstall or recopy the complete bundle. When the CLI route is used, Node.js and `scripts/cli-read.mjs` are checked before the first CLI account read; without them CLI reads are unavailable and the affected checks go to other routes or are recorded as gaps. Missing renderer/assets/fonts or export tools only disable styled HTML/PDF export; warn and retain the Markdown report, without failing the audit or installing packages. A report-export browser is always optional.

### Vercel tools

Where supported, the official Vercel plugin is installed separately with:

```sh
npx plugins add vercel/vercel-plugin
```

The plugin's supported-host list and the Skills CLI's supported-agent list are different. The plugin currently lists Grok Build, but does not establish full-plugin support for every host that can load a skill. Do not assume the full plugin installer works in Eve. Use that runtime's supported Vercel tool integration or the CLI/browser path.

Installation does not authenticate your Vercel account or run an audit. Complete your host's normal authentication flow and confirm the intended team and scope before collecting evidence.

## Compatibility status

- Eve: listed by the Skills CLI as an installation target. The skill uses portable instructions and no host-specific hooks.
- Grok Build: listed by both the Skills CLI and Vercel plugin.
- Grokbot: not established by those sources. A bot runtime needs its own skill-loading, authenticated CLI/plugin, browser and approval support; the model name alone is not compatibility evidence.
- Other Agent Skills hosts: capability-dependent. Missing tools produce explicit review gaps, not fabricated findings.

## Files

Generated from `git ls-files skills`; `tests/skill.test.mjs` fails if a file under `skills/vercel-security-audit/` is missing from this list.

The installed skill:

- skills/vercel-security-audit/SKILL.md: scope, read-only guardrails, startup integrity check and ordered process.
- skills/vercel-security-audit/references/capabilities.md: connector/CLI/browser routing, the field-selection gate, bundled reader reads, product check slugs and sensitivity warnings.
- skills/vercel-security-audit/references/checklist.md: 24 core checks and four separately authorised deeper checks.
- skills/vercel-security-audit/references/collection-plan.md: preflight and per-check collection plan.
- skills/vercel-security-audit/references/mcp-check-map.md: per-check MCP-first routing map with CLI and browser fallbacks.
- skills/vercel-security-audit/references/mcp-boundary.md: MCP tool denylist and conditional metadata allowlist.
- skills/vercel-security-audit/references/browser-evidence.md: pre-model browser gate, UI-state playbook, safe owner questions, inline owner round and accidental-exposure procedure.
- skills/vercel-security-audit/references/evidence-assessment.md: status assignment, conflicting evidence, plan entitlements and owner acceptance.
- skills/vercel-security-audit/references/report-model.md: optional versioned JSON report model for `manage-report.mjs`.
- skills/vercel-security-audit/references/report-template.md: required report components and an example layout.
- skills/vercel-security-audit/references/report-design.md: report identity, offline rendering, structural QA and print checks.
- skills/vercel-security-audit/scripts/cli-read.mjs: standard-library reader that runs one documented Vercel CLI read and prints only allow-listed fields. Every CLI account read goes through it.
- skills/vercel-security-audit/scripts/render-report.mjs: standard-library Markdown-to-HTML renderer.
- skills/vercel-security-audit/scripts/check-report.mjs: read-only structural QA for rendered HTML (counts, status matrix parity, passive HTML).
- skills/vercel-security-audit/scripts/manage-report.mjs: optional JSON report model: validate, append evidence to a new revision and build Markdown or HTML.
- skills/vercel-security-audit/assets/report.html and skills/vercel-security-audit/assets/report.css: HTML template and print styles.
- skills/vercel-security-audit/assets/fonts/Geist-Regular.woff2, skills/vercel-security-audit/assets/fonts/Geist-SemiBold.woff2 and skills/vercel-security-audit/assets/fonts/GeistMono-Regular.woff2: pinned Geist fonts.
- skills/vercel-security-audit/assets/fonts/OFL.txt, skills/vercel-security-audit/assets/fonts/LICENSE.txt, skills/vercel-security-audit/assets/fonts/README.md and skills/vercel-security-audit/assets/fonts/SOURCES.json: font licence notices and pinned provenance.

Repository only, not installed with the skill:

- examples/security-audit.md: synthetic layout example, not a real audit.
- evals/scenarios.md: behaviour scenarios for evaluating the skill in a host.
- tests/: offline, standard-library Node.js tests (`*.test.mjs`, run with the built-in `node:test` runner), grouped roughly as packaging and install (`skill.test.mjs`, `install.test.mjs`, `isolated-mode.test.mjs`, `scope-first.test.mjs`, `team-first.test.mjs`, `cli-version.test.mjs`), the CLI reader and routing (`cli-reader.test.mjs`, `safe-pagination.test.mjs`, `security-check-mapping.test.mjs`, `domain-cli-reads.test.mjs`, `selection-gate.test.mjs`, `tool-routing.test.mjs`, `connector-recommendation.test.mjs`, `mcp-boundary.test.mjs`, `traffic-buckets.test.mjs`), browser and evidence policy (`browser-preflight.test.mjs`, `browser-privacy.test.mjs`, `browser-states.test.mjs`, `tabbed-views.test.mjs`, `navigation-map.test.mjs`, `evidence-policy.test.mjs`, `plan-awareness.test.mjs`, `plan-signals.test.mjs`, `incident-tiers.test.mjs`, `docs-agent-content.test.mjs`, `coverage-limits.test.mjs`, `optional-scope.test.mjs`, `owner-confirmations.test.mjs`, `inline-owner-round.test.mjs`, `deliberate-configuration.test.mjs`), and reports (`renderer.test.mjs`, `report-model.test.mjs`, `report-components.test.mjs`, `report-governance.test.mjs`, `report-qa.test.mjs`, `report-qa-diagnostics.test.mjs`, `diagnostics.test.mjs`, `matrix-parity.test.mjs`, `friendly-times.test.mjs`, `alias-legend.test.mjs`). `report-model-fixtures.mjs` holds shared fixtures for the report model tests.
- .github/workflows/tests.yml: runs the tests in GitHub Actions.
- CHANGELOG.md: release notes.
- SECURITY.md: how to report a vulnerability in this skill privately.

CLI command syntax was inspected using installed Vercel CLI 62.7.0 help, without reading an account; later CLI versions were checked only where the references name them. Canonical CLI security and firewall documentation was fetched successfully. This is not a live security audit or proof of end-to-end host compatibility.

## Report formatting

Markdown remains the required source. The bundled renderer adds a light, styled HTML report with Geist typography, clear status labels, guided recommendations and a technical appendix. It embeds the local fonts and their OFL notices, so the report does not fetch assets or use analytics.

With Node.js 22+ installed, preview the synthetic example from the repository root:

```sh
node skills/vercel-security-audit/scripts/render-report.mjs examples/security-audit.md -o example-report.html
```

The output path must be new. Open the HTML locally and, if needed, use an installed browser's print-to-PDF function. No logo, account access or external conversion service is involved. See the skill's references/report-design.md for limitations and export checks. Font licensing is documented in skills/vercel-security-audit/assets/fonts/README.md; the fonts retain their separate OFL licence.

## Validate

```sh
node --test 'tests/*.test.mjs'
```

The tests need only the Node.js standard library; the oldest supported version is Node.js 22. GitHub Actions runs the same suite on every pull request and push to `main` (`.github/workflows/tests.yml`), on Node.js 22, 24 and 26, with read-only permissions and no secrets. Windows is not in the matrix yet: the reader's tests use POSIX fake executables. HTML publishing falls back to exclusive create where hard links are unavailable (#85), but that has not been run on Windows in CI.

One check, that the skill mentions no internal Vercel names, reads a maintainer-only list from `tests/private-markers.txt` (one name per line; gitignored, never committed). Without that file the check is skipped, so it runs locally for the maintainer and not in CI.

These deterministic tests check packaging and content constraints. They do not execute an agent, authenticate a browser, query Vercel or prove behavioural compliance.

## Licence

The skill, documentation and renderer are licensed under [MIT](LICENSE). The bundled Geist fonts are licensed separately under SIL OFL 1.1; their original notices and pinned provenance are retained in skills/vercel-security-audit/assets/fonts/.

## Public sources

- https://github.com/vercel/vercel-plugin
- https://github.com/vercel-labs/skills/blob/main/docs/creating-skills.md
- https://github.com/vercel-labs/skills/blob/main/docs/agents.md
- https://vercel.com/docs/cli/security
- https://vercel.com/docs/cli/firewall
