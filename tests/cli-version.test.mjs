// CLI version guidance: recommend updating, never force it, and record missing commands as gaps (#37).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const SKILL_DIR = new URL("skills/vercel-security-audit/", ROOT);
const CAPABILITIES = readFileSync(new URL("references/capabilities.md", SKILL_DIR), "utf8");
const SKILL = readFileSync(new URL("SKILL.md", SKILL_DIR), "utf8");
const README = readFileSync(new URL("README.md", ROOT), "utf8");

test("minimum tested version is stated in readme and capabilities", () => {
  for (const text of [README, CAPABILITIES]) {
    assert.ok(text.includes("Minimum tested CLI version: 62.7.0"));
    assert.ok(text.includes("54.18.0"));
  }
});

test("update is recommended not forced", () => {
  assert.ok(CAPABILITIES.includes("vercel --version"));
  assert.ok(CAPABILITIES.includes("This is guidance, not a requirement"));
  assert.ok(CAPABILITIES.includes("do not install, upgrade or download the CLI yourself"));
  assert.ok(SKILL.includes("recommend, without forcing"));
});

test("missing security command is a recorded gap", () => {
  assert.ok(CAPABILITIES.includes('"upgrade the CLI" note'));
  assert.ok(CAPABILITIES.includes("Do not retry, guess equivalent commands"));
  assert.ok(SKILL.includes("unknown `security` subcommand is a recorded capability gap"));
  assert.ok(SKILL.includes("#cli-version"));
});
