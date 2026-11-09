// Bundled CLI reader: allow-listed output only, fixed failure kinds, no raw CLI text (#32).
//
// A fake `vercel` executable, put first on PATH (the reader has no option to run
// another executable, #79), replays synthetic JSON shaped like CLI 62.7.0 output
// (shapes verified with a keys-and-types-only probe). Canary values stand in for
// names, URLs, IPs and environment variable names that must never be printed.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const READER = path.join(ROOT, 'skills', 'vercel-security-audit', 'scripts', 'cli-read.mjs');
const CANARY = 'SYNTHETIC_READER_CANARY';

const FAKE_CLI = `#!${process.execPath}
const fs = require('fs');
const argv = process.argv.slice(2);
const fixtures = JSON.parse(fs.readFileSync(process.env.FAKE_FIXTURES, 'utf8'));
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(argv) + '\\n');
const out = (text) => fs.writeSync(1, text);
const err = (text) => fs.writeSync(2, text);
if (argv.length === 1 && argv[0] === '--version') {
  out((fixtures['--version'] ?? 'Vercel CLI 62.7.0') + '\\n'); process.exit(0);
}
const key = argv.filter((a) => a !== '--json' && a !== '--non-interactive').join(' ');
const entry = Object.prototype.hasOwnProperty.call(fixtures, key) ? fixtures[key] : null;
if (entry === null) { err('Error: no fixture ' + key + '\\n'); process.exit(1); }
if ('banner' in entry) {
  // A logged-out CLI starting the device-login flow, then waiting.
  (entry.stream === 'stdout' ? out : err)(entry.banner);
  setTimeout(() => process.exit(0), 60000);
} else if ('stderr' in entry) {
  out(entry.stdout ?? ''); err(entry.stderr); process.exit(entry.exit ?? 1);
} else {
  out(typeof entry.stdout === 'string' ? entry.stdout : JSON.stringify(entry.json));
  process.exit(entry.exit ?? 0);
}
`;
const LOGIN_BANNER = '> No existing credentials found. Starting login flow...\n'
  + `> Visit https://vercel.com/oauth/device?user_code=${CANARY}\n`;

/** Shaped like the CLI 62.7.0 writeAgentError payload (agent-output chunk). */
function agentError(reason, message) {
  return {
    status: 'error', reason, message, hint: `${CANARY} hint`,
    scope: CANARY.toLowerCase(), next: [{ command: `vercel ${CANARY}`, when: CANARY }],
  };
}

const LOGGED_OUT_WHOAMI = { stdout: JSON.stringify({ loggedIn: false, cliVersion: '65.3.1', linkedProject: null }), exit: 1 };

const SECURITY = { report: {
  'env-vars-plaintext': { violationsCount: 2, totalCount: 9, sampleType: ['envVar'],
    samples: [{ id: `prj_${CANARY}`, label: `${CANARY}-project`,
      samples: [{ id: 'env_1', label: `${CANARY}_SECRET_NAME` }] }] },
  'deployment-protection': { violationsCount: 0, totalCount: 4, sampleType: ['project'], samples: [] },
  'members-no-mfa': { violationsCount: 0, totalCount: 0, sampleType: ['user'], samples: [] },
  // Observed live on CLI 62.7.0: some checks omit totalCount.
  'depl-no-git-fork-protection': { violationsCount: 0, sampleType: ['project'], samples: [] },
  'odd-counts': { violationsCount: -1, totalCount: '3' },
  'string-total': { violationsCount: 0, totalCount: '3' },
  [`${CANARY}_ODD KEY`]: { violationsCount: 1 },
} };
const PROJECTS = { contextName: CANARY, elapsed: '1s', pagination: { count: 1, next: null, prev: 1 },
  projects: [{ id: 'prj_1', name: 'shop', deprecated: false, nodeVersion: '22.x',
    updatedAt: 1, latestProductionUrl: `https://${CANARY}.example` }] };
const FIREWALL = { firewallEnabled: true, attackMode: { enabled: false },
  botProtection: { enabled: true, action: null }, aiBots: { enabled: false, action: null },
  owasp: { enabled: false, action: null, requiresUpgrade: true, upgrade: `https://${CANARY}` },
  rules: { active: 2, inactive: 1, total: 3 }, draftChanges: 0, ipBlocks: 4,
  bypass: [], bypasses: { custom: { count: 1, skips: [CANARY], state: 'active' },
    system: { count: 0, skips: [], state: 'inactive' } },
  requestFlow: [{ id: 'managed-rules', state: 'active', configurable: true, label: CANARY,
    description: CANARY, rulesets: [{ id: 'owasp', state: 'unavailable', label: CANARY,
      unavailable: { reason: 'plan', upgrade: CANARY } }] }] };
