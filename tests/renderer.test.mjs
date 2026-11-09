// Deterministic, stdlib-only checks of the offline renderer and local CLI (ported from tests/test_renderer.py).
//
// All report content is synthetic. No browser, network service, account, or Git
// command is used. Child processes are restricted to running the local renderer CLI.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as RENDERER from "../skills/vercel-security-audit/scripts/render-report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = path.join(ROOT, "skills", "vercel-security-audit");
const SCRIPT = path.join(SKILL_DIR, "scripts", "render-report.mjs");
const ASSETS = path.join(SKILL_DIR, "assets");

const STATUS_LABELS = {
  satisfactory: "Satisfactory",
  action_recommended: "Action recommended",
  needs_confirmation: "Needs confirmation",
  not_reviewed: "Not reviewed",
  not_applicable: "Not applicable",
};

// ---- Minimal HTML parser mirroring the Python test's HTMLParser tree ---------------

class Element {
  // Minimal parsed tree; text is decoded by the parser, never regex-stripped.
  constructor(tag, attrs = [], parent = null) {
    this.tag = tag;
    this.attrs = Object.fromEntries(attrs);
    this.attributeNames = attrs.map(([name]) => name);
    this.parent = parent;
    this.children = [];
  }

  get text() {
    return this.children.map((child) => (typeof child === "string" ? child : child.text)).join("");
  }

  find(tag = null, cssClass = null) {
    const found = [];
    for (const child of this.children) {
      if (child instanceof Element) {
        if ((tag === null || child.tag === tag)
            && (cssClass === null || (child.attrs.class || "").split(/\s+/).includes(cssClass))) {
          found.push(child);
        }
        found.push(...child.find(tag, cssClass));
      }
    }
    return found;
  }
}

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\xa0" };

function unescape(text) {
  return text.replace(/&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[A-Za-z][A-Za-z0-9]*;?)/g, (whole, body) => {
    if (body[0] === "#") {
      const digits = body.replace(/;$/, "");
      const code = digits[1] === "x" || digits[1] === "X" ? parseInt(digits.slice(2), 16) : parseInt(digits.slice(1), 10);
      return String.fromCodePoint(code);
    }
    const name = body.replace(/;$/, "");
    return Object.hasOwn(NAMED, name) ? NAMED[name] : whole;
  });
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img",
  "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW_TEXT = new Set(["script", "style"]);
const ESCAPABLE_RAW_TEXT = new Set(["title", "textarea"]);

class ParsedHTML {
  constructor(document) {
    this.root = new Element("document");
    this.stack = [this.root];
    this.errors = [];
    this.declarations = [];
    this.feed(document);
    if (this.stack.length !== 1) {
      this.errors.push("Unclosed tags: " + JSON.stringify(this.stack.slice(1).map((e) => e.tag)));
    }
  }

  feed(text) {
    let index = 0;
    const data = (value) => {
      if (value) this.stack[this.stack.length - 1].children.push(value);
    };
    while (index < text.length) {
      const open = text.indexOf("<", index);
      if (open < 0) {
        data(unescape(text.slice(index)));
        break;
      }
      data(unescape(text.slice(index, open)));
      index = open;
      if (text.startsWith("<!--", index)) {
        const end = text.indexOf("-->", index + 4);
        index = end < 0 ? text.length : end + 3;
      } else if (text.startsWith("<!", index)) {
        const end = text.indexOf(">", index);
        this.declarations.push(text.slice(index + 2, end).toLowerCase());
        index = end + 1;
      } else if (/^<\/[a-zA-Z]/.test(text.slice(index, index + 3))) {
        const end = text.indexOf(">", index);
        this.endTag(text.slice(index + 2, end).trim().toLowerCase());
        index = end + 1;
      } else if (/^<[a-zA-Z]/.test(text.slice(index, index + 2))) {
        index = this.startTag(text, index);
      } else {
        data("<");
        index += 1;
      }
    }
  }

  startTag(text, start) {
    const name = /^<([a-zA-Z][^\s/>]*)/.exec(text.slice(start))[1].toLowerCase();
    let index = start + 1 + name.length;
    const attrs = [];
    let selfClosing = false;
    for (;;) {
      while (/\s/.test(text[index])) index += 1;
      if (text[index] === ">") { index += 1; break; }
      if (text.startsWith("/>", index)) { selfClosing = true; index += 2; break; }
      if (text[index] === "/") { index += 1; continue; }
      const attrName = /^[^\s/>=]+/.exec(text.slice(index))[0];
      index += attrName.length;
      while (/\s/.test(text[index])) index += 1;
      let value = null;
      if (text[index] === "=") {
        index += 1;
        while (/\s/.test(text[index])) index += 1;
        const quote = text[index];
        if (quote === '"' || quote === "'") {
          const end = text.indexOf(quote, index + 1);
          value = text.slice(index + 1, end);
          index = end + 1;
        } else {
          value = /^[^\s>]*/.exec(text.slice(index))[0];
          index += value.length;
        }
        value = unescape(value);
      }
      attrs.push([attrName.toLowerCase(), value]);
    }
    const parent = this.stack[this.stack.length - 1];
    const element = new Element(name, attrs, parent);
    parent.children.push(element);
    if (selfClosing) {
      if (!VOID.has(name)) {
        this.stack.push(element);
        this.endTag(name);
      }
      return index;
    }
    if (!VOID.has(name)) this.stack.push(element);
    if (RAW_TEXT.has(name) || ESCAPABLE_RAW_TEXT.has(name)) {
      const close = new RegExp("</" + name + "\\s*>", "i").exec(text.slice(index));
      const end = close ? index + close.index : text.length;
      const raw = text.slice(index, end);
      if (raw) element.children.push(ESCAPABLE_RAW_TEXT.has(name) ? unescape(raw) : raw);
      if (close) {
        this.endTag(name);
        return end + close[0].length;
      }
      return text.length;
    }
    return index;
  }

  endTag(tag) {
    if (this.stack.length === 1 || this.stack[this.stack.length - 1].tag !== tag) {
      this.errors.push("Unexpected closing tag: " + tag);
    } else {
      this.stack.pop();
    }
  }

  find(tag = null, cssClass = null) {
    return this.root.find(tag, cssClass);
  }
}

// ---- Helpers --------------------------------------------------------------------------------

const DEFAULT_SOURCE = "# Synthetic review\n\n## Summary\nSafe text.";

/** Temporarily replace obj[name]; returns a restore function. */
function patch(object, name, value) {
  const had = Object.hasOwn(object, name);
  const original = object[name];
  if (value === undefined) delete object[name];
  else object[name] = value;
  return () => {
    if (had) object[name] = original;
    else delete object[name];
  };
}

