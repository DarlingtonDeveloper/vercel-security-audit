// CLI failures must be distinguishable yet never echo input values or paths (#29).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = path.join(ROOT, "skills", "vercel-security-audit", "scripts");
const CANARY = "SYNTHETIC_DIAGNOSTIC_CANARY";

/** Split a call's argument text at top-level commas (strings, comments and brackets respected). */
function callArguments(source, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let index = open + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\"" || character === "'" || character === "`") {
      for (index += 1; index < source.length && source[index] !== character; index += 1) {
        if (source[index] === "\\") index += 1;
      }
    } else if (source.startsWith("//", index)) {
      index = source.indexOf("\n", index);
    } else if (source.startsWith("/*", index)) {
      index = source.indexOf("*/", index) + 1;
    } else if ("([{".includes(character)) {
      depth += 1;
    } else if (")]}".includes(character)) {
      if (depth === 0) {
        args.push(source.slice(start, index));
        return args.map((arg) => arg.trim()).filter(Boolean);
      }
      depth -= 1;
    } else if (character === "," && depth === 0) {
      args.push(source.slice(start, index));
      start = index + 1;
    }
  }
  throw new Error("Unbalanced call");
}

// One string literal, or literals joined with + (Python folds adjacent literals into one constant).
const STRING = String.raw`(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\x60(?:[^\x60\\$]|\\.|\$(?!\{))*\x60)`;
const LITERAL = new RegExp(`^${STRING}(?:\\s*\\+\\s*${STRING})*$`);

describe("DiagnosticsTests", () => {
  let temporary;
  let directory;

  beforeEach(() => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "diagnostics-"));
    directory = path.join(temporary, CANARY);
    fs.mkdirSync(directory);
  });

  afterEach(() => {
    fs.rmSync(temporary, { recursive: true, force: true });
  });

  function runScript(script, ...args) {
    const result = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args.map(String)],
      { cwd: directory, encoding: "utf8", timeout: 20000 });
    assert.ok(!(result.stdout + result.stderr).includes(CANARY));
    assert.ok(!result.stderr.includes("Traceback"));
    assert.ok(!/\n\s+at /.test(result.stderr), "no JavaScript stack trace");
    return { returncode: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  function failure(script, ...args) {
    const result = runScript(script, ...args);
    assert.equal(result.returncode, 1, result.stderr);
    assert.equal(result.stdout, "");
    return result.stderr;
  }

  function init(name = "r1.json") {
    const output = path.join(directory, name);
    const result = runScript("manage-report.mjs", "init", "--scope-alias", "t", "--title", "t", "-o", output);
    assert.equal(result.returncode, 0, result.stderr);
    return output;
  }

  test("manage schema error differs from existing output", () => {
    const source = init();
    const bad = path.join(directory, "bad.json");
    const value = JSON.parse(fs.readFileSync(source, "utf8"));
    value.schema_version = CANARY;
    fs.writeFileSync(bad, JSON.stringify(value));
    const schema = failure("manage-report.mjs", "validate", bad);
    const exists = failure("manage-report.mjs", "init", "--scope-alias", "t", "--title", "t", "-o", source);
    assert.notEqual(schema, exists);
    assert.ok(exists.includes("The output path could not be used (File exists)."));
  });

  test("manage reports specific JSON errors", () => {
    const duplicate = path.join(directory, "duplicate.json");
    fs.writeFileSync(duplicate, '{"a": 1, "a": 2}');
    assert.ok(failure("manage-report.mjs", "validate", duplicate).includes("Duplicate JSON object key."));
    const nonfinite = path.join(directory, "nan.json");
    fs.writeFileSync(nonfinite, '{"a": NaN}');
    assert.ok(failure("manage-report.mjs", "validate", nonfinite).includes("Non-finite JSON numbers are invalid."));
    const missing = path.join(directory, "missing.json");
    assert.ok(failure("manage-report.mjs", "validate", missing).includes("The source file could not be used"));
  });

  test("render reports specific errors", () => {
    const notitle = path.join(directory, "notitle.md");
    fs.writeFileSync(notitle, `no title ${CANARY}\n`);
    assert.ok(failure("render-report.mjs", notitle, "-o", path.join(directory, "a.html"))
      .includes("The Markdown report must start with one report title (# Title)."));
    const fence = path.join(directory, "fence.md");
    fs.writeFileSync(fence, "# T\n```\nopen");
    assert.ok(failure("render-report.mjs", fence, "-o", path.join(directory, "b.html"))
      .includes("Close all fenced code blocks before rendering."));
    const binary = path.join(directory, "binary.md");
    fs.writeFileSync(binary, Buffer.concat([Buffer.from([0x23, 0x20, 0x54, 0x0a, 0xff, 0xfe]), Buffer.from(CANARY)]));
    assert.ok(failure("render-report.mjs", binary, "-o", path.join(directory, "c.html")).includes("must be UTF-8 text."));
    const existing = path.join(directory, "existing.html");
    fs.writeFileSync(existing, "keep");
    const title = path.join(directory, "title.md");
    fs.writeFileSync(title, "# T\n");
    assert.ok(failure("render-report.mjs", title, "-o", existing).includes("The output path could not be used (File exists)."));
    assert.equal(fs.readFileSync(existing, "utf8"), "keep");
  });

  test("printed error messages are literal strings", () => {
    // Printing is only safe because every authored message is a constant.
    const calls = /\bnew (?:ReportError|ModelError)\s*\(|(?<![\w.])requireThat\s*\(/g;
    for (const name of ["render-report.mjs", "manage-report.mjs"]) {
      const source = fs.readFileSync(path.join(SCRIPTS, name), "utf8");
      let checked = 0;
      for (const match of source.matchAll(calls)) {
        if (/function\s+$/.test(source.slice(Math.max(0, match.index - 20), match.index))) continue; // A definition.
        const args = callArguments(source, match.index + match[0].length - 1);
        const message = args[args.length - 1];
        if (message === "message") continue; // Forwarding a literal argument.
        const line = source.slice(0, match.index).split("\n").length;
        assert.ok(message !== undefined && LITERAL.test(message), `${name}:${line} ${message}`);
        checked += 1;
      }
      assert.ok(checked > 0, name);
    }
  });
});
