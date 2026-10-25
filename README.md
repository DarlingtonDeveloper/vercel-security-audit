# Vercel Security Audit skill

Community-maintained and unofficial. This project is not an official Vercel product and is not endorsed by Vercel.

An Agent Skills community preview for reviewing your own Vercel team's configuration through the Vercel plugin/CLI and an authenticated browser. It produces an evidence-backed, guided action plan and leaves settings unchanged.

This is an early, standalone community preview. It is not an official Vercel security certification or a continuously running monitoring service. It does not require Worldkit or employee access. Deterministic tests pass, but live host execution has not yet been evaluated.

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
- Vercel plugin read capabilities and/or an installed Vercel CLI.
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

Startup must read all four references. Missing essential references produce an installation integrity error before account reads: reinstall or recopy the complete bundle. Missing renderer/assets/fonts or export tools only disable styled HTML/PDF export; warn and retain the Markdown report, without failing the audit or installing packages. Python and a report-export browser are optional, not Markdown-only prerequisites.

### Vercel tools

Where supported, the official Vercel plugin is installed separately with:

```sh
npx plugins add vercel/vercel-plugin
```

The plugin's supported-host list and the Skills CLI's supported-agent list are different. The plugin currently lists Grok Build, but does not establish full-plugin support for every host that can load a skill. Do not assume the full plugin installer works in Eve. Use that runtime's supported Vercel tool integration or the CLI/browser path.

Installation does not authenticate your Vercel account or run an audit. Complete your host's normal authentication flow and confirm the intended team and scope before collecting evidence.

## Compatibility status

- Eve: listed by the Skills CLI as an installation target. This draft uses portable instructions and no host-specific hooks. Live execution has not been tested.
- Grok Build: listed by both the Skills CLI and Vercel plugin. Live execution has not been tested.
- Grokbot: not established by those sources. A bot runtime needs its own skill-loading, authenticated CLI/plugin, browser and approval support; the model name alone is not compatibility evidence.
- Other Agent Skills hosts: capability-dependent. Missing tools produce explicit review gaps, not fabricated findings.

## Files

- skills/vercel-security-audit/SKILL.md: scope, read-only guardrails and ordered process.
- references/capabilities.md: plugin/CLI/browser routing, read-command patterns and sensitivity warnings.
- references/checklist.md: 24 core checks and four separately authorised deeper checks.
- references/report-template.md: audience-friendly report and recommendation structure.
- references/report-design.md: community identity, offline rendering and print checks.
- skills/vercel-security-audit/scripts/render_report.py: standard-library Markdown-to-HTML renderer.
- skills/vercel-security-audit/assets/: print styles, HTML template, pinned Geist fonts and their licence notices.
- examples/security-audit.md: synthetic layout example, not a real audit.
- tests/test_skill.py, tests/test_renderer.py and tests/test_install.py: packaging, guardrail, renderer, install-location and public-content checks.
- evals/scenarios.md: behaviour cases for a future live host evaluation.

CLI command syntax was inspected using installed Vercel CLI 62.7.0 help, without reading an account. Canonical CLI security and firewall documentation was fetched successfully. This is not a live security audit or proof of end-to-end host compatibility.

## Report formatting

Markdown remains the required source. The bundled renderer adds a light, community-branded HTML report with Geist typography, clear status labels, guided recommendations and a technical appendix. It embeds the local fonts and their OFL notices, so the report does not fetch assets or use analytics.

With Python 3 installed, preview the synthetic example from the repository root:

```sh
python3 skills/vercel-security-audit/scripts/render_report.py examples/security-audit.md -o example-report.html
```

The output path must be new. Open the HTML locally and, if needed, use an installed browser's print-to-PDF function. No Vercel logo, official endorsement, account access or external conversion service is involved. See the skill's references/report-design.md for limitations and export checks. Font licensing is documented in skills/vercel-security-audit/assets/fonts/README.md; the fonts retain their separate OFL licence.

## Validate

```sh
python3 -m unittest discover -s tests -v
```

These deterministic tests check packaging and content constraints. They do not execute an agent, authenticate a browser, query Vercel or prove behavioural compliance.

## Licence

The skill, documentation and renderer are licensed under [MIT](LICENSE). The bundled Geist fonts are licensed separately under SIL OFL 1.1; their original notices and pinned provenance are retained in skills/vercel-security-audit/assets/fonts/.

## Public sources

- https://github.com/vercel/vercel-plugin
- https://github.com/vercel-labs/skills/blob/main/docs/creating-skills.md
- https://github.com/vercel-labs/skills/blob/main/docs/agents.md
- https://vercel.com/docs/cli/security
- https://vercel.com/docs/cli/firewall