function withPatches(patches, body) {
  const restores = [];
  try {
    for (const [object, name, value] of patches) restores.push(patch(object, name, value));
    return body();
  } finally {
    for (const restore of restores.reverse()) restore();
  }
}

function osError(code, message, syscall = "link") {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.errno = -os.constants.errno[code];
  error.syscall = syscall;
  return error;
}

function render(source = DEFAULT_SOURCE, options = {}) {
  // Deny even attempted DNS, connections, shell commands, and child processes.
  const targets = [
    [net, "Socket"], [net, "connect"], [net, "createConnection"], [dns, "lookup"],
    [childProcess, "spawn"], [childProcess, "spawnSync"], [childProcess, "exec"],
    [childProcess, "execSync"], [childProcess, "execFile"], [childProcess, "execFileSync"],
    [childProcess, "fork"],
  ];
  const calls = [];
  const guards = targets.map(([object, name]) => [object, name, (...args) => {
    calls.push(name);
    void args;
    throw new Error("Forbidden renderer I/O: " + name);
  }]);
  const document = withPatches(guards, () => ("language" in options
    ? RENDERER.renderReport(source, options.language)
    : RENDERER.renderReport(source)));
  assert.deepEqual(calls, []);
  assert.equal(typeof document, "string");
  return document;
}

function parse(document) {
  const parsed = new ParsedHTML(document);
  assert.deepEqual(parsed.errors, [], "HTML must have balanced, explicit nesting");
  assert.deepEqual(parsed.declarations, ["doctype html"]);
  assert.equal(parsed.find("html").length, 1);
  assert.equal(parsed.find("head").length, 1);
  assert.equal(parsed.find("body").length, 1);
  assert.equal(parsed.find("main").length, 1);
  return parsed;
}

const ALLOWED = new Set([
  "html", "head", "meta", "title", "style", "body", "div", "header",
  "p", "span", "h1", "h2", "h3", "h4", "h5", "h6", "aside", "main",
  "ul", "ol", "li", "a", "section", "article", "blockquote", "pre",
  "code", "strong", "em", "hr", "br", "footer", "details", "summary",
  "table", "thead", "tbody", "tr", "th", "td",
]);
const FORBIDDEN_ATTRIBUTES = new Set(["src", "srcset", "srcdoc", "action", "formaction",
  "poster", "data", "style", "background", "ping"]);

function assertPassive(parsed) {
  for (const element of parsed.find()) {
    assert.ok(ALLOWED.has(element.tag), element.tag);
    assert.equal(element.attributeNames.length, new Set(element.attributeNames).size);
    for (const name of Object.keys(element.attrs)) {
      assert.ok(!name.startsWith("on"), `${element.tag} ${name}`);
      assert.ok(!FORBIDDEN_ATTRIBUTES.has(name), name);
      if (name === "href") assert.equal(element.tag, "a");
    }
    if (element.tag === "meta") {
      assert.notEqual((element.attrs["http-equiv"] || "").toLowerCase(), "refresh");
    }
  }
  assert.equal(parsed.find("style").length, 1);
}

function assertNavigationResolves(parsed) {
  const identifiers = parsed.find().filter((e) => "id" in e.attrs).map((e) => e.attrs.id);
  assert.equal(identifiers.length, new Set(identifiers).size, "HTML IDs must be unique");
  const sections = parsed.find("section");
  const navigation = parsed.find("aside", "report-nav");
  assert.equal(navigation.length, 1);
  const links = navigation[0].find("a");
  assert.deepEqual(links.map((e) => e.attrs.href), sections.map((s) => "#" + s.attrs.id));
  for (const link of links) {
    assert.equal(identifiers.filter((id) => id === link.attrs.href.slice(1)).length, 1);
  }
}

function counter(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function words(text) {
  return RENDERER.pyStrip(text).split(new RegExp(`[${RENDERER.PY_WS}]+`));
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "renderer-test-"));
}

function mode(file) {
  return fs.statSync(file).mode & 0o777;
}

function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function stagingFiles(directory) {
  return fs.readdirSync(directory).filter((name) => name.startsWith(".report-"));
}

const NO_SCORE = /security score|\p{Nd}+\/100|\p{Nd}+%/iu;

// ---- RendererHTMLTests ----------------------------------------------------------------------

