// Helpers must run with a clean environment and resolve siblings from the skill, not the CWD.
// Python ran the scripts under `python -I`; Node has no isolated-mode flag, so the scripts run
// with a minimal environment (no NODE_OPTIONS or NODE_PATH) from a directory holding decoys.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = path.join(ROOT, "skills", "vercel-security-audit", "scripts");
const EXAMPLE = path.join(ROOT, "examples", "security-audit.md");

let directory;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "isolated-mode-"));
  // Decoys in the working directory must never be imported.
  const decoy = "process.stderr.write('DECOY_RENDERER_IMPORTED\\n'); process.exit(3);\n";
  fs.writeFileSync(path.join(directory, "render-report.mjs"), decoy, "utf8");
  fs.writeFileSync(path.join(directory, "render_report.mjs"), decoy, "utf8");
  fs.writeFileSync(path.join(directory, "render_report.py"), "raise SystemExit('DECOY_RENDERER_IMPORTED')\n", "utf8");
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

function runIsolated(script, ...args) {
  const env = { PATH: process.env.PATH ?? "", HOME: directory };
  const result = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args.map(String)],
    { cwd: directory, env, encoding: "utf8", timeout: 20000 });
  return { returncode: result.status, stdout: result.stdout, stderr: result.stderr };
}

function assertOk(result) {
  assert.equal(result.returncode, 0, result.stderr);
  assert.ok(!(result.stdout + result.stderr).includes("DECOY_RENDERER_IMPORTED"));
  // Python checked for "Traceback"; an uncaught Node error prints a stack with "    at ".
  assert.ok(!result.stderr.includes("Traceback"));
  assert.ok(!/\n\s+at /.test(result.stderr), result.stderr);
}

test("render and check run isolated", () => {
  const output = path.join(directory, "report.html");
  assertOk(runIsolated("render-report.mjs", EXAMPLE, "-o", output));
  assertOk(runIsolated("check-report.mjs", output));
});

test("manage runs isolated", () => {
  const output = path.join(directory, "report-v1.json");
  assertOk(runIsolated("manage-report.mjs", "init", "--scope-alias", "t", "--title", "Synthetic", "-o", output));
  assertOk(runIsolated("manage-report.mjs", "validate", output));
});
