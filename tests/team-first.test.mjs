// Agree the team slug before any account read; never list every team (#35).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'skills', 'vercel-security-audit');
const SKILL = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
const CAPABILITIES = fs.readFileSync(path.join(SKILL_DIR, 'references', 'capabilities.md'), 'utf8');

test('slug is asked before account reads', () => {
  assert.ok(SKILL.includes('Ask for the team slug first'));
  assert.ok(CAPABILITIES.includes('Ask for the team slug before any account read'));
  assert.ok(SKILL.includes('copy it from their own dashboard URL'));
});

test('membership is confirmed for the agreed team only', () => {
  assert.ok(SKILL.includes('`team-check` read'));
  assert.ok(CAPABILITIES.includes('cli-read.mjs" team-check --scope "$team_slug"'));
  assert.ok(CAPABILITIES.includes('other teams are never printed or counted'));
});

test('teams list is never run directly', () => {
  assert.ok(SKILL.includes('Never run `vercel teams list` directly'));
  assert.equal(/^vercel teams list/m.exec(CAPABILITIES), null);
  assert.ok(!SKILL.includes('discover permitted teams'));
});
