# Changelog

Notable changes to the vercel-security-audit skill. There are no tagged releases yet, so entries are grouped by merge date, newest first. Numbers are GitHub issues (`issue #N`) or pull requests (`#N`).

## Unreleased

- Security check reader: documents all nine product check slugs from the CLI 65.7.0 source, maps each to a checklist ID, and adds `checklistId` to each check in the `security-check` read. Slugs not in the table are reported as `unmapped` instead of being dropped (issue #90).
- Config-intent read: now a named exception to the pre-exposure gate, which needs the owner to confirm the files contain no inline secrets. Seeing a secret stops the read under the accidental-exposure procedure (issue #80).
- Status matrix: owner-accepted checks carry a fixed `(owner-accepted)` marker in the Check cell while their status stays `needs_confirmation`. `manage_report.py` emits it, and `check_report.py` validates it and lists the marked checks in `owner_accepted_markers` (issue #80).
- Private alias legend: defines how names reach the legend without breaking the pre-exposure gate. CLI-reader `domain-N` aliases get a legend entry only from an owner-supplied mapping (issue #86).
- Docs: README and SKILL.md now agree on startup behaviour and on Python 3 being required for CLI reads. SKILL.md asks for scope once and reads the checklist once. The README file list now matches the tree, with a test guarding it, and this changelog is new (issue #82).

## 2026-10-29

Fixes from the review of the 26 October changes.

- #92: unavailable, no-access and muted security checks are never passing (issue #77).
- #93: a logged-out CLI fails fast with `not_authenticated` instead of hanging on the device-login flow (issue #78).
- #94: startup checks every linked reference, not just four (issue #91).
- #95: the security check is read once as a scoped baseline before per-check routing (issue #89).
- #96: GitHub Actions runs the test suite on every pull request and push to `main` (issue #88).
- #97: the hidden `--cli` override is removed, and errors are classified by the CLI's structured agent reason (issue #79).
- #98: a page with no pagination block returns its data with the end not reported, and page-1 failures carry coverage (issue #84).
- #99: the domains read keeps the nameservers mode and dates, and the docs stop overclaiming fields (issue #81).
- #100: HTML publishing falls back to exclusive create when hard links are unavailable (issue #85).
- #101: `check_report.py` checks that each status matrix row matches its appendix outcome (issue #87).
- #102: report times are shown in the reader's zone, and the summary time labels are clearer (issue #83).

## 2026-10-26

Changes from the guided test-run feedback (issue #27, split into issues #32 to #53).

- #31: the report helper scripts work under `python -I`, write HTML atomically and give specific diagnostics (issues #28, #29, #30).
- #54: the owner, when present, gets one batched round of questions before the first report (issue #40).
- #55: the owner's codebase is checked for intent before a setting is flagged as deliberate configuration (issue #41).
- #56: the report has required components instead of a fixed layout (issue #39).
- #57: the report opens with a status matrix (issue #38).
- #58: the report summary shows friendly local times (issue #42).
- #59: a minimum tested CLI version is stated, and a missing `security` command is recorded as a capability gap (issue #37).
- #61: a connector is recommended before falling back to the CLI or browser (issue #43).
- #62: domains are read through the allow-listed reader, while env and cert listings stay out (issue #44).
- #63: scope is asked for before references are loaded (issue #45).
- #64: `check_report.py` failures are specific, and the `Appendix` heading rule is documented (issue #46).
- #65: low-severity exposures get a proportionate incident path (issue #47).
- #66: bucketed traffic windows are recorded as returned (issue #48).
- #67: structured plan entitlement signals can support `not_applicable` (issue #49).
- #68: tabbed dashboard views are covered in the UI-state playbook (issue #50).
- #69: owner-only reports can have a private alias legend (issue #51).
- #70: Drains, Alerts and Notifications are in the browser navigation map (issue #52).
- #71: agent-directed content in docs pages is treated as data (issue #53).
- #72: the doc defines what counts as host-enforced field selection before exposure (issue #33).
- #73: the team is agreed before teams are listed (issue #35).
- #74: a bundled safe pagination helper avoids false coverage (issue #36).
- #75: security check `--json` output is mapped to statuses using the fields it actually returns (issue #34).
- #76: every CLI account read goes through the bundled allow-list reader `scripts/cli_read.py` (issue #32).

## 2026-10-25

- Initial community preview of the skill, then #14 to #26 (issues #1 to #13). These cover portable installation, MCP-first routing and the tool boundary, browser preflight and safe evidence capture, dashboard state interpretation, conflicting evidence, plan-aware assessment, explicit coverage limits, offline report QA, incremental evidence, per-check optional-scope consent and Owner confirmation questions.