const RULES = { hasDraft: true, pendingChanges: 1, managed: [{ action: 'deny', id: 'bot_filter', name: CANARY, wafRuleId: null }],
  rules: [{ active: true, name: CANARY, conditionGroup: [{ conditions: [{ type: 'header', key: `x-${CANARY}`, value: CANARY }] }] }] };
const TRAFFIC = { filter: null, period: { start: '2026-10-25T13:00:00Z', end: '2026-10-26T14:00:00Z', granularity: { hours: 1 } },
  series: [], stats: {}, topLists: [{ dimension: 'action', rows: [{ key: 'deny', value: 5 }, { key: '203.0.113.9', value: 1, ip: CANARY }] }] };
const INTEGRATIONS = { resources: [{ id: CANARY, installationId: CANARY, name: CANARY, product: 'Upstash for Redis',
  projects: [CANARY], status: 'available' }] };
const SCOPE = ['--scope', 'example-team'];
const PROJECT = [...SCOPE, '--project', 'prj_1'];
const FIXTURES = {
  whoami: { json: { username: 'example-user', email: `${CANARY}@example.test`, name: CANARY,
    team: { slug: CANARY, name: CANARY } } },
  'security check --scope example-team': { json: SECURITY },
  'teams list': { json: { pagination: { count: 3, next: null, prev: 1 }, teams: [
    { current: false, id: 'team_1', name: `${CANARY} Other Org`, plan: 'enterprise', slug: `${CANARY.toLowerCase()}-org` },
    { current: true, id: 'team_2', name: 'Example', plan: 'pro', slug: 'example-team' },
    { current: false, id: 'team_3', name: `${CANARY} Side`, plan: 'hobby', slug: `side-${CANARY.toLowerCase()}` }] } },
  'project ls --scope example-team': { json: PROJECTS },
  'firewall status --scope example-team --project prj_1': { json: FIREWALL },
  'firewall rules list --scope example-team --project prj_1': { json: RULES },
  'firewall traffic list --scope example-team --project prj_1 --since 24h --dimension action': { json: TRAFFIC },
  'integration list --scope example-team --all': { json: INTEGRATIONS },
  'domains list --scope example-team --limit 100': { json: { pagination: { count: 2, next: null, prev: null },
    domains: [{ name: `${CANARY}.example`, verified: true, id: CANARY, nameservers: [CANARY] },
      { name: `internal-${CANARY}.example`, verified: false, serviceType: CANARY }] } },
  // CLI 65.3.1 domains list item shape (#81); hostnames, registrars and creators are canaries.
  'domains list --scope shape-team --limit 100': { json: { pagination: { count: 3, next: null, prev: null },
    domains: [
      { name: `${CANARY}.example`, registrar: `${CANARY} Registrar`, nameservers: 'external',
        expiresAt: 1798761600000, createdAt: 1735689600000, creator: `${CANARY.toLowerCase()}-user` },
      { name: `shop.${CANARY.toLowerCase()}.example`, registrar: `Vercel ${CANARY}`, nameservers: 'vercel',
        expiresAt: '2027-01-01T00:00:00Z', createdAt: '2025-01-01T00:00:00.000+00:00', creator: CANARY },
      { name: `${CANARY}-odd.example`, registrar: CANARY, nameservers: CANARY.toLowerCase(),
        expiresAt: null, createdAt: -5, creator: CANARY }] } },
  'domains list --scope badtime-team --limit 100': { json: { pagination: { count: 6, next: null, prev: null },
    domains: [true, 1.5, '2026-13-01T00:00:00Z', '2026-01-02', `yesterday ${CANARY}`, { at: CANARY }]
      .map((value) => ({ nameservers: [`ns1.${CANARY}.example`], expiresAt: value, createdAt: value })) } },
  'domains list --scope page-team --limit 100': { json: { pagination: { count: 1, next: 555, prev: null },
    domains: [{ name: `${CANARY}-a.example`, verified: true }] } },
  'domains list --scope page-team --limit 100 --next 555': { json: { pagination: { count: 1, next: null, prev: 555 },
    domains: [{ name: `${CANARY}-b.example`, verified: false }] } },
  'webhooks list --scope example-team': { stdout: `not json ${CANARY}` },
  'activity --scope example-team --all --since 7d --limit 100': {
    stderr: `Error: ${CANARY} is forbidden (403)\n` },
  'project ls --scope page-team': { json: { ...PROJECTS, pagination: { count: 1, next: 111, prev: null } } },
  'project ls --scope page-team --next 111': { json: { ...PROJECTS, projects: [{ ...PROJECTS.projects[0], id: 'prj_2' }] } },
  'project ls --scope corrupt-team': { json: { ...PROJECTS, pagination: { count: 1, next: 222, prev: null } } },
  // What `echo "$json"` produced in #27: escapes interpreted, JSON corrupted.
  'project ls --scope corrupt-team --next 222': { stdout: `{"projects": [{"name": "a\\nb${CANARY}` },
  'project ls --scope loop-team': { json: { ...PROJECTS, pagination: { count: 1, next: 333, prev: null } } },
  'project ls --scope loop-team --next 333': { json: { ...PROJECTS, pagination: { count: 1, next: 333, prev: 1 } } },
  'project ls --scope nopage-team': { json: { projects: PROJECTS.projects } },
  // A pagination block that is present but malformed stays invalid_cursor (#84).
  'project ls --scope emptyblock-team': { json: { ...PROJECTS, pagination: { count: 1 } } },
  'project ls --scope nullblock-team': { json: { ...PROJECTS, pagination: null } },
  'project ls --scope badcursor-team': { json: { ...PROJECTS, pagination: { next: `../${CANARY}` } } },
  'project ls --scope halfpage-team': { json: { ...PROJECTS, pagination: { count: 1, next: 444, prev: null } } },
  'project ls --scope halfpage-team --next 444': { json: { projects: [{ ...PROJECTS.projects[0], id: 'prj_2' }] } },
  // Activity with no pagination block at all: the shape is unverified, so the end is not reported.
  'activity --scope example-team --all --since 24h --limit 100': { json: {
    scope: { teamSlug: CANARY.toLowerCase() },
    events: [{ type: 'project-created', createdAt: 3, text: CANARY },
      { type: 'project-created', createdAt: 2, text: CANARY },
      { type: 'team-member-joined', createdAt: 1, user: { email: CANARY } }] } },
  // The CLI 62.7.0 source shape: pagination.next is the last event's createdAt - 1, or null.
  'activity --scope example-team --all --since 30d --limit 100': { json: {
    events: [{ type: 'project-created', createdAt: 10 }], pagination: { next: 9 } } },
  'activity --scope example-team --all --since 30d --limit 100 --next 9': { json: {
    events: [{ type: 'deployment', createdAt: 8 }], pagination: { next: null } } },
  // Shapes the CLI 65.3.1 statusOf reads (#77): no access and muted must never pass.
  'security check --scope muted-team': { json: { posture: { mutedCount: 3 }, report: {
    'members-no-mfa': { unavailable: true, unavailableReason: 'insufficient-permissions', violationsCount: 0 },
    'pats-no-expiration': { unavailableReason: 'muted', mutedCount: 3, violationsCount: 0 },
    'no-count-unavailable': { unavailable: true },
    'reason-only': { unavailableReason: `${CANARY}-reason`, violationsCount: 0, totalCount: 5 },
    'partly-muted': { violationsCount: 0, totalCount: 4, mutedCount: 2 },
    'muted-with-open': { violationsCount: 1, totalCount: 4, mutedCount: 2 },
    clean: { violationsCount: 0, totalCount: 4, mutedCount: 0 },
    'flag-false': { unavailable: false, violationsCount: 0, totalCount: 2, mutedCount: '2' },
  } } },
  'security check --scope old-team': {
    stderr: 'Error: "security" is not a valid target directory or subcommand. Did you mean "cert"?\n' },
  // Agent-mode error payloads (#79): only the reason is used; message, hint, scope and next never are.
  'security check --scope agent-permission-team': { exit: 1, stdout: JSON.stringify(agentError(
    'forbidden', `Not found (404): ${CANARY}`)) },
  'project ls --scope agent-stderr-team': { exit: 1, stdout: '', stderr: JSON.stringify(agentError(
    'project_not_found', `You do not have permission ${CANARY}`)) },
  'webhooks list --scope agent-unknown-team': { exit: 1, stdout: JSON.stringify(agentError(
    `${CANARY.toLowerCase()}_reason`, 'Forbidden (403)')) },
  'webhooks list --scope agent-typed-team': { exit: 1, stdout: JSON.stringify({ ...agentError('x', 'x'), reason: 403 }) },
  'webhooks list --scope agent-precedence-team': { exit: 1, stdout: JSON.stringify(agentError('api_error', CANARY)),
    stderr: `Error: ${CANARY} (403)\n` },
  'integration list --scope agent-401-team --all': { exit: 1, stdout: JSON.stringify(agentError('not_authorized', CANARY)) },
  'integration list --scope agent-plan-team --all': { exit: 2, stdout: JSON.stringify(agentError('PLAN_UPGRADE_REQUIRED', CANARY)) },
  // Plain stderr: names containing "permission" or "404" must not decide the kind.
  'firewall status --scope example-team --project permission-404-site': {
    stderr: 'Error: Project permission-404-site could not be loaded\nError: permission-404-site not found\n' },
  'firewall overview --scope example-team --project permission-404-site': {
    stderr: 'Error: permission-404-site: forbidden permission 403 404\n' },
  'firewall status --scope example-team --project denied-site': {
    stderr: 'Error: You do not have permission to access project "denied-site" in team "example-team".\n' },
  'firewall status --scope example-team --project missing-site': { stderr: 'Error: Project not found (404)\n' },
  'firewall status --scope example-team --project expired-site': { stderr: 'Error: The token is not valid (401).\n' },
};

