# Security policy

This is a community-maintained, unofficial project. It is not a Vercel product, and reports about it are not handled by Vercel.

## Reporting a vulnerability in this skill

Please report privately, not in a public issue or pull request. Use GitHub's private vulnerability reporting: open the repository's Security tab and choose "Report a vulnerability".

Useful reports include:

- A way for the bundled scripts (`scripts/cli_read.py`, `render_report.py`, `manage_report.py` or `check_report.py`) to print, save or send data outside their allow-lists, such as secret values, hostnames, names, emails or raw CLI output.
- Instructions in `SKILL.md` or `references/` that could lead an agent to change settings, deploy, contact people or expose sensitive data, contrary to the read-only boundary.
- Generated reports that could include sensitive data despite the redaction rules.

Do not include real credentials, account data or customer information in a report. Synthetic examples are enough.

This is maintained in spare time, so there is no guaranteed response time. Fixes are released on the `main` branch; there are no separately supported versions.

## Out of scope

- Vulnerabilities in Vercel's own products, the Vercel CLI or the Vercel plugin. Report those to Vercel through its official security reporting channels.
- Vulnerabilities in a host agent or browser that loads this skill.
- An agent that ignores the skill's instructions. The instructions are guidance, not an access control; account permissions are the real boundary (see README).