describe("RendererHTMLTests", () => {
  test("string_api_is_deterministic_self_contained_and_offline", () => {
    const source = "# Revue café — 安全\n\n## Résumé\n[Docs](https://example.test/docs)";
    const document = render(source);
    assert.equal(document, render(source));
    const parsed = parse(document);
    assertPassive(parsed);
    assert.equal(parsed.find("html")[0].attrs.lang, "en");
    assert.equal(parsed.find("h1")[0].text, "Revue café — 安全");
    assertNavigationResolves(parsed);
    assert.ok(parsed.find("header")[0].text.includes("Read-only configuration review"));
    assert.ok(parsed.find("footer")[0].text.includes("does not certify security or compliance"));
    assert.equal(parsed.find("a").length, 2); // One nav and one user-activated link.
  });

  test("first_line_h1_is_required", () => {
    for (const source of ["", "\n# Title", "Text\n# Title", "## Title", "# ", "#\tTitle"]) {
      assert.throws(() => render(source), RENDERER.ReportError, JSON.stringify(source));
    }
  });

  test("only_first_h1_becomes_document_title", () => {
    const parsed = parse(render("# First & <title>\n\n# Later heading\nBody."));
    assert.deepEqual(parsed.find("h1").map((e) => e.text), ["First & <title>"]);
    assert.deepEqual(parsed.find("title").map((e) => e.text), ["First & <title>"]);
    assert.deepEqual(parsed.find("h2").map((e) => e.text), ["Later heading"]);
    assertNavigationResolves(parsed);
  });

  test("title_length_boundary", () => {
    const parsed = parse(render("# " + "é".repeat(240)));
    assert.equal(parsed.find("h1")[0].text, "é".repeat(240));
    assert.throws(() => render("# " + "é".repeat(241)), RENDERER.ReportError);
  });

  test("raw_html_and_event_handlers_are_text_not_elements", () => {
    const payload = '<script>alert("synthetic")</script> '
      + '<img src="https://example.test/pixel" onerror="alert(1)"> '
      + '<a href="javascript:alert(1)" onclick="alert(2)">click</a> '
      + '<iframe srcdoc="unsafe"></iframe><form action="/send"></form>';
    const parsed = parse(render("# <b>Title</b> & safety\n\n## Content\n" + payload));
    assertPassive(parsed);
    const main = parsed.find("main")[0];
    assert.ok(main.text.includes(payload));
    assert.deepEqual(main.find("a"), []);
    assert.equal(parsed.find("h1")[0].text, "<b>Title</b> & safety");
  });

  test("script_and_css_breakouts_stay_literal_in_all_source_contexts", () => {
    const payload = "</style><script>window.synthetic=1</script>"
      + "<style>@import url(https://example.test/remote.css);</style>";
    const source = "# " + payload + "\n\n## " + payload + "\n\n" + payload
      + "\n\n`" + payload + "`\n\n```html\n" + payload + "\n```\n";
    const parsed = parse(render(source));
    assertPassive(parsed);
    assert.ok(!parsed.find("style")[0].text.includes(payload));
    assert.equal(parsed.find("title")[0].text, payload);
    assert.ok(parsed.find("main")[0].text.includes(payload));
    assert.equal(parsed.find("main")[0].find("pre")[0].text, payload);
  });

  test("template_placeholders_in_source_are_single_pass_literal_text", () => {
    const literal = "{{LANG}} {{TITLE}} {{STYLE}} {{NAV}} {{BODY}} {{FONT_LICENCE}}";
    const source = "# " + literal + "\n\n## " + literal + "\n\n" + literal + " <script>no()</script>";
    const parsed = parse(render(source, { language: "fr" }));
    assertPassive(parsed);
    assert.equal(parsed.find("html")[0].attrs.lang, "fr");
    assert.equal(parsed.find("title")[0].text, literal);
    assert.equal(parsed.find("h1")[0].text, literal);
    assert.equal(parsed.find("h2")[0].text, literal);
    assert.equal(parsed.find("aside")[0].find("a")[0].text, literal);
    assert.ok(parsed.find("main")[0].text.includes(literal + " <script>no()</script>"));
  });

  test("markdown_images_are_omitted_not_loaded", () => {
    const source = "# Images\n\n## Content\n"
      + "![Remote](https://example.test/pixel)\n"
      + "![Local](file:///tmp/synthetic.png)\n"
      + "![Inline](data:image/png;base64,AAAA)";
    const parsed = parse(render(source));
    assertPassive(parsed);
    const omitted = parsed.find("span", "omitted-image");
    assert.equal(omitted.length, 3);
    assert.deepEqual(omitted.map((e) => e.text), Array(3).fill("[Image omitted from offline report]"));
    assert.ok(!parsed.find("main")[0].text.includes("example.test/pixel"));
    assert.deepEqual(parsed.find("img"), []);
  });

  test("unsafe_url_forms_never_become_links", () => {
    const unsafe = [
      "http://example.test/docs", "javascript:alert", "JaVaScRiPt:alert",
      "data:text/html,unsafe", "file:///tmp/synthetic", "//example.test/docs",
      "/relative", "docs/page", "https://user:password@example.test/docs",
      "https://user@example.test/docs", "https://example.test/docs?token=synthetic",
      "https://example.test/docs?token=synthetic#anchor", "https://example.test:444/docs",
      "https://example.test:invalid/docs", "https://[invalid/docs",
      "https://example.test/space here", "https://example.test/\ttab",
      "https://example.test/\x7fcontrol", "https://example.test/back\\slash",
      "https://example.test/%40hidden", "https://example.test/%3Fquery",
      "https://example.test/%0Anewline", "https://example.test/%20space",
      "https://example.test/%3Astructure", "https://example.test/%5Cslash",
      "#bad anchor", "#1bad", "#", "https:///missing-host",
    ];
    for (const url of unsafe) {
      const parsed = parse(render("# Links\n\n## Content\n[label](" + url + ")"));
      const main = parsed.find("main")[0];
      assert.deepEqual(main.find("a"), [], "Unsafe URL became an actual anchor: " + url);
      assert.ok(main.text.includes("label [link omitted]"), url);
      assertPassive(parsed);
    }
  });

  test("empty_credentials_are_also_disallowed", () => {
    for (const url of ["https://@example.test/docs", "https://:@example.test/docs"]) {
      const parsed = parse(render("# Links\n\n[label](" + url + ")"));
      assert.deepEqual(parsed.find("main")[0].find("a"), [],
        "An empty userinfo component is still URL credentials");
    }
  });

  test("safe_https_and_document_anchors_retain_exact_href", () => {
    const safe = ["https://example.test/docs", "https://example.test:443/docs#part",
      "https://example.test/a&b#part", "https://example.test/caf%C3%A9",
      "#content", "#Content_2-test"];
    for (const url of safe) {
      const parsed = parse(render("# Links\n\n## Content\n[label](" + url + ")"));
      const links = parsed.find("main")[0].find("a");
      assert.equal(links.length, 1, url);
      const [link] = links;
      assert.equal(link.attrs.href, url);
      assert.equal(link.text, "label");
      assert.deepEqual(new Set(link.attrs.rel.split(/\s+/)), new Set(["noopener", "noreferrer"]));
    }
  });

  test("link_labels_and_attribute_quotes_are_escaped", () => {
    const label = '<img src=x onerror=alert> & "quoted"';
    const url = 'https://example.test/path"onclick="synthetic';
    const source = "# Links\n\n## Content\n[" + label + "](" + url + ")";
    const parsed = parse(render(source));
    assertPassive(parsed);
    const links = parsed.find("main")[0].find("a");
    assert.equal(links.length, 1);
    const [link] = links;
    assert.equal(link.text, label);
    assert.equal(link.attrs.href, url);
    assert.deepEqual(new Set(Object.keys(link.attrs)), new Set(["href", "rel"]));
    assert.deepEqual(link.find(), []);
  });

  test("csp_disables_execution_connections_images_and_forms", () => {
    const parsed = parse(render());
    const policies = parsed.find("meta")
      .filter((e) => (e.attrs["http-equiv"] || "").toLowerCase() === "content-security-policy")
      .map((e) => e.attrs.content);
    assert.equal(policies.length, 1);
    const directives = {};
    for (const entry of policies[0].split(";")) {
      const tokens = entry.split(/\s+/).filter(Boolean);
      if (tokens.length) {
        assert.ok(!Object.hasOwn(directives, tokens[0]));
        directives[tokens[0]] = tokens.slice(1);
      }
    }
    for (const name of ["default-src", "script-src", "connect-src", "img-src", "form-action",
      "base-uri", "object-src"]) {
      assert.deepEqual(directives[name], ["'none'"], name);
    }
    assert.deepEqual(directives["font-src"], ["data:"]);
    assert.deepEqual(directives["style-src"], ["'unsafe-inline'"]);
    // Frames must be explicitly denied or inherit the deny-all default.
    assert.deepEqual(directives["frame-src"] ?? directives["default-src"], ["'none'"]);
    assertPassive(parsed);
  });

  test("supported_markdown_has_semantic_elements", () => {
    const source = "# Report\n\n## Section\n### Detail\n#### Four\n##### Five\n###### Six\n\n"
      + "Paragraph with **bold & safe** and *emphasis* and `x < y`.\nSecond line.\n\n"
      + "- Unordered one\n* Unordered two\n\n3. Ordered three\n4) Ordered four\n\n"
      + "> Quoted <literal>\n\n```python\nx = '<not-html>'\nprint(x)\n```\n\n"
      + "---\n\n<!-- pagebreak -->";
    const parsed = parse(render(source));
    const main = parsed.find("main")[0];
    for (const tag of ["h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li",
      "blockquote", "pre", "code", "strong", "em", "br", "hr"]) {
      assert.ok(main.find(tag).length, tag);
    }
    assert.equal(main.find("strong")[0].text, "bold & safe");
    assert.equal(main.find("em")[0].text, "emphasis");
    assert.equal(main.find("blockquote")[0].text, "Quoted <literal>");
    assert.equal(main.find("pre")[0].text, "x = '<not-html>'\nprint(x)");
    assert.equal(main.find("pre")[0].children[0].tag, "code");
    assert.equal(main.find("div", "page-break")[0].attrs["aria-hidden"], "true");
    assertPassive(parsed);
  });

  test("all_five_statuses_have_visible_non_score_labels", () => {
    const lines = ["# States", "", "## Results"];
    Object.keys(STATUS_LABELS).forEach((status, index) => {
      lines.push("", (index % 2 ? "**Status:** " : "Status: ") + status + ".");
    });
    const parsed = parse(render(lines.join("\n")));
    const badges = parsed.find("span", "status-badge");
    assert.deepEqual(badges.map((b) => b.text), Object.values(STATUS_LABELS));
    for (const badge of badges) {
      assert.ok(RENDERER.pyStrip(badge.text), "State must not be colour alone");
      assert.doesNotMatch(badge.text, /\p{Nd}|%|[sS][cC][oO][rR][eE]/u);
      assert.notEqual(badge.attrs["aria-hidden"], "true");
      assert.ok(!("hidden" in badge.attrs));
    }
    assert.doesNotMatch(parsed.find("body")[0].text, NO_SCORE);
  });

  test("unknown_status_is_literal_not_a_passing_badge", () => {
    const parsed = parse(render("# States\n\nStatus: unrecognised\n\nStatus: satisfactory_extra"));
    assert.deepEqual(parsed.find("span", "status-badge"), []);
    assert.ok(parsed.find("main")[0].text.includes("Status: unrecognised"));
  });

  test("h2_ids_deduplicate_and_navigation_resolves", () => {
    const source = "# Report\n\n## Repeat\nA\n\n## Repeat\nB\n\n## !!!\nC\n\n## !!!\nD";
    const parsed = parse(render(source));
    assert.deepEqual(parsed.find("section").map((e) => e.attrs.id),
      ["repeat", "repeat-2", "section", "section-2"]);
    assertNavigationResolves(parsed);
  });

  test("generated_ids_do_not_collide_with_literal_suffixes_or_main", () => {
    for (const headings of [["Repeat", "Repeat", "Repeat-2"], ["Report main", "Other"]]) {
      const source = "# Report\n\n" + headings.map((h) => "## " + h).join("\n\n");
      assertNavigationResolves(parse(render(source)));
    }
  });

  test("recommendation_articles_are_siblings_and_close_before_next_section", () => {
    const source = "# Report\n\n## Recommendations\nIntro.\n\n"
      + "### First\nBody.\n\n#### Detail\n- Item\n\n"
      + "### Second\nBody.\n\n## Appendix\n### Ordinary heading\nEnd.";
    const parsed = parse(render(source));
    const sections = parsed.find("section");
    const articles = parsed.find("article");
    assert.equal(articles.length, 2);
    assert.deepEqual(articles.map((a) => a.find("h3")[0].text), ["First", "Second"]);
    for (const article of articles) {
      assert.equal(article.parent, sections[0]);
      assert.deepEqual(article.find("article"), []);
    }
    assert.deepEqual(sections[1].find("article"), []);
    assert.equal(sections[1].find("h3")[0].text, "Ordinary heading");
    assertNavigationResolves(parsed);
  });

  test("final_article_and_section_close_at_end_of_input", () => {
    const parsed = parse(render("# Report\n\n## Recommendations\n### Last\n- End"));
    const articles = parsed.find("article");
    assert.equal(articles.length, 1);
    const [article] = articles;
    assert.equal(article.find("li")[0].text, "End");
    assert.equal(article.parent.tag, "section");
  });

  test("ordered_numbers_survive_blank_lines_and_list_type_changes", () => {
    const source = "# Steps\n\n## Plan\n3. Third\n\n7. Seventh\n8) Eighth\n\n"
      + "- Bullet\n\n12. Twelfth\n\n1. Restart";
    const parsed = parse(render(source));
    const main = parsed.find("main")[0];
    const items = main.find("ol").flatMap((listing) => listing.find("li"));
    assert.deepEqual(items.map((e) => e.attrs.value), ["3", "7", "8", "12", "1"]);
    assert.deepEqual(items.map((e) => e.text), ["Third", "Seventh", "Eighth", "Twelfth", "Restart"]);
    const bullets = main.find("ul")[0].find("li");
    assert.equal(bullets.length, 1);
    assert.ok(!("value" in bullets[0].attrs));
  });

  test("invalid_source_types_nul_and_unclosed_fence_are_rejected", () => {
    for (const source of [null, Buffer.from("# Bytes"), 42, "# Title\nNUL\x00here",
      "# Title\n\n```python\nprint('synthetic')"]) {
      assert.throws(() => render(source), RENDERER.ReportError, String(source));
    }
  });

  test("two_megabyte_limit_counts_utf8_bytes", () => {
    const prefix = "# Limit\n\n";
    const remaining = 2_000_000 - Buffer.byteLength(prefix);
    const source = prefix + "é".repeat(Math.floor(remaining / 2)) + "a".repeat(remaining % 2);
    assert.equal(Buffer.byteLength(source), 2_000_000);
    const parsed = parse(render(source));
    assert.equal(parsed.find("main")[0].find("p")[0].text, source.slice(prefix.length));
    assert.throws(() => render(source + "a"), RENDERER.ReportError);
  });

  test("language_validation_rejects_attribute_injection_and_non_strings", () => {
    for (const language of ['en" onload="synthetic', "en><script>", "en\nfr", "", "english",
      "en_US", null, 1]) {
      assert.throws(() => render(DEFAULT_SOURCE, { language }), RENDERER.ReportError, String(language));
    }
    for (const language of ["en", "fr", "fr-CA"]) {
      const parsed = parse(render(DEFAULT_SOURCE, { language }));
      assert.deepEqual(parsed.find("html")[0].attrs, { lang: language });
    }
  });

  test("unicode_and_command_like_source_remain_plain_text_without_execution", () => {
    const directory = makeTempDir();
    try {
      const marker = path.join(directory, "must-not-exist");
      const literal = "é — 安全 🔒 $(touch " + marker + ") "
        + "__import__('os').system('synthetic') {{7*7}}";
      const source = "# Unicode\n\n## Content\n" + literal + "\n\n```sh\n" + literal + "\n```";
      const parsed = parse(render(source));
      assert.ok(parsed.find("main")[0].text.includes(literal));
      assert.equal(parsed.find("main")[0].find("pre")[0].text, literal);
      assert.ok(!exists(marker));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

// ---- BundledFontTests -------------------------------------------------------------------------

describe("BundledFontTests", () => {
  test("manifest_pins_all_three_font_bytes_and_licence_copies", () => {
    const fonts = path.join(ASSETS, "fonts");
    const manifest = JSON.parse(fs.readFileSync(path.join(fonts, "SOURCES.json"), "utf8"));
    assert.equal(manifest.repository, "https://github.com/vercel/geist-font");
    assert.match(manifest.commit, /^[0-9a-f]{40}$/);
    assert.equal(manifest.licence, "SIL Open Font License 1.1");
    assert.deepEqual(manifest.licence_files, ["OFL.txt", "LICENSE.txt"]);
    assert.deepEqual(new Set(manifest.fonts.map((e) => e.file)),
      new Set(["Geist-Regular.woff2", "Geist-SemiBold.woff2", "GeistMono-Regular.woff2"]));
    assert.equal(manifest.fonts.length, 3);
    for (const entry of manifest.fonts) {
      const data = fs.readFileSync(path.join(fonts, entry.file));
      assert.equal(data.length, entry.bytes, entry.file);
      assert.deepEqual(data.subarray(0, 4), Buffer.from("wOF2"));
      assert.equal(createHash("sha256").update(data).digest("hex"), entry.sha256);
      assert.ok(entry.source_path.endsWith("/" + entry.file));
    }
    for (const filename of manifest.licence_files) {
      const licence = fs.readFileSync(path.join(fonts, filename), "utf8");
      assert.ok(licence.includes("SIL OPEN FONT LICENSE Version 1.1"));
      assert.ok(licence.includes("Copyright"));
      assert.ok(licence.includes("TERMINATION"));
      assert.ok(licence.includes("DISCLAIMER"));
    }
  });

  test("all_fonts_are_embedded_with_correct_styles_and_no_remote_css", () => {
    const parsed = parse(render());
    const style = parsed.find("style")[0].text;
    // Base64 font payloads legitimately contain //; inspect CSS tokens and
    // URL destinations rather than treating those bytes as remote URLs.
    assert.doesNotMatch(style, /@import\b|https?:\/\//i);
    const faces = Array.from(style.matchAll(new RegExp(`@font-face[${RENDERER.PY_WS}]*\\{([^}]+)\\}`, "g")), (m) => m[1]);
    assert.equal(faces.length, 3);
    const expected = [["Geist", "400", "Geist-Regular.woff2"],
      ["Geist", "600", "Geist-SemiBold.woff2"],
      ["Geist Mono", "400", "GeistMono-Regular.woff2"]];
    faces.forEach((face, index) => {
      const [family, weight, filename] = expected[index];
      assert.ok(face.includes("font-family:'" + family + "'"), filename);
      assert.ok(face.includes("font-weight:" + weight + ";"));
      assert.ok(face.includes("font-style:normal;"));
      assert.ok(face.includes("font-display:swap;"));
      assert.ok(face.includes("format('woff2')"));
      const encoded = Array.from(face.matchAll(/url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/g), (m) => m[1]);
      assert.equal(encoded.length, 1);
      assert.match(encoded[0], /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
      assert.deepEqual(Buffer.from(encoded[0], "base64"), fs.readFileSync(path.join(ASSETS, "fonts", filename)));
    });
    const urls = Array.from(style.matchAll(/url\(([^)]+)\)/gi), (m) => m[1]);
    assert.equal(urls.length, 3);
    assert.ok(urls.every((url) => url.startsWith("data:font/woff2;base64,")));
    const css = fs.readFileSync(path.join(ASSETS, "report.css"), "utf8");
    assert.ok(style.includes(css));
    assert.ok(style.includes("@media print"));
    assert.ok(style.includes("@page"));
    assertPassive(parsed);
  });

  test("full_licence_copies_are_inline_readable_text", () => {
    const parsed = parse(render());
    const details = parsed.find("details", "font-licence");
    assert.equal(details.length, 1);
    assert.equal(details[0].find("summary")[0].text, "Font licences");
    const expected = ["OFL.txt", "LICENSE.txt"]
      .map((filename) => fs.readFileSync(path.join(ASSETS, "fonts", filename), "utf8")).join("\n\n");
    assert.equal(details[0].find("pre")[0].text, expected);
    assert.deepEqual(details[0].find("a"), []);
  });
});

// ---- PipeTableTests ---------------------------------------------------------------------------

const MATRIX = "# Matrix review\n\n## Status at a glance\n\n"
  + "| Check | Team | `example-site` |\n| --- | :---: | ---: |\n"
  + "| **IAM-01** team roles | satisfactory | Team-wide |\n"
  + "| DEP-01 [docs](https://example.test/docs) | By project | action_recommended |\n"
  + "| CRE-01 | needs_confirmation | Status: not_reviewed |\n";

function table(source) {
  const parsed = parse(render(source));
  assertPassive(parsed);
  return parsed;
}

describe("PipeTableTests", () => {
  test("header_separator_and_rows_render_as_semantic_table", () => {
    const parsed = table(MATRIX);
    const wrappers = parsed.find("div", "table-wrap");
    assert.equal(wrappers.length, 1);
    const tables = wrappers[0].find("table");
    assert.equal(tables.length, 1);
    const [element] = tables;
    assert.deepEqual(element.children.map((c) => c.tag), ["thead", "tbody"]);
    assert.deepEqual(element.find("th").map((th) => th.text), ["Check", "Team", "example-site"]);
    assert.ok(element.find("th").every((th) => JSON.stringify(th.attrs) === JSON.stringify({ scope: "col" })));
    const rows = element.find("tbody")[0].find("tr");
    assert.deepEqual(rows.map((row) => row.find("td").length), [3, 3, 3]);
    assert.equal(element.find("strong")[0].text, "IAM-01");
    assert.equal(element.find("a")[0].attrs.href, "https://example.test/docs");
    assert.equal(element.find("code")[0].text, "example-site");
  });

  test("status_keys_in_cells_become_visible_badges", () => {
    let parsed = table(MATRIX);
    const badges = parsed.find("td")[0].parent.parent.find("span", "status-badge").map((b) => b.text);
    assert.deepEqual(badges, ["Satisfactory", "Action recommended", "Needs confirmation", "Not reviewed"]);
    const cells = parsed.find("td").map((td) => td.text);
    assert.ok(cells.includes("Team-wide"));
    assert.ok(cells.includes("By project"));
    // Unknown or partial status words stay literal text, never a passing badge.
    parsed = table("# T\n\n| A |\n| --- |\n| passed |\n| satisfactory. |\n| Satisfactory |\n");
    assert.deepEqual(parsed.find("span", "status-badge"), []);
  });

  test("cell_text_is_escaped_and_raw_html_stays_literal", () => {
    const source = "# T\n\n| <b>Head</b> |\n| --- |\n| <script>x()</script> & <img src=x> |\n";
    const document = render(source);
    const parsed = table(source);
    assert.deepEqual(parsed.find("script"), []);
    assert.deepEqual(parsed.find("img"), []);
    assert.equal(parsed.find("th")[0].text, "<b>Head</b>");
    assert.equal(parsed.find("td")[0].text, "<script>x()</script> & <img src=x>");
    assert.ok(document.includes("&lt;script&gt;"));
  });

  test("escaped_pipes_are_literal_cell_text", () => {
    const parsed = table("# T\n\n| A \\| B | C |\n| --- | --- |\n| `x\\|y` | z |\n");
    assert.deepEqual(parsed.find("th").map((th) => th.text), ["A | B", "C"]);
    assert.equal(parsed.find("code")[0].text, "x|y");
  });

  test("unsafe_links_and_images_in_cells_are_omitted", () => {
    const parsed = table("# T\n\n| A | B |\n| --- | --- |\n"
      + "| [x](javascript:alert(1)) | ![i](https://example.test/i.png) |\n");
    assert.deepEqual(parsed.find("img"), []);
    assert.deepEqual(parsed.find("a").filter((a) => a.parent.tag === "td"), []);
    assert.ok(parsed.find("td")[0].text.includes("[link omitted]"));
  });

  test("pipe_lines_without_separator_stay_paragraph_text", () => {
    for (const source of ["# T\n\n| A | B |\n| x | y |\n", "# T\n\n| A | B |\n| -- | -- |\n",
      "# T\n\n| A | B |\n\n| --- | --- |\n", "# T\n\nA | B\n--- | ---\n"]) {
      const parsed = table(source);
      assert.deepEqual(parsed.find("table"), [], source);
      assert.ok(parsed.find("main")[0].find("p")[0].text.includes("A"));
    }
  });

  test("malformed_tables_are_rejected_without_echoing_content", () => {
    for (const source of ["# T\n\n| SECRET_CANARY | B |\n| --- |\n| x | y |\n",
      "# T\n\n| A |\n| --- | --- |\n| x |\n",
      "# T\n\n| A | B |\n| --- | --- |\n| SECRET_CANARY |\n",
      "# T\n\n| A | B |\n| --- | --- |\n| x | y | z |\n",
      "# T\n\n| A |\n| --- |\n| SECRET_CANARY\n",
      "# T\n\n| A |\n| --- |\n",
      "# T\n\n" + "|" + " c |".repeat(17) + "\n|" + " --- |".repeat(17) + "\n|" + " x |".repeat(17) + "\n"]) {
      let raised = null;
      try {
        render(source);
      } catch (error) {
        raised = error;
      }
      assert.ok(raised instanceof RENDERER.ReportError, source.slice(0, 40));
      assert.ok(!String(raised.message).includes("SECRET_CANARY"));
    }
  });

  test("tables_end_at_blank_or_non_pipe_lines_and_close_lists", () => {
    const parsed = table("# T\n\n- item\n| A |\n| --- |\n| x |\nafter\n\n| B |\n| --- |\n| y |\n");
    assert.equal(parsed.find("table").length, 2);
    assert.deepEqual(parsed.find("ul")[0].find("table"), []);
    assert.equal(parsed.find("main")[0].find("p")[0].text, "after");
  });

  test("pipe_lines_inside_fenced_code_are_code", () => {
    const parsed = table("# T\n\n```\n| A |\n| --- |\n| x |\n```\n");
    assert.deepEqual(parsed.find("table"), []);
    assert.ok(parsed.find("pre")[0].text.includes("| --- |"));
  });
});

// ---- SyntheticExampleTests --------------------------------------------------------------------

describe("SyntheticExampleTests", () => {
  test("example_renders_all_core_and_optional_checks_with_exact_status_counts", () => {
    const source = fs.readFileSync(path.join(ROOT, "examples", "security-audit.md"), "utf8").replace(/\r\n?/g, "\n");
    assert.ok(source.includes("Synthetic, illustrative report"));
    assert.ok(source.includes("fictional"));
    const parsed = parse(render(source));
    assertPassive(parsed);
    assertNavigationResolves(parsed);
    assert.equal(parsed.find("h1")[0].text, "Example team security review");
    const sections = Object.fromEntries(parsed.find("section").map((s) => [s.find("h2")[0].text, s]));
    const core = sections["Appendix: required core checks"];
    const optional = sections["Appendix: optional checks, excluded from core coverage"];
    const expectedCore = new Set();
    for (const domain of ["IAM", "CRE", "DEP", "FWB", "SRC", "SEC", "DOM", "OPS"]) {
      for (const index of [1, 2, 3]) expectedCore.add(domain + "-" + String(index).padStart(2, "0"));
    }
    assert.deepEqual(new Set(core.find("h3").map((h) => words(h.text)[0])), expectedCore);
    assert.equal(core.find("h3").length, 24);
    assert.deepEqual(new Set(optional.find("h3").map((h) => words(h.text)[0])),
      new Set(["DEP-04", "SRC-04", "SEC-04", "OPS-04"]));
    assert.equal(optional.find("h3").length, 4);
    assert.deepEqual(counter(core.find("span", "status-badge").map((b) => b.text)),
      { Satisfactory: 12, "Action recommended": 2, "Needs confirmation": 6, "Not reviewed": 3, "Not applicable": 1 });
    assert.deepEqual(counter(optional.find("span", "status-badge").map((b) => b.text)), { "Not reviewed": 4 });
    // 28 appendix outcomes plus status-matrix cells, which are summaries, not outcomes.
    const matrix = sections["Status at a glance"];
    assert.equal(matrix.find("table").length, 2);
    assert.equal(parsed.find("span", "status-badge").length - matrix.find("span", "status-badge").length, 28);
    assert.equal(matrix.find("span", "status-badge").length, 34);
    assert.equal(parsed.find("article", "recommendation").length, 2);
    const priorities = sections["Initial priorities"].find("ol")[0].find("li");
    assert.deepEqual(priorities.map((e) => e.attrs.value), ["1", "2", "3"]);
    for (const article of parsed.find("article", "recommendation")) {
      assert.deepEqual(article.find("ol")[0].find("li").map((e) => e.attrs.value), ["1", "2", "3", "4", "5", "6"]);
    }
    assert.doesNotMatch(parsed.find("body")[0].text, NO_SCORE);
  });
});

// ---- RendererCLITests ----------------------------------------------------------------------------

function cliFixture(t) {
  const directory = makeTempDir();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = {
    directory,
    source: path.join(directory, "synthetic.md"),
    output: path.join(directory, "report.html"),
  };
  fixture.cli = (data = Buffer.from("# Synthetic CLI review\n\n## Summary\nSafe text."), extra = []) => {
    fs.writeFileSync(fixture.source, data);
    const result = childProcess.spawnSync(process.execPath, [SCRIPT, fixture.source, "-o", fixture.output, ...extra],
      { cwd: directory, encoding: "utf8", timeout: 20000 });
    return { returncode: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  fixture.assertCliFailure = (result, secret = "SYNTHETIC_SOURCE_CANARY") => {
    assert.equal(result.returncode, 1);
    assert.equal(result.stdout, "");
    // Specific, value-free diagnostics on one line (#29).
    assert.ok(result.stderr.startsWith("Could not render report"), result.stderr);
    assert.ok(result.stderr.endsWith("Existing files were preserved.\n"), result.stderr);
    assert.equal(result.stderr.split("\n").length - 1, 1);
    assert.ok(!(result.stdout + result.stderr).includes(secret));
    assert.ok(!result.stderr.includes(fixture.source));
    assert.ok(!/Traceback|\n\s+at /.test(result.stderr));
  };
  return fixture;
}

describe("RendererCLITests", () => {
  test("cli_creates_private_output_preserves_input_and_uses_no_cwd_assets", (t) => {
    const f = cliFixture(t);
    const data = Buffer.from("# Revue café 安全\n\n## Résumé\nTexte synthétique.", "utf8");
    const result = f.cli(data);
    assert.equal(result.returncode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "Offline HTML report created. Review it before sharing or printing to PDF.\n");
    assert.deepEqual(fs.readFileSync(f.source), data);
    assert.equal(mode(f.output), 0o600);
    const document = fs.readFileSync(f.output, "utf8");
    assert.equal(document, render(data.toString("utf8")));
    assertPassive(parse(document));
    assert.deepEqual(new Set(fs.readdirSync(f.directory)), new Set(["synthetic.md", "report.html"]));
  });

  test("cli_existing_output_is_never_overwritten", (t) => {
    const f = cliFixture(t);
    const original = Buffer.from("Keep existing output exactly.\x00\xff", "latin1");
    fs.writeFileSync(f.output, original);
    fs.chmodSync(f.output, 0o640);
    const result = f.cli(Buffer.from("# SYNTHETIC_SOURCE_CANARY\nNew content."));
    f.assertCliFailure(result);
    assert.deepEqual(fs.readFileSync(f.output), original);
    assert.equal(mode(f.output), 0o640);
    assert.deepEqual(fs.readFileSync(f.source), Buffer.from("# SYNTHETIC_SOURCE_CANARY\nNew content."));
  });

  test("cli_output_equal_to_input_preserves_source", (t) => {
    const f = cliFixture(t);
    const data = Buffer.from("# SYNTHETIC_SOURCE_CANARY\nMust remain Markdown.");
    const result = f.cli(data, ["--output", f.source]);
    f.assertCliFailure(result);
    assert.deepEqual(fs.readFileSync(f.source), data);
    assert.ok(!exists(f.output));
  });

  test("cli_refuses_existing_symlink_without_touching_target", { skip: typeof fs.symlinkSync !== "function" && "Requires symlinks" }, (t) => {
    const f = cliFixture(t);
    const target = path.join(f.directory, "target.txt");
    fs.writeFileSync(target, "Preserve symlink target.");
    fs.symlinkSync(target, f.output);
    const result = f.cli();
    f.assertCliFailure(result);
    assert.ok(fs.lstatSync(f.output).isSymbolicLink());
    assert.equal(fs.readFileSync(target, "utf8"), "Preserve symlink target.");
  });

  test("cli_rejects_invalid_inputs_without_output_or_source_content_in_error", (t) => {
    const f = cliFixture(t);
    const canary = Buffer.from("SYNTHETIC_SOURCE_CANARY");
    const b = (...parts) => Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : p)));
    const cases = {
      "invalid UTF-8": b("# ", canary, "\n\xff"),
      "unclosed fence": b("# ", canary, "\n```python\nsecret = 'synthetic'"),
      oversized: b("# ", canary, "\n", Buffer.alloc(2_000_000, "x")),
      NUL: b("# ", canary, "\n\x00"),
      "missing title": b(canary, "\nNo H1."),
      empty: Buffer.alloc(0),
    };
    for (const [name, data] of Object.entries(cases)) {
      f.assertCliFailure(f.cli(data));
      assert.ok(!exists(f.output), name);
      assert.deepEqual(fs.readFileSync(f.source), data);
    }
  });

  test("cli_lang_en_and_fr", (t) => {
    const f = cliFixture(t);
    for (const language of ["en", "fr"]) {
      const result = f.cli(undefined, ["--lang", language]);
      assert.equal(result.returncode, 0, result.stderr);
      const parsed = parse(fs.readFileSync(f.output, "utf8"));
      assert.deepEqual(parsed.find("html")[0].attrs, { lang: language });
      fs.unlinkSync(f.output);
    }
  });

  test("cli_language_injection_is_rejected_without_leaking_source", (t) => {
    const f = cliFixture(t);
    const result = f.cli(Buffer.from("# SYNTHETIC_SOURCE_CANARY\nPrivate synthetic body."),
      ["--lang", 'en" onload="synthetic']);
    f.assertCliFailure(result);
    assert.ok(!exists(f.output));
  });
});

// ---- RendererPublishTests ------------------------------------------------------------------------

function publishFixture(t) {
  // A failed write must leave nothing at the destination so a retry works (#30).
  const directory = makeTempDir();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = {
    directory,
    source: path.join(directory, "synthetic.md"),
    output: path.join(directory, "report.html"),
  };
  fs.writeFileSync(fixture.source, "# Synthetic review\n\n## Summary\nSafe text.", "utf8");
  fixture.runMain = () => {
    let stderr = "";
    const code = withPatches([
      [process.stdout, "write", () => true],
      [process.stderr, "write", (chunk) => { stderr += chunk; return true; }],
    ], () => RENDERER.main([fixture.source, "-o", fixture.output]));
    assert.ok(!stderr.includes("Traceback") && !/\n\s+at /.test(stderr));
    return [code, stderr];
  };
  fixture.main = () => fixture.runMain()[0];
  fixture.assertNothingPublished = () => {
    assert.ok(!exists(fixture.output));
    assert.deepEqual(stagingFiles(directory), []);
  };
  fixture.assertPublishedOnce = () => {
    assert.equal(mode(fixture.output), 0o600);
    assert.equal(fs.readFileSync(fixture.output, "utf8"), RENDERER.renderReport(fs.readFileSync(fixture.source, "utf8")));
    assert.deepEqual(new Set(fs.readdirSync(directory)), new Set(["synthetic.md", "report.html"]));
  };
  fixture.assertExistingRefused = () => {
    const original = Buffer.from("Keep existing output exactly.\x00\xff", "latin1");
    fs.writeFileSync(fixture.output, original);
    const [code, stderr] = fixture.runMain();
    assert.equal(code, 1);
    assert.ok(stderr.includes("The output path could not be used (File exists)."), stderr);
    assert.ok(stderr.endsWith("Existing files were preserved.\n"), stderr);
    assert.deepEqual(fs.readFileSync(fixture.output), original);
    assert.deepEqual(stagingFiles(directory), []);
  };
  return fixture;
}

const realWriteSync = fs.writeSync;
const realWritevSync = fs.writevSync;

describe("RendererPublishTests", () => {
  test("failed_write_publishes_nothing_and_retry_succeeds", (t) => {
    const f = publishFixture(t);
    // Writes 100 bytes, then fails like a full disk (Python patched the os.fdopen staging stream).
    const partialWrite = (descriptor, buffers) => {
      realWritevSync(descriptor, [buffers[0].subarray(0, 100)]);
      throw osError("ENOSPC", "no space left on device", "write");
    };
    withPatches([[fs, "writevSync", partialWrite]], () => assert.equal(f.main(), 1));
    f.assertNothingPublished();
    assert.equal(f.main(), 0);
    assert.equal(mode(f.output), 0o600);
    assert.ok(fs.readFileSync(f.output, "utf8").startsWith("<!doctype html>"));
  });

  test("failed_fsync_or_link_publishes_nothing", (t) => {
    const f = publishFixture(t);
    for (const target of ["fsyncSync", "linkSync"]) {
      const failing = () => { throw osError("EIO", "i/o error", target); };
      withPatches([[fs, target, failing]], () => assert.equal(f.main(), 1, target));
      f.assertNothingPublished();
    }
  });
});

// ---- RendererPortablePublishTests ----------------------------------------------------------------
// Without hard links or fchmod, publish once and still never overwrite (#85).

describe("RendererPortablePublishTests", () => {
  test("link_without_hard_link_support_falls_back_once_and_never_overwrites", (t) => {
    const f = publishFixture(t);
    for (const name of ["EPERM", "EXDEV", "ENOTSUP", "EOPNOTSUPP"]) {
      if (!(name in os.constants.errno)) continue;
      const error = osError(name, "Hard links unsupported");
      let linkCalls = 0;
      const openCalls = [];
      const realOpen = fs.openSync;
      withPatches([
        [fs, "linkSync", () => { linkCalls += 1; throw error; }],
        [fs, "openSync", (...args) => { openCalls.push(args); return realOpen(...args); }],
      ], () => {
        const [code, stderr] = f.runMain();
        assert.deepEqual([code, stderr], [0, ""], name);
        assert.equal(linkCalls, 1);
        const outputOpens = openCalls.filter((args) => path.resolve(String(args[0])) === f.output);
        assert.equal(outputOpens.length, 1);
        assert.equal(outputOpens[0][2], 0o600);
        f.assertPublishedOnce();
        f.assertExistingRefused();
      });
      fs.unlinkSync(f.output);
    }
  });

  test("missing_os_link_falls_back_and_never_overwrites", (t) => {
    const f = publishFixture(t);
    withPatches([[fs, "linkSync", undefined]], () => {
      assert.deepEqual(f.runMain(), [0, ""]);
      f.assertPublishedOnce();
      f.assertExistingRefused();
    });
  });

  test("missing_os_fchmod_still_publishes_privately", (t) => {
    const f = publishFixture(t);
    withPatches([[fs, "fchmodSync", undefined]], () => {
      assert.deepEqual(f.runMain(), [0, ""]);
      f.assertPublishedOnce();
      f.assertExistingRefused();
    });
  });

  test("missing_fchmod_and_hard_links_together_still_publish", (t) => {
    const f = publishFixture(t);
    withPatches([
      [fs, "fchmodSync", undefined],
      [fs, "linkSync", () => { throw osError("EPERM", "operation not permitted"); }],
    ], () => {
      assert.deepEqual(f.runMain(), [0, ""]);
      f.assertPublishedOnce();
      f.assertExistingRefused();
    });
  });

  test("fallback_failed_write_removes_only_its_partial_file_and_retry_succeeds", (t) => {
    const f = publishFixture(t);
    const partialWrite = (descriptor, data, offset = 0, length = data.length - offset) => {
      realWriteSync(descriptor, data, offset, Math.min(100, length));
      throw osError("ENOSPC", "no space left on device", "write");
    };
    withPatches([[fs, "linkSync", () => { throw osError("EXDEV", "cross-device link not permitted"); }]], () => {
      const [code, stderr] = withPatches([[fs, "writeSync", partialWrite]], () => f.runMain());
      assert.equal(code, 1);
      assert.ok(stderr.includes("(No space left on device)"), stderr);
      f.assertNothingPublished();
      assert.deepEqual(f.runMain(), [0, ""]);
    });
    f.assertPublishedOnce();
  });

  test("other_link_errors_are_not_retried_on_posix", () => {
    for (const platform of ["linux", "darwin"]) {
      assert.equal(RENDERER.linkUnsupported(osError("EIO", "i/o error"), platform), false);
      assert.equal(RENDERER.linkUnsupported(osError("EPERM", "operation not permitted"), platform), true);
      assert.equal(RENDERER.linkUnsupported(osError("EEXIST", "file already exists"), platform), false);
    }
  });

  test("any_link_error_except_existing_target_falls_back_on_windows", () => {
    assert.equal(RENDERER.linkUnsupported(osError("EIO", "i/o error"), "win32"), true);
    assert.equal(RENDERER.linkUnsupported(new Error("Incorrect function"), "win32"), true);
    assert.equal(RENDERER.linkUnsupported(osError("EEXIST", "file already exists"), "win32"), false);
  });

  test("missing_platform_primitive_is_a_report_error_without_traceback", (t) => {
    const f = publishFixture(t);
    for (const target of ["fsyncSync", "openSync"]) {
      const [code, stderr] = withPatches([
        [fs, "linkSync", () => { throw osError("EPERM", "operation not permitted"); }],
        [fs, target, () => { throw new TypeError("synthetic"); }],
      ], () => f.runMain());
      assert.equal(code, 1, target);
      assert.equal(stderr, "Could not render report: This platform cannot create a new "
        + "private output file. Existing files were preserved.\n");
      assert.ok(!stderr.includes("synthetic"));
      f.assertNothingPublished();
    }
  });
});
