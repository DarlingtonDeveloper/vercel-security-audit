# Community report design and offline export

## Identity

Use the bundled, independently styled report. It uses Geist and Geist Mono typography but is community-maintained and unofficial. Preserve the header/footer disclosure. Do not add Vercel logos, official sign-offs, security scores or claims of certification. The official Vercel-authored design instructions at vercel.com/design.md are not the authorship instructions for this community report.

## Reading order

The [required components](report-template.md#required-components) define what every report must contain and which rules are fixed. This is the default reading order for them, not a fixed layout:

1. A short title, then the status matrix: one row per check, a Team column and one column per in-scope project, using the five status labels.
2. A short, plain-language summary with the review window and verified scope, confirmed strengths and at most three initial priorities.
3. Guided recommendations with responsible roles, prerequisites, numbered steps and completion checks.
4. Follow-up decisions and the complete technical checklist in an appendix.

Status labels distinguish Satisfactory, Action recommended, Needs confirmation, Not reviewed and Not applicable. Colour is secondary; all labels remain readable in grayscale. Unknown checks must not look like passing checks.

## Render from Markdown

Resolve the installed skill directory from the host's actual skill location, not the current project. The renderer is scripts/render_report.py inside that directory. It needs Python 3 and only the standard library.

Review the Markdown for secrets and unsupported claims first. The renderer escapes content but is not a secret scanner or evidence validator. Render only a sanitised report to a new path in a local, private output directory, not a shared or network folder:

```sh
python3 "$skill_dir/scripts/render_report.py" "$report_md" -o "$report_html"
```

The output is a single self-contained HTML file. CSS, three local WOFF2 fonts and their licence text are embedded. Opening or rendering it requires no remote images, scripts, styles, font services or analytics. External documentation links are user-activated links, not loaded assets. Links with credentials or queries are omitted, images are omitted, and raw HTML is displayed as text.

Supported Markdown is deliberately bounded: a first-line H1 title, headings, paragraphs, flat ordered/unordered lists, blockquotes, fenced code, bold/emphasis, inline code, credential-free HTTPS or same-document links, and simple pipe tables. Do not rely on raw HTML, images, nested lists or executable diagrams for essential meaning. Use the report template's flat, numbered action steps.

Pipe tables are bounded too. A table is a header row immediately followed by a separator row (`| --- |` cells, at least three hyphens, optional alignment colons that are accepted but not applied), then at least one body row. Every row starts and ends with `|` and has the header's number of cells; at most 16 columns. Write `\|` for a literal pipe inside a cell, including inside inline code. Cells support the same inline formatting as paragraphs and stay escaped; a cell holding exactly one status key, such as `needs_confirmation`, renders as that status badge. Pipe lines without a valid separator stay ordinary paragraph text. A separator or body row with the wrong number of cells, a body row that does not end with `|`, a table without a body row, or more than 16 columns stops rendering with an error rather than guessing. No cell spans, nested tables, block content or HTML inside cells.

The document language defaults to en. Use --lang fr or another valid language tag for translated report content. The template's shell/status labels remain English; full localisation is not implemented. Preserve requested-language Markdown as the source even if styled export is unsuitable.

The renderer refuses existing output files, oversized input, an absent title and unclosed code fences. It writes a new HTML file with mode 0600 where the platform supports POSIX modes. Where hard links work it stages the file and links it into place; where they do not (some network, FAT/exFAT or container mounts, and Windows) it creates the path exclusively instead, which still never replaces an existing file but can briefly show a partial file to another reader. A failed write leaves nothing at the output path. It never installs packages, launches a browser, calls a network service or uploads a report.

## Optional PDF: safe print and fallback

PDF is optional. Markdown remains the source deliverable; the generated HTML is a valid styled fallback. A headless print hang, even on a tiny page, does not establish its cause. A policy-installed extension is one possible cause, not a verified diagnosis. Do not keep retrying or wait indefinitely.

Use only an already-installed, approved browser. Do not install or download a browser, extension, driver, package, or fallback renderer for this export. Do not reuse an authenticated automation session or the default browser profile. For each attempt create a fresh temporary profile, isolated from authentication user data, and open only the generated, locally reviewed, sanitised HTML. Never import local cookies, passwords, account storage, or profile files. This isolation is different from the authenticated dashboard browser used to collect evidence.

For an approved Chromium-family browser, these are print flags, not a policy workaround:

```sh
"$approved_browser" --headless --disable-extensions \
  --user-data-dir="$fresh_temporary_profile" \
  --disable-background-networking --disable-sync --no-first-run \
  --no-default-browser-check --no-pdf-header-footer \
  --print-to-pdf="$new_private_pdf" "$sanitised_local_html_file_uri"
```

Do not run that command without a bounded process supervisor. Resolve the browser path from the host's approved installation; do not assume a binary, flag support or PDF capability. The profile must be newly created, private, and used for this attempt only, not a directory inside authentication user data. Use a new PDF path in a private directory. Do not enable remote debugging or disable the browser sandbox.

`--disable-extensions` requests that ordinary extensions not load. It does **not** bypass managed device policy and may not suppress policy-installed extensions. A fresh profile does not exempt the browser from management. Stop on a device-policy restriction. Never change managed profiles, installed extensions, registry/preferences or policies to make printing work.

Apply a finite wall-clock deadline (for example 45 seconds) using the host's approved process supervisor or Python's standard library. Scope termination to the process tree started for this attempt, never all browser processes. On timeout, terminate that owned process tree, allow at most five seconds for exit, then force-stop that same tree with another finite reap deadline. If termination cannot be confirmed, record it and stop; do not relaunch or delete a profile still in use. Remove only this attempt's temporary profile once its processes have exited. An interactive print attempt needs a deadline too: cancel and use the fallback if the dialog is unresponsive. Do not use browser virtual-time budgets as a substitute for a wall-clock deadline.

Treat timeout, nonzero exit, absent/empty PDF or a file lacking a PDF signature as export failure, not a successful report. Even a nonempty PDF with a valid signature still needs page-by-page visual inspection. Use the HTML's A4 print CSS, disable browser URL/date headers and footers, and retain the community disclosure. Do not overwrite an existing deliverable.

Fallback order:

1. If the already-approved isolated browser can open the HTML, its normal Print / Save as PDF dialog may be used within the same boundaries and deadline. Do not switch to an authenticated profile to avoid a failure.
2. An alternative already-installed, approved offline renderer or document viewer may be used only if its supported configuration enforces equivalent isolation: no JavaScript, no automatic external or arbitrary local-file asset loads, and embedded styles/fonts only. It must honour this HTML's CSP or provide equivalent restrictions. A converter that ignores CSP without equivalent controls is not suitable. Verify local font and print support first; do not assume compatibility from installation alone.
3. If those conditions cannot be established, or export still fails, deliver the Markdown and HTML. No alternative renderer is mandatory. Never upload the report to an external conversion service.

Background-network flags and document CSP are not an operating-system network sandbox. If a zero-network process is required, use only an already-approved host isolation mechanism that denies egress; otherwise skip that renderer. Do not modify device policy to create one. The structural checker below proves only the absence of automatic external asset references within the accepted document structure, not that a browser, extension, viewer or host made zero requests at runtime.

## Nonvisual structural QA

Run the bundled stdlib checker on the generated HTML before opening or printing it. It reads local files only, does not launch processes or browsers, and never writes a report, installs software, fetches links or uploads content:

```sh
python3 -B "$skill_dir/scripts/check_report.py" "$report_html"
python3 -B "$skill_dir/scripts/check_report.py" "$report_html" \
  --expected-summary "$expected_summary_json" \
  --evidence-json "$sanitised_evidence_json"
```

Both JSON arguments are optional. Exit 0 means the requested structural checks passed; exit 1 means an input/check failed, and the message names the failing rule (for example a missing appendix section, a duplicate check or mismatched expected counts) without echoing report content, keys or paths; invalid CLI arguments exit 2. Standard output on success is a JSON QA result, not an audit report. Keep that result with the private deliverables. No JSON report builder or mandatory audit schema is introduced here.

### Count comparison contract

The HTML appendix must contain each of the 24 core topic IDs and four optional topic IDs from `checklist.md` exactly once. Use a third-level heading starting `ID - Title` for each check, followed by exactly one recognised status badge produced from its `Status:` line. Keep these records in second-level sections whose headings begin `Appendix`, as in the current template. Core and optional records may share an appendix section or use separate appendix sections; IDs determine the count group. Include optional checks as `not_reviewed` when declined, with the reason. Duplicate IDs, unknown IDs, missing checks and multiple/missing/unknown statuses fail rather than being silently deduplicated. Recommendation badges, status-matrix and other table badges, and navigation text are not counted as check outcomes; a check whose only status is in a table fails as missing its status.

When structured counts are available, pass a separate `--expected-summary` file with exactly this small contract. All five keys are required in each group, including zero values; counts must be nonnegative JSON integers, not booleans. This synthetic example totals 24 core and four optional outcomes:

```json
{
  "core": {
    "satisfactory": 5,
    "action_recommended": 5,
    "needs_confirmation": 5,
    "not_reviewed": 5,
    "not_applicable": 4
  },
  "optional": {
    "satisfactory": 0,
    "action_recommended": 0,
    "needs_confirmation": 0,
    "not_reviewed": 4,
    "not_applicable": 0
  }
}
```

Prepare these expected counts independently from the approved source evidence, not by copying the checker's own counts back as an expectation. Another report builder can produce this small sidecar without adopting a new full-report schema. The checker compares every status in both groups; it does not parse prose summary totals. Manually confirm that the visible summary also agrees with this source and the emitted counts.

`--evidence-json` accepts the current template's optional single evidence object (`topic_id` and `status`, with other evidence fields allowed), or a flat JSON list of such objects. It checks each supplied ID/status against its appendix outcome, rejecting duplicates, unknown IDs and mismatches. A single example is **not** assumed to be a complete structured report. Partial inputs are explicitly labelled `matched N of 28 checks; partial source`; only all 28 distinct IDs establish full per-check evidence parity. An enclosing report-builder object such as `{"checks": [...]}` is not accepted; explicitly export the flat list or expected-summary sidecar instead. The illustrative JSON inside Markdown is code text, not automatically discovered evidence.

Without an expected-summary file, output says summary parity was not checked. Without evidence JSON, per-check evidence parity is also not checked. A partial source or successful HTML-only check must never be described as full JSON parity. If no structured source exists, compare counts and statuses manually to the Markdown and record JSON comparison as not performed.

### Status matrix comparison

The checker also compares the status matrix with the appendix, which stays the counted outcome. The matrix is every table placed directly in the report body before the first second-level section, together with the tables in that first section when it is not an appendix. Keep the core and optional matrix tables (and any tables split for width or grouped by domain) in that opening position, before the review summary. Tables later in the report, including tables inside appendix records, are neither matrix rows nor outcomes.

- Every matrix body row names exactly one checklist ID in its first cell, and every other cell holds exactly one status key (rendered as its badge) or the words Team-wide or By project. Each row needs at least one status cell.
- Each of the 28 appendix checks appears in exactly one matrix row, and optional checks sit in their own table. Missing, duplicate, unknown and mixed-group rows fail.
- A row's matrix status is its least favourable status cell, using the status order in the [report template](report-template.md#status-at-a-glance); Team-wide and By project cells are skipped. That status must equal the check's appendix outcome. A matrix better than the appendix fails, and so does a matrix worse than the appendix, because the appendix outcome must already reflect the least favourable project.

Failures name the rule, the checklist ID and, for a mismatch, the two status keys, for example `Status matrix shows a better result than the appendix. (check ID IAM-02; matrix satisfactory; appendix needs_confirmation).` No other report text is echoed. Success output includes `matrix_parity: matched all 28 checks`. The checker does not verify that Team-wide and By project are used consistently across columns; review that by hand.

### Passive document and identity checks

The checker accepts only the bundled renderer's passive HTML dialect. It checks balanced tags, unique attributes/IDs, required landmarks, the renderer's exact table shape (wrapped tables directly in the report body, one header row of column headers, body rows of the same width, no other table attributes), resolved same-document links, a deny-by-default CSP before style content, and credential-free user-activated HTTPS links. It rejects scripts (including JSON script elements), event handlers, forms, frames, objects, images, SVG, linked styles, preload/preconnect elements, refresh directives and unexpected attributes. No image or official logo asset is permitted; logo-marked markup is also rejected. Preserve the required community/unofficial header and footer disclosure, non-endorsement and non-certification statements. Do not add an official logo, official sign-off or claim of certification in text either; human review still checks identity and unsupported claims.

Embedded CSS must match the installed bundled stylesheet and the three local WOFF2 font data declarations exactly. This conservative comparison rejects added `@import`, remote `url()`, CSS escapes, substituted fonts and extra style blocks without pretending to implement a general CSS parser. Locally modified branding/styles must be reviewed and reconciled with the trusted assets before export; do not weaken the checker to accept an arbitrary document. It is not a secret scanner, evidence validator, general HTML sanitizer or independent integrity check of a modified skill installation.

A pass is structural proof within this bounded generated dialect that no automatic external asset requests are specified. It is not a runtime network measurement, visual layout check, proof that fonts actually rendered, or proof of a secure application. A deliberate documentation-link click is navigation, not an automatically loaded report asset.

## Export checks and QA record

- Confirm the title, scope, dates and visible status labels agree with the sanitised Markdown and approved evidence.
- Record separate core/optional counts for all five statuses; compare JSON if available using the contract above, and record any comparison not performed.
- Confirm every recommendation includes its steps and completion check; do not promote unknowns to passing checks.
- Preserve the required unofficial disclaimer and absence of official logos or sign-offs.
- Run structural QA for CSP, embedded styles/fonts and absence of automatic external asset references. Record runtime network observation separately as performed or not performed; structural checks alone cannot establish zero observed requests.
- If screenshots or an approved visual viewer are available, check wide/narrow layouts, overflow, clipping, grayscale readability, local font rendering, and every PDF page for orphaned headings and broken lists. Do not claim these checks based on HTML structure alone.
- If screenshots/viewer are unavailable, explicitly record `Visual QA: not performed`, the blocker, and which layout/font/PDF checks remain unverified. The checker always emits `visual_qa: not performed`; it cannot certify a later human inspection.
- Record the export method, timeout/exit result or failure, whether PDF was produced and visually inspected, and which Markdown/HTML fallback files were retained. A hung export must not block delivery of those files.
- Preserve source files and verify that existing user files were not overwritten. Keep the report private until the user approves exact content and destination.

## Assets and licences

The bundled fonts are unmodified upstream Geist assets under SIL Open Font License 1.1. See assets/fonts/SOURCES.json for their pinned source and checksums, and preserve assets/fonts/OFL.txt and LICENSE.txt. Their licence is independent of the eventual licence chosen for the skill itself. The renderer embeds the font notices in a readable, collapsed Font licences section.

The synthetic example in the repository is for layout testing, not evidence of an actual account review or proof of live host compatibility.