/** shutil.which for a single command name. */
function which(name, searchPath) {
  for (const dir of searchPath.split(path.delimiter)) {
    const candidate = path.join(dir, name);
    try {
      if (fs.statSync(candidate).isFile()) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch {
      // not here
    }
  }
  return null;
}

let ctx;

beforeEach(() => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-reader-'));
  const cli = path.join(directory, 'vercel');
  fs.writeFileSync(cli, FAKE_CLI, 'utf8');
  fs.chmodSync(cli, fs.statSync(cli).mode | 0o100);
  const fixtures = path.join(directory, 'fixtures.json');
  fs.writeFileSync(fixtures, JSON.stringify(FIXTURES), 'utf8');
  const log = path.join(directory, 'argv.log');
  // The fake shadows any real CLI: the reader resolves `vercel` through PATH.
  const searchPath = directory + path.delimiter + (process.env.PATH ?? '/bin:/usr/bin');
  assert.equal(which('vercel', searchPath), cli);
  ctx = { directory, cli, fixtures, log, path: searchPath };
});

afterEach(() => {
  fs.rmSync(ctx.directory, { recursive: true, force: true });
});

function read(args, { version = null, overrides = null, path: searchPath = null } = {}) {
  if (version || overrides) {
    const data = { ...FIXTURES, ...(version ? { '--version': version } : {}), ...(overrides ?? {}) };
    fs.writeFileSync(ctx.fixtures, JSON.stringify(data), 'utf8');
  }
  const env = { ...process.env, FAKE_FIXTURES: ctx.fixtures, FAKE_LOG: ctx.log,
    PATH: searchPath === null ? ctx.path : searchPath };
  const result = spawnSync(process.execPath, [READER, ...args], { encoding: 'utf8', timeout: 30000, env });
  const out = { returncode: result.status, stdout: result.stdout, stderr: result.stderr };
  assert.ok(!(out.stdout + out.stderr).includes(CANARY));
  assert.ok(!out.stderr.includes('Traceback'));
  return out;
}

