// Offline packaging/content checks. These do not test an agent or a live account.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const SKILL_DIR = path.join(ROOT, "skills", "vercel-security-audit");
const SKILL = path.join(SKILL_DIR, "SKILL.md");
const read = (file) => readFileSync(file, "utf8");

function after(text, sep) {
  const index = text.indexOf(sep);
  if (index < 0) throw new Error(`separator not found: ${JSON.stringify(sep)}`);
  return text.slice(index + sep.length);
}
function before(text, sep) {
  const index = text.indexOf(sep);
  return index < 0 ? text : text.slice(0, index);
}
const count = (text, sub) => text.split(sub).length - 1;

// Python str.splitlines(): splits on every Unicode line boundary, no trailing empty item.
function splitlines(text) {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

// Python Path.rglob("*"): every entry below dir, without following directory symlinks.
function rglob(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    out.push(full);
    if (entry.isDirectory()) out.push(...rglob(full));
  }
  return out;
}
const parts = (file) => path.relative(ROOT, file).split(path.sep);

describe("DocsDriftTests: README and SKILL.md agree with the shipped tree and with each other (#82)", () => {
  const readme = read(path.join(ROOT, "README.md"));
  const files = before(after(readme, "## Files\n"), "\n## ");
  const skill = read(SKILL);

  test("every skill file and test is listed", () => {
    const shipped = rglob(SKILL_DIR).filter((file) =>
      isFile(file) && !parts(file).includes("__pycache__") && path.extname(file) !== ".pyc");
    assert.ok(shipped.length > 20);
    for (const file of shipped) {
      const relative = path.relative(ROOT, file).split(path.sep).join("/");
      assert.ok(files.includes(relative), path.basename(file));
    }
    // Node port: the test files are tests/*.test.mjs (Python listed tests/test_*.py).
    for (const name of readdirSync(path.join(ROOT, "tests")).filter((n) => n.endsWith(".test.mjs")).sort()) {
      assert.ok(files.includes(`\`${name}\``), name);
    }
  });

  test("changelog exists", () => {
    const changelog = read(path.join(ROOT, "CHANGELOG.md"));
    assert.ok(changelog.startsWith("# Changelog"));
    for (const number of [54, 76, 92, 102]) {
      assert.ok(changelog.includes(`#${number}`), String(number));
    }
  });

  test("node requirement agrees", () => {
    // Node port of test_python_requirement_agrees: the reader is scripts/cli-read.mjs on Node.js 22+.
    for (const text of [readme, skill]) {
      assert.ok(text.includes("`scripts/cli-read.mjs`"));
    }
    assert.ok(readme.includes("Node.js 22+ (standard library only) for any CLI-based audit"));
    assert.ok(skill.includes("Node.js 22+ and the readable bundled `scripts/cli-read.mjs` are required"));
    assert.ok(!readme.includes("Node.js and a report-export browser are optional"));
    assert.ok(!skill.includes("the renderer, Node.js or a report-export browser"));
    assert.ok(!readme.includes("Startup must read all four references"));
    assert.ok(readme.includes("asks for scope first"));
  });

  test("skill asks for scope and reads the checklist once", () => {
    assert.equal(count(skill, "Ask for scope first"), 1);
    assert.equal(count(skill, "Ask for the team slug first"), 1);
    assert.equal(count(skill, "the complete [checklist](references/checklist.md)"), 1);
    assert.ok(!skill.includes("Read the complete [checklist]"));
  });
});

