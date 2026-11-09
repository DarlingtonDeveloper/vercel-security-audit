// Owner-only reports may have a separate private alias legend (#51); offline document contract.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'skills', 'vercel-security-audit');

let legend;

beforeEach(() => {
  const text = fs.readFileSync(path.join(SKILL, 'references', 'report-template.md'), 'utf8');
  const marker = '## Private alias legend (optional)';
  const index = text.indexOf(marker);
  assert.ok(index >= 0, marker);
  legend = text.slice(index + marker.length).split('\n## ')[0];
});

test('legend is separate and never rendered', () => {
  for (const clause of ['Synthetic aliases stay mandatory in the report itself', 'separate file',
    'Never embed it in the Markdown, JSON model, HTML or PDF',
    'never pass it to the renderer or QA script', 'never overwrite an existing one',
    'Do not share, attach or publish.']) {
    assert.ok(legend.includes(clause), clause);
  }
});

test('cli reader aliases need an owner supplied mapping', () => {
  // The reader never returns hostnames, so domain-N legend entries come only from the owner (#86).
  for (const clause of ['(capabilities.md#what-counts-as-field-selection-before-exposure)',
    'The bundled CLI reader never returns hostnames', '`domain-N` aliases',
    'no legend entry for a `domain-N` alias can come from reader output',
    'ask the owner to supply the mapping', 'supplied by owner',
    'Never read names some other way', 'stay unmapped']) {
    assert.ok(legend.includes(clause), clause);
  }
  const reader = fs.readFileSync(path.join(SKILL, 'scripts', 'cli-read.mjs'), 'utf8');
  assert.ok(reader.includes('hostnames, registrars and creators never leave the reader'));
  assert.ok(!reader.includes('--legend-file'));
});

test('legend excludes people and secrets', () => {
  for (const clause of ['team, project, environment and domain aliases', 'already returned by authorised inventory reads',
    'Never include people', 'credentials', 'environment values']) {
    assert.ok(legend.includes(clause), clause);
  }
});

test('skill links the legend rules', () => {
  const step = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8').split('### 5.').slice(1).join('### 5.').split('### 6.')[0];
  assert.ok(step.includes('(references/report-template.md#private-alias-legend-optional)'));
  assert.ok(step.includes('never part of the report'));
});
