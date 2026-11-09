// The pre-exposure gate names the mechanisms that count, with examples (#33).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'skills', 'vercel-security-audit');
const REFS = path.join(SKILL_DIR, 'references');
const ANCHOR = 'capabilities.md#what-counts-as-field-selection-before-exposure';

let section;

beforeEach(() => {
  const text = fs.readFileSync(path.join(REFS, 'capabilities.md'), 'utf8');
  const start = text.indexOf('## What counts as field selection before exposure');
  assert.ok(start >= 0);
  const end = text.indexOf('\n## ', start + 1);
  assert.ok(end >= 0);
  section = text.slice(start, end);
});

test('only bundled or verified mechanisms count', () => {
  for (const phrase of ['Only these mechanisms count', 'the bundled reader, `scripts/cli-read.mjs`',
    'verified response contract is metadata-only',
    'verified to take no automatic screenshot, snapshot or accessibility-tree capture',
    'Write the selector before navigating']) {
    assert.ok(section.includes(phrase), phrase);
  }
});

test('ad hoc and after the fact selection do not count', () => {
  for (const phrase of ['An ad-hoc filter written during the audit', '| jq',
    'after the output, page text or image has already reached the model',
    'Saving raw output to a file', 'document.body.innerText',
    'Instructions to the model to ignore']) {
    assert.ok(section.includes(phrase), phrase);
  }
});

test('worked examples cover cli and browser', () => {
  assert.ok(section.includes('Acceptable CLI read:'));
  assert.ok(section.includes('Acceptable browser read'));
  assert.ok(section.includes('Not acceptable:'));
});

test('no mechanism routes to owner statement before not reviewed', () => {
  assert.ok(section.includes('does not automatically make it not_reviewed'));
  assert.ok(section.includes('Record which mechanism was used'));
});

test('gate references link to the definition', () => {
  for (const file of [path.join(SKILL_DIR, 'SKILL.md'), path.join(REFS, 'mcp-boundary.md'), path.join(REFS, 'browser-evidence.md')]) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.includes(ANCHOR) || text.includes(ANCHOR.split('#')[1]), path.basename(file));
  }
});