describe("PublicSkillTests", () => {
  function skillTexts() {
    return rglob(SKILL_DIR)
      .filter((file) => isFile(file) && ![".woff2", ".pyc"].includes(path.extname(file))
        && !parts(file).includes("__pycache__"))
      .map((file) => [file, read(file).toLowerCase()]);
  }

  test("portable frontmatter", () => {
    const text = read(SKILL);
    const frontmatter = text.split("---")[1];
    const fields = Object.fromEntries(
      [...frontmatter.matchAll(/^(name|description): (.+)$/gm)].map((m) => [m[1], m[2]]));
    assert.equal(fields.name, "vercel-security-audit");
    assert.ok(fields.description.length > 40);
    assert.ok(fields.description.length < 1024);
    assert.ok(!frontmatter.includes("allowed-tools:"));
    assert.ok(!frontmatter.includes("context:"));
    assert.ok(!frontmatter.includes("hooks:"));
  });

  test("relative reference links resolve", () => {
    const skillDir = realpathSync(SKILL_DIR);
    for (const file of rglob(SKILL_DIR).filter((f) => f.endsWith(".md"))) {
      for (const [, target] of read(file).matchAll(/\]\(([^)]+)\)/g)) {
        if (target.startsWith("https://") || target.startsWith("http://") || target.startsWith("#")) {
          continue;
        }
        let resolved = path.resolve(path.dirname(file), target.split("#")[0]);
        if (existsSync(resolved)) resolved = realpathSync(resolved);
        const relative = path.relative(skillDir, resolved);
        assert.ok(relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)), target);
        assert.ok(isFile(resolved), target);
      }
    }
  });

  test("required resources exist", () => {
    for (const name of ["capabilities.md", "checklist.md", "report-template.md"]) {
      assert.ok(isFile(path.join(SKILL_DIR, "references", name)), name);
    }
  });

  test("core checklist is complete and unique", () => {
    const text = read(path.join(SKILL_DIR, "references", "checklist.md"));
    const index = text.indexOf("## Optional deeper");
    assert.ok(index >= 0);
    const core = text.slice(0, index);
    const optional = text.slice(index + "## Optional deeper".length);
    const coreIds = [...core.matchAll(/^### ([A-Z]{3}-\d{2})/gm)].map((m) => m[1]);
    const optionalIds = [...optional.matchAll(/^### ([A-Z]{3}-\d{2})/gm)].map((m) => m[1]);
    assert.equal(coreIds.length, 24);
    assert.equal(optionalIds.length, 4);
    assert.equal(new Set([...coreIds, ...optionalIds]).size, 28);
    assert.equal([...core.matchAll(/^## Required core:/gm)].length, 8);
    for (const section of text.split(/^### /m).slice(1)) {
      for (const label of ["Primary read source:", "Evidence needed:", "Cannot infer:"]) {
        assert.ok(section.includes(label), label);
      }
    }
  });

  test("all result states are defined", () => {
    const text = read(SKILL);
    for (const state of ["satisfactory", "action_recommended", "needs_confirmation", "not_reviewed", "not_applicable"]) {
      assert.ok(text.includes(`- ${state}:`), state);
    }
  });

  test("runtime dependencies are capability based", () => {
    const text = read(path.join(ROOT, "README.md"));
    assert.ok(text.includes("Grokbot: not established"));
    assert.ok(text.includes("does not need desktop control"));
    assert.ok(text.includes("and/or an installed Vercel CLI"));
  });

  test("no community or unofficial framing", () => {
    const files = [...skillTexts(), ...["README.md", "SECURITY.md", "examples/security-audit.md"]
      .map((name) => [path.join(ROOT, name), read(path.join(ROOT, name)).toLowerCase()])];
    for (const [file, text] of files) {
      for (const phrase of ["unofficial", "community-maintained", "community preview", "community-branded",
        "not endorsed by vercel", "live execution has not been tested"]) {
        assert.ok(!text.includes(phrase), `${path.basename(file)}: ${phrase}`);
      }
    }
  });

  test("public skill has no local paths", () => {
    for (const [file, text] of skillTexts()) {
      assert.doesNotMatch(text, /(?:\/users\/|\/home\/)[a-z0-9_-]+\//, path.basename(file));
    }
  });

  test("public skill has no internal sources", (t) => {
    // Internal names are kept out of the public repo in a gitignored, maintainer-only list.
    // Create tests/private-markers.txt with one name per line (lines starting with # are
    // comments). Without it, this check is skipped, so it runs only where that file exists.
    const markersFile = path.join(ROOT, "tests", "private-markers.txt");
    if (!isFile(markersFile)) {
      t.skip("tests/private-markers.txt not present; internal-name check runs only for maintainers");
      return;
    }
    const markers = splitlines(read(markersFile))
      .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
      .map((line) => line.trim().toLowerCase());
    assert.ok(markers.length > 0, "tests/private-markers.txt has no entries");
    for (const [file, text] of skillTexts()) {
      markers.forEach((marker, index) => {
        // The failure shows only this message (the entry number), never the name or the file text.
        assert.ok(!text.includes(marker), `${path.basename(file)}: private marker entry ${index + 1} found`);
      });
    }
  });

  test("review is read only and has a handoff", () => {
    const text = read(SKILL);
    assert.ok(text.includes("never stages or applies configuration changes"));
    assert.ok(text.includes("A Log-mode firewall rule is still a configuration change"));
    assert.ok(text.includes("Stop on MFA, device-policy or permission blocks"));
    assert.ok(text.includes("approval of the exact destination and final content"));
    assert.ok(text.includes("do not automatically fix findings"));
  });

  test("sensitive browser views require pre exposure selection", () => {
    const text = read(SKILL);
    assert.ok(text.includes("before any page text or image reaches the model"));
    assert.ok(text.includes("do not automate sensitive member, credential or environment views"));
    assert.ok(text.includes("Skill instructions alone do not implement a safe collector"));
  });

  test("team wide reads need distinct authorisation", () => {
    const text = read(SKILL);
    assert.ok(text.includes("team-wide inventory and configuration reads separately"));
    assert.ok(text.includes("filtering after collection cannot repair an authorisation gap"));
  });

  test("capability command examples are inspection only", () => {
    const text = read(path.join(SKILL_DIR, "references", "capabilities.md"));
    const allowed = [
      "--version", "whoami", "teams list", "security check", "project ls", "firewall status",
      "firewall overview", "firewall rules list", "firewall system-bypass list",
      "firewall bot-management", "firewall traffic list", "firewall alerts list",
      "activity", "webhooks list", "integration list", "domains list",
    ];
    // Only help and version run directly; account reads run through the bundled reader (#32).
    const direct = [...text.matchAll(/^vercel (.+)$/gm)].map((m) => m[1]);
    assert.ok(direct.length >= 6);
    for (const command of direct) {
      assert.ok(command === "--version" || command.endsWith(" --help"), command);
    }
    const mapped = [...text.matchAll(/^[a-z-]+ +vercel (.+)$/gm)].map((m) => m[1]);
    assert.ok(mapped.length >= 14);
    for (const command of [...direct, ...mapped]) {
      assert.ok(allowed.some((item) => command === item || command.startsWith(item + " ")), command);
      assert.doesNotMatch(command, /(?:^|\s)(?:--token|-t|--debug|-d|--yes)(?:\s|$)/);
      assert.ok(!command.includes("vercel api"), command);
    }
    assert.ok(text.includes("Never run a documented account read directly"));
  });

  test("report json example is synthetic and valid", () => {
    const text = read(path.join(SKILL_DIR, "references", "report-template.md"));
    const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    assert.equal(blocks.length, 1);
    const example = JSON.parse(blocks[0]);
    assert.equal(example.scope_alias, "example-team");
    assert.equal(example.status, "needs_confirmation");
    assert.ok(!Object.hasOwn(example, "token"));
  });

  test("report contains guided action fields", () => {
    const text = read(path.join(SKILL_DIR, "references", "report-template.md"));
    for (const label of ["Benefit:", "Who:", "Before changing:", "Where to start:", "Done when:", "Impact / rollback:", "Docs:"]) {
      assert.ok(text.includes(label), label);
    }
    assert.ok(text.includes("at most three"));
    assert.ok(text.includes("PDF is optional"));
  });

  test("behaviour scenarios are explicitly unexecuted", () => {
    const text = read(path.join(ROOT, "evals", "scenarios.md"));
    assert.ok(text.includes("not executed model or host tests"));
    assert.equal([...text.matchAll(/^## \d+\./gm)].length, 13);
    assert.equal(count(text, "Pass:"), 13);
  });

  test("tables use only the bounded renderer grammar and fences balance", () => {
    // Pipe tables are supported (status matrix); every pipe line must belong to a
    // header + separator + rows block with consistent widths, so nothing that
    // looks like a table silently renders as paragraph text.
    const separator = /\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+/;
    for (const file of rglob(ROOT).filter((f) => f.endsWith(".md") && isFile(f))) {
      const lines = splitlines(read(file));
      assert.equal(lines.filter((line) => line.startsWith("```")).length % 2, 0, file);
      let fenced = false;
      let block = [];
      const blocks = [];
      for (const line of [...lines, ""]) {
        if (line.startsWith("```")) fenced = !fenced;
        if (!fenced && line.startsWith("|")) {
          block.push(line);
          continue;
        }
        if (block.length) {
          blocks.push(block);
          block = [];
        }
      }
      for (const rows of blocks) {
        const label = `${path.basename(file)}: ${rows[0].slice(0, 40)}`;
        assert.ok(rows.length >= 3, label);
        assert.match(rows[1], separator, label);
        const widths = new Set(rows.map((row) => row.trim().split(/(?<!\\)\|/).length));
        assert.ok(rows.every((row) => row.trimEnd().endsWith("|")), label);
        assert.equal(widths.size, 1, label);
      }
    }
  });
});
