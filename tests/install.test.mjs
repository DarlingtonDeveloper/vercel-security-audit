// Offline install documentation and relocated-bundle checks, not live host tests
// (ported from tests/test_install.py). Python-specific assertions are translated to
// Node: the export preflight names `scripts/render-report.mjs` and "Node.js", and the
// relocated bundle runs render-report.mjs with process.execPath.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = path.join(ROOT, "skills", "vercel-security-audit");
const SOURCE = "DarlingtonDeveloper/vercel-security-audit";

/** POSIX shlex.split for the plain command lines in the README. */
function shlexSplit(line) {
  const tokens = [];
  let current = null;
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === quote) quote = null;
      else if (character === "\\" && quote === '"' && /["\\$`\n]/.test(line[index + 1] ?? "")) current += line[++index];
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
      current ??= "";
    } else if (character === "\\") {
      current = (current ?? "") + (line[++index] ?? "");
    } else if (/\s/.test(character)) {
      if (current !== null) tokens.push(current);
      current = null;
    } else if (character === "#" && current === null) {
      break;
    } else {
      current = (current ?? "") + character;
    }
  }
  if (quote) throw new Error("No closing quotation");
  if (current !== null) tokens.push(current);
  return tokens;
}

function splitLines(text) {
  const lines = text.split(/\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function after(text, separator) {
  const index = text.indexOf(separator);
  assert.ok(index >= 0, `separator not found: ${JSON.stringify(separator)}`);
  return text.slice(index + separator.length);
}

function before(text, separator) {
  const index = text.indexOf(separator);
  return index < 0 ? text : text.slice(0, index);
}

function read(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

describe("InstallDocumentationTests", () => {
  test("project_global_and_agent_specific_commands", () => {
    const readme = read(path.join(ROOT, "README.md"));
    const commands = splitLines(readme).filter((line) => line.startsWith("npx skills add ")).map(shlexSplit);
    const has = (command) => commands.some((c) => JSON.stringify(c) === JSON.stringify(command));
    const base = ["npx", "skills", "add", SOURCE, "--skill", "vercel-security-audit"];
    for (const command of [base, [...base, "--agent", "eve"], [...base, "--global"],
      [...base, "--global", "--agent", "grok"]]) {
      assert.ok(has(command), JSON.stringify(command));
    }
    assert.ok(has(["npx", "skills", "add", SOURCE, "--list"]));
    for (const command of commands) {
      assert.ok(!(command.includes("--global") && command.includes("eve")),
        "Eve has no global install target in the verified CLI source");
    }
    assert.ok(readme.includes("does not support global"));
    assert.ok(readme.includes("https://github.com/vercel-labs/skills/blob/"));
  });

  test("manual_central_install_preserves_the_whole_bundle", () => {
    const readme = read(path.join(ROOT, "README.md"));
    const heading = "### Manual central agent-library install\n";
    assert.ok(readme.includes(heading));
    const section = before(after(readme, heading), "\n### ");
    assert.ok(section.includes("host-configured"));
    assert.ok(section.includes("cp -R skills/vercel-security-audit "));
    assert.ok(section.includes('test ! -e "$skill_library/vercel-security-audit"'));
    assert.ok(section.includes("not just SKILL.md"));
    for (const resource of ["references/", "scripts/", "assets/", "assets/fonts/"]) {
      assert.ok(section.includes(resource), resource);
    }
  });
});

function startup() {
  const text = read(path.join(SKILL_DIR, "SKILL.md"));
  const heading = "## Startup: installation integrity\n";
  assert.ok(text.includes(heading), "Missing startup installation integrity preflight");
  assert.ok(text.indexOf(heading) < text.indexOf("## Process\n"));
  return before(after(text, heading), "\n## ");
}

function referenceLinks(text) {
  return new Set(Array.from(text.matchAll(/\]\((references\/[^)#]+)/g), (m) => m[1]));
}

describe("InstallIntegrityTests", () => {
  test("startup_checks_every_linked_reference_before_account_reads", () => {
    const section = startup();
    const references = referenceLinks(section);
    // Every reference the process links must be in the startup check, so the two cannot drift (#91).
    const linked = referenceLinks(read(path.join(SKILL_DIR, "SKILL.md")));
    assert.deepEqual([...linked].filter((r) => !references.has(r)), [],
      "SKILL.md links references the startup check does not cover");
    // And every bundled reference is linked, so none is shipped but never checked.
    const bundled = new Set(fs.readdirSync(path.join(SKILL_DIR, "references"))
      .filter((name) => name.endsWith(".md") && isFile(path.join(SKILL_DIR, "references", name)))
      .map((name) => `references/${name}`));
    assert.deepEqual(references, bundled);
    for (const reference of references) assert.ok(isFile(path.join(SKILL_DIR, reference)), reference);
    for (const instruction of ["confirm that every essential reference below is present and readable", "missing or unreadable",
      "stop before account reads", "Installation integrity error",
      "complete skill directory", "host's actual skill location",
      "not the current project or working directory"]) {
      assert.ok(section.includes(instruction), instruction);
    }
  });

  test("export_preflight_is_optional_and_keeps_markdown_on_missing_helpers", () => {
    const section = startup();
    const condition = "Only for styled HTML/PDF export";
    assert.ok(section.includes(condition), "Export dependencies need a conditional preflight");
    const exportText = after(section, condition);
    // Node port: was `scripts/render_report.py` and "Python 3".
    for (const resource of ["scripts/render-report.mjs", "assets/report.html", "assets/report.css",
      "assets/fonts/Geist-Regular.woff2", "assets/fonts/Geist-SemiBold.woff2",
      "assets/fonts/GeistMono-Regular.woff2", "assets/fonts/OFL.txt",
      "assets/fonts/LICENSE.txt"]) {
      assert.ok(exportText.includes(`\`${resource}\``), resource);
      assert.ok(isFile(path.join(SKILL_DIR, resource)), resource);
    }
    for (const instruction of ["Markdown-only audits do not require", "Node.js",
      "report-export browser", "warn", "keep `security-audit.md`",
      "not an audit failure", "Do not install packages"]) {
      assert.ok(exportText.includes(instruction), instruction);
    }
  });
});

describe("RelocatedBundleTests", () => {
  test("complete_bundle_renders_from_each_install_location_not_cwd", (t) => {
    // Arbitrary fixture locations, not claims about any host's loader paths.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "install-test-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const cwd = path.join(root, "unrelated-working-directory");
    fs.mkdirSync(path.join(cwd, "assets"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "assets", "report.html"), "Not the skill template.");
    const source = path.join(root, "synthetic.md");
    const markdown = Buffer.from("# Install relocation check\n\n## Summary\nSynthetic evidence only.\n");
    fs.writeFileSync(source, markdown);
    for (const location of ["project install", "global install", "central agent-library"]) {
      const installed = path.join(root, location, "vercel-security-audit");
      fs.cpSync(SKILL_DIR, installed, {
        recursive: true,
        filter: (entry) => path.basename(entry) !== "__pycache__",
      });
      const text = read(path.join(installed, "SKILL.md"));
      for (const match of text.matchAll(/\]\((references\/[^)]+)\)/g)) {
        assert.ok(isFile(path.join(installed, match[1].split("#")[0])), match[1]);
      }
      const output = path.join(root, location + ".html");
      const result = spawnSync(process.execPath, [path.join(installed, "scripts", "render-report.mjs"), source, "-o", output],
        { cwd, encoding: "utf8", timeout: 20000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      const document = fs.readFileSync(output, "utf8");
      assert.ok(document.includes("<title>Install relocation check</title>"), location);
      assert.equal(document.split("@font-face{").length - 1, 3);
      assert.ok(document.includes("SIL OPEN FONT LICENSE Version 1.1"));
      assert.deepEqual(fs.readFileSync(source), markdown);
    }
  });
});