function ok(...args) {
  const result = read(args);
  assert.equal(result.returncode, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

function failure(...args) {
  const result = read(args);
  assert.equal(result.returncode, 1, result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.coverage.complete, false);
  return output;
}

function argvLog() {
  return fs.readFileSync(ctx.log, 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
}

const importReader = () => import(pathToFileURL(READER).href);

test('every read uses json non interactive and no shell', () => {
  ok('security-check', ...SCOPE);
  const argv = argvLog().at(-1);
  assert.deepEqual(argv.slice(-2), ['--json', '--non-interactive']);
  assert.deepEqual(argv.slice(0, 2), ['security', 'check']);
});

test('security check keeps counts and drops samples', () => {
  const output = ok('security-check', ...SCOPE);
  const { checks } = output.result;
  assert.deepEqual(checks['env-vars-plaintext'], { checklistId: 'unmapped', productResult: 'violations_found',
    violationsCount: 2, totalCount: 9, mutedCount: 'unknown', unavailableReason: null,
    sampleType: ['envVar'], samplesReceived: 1 });
  assert.equal(checks['deployment-protection'].violationsCount, 0);
  assert.equal(output.result.withheldCheckKeys, 1);
});

test('security check attaches checklist ids and flags unknown slugs', () => {
  const { checks } = ok('security-check', ...SCOPE).result;
  // A known slug carries its mapped checklist ID.
  assert.equal(checks['members-no-mfa'].checklistId, 'IAM-02');
  // A known slug whose totalCount is omitted is still mapped, and the total stays unknown.
  assert.equal(checks['depl-no-git-fork-protection'].checklistId, 'SRC-03');
  assert.equal(checks['depl-no-git-fork-protection'].totalCount, 'unknown');
  assert.equal(checks['depl-no-git-fork-protection'].productResult, 'no_violations_total_unreported');
  // Slugs outside the documented table are kept and marked, not dropped.
  for (const slug of ['env-vars-plaintext', 'deployment-protection', 'odd-counts', 'string-total']) {
    assert.equal(checks[slug].checklistId, 'unmapped');
  }
  // Only checklistId was added to the per-check fields.
  assert.deepEqual(new Set(Object.keys(checks['members-no-mfa'])), new Set(['checklistId', 'productResult', 'violationsCount',
    'totalCount', 'mutedCount', 'unavailableReason', 'sampleType', 'samplesReceived']));
});

test('checklist id table matches capabilities and checklist', async () => {
  const cliRead = await importReader();
  const skill = path.dirname(path.dirname(READER));
  const capabilities = fs.readFileSync(path.join(skill, 'references', 'capabilities.md'), 'utf8');
  const table = capabilities.split('### Product check slugs').slice(1).join('### Product check slugs').split('\n### ')[0];
  const documented = Object.fromEntries([...table.matchAll(/^- `([a-z0-9-]+)`: ([A-Z]{3}-\d{2})\b/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(documented, { ...cliRead.CHECKLIST_IDS });
  assert.equal(Object.keys(documented).length, 9);
  assert.ok(table.includes(`CLI ${cliRead.CHECK_SLUG_VERSION}`));
  const checklist = fs.readFileSync(path.join(skill, 'references', 'checklist.md'), 'utf8');
  const core = new Set([...checklist.split('## Optional deeper')[0].matchAll(/^### ([A-Z]{3}-\d{2})/gm)].map((m) => m[1]));
  for (const id of new Set(Object.values(cliRead.CHECKLIST_IDS))) assert.ok(core.has(id), id);
});

test('security check mapping is conservative and muted is unknown without fields', () => {
  const output = ok('security-check', ...SCOPE).result;
  const results = Object.fromEntries(Object.entries(output.checks).map(([key, value]) => [key, value.productResult]));
  assert.deepEqual(results, { 'env-vars-plaintext': 'violations_found', 'deployment-protection': 'no_violations',
    'members-no-mfa': 'nothing_evaluated', 'depl-no-git-fork-protection': 'no_violations_total_unreported',
    'odd-counts': 'unknown', 'string-total': 'unknown' });
  // CLI 62.7.0 output carries no muted fields: muted state is unknown, never "nothing muted".
  assert.equal(output.mutedDetectable, 'unknown');
  assert.equal(output.postureMutedCount, 'unknown');
});

test('unavailable and muted checks never pass', () => {
  const output = ok('security-check', '--scope', 'muted-team').result;
  const { checks } = output;
  const results = Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, value.productResult]));
  assert.deepEqual(results, { 'members-no-mfa': 'unavailable', 'pats-no-expiration': 'muted',
    'no-count-unavailable': 'unavailable', 'reason-only': 'unavailable',
    'partly-muted': 'muted', 'muted-with-open': 'violations_found',
    clean: 'no_violations', 'flag-false': 'no_violations' });
  assert.equal(checks['members-no-mfa'].unavailableReason, 'insufficient_permissions');
  assert.equal(checks['no-count-unavailable'].unavailableReason, 'other');
  // Unknown reason strings map to "other" and are never echoed (the read() helper checks the canary).
  assert.equal(checks['reason-only'].unavailableReason, 'other');
  assert.equal(checks['pats-no-expiration'].mutedCount, 3);
  assert.equal(checks['pats-no-expiration'].unavailableReason, 'muted');
  assert.equal(checks['flag-false'].mutedCount, 'unknown');
  assert.equal(output.postureMutedCount, 3);
  // Not every check reports mutedCount, so muted state is not fully known.
  assert.equal(output.mutedDetectable, 'unknown');
});

test('no unavailable input produces a passing result', async () => {
  const cliRead = await importReader();
  const passing = new Set(['no_violations', 'no_violations_total_unreported']);
  for (const flag of [true, false, null, 'yes', 1, 'absent']) {
    for (const reason of ['muted', 'insufficient-permissions', 'other-thing', 7, null, 'absent']) {
      for (const counts of [{}, { violationsCount: 0 }, { violationsCount: 0, totalCount: 3 }]) {
        const check = { ...counts };
        if (flag !== 'absent') check.unavailable = flag;
        if (reason !== 'absent') check.unavailableReason = reason;
        const flagged = !['absent', null, false].includes(flag) || !['absent', null].includes(reason);
        const result = cliRead.selectSecurityCheck({ report: { c: check } }).checks.c;
        if (flagged) assert.ok(!passing.has(result.productResult), JSON.stringify(check));
      }
    }
  }
  const every = cliRead.selectSecurityCheck({ report: { a: { violationsCount: 0, totalCount: 1, mutedCount: 0 },
    b: { unavailableReason: 'muted' } } });
  assert.equal(every.mutedDetectable, true);
});

test('whoami keeps username only', () => {
  assert.deepEqual(ok('whoami').result, { username: 'example-user' });
});

test('project inventory drops urls and reports end of list', () => {
  const output = ok('project-ls', ...SCOPE);
  assert.deepEqual(new Set(Object.keys(output.result.projects[0])),
    new Set(['id', 'name', 'deprecated', 'nodeVersion', 'updatedAt']));
  assert.deepEqual(output.coverage, { pages: 1, endOfList: 'known', complete: true });
});

test('firewall status keeps states and entitlement reason only', () => {
  const { result } = ok('firewall-status', ...PROJECT);
  assert.deepEqual(result.rules, { active: 2, inactive: 1, total: 3 });
  assert.deepEqual(result.owasp, { enabled: false, action: null, requiresUpgrade: true });
  assert.equal(result.requestFlow[0].rulesets[0].unavailableReason, 'plan');
  assert.deepEqual(result.bypasses.custom, { count: 1, state: 'active' });
});

test('firewall rules never print conditions', () => {
  const { result } = ok('firewall-rules', ...PROJECT);
  assert.deepEqual(result.customRules, [{ active: true }]);
  assert.deepEqual(result.managedRulesets, [{ id: 'bot_filter', action: 'deny' }]);
});

test('traffic rows withhold non enum keys', () => {
  const { rows } = ok('firewall-traffic', ...PROJECT).result.topLists[0];
  assert.deepEqual(rows[0], { key: 'deny', value: 5 });
  assert.deepEqual(rows[1], { key: 'unknown', value: 1 });
});

test('integrations keep product status and project count', () => {
  assert.deepEqual(ok('integrations', ...SCOPE).result,
    { resources: [{ product: 'Upstash for Redis', status: 'available', projectCount: 1 }] });
});

test('domains use synthetic aliases and keep boolean flags', () => {
  const output = ok('domains', ...SCOPE);
  const unknown = { nameservers: 'unknown', expiresAt: 'unknown', createdAt: 'unknown' };
  assert.deepEqual(output.result, { domainsCount: 2, domains: [
    { ...unknown, alias: 'domain-1', flags: { verified: true } },
    { ...unknown, alias: 'domain-2', flags: { verified: false } }] });
  assert.ok(!JSON.stringify(output).includes('.example'));
});

test('domains keep nameservers and dates from the cli shape', () => {
  const output = ok('domains', '--scope', 'shape-team');
  assert.deepEqual(output.result, { domainsCount: 3, domains: [
    { alias: 'domain-1', nameservers: 'external', expiresAt: 1798761600000, createdAt: 1735689600000, flags: {} },
    { alias: 'domain-2', nameservers: 'vercel', expiresAt: '2027-01-01T00:00:00Z',
      createdAt: '2025-01-01T00:00:00.000+00:00', flags: {} },
    { alias: 'domain-3', nameservers: 'unknown', expiresAt: 'unknown', createdAt: 'unknown', flags: {} }] });
  const text = JSON.stringify(output);
  for (const withheld of ['.example', 'Registrar', 'Vercel ', '-user', '"name"', '"registrar"', '"creator"']) {
    assert.ok(!text.includes(withheld), withheld);
  }
});

test('unvalidated domain dates and nameservers are unknown', () => {
  const { domains } = ok('domains', '--scope', 'badtime-team').result;
  assert.equal(domains.length, 6);
  for (const domain of domains) {
    assert.deepEqual({ nameservers: domain.nameservers, expiresAt: domain.expiresAt, createdAt: domain.createdAt },
      { nameservers: 'unknown', expiresAt: 'unknown', createdAt: 'unknown' });
  }
});

test('team check reports only the agreed team', () => {
  const output = ok('team-check', ...SCOPE);
  assert.deepEqual(output.result, { member: true, plan: 'pro', current: true });
  assert.ok(!JSON.stringify(output).includes(CANARY.toLowerCase()));
  assert.ok(!JSON.stringify(output).includes('enterprise'));
  assert.deepEqual(ok('team-check', '--scope', 'not-mine').result, { member: false });
  const result = read(['team-check']);
  assert.equal(result.returncode, 2);
});

test('pagination follows next until explicit end', () => {
  const output = ok('project-ls', '--scope', 'page-team');
  assert.deepEqual(output.result.projects.map((p) => p.id), ['prj_1', 'prj_2']);
  assert.deepEqual(output.coverage, { pages: 2, endOfList: 'known', complete: true });
  // Flags are separate argv elements, never one word-split string (the zsh $FLAGS pitfall).
  assert.ok(argvLog().some((argv) => JSON.stringify(argv) === JSON.stringify(
    ['project', 'ls', '--scope', 'page-team', '--next', '111', '--json', '--non-interactive'])));
});

test('domain pages merge with unique aliases', () => {
  const output = ok('domains', '--scope', 'page-team');
  assert.deepEqual(output.result.domains.map((d) => d.alias), ['domain-1', 'domain-2']);
  assert.equal(output.result.domainsCount, 2);
  assert.equal(output.coverage.complete, true);
});

test('parse failure on a later page is incomplete not end of list', () => {
  const output = failure('project-ls', '--scope', 'corrupt-team');
  assert.equal(output.failure, 'invalid_json');
  assert.deepEqual(output.coverage, { pages: 1, endOfList: 'not_reached', complete: false, stoppedBecause: 'invalid_json' });
  assert.equal(output.partialResult.projects.length, 1);
});

test('repeated cursor page cap and malformed pagination are incomplete', () => {
  assert.equal(failure('project-ls', '--scope', 'loop-team').failure, 'repeated_cursor');
  const capped = failure('project-ls', '--scope', 'page-team', '--max-pages', '1');
  assert.equal(capped.failure, 'page_cap_reached');
  assert.equal(capped.coverage.pages, 1);
  for (const scope of ['emptyblock-team', 'nullblock-team', 'badcursor-team']) {
    const output = failure('project-ls', '--scope', scope);
    assert.equal(output.failure, 'invalid_cursor', scope);
    assert.equal(output.coverage.stoppedBecause, 'invalid_cursor', scope);
  }
  assert.equal(read(['project-ls', '--scope', 'page-team', '--max-pages', '0']).returncode, 2);
});

test('missing pagination block returns data with end not reported', () => {
  const notReported = { endOfList: 'not_reported', complete: 'unknown', reason: 'no_pagination_block' };
  const output = ok('activity', ...SCOPE);
  assert.deepEqual(output.result, { eventsCount: 3, eventTypes: { 'project-created': 2, 'team-member-joined': 1 } });
  assert.deepEqual(output.coverage, { ...notReported, pages: 1 });
  assert.deepEqual(ok('project-ls', '--scope', 'nopage-team').coverage, { ...notReported, pages: 1 });
  const later = ok('project-ls', '--scope', 'halfpage-team');
  assert.deepEqual(later.result.projects.map((p) => p.id), ['prj_1', 'prj_2']);
  assert.deepEqual(later.coverage, { ...notReported, pages: 2 });
});

test('activity follows the numeric cursor to an explicit end', () => {
  const output = ok('activity', ...SCOPE, '--since', '30d');
  assert.deepEqual(output.result, { eventsCount: 2, eventTypes: { 'project-created': 1, deployment: 1 } });
  assert.deepEqual(output.coverage, { pages: 2, endOfList: 'known', complete: true });
});

test('page one failures carry coverage', () => {
  const output = failure('activity', ...SCOPE, '--since', '7d');
  assert.equal(output.failure, 'permission');
  assert.deepEqual(output.coverage, { pages: 0, complete: false, stoppedBecause: 'permission' });
  assert.ok(!('partialResult' in output));
  const loggedOut = JSON.parse(read(['domains', ...SCOPE], { overrides: { whoami: LOGGED_OUT_WHOAMI } }).stdout);
  assert.deepEqual(loggedOut.coverage, { pages: 0, complete: false, stoppedBecause: 'not_authenticated' });
  // Reads that are not paginated keep the plain incomplete marker.
  assert.deepEqual(failure('webhooks', ...SCOPE).coverage, { complete: false });
});

test('failures are fixed kinds without cli text', () => {
  assert.equal(failure('webhooks', ...SCOPE).failure, 'invalid_json');
  assert.equal(failure('activity', ...SCOPE, '--since', '7d').failure, 'permission');
});

test('there is no option to run another executable', () => {
  const helpText = read(['--help']).stdout;
  assert.ok(helpText.includes('--max-pages'));
  assert.ok(!helpText.includes('--cli'));
  const other = path.join(ctx.directory, 'other.sh');
  fs.writeFileSync(other, '#!/bin/sh\necho ran > "$FAKE_LOG"\n', 'utf8');
  fs.chmodSync(other, fs.statSync(other).mode | 0o100);
  for (const flag of [['--cli', other], [`--cli=${other}`]]) {
    const result = read(['whoami', ...flag]);
    assert.equal(result.returncode, 2, JSON.stringify(flag));
    assert.equal(result.stdout, '');
  }
  assert.ok(!fs.existsSync(ctx.log));
  const source = fs.readFileSync(READER, 'utf8');
  assert.ok(!source.includes('--cli'));
  assert.ok(!source.includes('os.environ'));
  // Node equivalent of the os.environ check: PATH (read the way Python's subprocess reads it)
  // is the only environment variable the reader looks at, so none can redirect it.
  const envReads = [...source.matchAll(/process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[)?/g)].map((m) => m[1] ?? null);
  assert.deepEqual([...new Set(envReads)], ['PATH']);
});

test('without vercel on path the cli is unavailable', () => {
  const empty = path.join(ctx.directory, 'empty');
  fs.mkdirSync(empty);
  const output = JSON.parse(read(['whoami'], { path: empty }).stdout);
  assert.equal(output.failure, 'cli_unavailable');
  assert.ok(!fs.existsSync(ctx.log));
});

function assertOnlyTheKind(output, kind) {
  assert.equal(output.failure, kind);
  const allowed = new Set(['read', 'ok', 'failure', 'coverage', 'note']);
  for (const key of Object.keys(output)) assert.ok(allowed.has(key), key);
  assert.ok(!JSON.stringify(output).includes('hint'));
}

test('structured agent reason decides the kind', () => {
  // The message says 404 and the hint names the scope; the reason still decides.
  assertOnlyTheKind(failure('security-check', '--scope', 'agent-permission-team'), 'permission');
  assertOnlyTheKind(failure('project-ls', '--scope', 'agent-stderr-team'), 'not_found');
  const output = failure('integrations', '--scope', 'agent-401-team');
  assertOnlyTheKind(output, 'not_authenticated');
  assert.ok(output.note.includes('vercel login'));
  assertOnlyTheKind(failure('integrations', '--scope', 'agent-plan-team'), 'plan_required');
});

test('unknown or mistyped reasons are cli errors without substring guessing', () => {
  for (const scope of ['agent-unknown-team', 'agent-typed-team', 'agent-precedence-team']) {
    assertOnlyTheKind(failure('webhooks', '--scope', scope), 'cli_error');
  }
});

test('plain stderr names do not decide the kind', () => {
  for (const name of ['firewall-status', 'firewall-overview']) {
    const output = failure(name, ...SCOPE, '--project', 'permission-404-site');
    assertOnlyTheKind(output, 'cli_error');
    assert.ok(!JSON.stringify(output).includes('permission-404-site'));
  }
});

test('anchored cli phrases still classify plain stderr', () => {
  for (const [project, kind] of [['denied-site', 'permission'], ['missing-site', 'not_found'],
    ['expired-site', 'not_authenticated']]) {
    assertOnlyTheKind(failure('firewall-status', ...SCOPE, '--project', project), kind);
  }
});

test('missing security command is a capability gap', () => {
  const output = failure('security-check', '--scope', 'old-team');
  assert.equal(output.failure, 'unknown_command');
  assert.ok(output.note.includes('upgrade the CLI'));
});

function loggedOut(args, overrides) {
  const started = performance.now();
  const result = read(args, { overrides });
  const elapsed = (performance.now() - started) / 1000;
  assert.equal(result.returncode, 1, result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.failure, 'not_authenticated');
  assert.equal(output.coverage.complete, false);
  assert.ok(output.note.includes('vercel login'));
  assert.ok(!(result.stdout + result.stderr).includes('oauth/device'));
  assert.ok(!(result.stdout + result.stderr).includes('user_code'));
  return elapsed;
}

test('logged out whoami is not authenticated', () => {
  assert.ok(loggedOut(['whoami'], { whoami: LOGGED_OUT_WHOAMI }) < 10);
});

test('logged out account reads stop before the real command', () => {
  // The real command would start a device-login flow; it must never run.
  const overrides = { whoami: LOGGED_OUT_WHOAMI, 'teams list': { banner: LOGIN_BANNER },
    'security check --scope example-team': { banner: LOGIN_BANNER } };
  for (const args of [['team-check', ...SCOPE], ['security-check', ...SCOPE]]) {
    fs.rmSync(ctx.log, { force: true });
    assert.ok(loggedOut(args, overrides) < 20, JSON.stringify(args));
    assert.deepEqual(argvLog(), [['whoami', '--json', '--non-interactive']], JSON.stringify(args));
  }
});

test('a login flow that starts anyway is stopped at once', () => {
  for (const stream of ['stderr', 'stdout']) {
    let overrides = { 'teams list': { banner: LOGIN_BANNER, stream } };
    assert.ok(loggedOut(['team-check', ...SCOPE], overrides) < 20, stream);
    // The preflight itself hanging on a login flow is caught the same way.
    overrides = { whoami: { banner: LOGIN_BANNER, stream } };
    assert.ok(loggedOut(['project-ls', ...SCOPE], overrides) < 20, stream);
  }
});

test('login handoff is documented', () => {
  const skillDir = path.dirname(path.dirname(READER));
  const capabilities = fs.readFileSync(path.join(skillDir, 'references', 'capabilities.md'), 'utf8');
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.ok(capabilities.includes('confirms the CLI is logged in with a short `whoami` check'));
  assert.ok(capabilities.includes('Never start, open or relay a device-login URL or code'));
  assert.ok(skill.includes('ask them to run `vercel login` themselves'));
});

test('account reads check login first', () => {
  ok('project-ls', ...SCOPE);
  assert.deepEqual(argvLog()[0], ['whoami', '--json', '--non-interactive']);
  assert.deepEqual(argvLog()[1].slice(0, 2), ['project', 'ls']);
});

test('version compares against minimum tested', () => {
  const old = JSON.parse(read(['version'], { version: 'Vercel CLI 54.18.0' }).stdout).result;
  assert.equal(old.olderThanMinimumTested, true);
  const recent = JSON.parse(read(['version'], { version: 'Vercel CLI 65.0.0' }).stdout).result;
  assert.equal(recent.olderThanMinimumTested, false);
  assert.equal(recent.minimumTested, '62.7.0');
});

test('identifiers cannot inject flags and scope is required', () => {
  for (const args of [['security-check', '--scope', '--token'], ['security-check', '--scope=-t'],
    ['firewall-status', ...SCOPE], ['project-ls'], ['unknown-read', ...SCOPE],
    ['activity', ...SCOPE, '--since', '1y']]) {
    const result = read(args);
    assert.equal(result.returncode, 2, JSON.stringify(args));
    assert.equal(result.stdout, '');
  }
  assert.ok(!fs.existsSync(ctx.log));
});
