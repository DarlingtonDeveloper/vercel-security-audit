# Community report design and offline export

## Identity

Use the bundled, independently styled report. It uses Geist and Geist Mono typography but is community-maintained and unofficial. Preserve the header/footer disclosure. Do not add Vercel logos, official sign-offs, security scores or claims of certification. The official Vercel-authored design instructions at vercel.com/design.md are not the authorship instructions for this community report.

## Reading order

1. A short title, review window and verified scope.
2. A balanced summary, confirmed strengths and at most three initial priorities.
3. Guided recommendations with responsible roles, prerequisites, numbered steps and completion checks.
4. Follow-up decisions and the complete technical checklist in an appendix.

Status labels distinguish Satisfactory, Action recommended, Needs confirmation, Not reviewed and Not applicable. Colour is secondary; all labels remain readable in grayscale. Unknown checks must not look like passing checks.

## Render from Markdown

Resolve the installed skill directory from the host's actual skill location, not the current project. The renderer is scripts/render_report.py inside that directory. It needs Python 3 and only the standard library.

Review the Markdown for secrets and unsupported claims first. The renderer escapes content but is not a secret scanner or evidence validator. Render only a sanitised report to a new path in a private output directory:

```sh
python3 "$skill_dir/scripts/render_report.py" "$report_md" -o "$report_html"
```

The output is a single self-contained HTML file. CSS, three local WOFF2 fonts and their licence text are embedded. Opening or rendering it requires no remote images, scripts, styles, font services or analytics. External documentation links are user-activated links, not loaded assets. Links with credentials or queries are omitted, images are omitted, and raw HTML is displayed as text.

Supported Markdown is deliberately bounded: a first-line H1 title, headings, paragraphs, flat ordered/unordered lists, blockquotes, fenced code, bold/emphasis, inline code and credential-free HTTPS or same-document links. Do not rely on raw HTML, images, tables, nested lists or executable diagrams for essential meaning. Use the report template's flat, numbered action steps.

The document language defaults to en. Use --lang fr or another valid language tag for translated report content. The template's shell/status labels remain English; full localisation is not implemented. Preserve requested-language Markdown as the source even if styled export is unsuitable.

The renderer refuses existing output files, oversized input, an absent title and unclosed code fences. It writes a new HTML file with mode 0600. It never installs packages, launches a browser, calls a network service or uploads a report.

## Optional PDF

Open the reviewed HTML in an already-installed isolated browser or a host-provided document viewer. Use its print-to-PDF capability, if available. Use the HTML's A4 print CSS, disable browser URL/date headers and footers, and retain the community disclosure. A renderer that adds a Vercel logo or official footer is unsuitable for this community output.

Never upload the document to an external conversion service. Do not grant account browser credentials to a report-rendering process. If PDF export is unavailable, provide the Markdown and HTML; a PDF is not required for skill completion.

## Export checks

- Confirm the title, scope, dates and status labels agree with the Markdown.
- Check wide and narrow layouts for horizontal overflow and clipped text.
- Confirm every recommendation includes its steps and completion check.
- Inspect every PDF page for orphaned headings, broken lists and clipped content.
- Confirm fonts load locally and the page makes no automatic network requests.
- Preserve the source and verify that existing user files were not overwritten.
- Keep the report private until the user approves exact content and destination.

## Assets and licences

The bundled fonts are unmodified upstream Geist assets under SIL Open Font License 1.1. See assets/fonts/SOURCES.json for their pinned source and checksums, and preserve assets/fonts/OFL.txt and LICENSE.txt. Their licence is independent of the eventual licence chosen for the skill itself. The renderer embeds the font notices in a readable, collapsed Font licences section.

The synthetic example in the repository is for layout testing, not evidence of an actual account review or proof of live host compatibility.
