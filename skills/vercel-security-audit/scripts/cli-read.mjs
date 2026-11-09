#!/usr/bin/env node
/**
 * Run one documented, read-only Vercel CLI command and print only allow-listed fields.
 *
 * Standard library only. The command runs as an argument list (no shell), always
 * with --json and --non-interactive, and its raw output never leaves this process:
 * only the bundled selector's fields are printed. CLI stderr is never echoed;
 * failures are classified into fixed, value-free kinds. This is the bundled
 * field-selection mechanism for CLI account reads, not a secret scanner.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

export const MINIMUM_TESTED_VERSION = Object.freeze([62, 7, 0]);
// Always the `vercel` on PATH, as in the user's shell. There is deliberately no option or
// variable that points the reader at another executable (#79); tests put a fake `vercel`
// first on PATH instead.
export const CLI = 'vercel';
export const TIMEOUT_SECONDS = 90;
// Login preflight before every account read: a logged-out CLI must fail fast, not start a device flow.
export const AUTH_TIMEOUT_SECONDS = 15;
// Seen when a logged-out CLI starts the device-login flow even with --non-interactive (CLI 65.3.1).
export const LOGIN_FLOW_MARKERS = Object.freeze(['starting login flow', 'oauth/device', 'no existing credentials found']);
export const MAX_OUTPUT_BYTES = 8_000_000;
// Agreed identifiers only: no leading dash, so they can never become CLI flags.
// All patterns are anchored: they are used as Python fullmatch.
export const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
export const SINCE = /^[1-9][0-9]{0,3}[mhd]$/;
export const CHECK_KEY = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const ENUM = /^[a-z][a-z0-9_.:-]{0,39}$/;
// Sample type labels are camelCase product words; UPPER_SNAKE (env var names) never matches.
export const SAMPLE_TYPE = /^[a-z][a-zA-Z0-9]{0,39}$/;
// Marketplace product names, e.g. "Neon" or "Upstash for Redis".
export const PRODUCT = /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,39}$/;
export const UNKNOWN = 'unknown';

/** A fixed, value-free failure kind; never carries CLI output. */
export class ReaderError extends Error {
  constructor(kind, coverage = null) {
    super(kind);
    this.kind = kind;
    this.coverage = coverage;
  }
}

// --- Python value model. Parsed JSON objects are null-prototype objects, JSON integers
// are numbers (BigInt beyond the safe range) and JSON floats are PyFloat, so that Python's
// int/float distinction (type(v) is int) is kept.

export class PyFloat {
  constructor(value) {
    this.value = value;
  }
}

function isDict(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof PyFloat);
}

function isInt(value) {
  return (typeof value === 'number' && Number.isInteger(value)) || typeof value === 'bigint';
}

function isStr(value) {
  return typeof value === 'string';
}

function hasKey(dict, key) {
  return Object.prototype.hasOwnProperty.call(dict, key);
}

function entries(dict) {
  return Object.keys(dict).map((key) => [key, dict[key]]);
}

function fullmatch(pattern, value) {
  return pattern.test(value);
}

function newDict() {
  return Object.create(null);
}

const JSON_WS = ' \t\n\r';
const NUMBER_AT = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;
const HEX4 = /^[0-9a-fA-F]{4}$/;
// Python 3.11+ int() refuses decimal strings above 4300 digits (ValueError).
const INT_MAX_STR_DIGITS = 4300;

class PyJSONDecodeError extends Error {}

/** Python json.loads semantics (NaN/Infinity accepted, int vs float kept); iterative, no depth limit. */
export function pyJsonLoads(text) {
  let i = 0;
  const n = text.length;
  const fail = () => { throw new PyJSONDecodeError('invalid JSON'); };
  const skip = () => { while (i < n && JSON_WS.includes(text[i])) i += 1; };

  const parseString = () => {
    // text[i] === '"'
    i += 1;
    let out = '';
    let start = i;
    for (;;) {
      if (i >= n) fail();
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        out += text.slice(start, i);
        i += 1;
        return out;
      }
      if (c < 0x20) fail();
      if (c === 0x5c) {
        out += text.slice(start, i);
        const e = text[i + 1];
        if (e === undefined) fail();
        if (e === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!HEX4.test(hex)) fail();
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else {
          const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
          if (!hasKey(map, e)) fail();
          out += map[e];
          i += 2;
        }
        start = i;
        continue;
      }
      i += 1;
    }
  };

  const parseScalar = () => {
    const c = text[i];
    if (c === '"') return parseString();
    if (text.startsWith('null', i)) { i += 4; return null; }
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    if (text.startsWith('NaN', i)) { i += 3; return new PyFloat(NaN); }
    if (text.startsWith('Infinity', i)) { i += 8; return new PyFloat(Infinity); }
    if (text.startsWith('-Infinity', i)) { i += 9; return new PyFloat(-Infinity); }
    NUMBER_AT.lastIndex = i;
    const match = NUMBER_AT.exec(text);
    if (!match) fail();
    i += match[0].length;
    if (match[1] === undefined && match[2] === undefined) {
      const digits = match[0].replace('-', '');
      if (digits.length > INT_MAX_STR_DIGITS) fail();
      const big = BigInt(match[0]);
      return (big <= BigInt(Number.MAX_SAFE_INTEGER) && big >= BigInt(Number.MIN_SAFE_INTEGER))
        ? Number(big) + 0 : big;
    }
    return new PyFloat(Number(match[0]));
  };

  // Explicit stack of open containers: {container, key (objects)}.
  const stack = [];
  let result;
  let haveResult = false;
  skip();
  for (;;) {
    // Parse one value at position i.
    let value;
    if (i >= n) fail();
    const c = text[i];
    if (c === '{') {
      i += 1;
      skip();
      if (text[i] === '}') {
        i += 1;
        value = newDict();
      } else {
        if (text[i] !== '"') fail();
        const key = parseString();
        skip();
        if (text[i] !== ':') fail();
        i += 1;
        skip();
        stack.push({ container: newDict(), key });
        continue;
      }
    } else if (c === '[') {
      i += 1;
      skip();
      if (text[i] === ']') {
        i += 1;
        value = [];
      } else {
        stack.push({ container: [], key: null });
        continue;
      }
    } else {
      value = parseScalar();
    }
    // Attach the finished value, closing containers as far as possible.
    for (;;) {
      if (stack.length === 0) {
        result = value;
        haveResult = true;
        break;
      }
      const top = stack[stack.length - 1];
      if (Array.isArray(top.container)) top.container.push(value);
      else top.container[top.key] = value;
      skip();
      const d = text[i];
      if (Array.isArray(top.container)) {
        if (d === ',') { i += 1; skip(); break; }
        if (d === ']') { i += 1; stack.pop(); value = top.container; continue; }
        fail();
      } else {
        if (d === ',') {
          i += 1;
          skip();
          if (text[i] !== '"') fail();
          top.key = parseString();
          skip();
          if (text[i] !== ':') fail();
          i += 1;
          skip();
          break;
        }
        if (d === '}') { i += 1; stack.pop(); value = top.container; continue; }
        fail();
      }
    }
    if (haveResult) break;
  }
  skip();
  if (i !== n) fail();
  return result;
}

function pyFloatRepr(value) {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  const [mantissa, expText] = value.toExponential().split('e');
  const exponent = Number(expText);
  const negative = mantissa.startsWith('-');
  const digits = mantissa.replace('-', '').replace('.', '');
  let out;
  if (exponent >= -5 + 1 && exponent < 16) {
    if (exponent >= 0) {
      const intPart = digits.slice(0, exponent + 1).padEnd(exponent + 1, '0');
      const frac = digits.slice(exponent + 1);
      out = `${intPart}.${frac || '0'}`;
    } else {
      out = `0.${'0'.repeat(-exponent - 1)}${digits}`;
    }
  } else {
    const rest = digits.slice(1);
    const sign = exponent < 0 ? '-' : '+';
    out = `${digits[0]}${rest ? `.${rest}` : ''}e${sign}${String(Math.abs(exponent)).padStart(2, '0')}`;
  }
  return negative ? `-${out}` : out;
}

const ESCAPES = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };

function pyJsonString(value) {
  let out = '"';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    const code = value.charCodeAt(i);
    if (hasKey(ESCAPES, ch)) out += ESCAPES[ch];
    else if (code >= 0x20 && code <= 0x7e) out += ch;
    else out += `\\u${code.toString(16).padStart(4, '0')}`;
  }
  return `${out}"`;
}

function codePointCompare(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** Python json.dumps(value, indent=2, sort_keys=True) with the default ensure_ascii=True. */
export function pyJsonDumps(value, indent = 2, level = 0) {
  if (value === null || value === undefined) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : pyFloatRepr(value);
  if (value instanceof PyFloat) return pyFloatRepr(value.value);
  if (typeof value === 'string') return pyJsonString(value);
  const inner = ' '.repeat(indent * (level + 1));
  const outer = ' '.repeat(indent * level);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((item) => inner + pyJsonDumps(item, indent, level + 1)).join(',\n')}\n${outer}]`;
  }
  const keys = Object.keys(value).sort(codePointCompare);
  if (keys.length === 0) return '{}';
  return `{\n${keys.map((key) => `${inner}${pyJsonString(key)}: ${pyJsonDumps(value[key], indent, level + 1)}`).join(',\n')}\n${outer}}`;
}

// Python str.isspace characters, for str.strip().
const PY_WHITESPACE = new Set([
  '\t', '\n', '\x0b', '\x0c', '\r', '\x1c', '\x1d', '\x1e', '\x1f', ' ', '\x85', '\xa0', '\u1680',
  '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2007', '\u2008', '\u2009',
  '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000',
]);

function pyStrip(text) {
  let start = 0;
  let end = text.length;
  while (start < end && PY_WHITESPACE.has(text[start])) start += 1;
  while (end > start && PY_WHITESPACE.has(text[end - 1])) end -= 1;
  return text.slice(start, end);
}

/** Python str.splitlines() without keepends. */
function pySplitLines(text) {
  const lines = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\r' && text[i + 1] === '\n') {
      lines.push(text.slice(start, i));
      i += 2;
      start = i;
    } else if ('\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029'.includes(ch)) {
      lines.push(text.slice(start, i));
      i += 1;
      start = i;
    } else {
      i += 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

// --- small, defensive accessors: missing or mistyped fields are unknown, never zero.

function get(value, ...keys) {
  for (const key of keys) {
    if (!isDict(value) || !hasKey(value, key)) return UNKNOWN;
    value = value[key];
  }
  return value;
}

function int(value) {
  return isInt(value) ? value : UNKNOWN;
}

function bool(value) {
  return typeof value === 'boolean' ? value : UNKNOWN;
}

/** Product enums only (e.g. deny, active); anything else is withheld. */
function enumValue(value) {
  if (value === null) return null;
  return isStr(value) && fullmatch(ENUM, value) ? value : UNKNOWN;
}

function count(value) {
  return Array.isArray(value) ? value.length : UNKNOWN;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function feature(value) {
  return { enabled: bool(get(value, 'enabled')), action: enumValue(get(value, 'action')) };
}

function strOr(value) {
  return isStr(value) ? value : UNKNOWN;
}

// --- selectors: each returns only allow-listed fields from parsed JSON.

export function selectWhoami(data) {
  return { username: strOr(get(data, 'username')) };
}

// Known unavailableReason values (CLI 65.3.1 statusOf); anything else is reported as "other", never echoed.
export const UNAVAILABLE_REASONS = Object.freeze({ muted: 'muted', 'insufficient-permissions': 'insufficient_permissions' });

// Every product check slug in the CLI's SECURITY_CHECKS table (CLI 65.7.0, commands-core.js),
// mapped to the one checklist ID whose subsetting it tests. capabilities.md documents the
// same table; a slug not listed here is reported as "unmapped", never dropped (#90).
export const CHECK_SLUG_VERSION = '65.7.0';
export const CHECKLIST_IDS = Object.freeze({
  'members-no-mfa': 'IAM-02',
  'members-too-many-owners': 'IAM-01',
  'pats-no-expiration': 'CRE-01',
  'env-vars-creds-instead-of-oidc': 'SEC-02',
  'depl-no-git-fork-protection': 'SRC-03',
  'proj-no-preview-depl-protection': 'DEP-01',
  'env-vars-non-sensitive': 'SEC-01',
  'env-vars-non-sensitive-stale': 'SEC-02',
  'env-vars-exposed-web-app-fwk': 'SEC-01',
});
export const UNMAPPED = 'unmapped';

function nonNegative(value) {
  value = int(value);
  return value === UNKNOWN || value >= 0 ? value : UNKNOWN;
}

/**
 * Conservative per-product-check result, checked in the same order as the CLI's statusOf.
 *
 * unavailableReason "muted": muted. unavailable (or any other reason): unavailable.
 * Neither is ever passing, whatever the counts say.
 * violations > 0: violations_found (a review candidate, not yet a finding).
 * violations == 0 and total > 0: no_violations (this product check and scope only).
 * violations == 0 and total omitted: no_violations_total_unreported (the CLI omits
 * totalCount for some checks; zero from a complete structured check still counts,
 * with the missing total recorded as a caveat).
 * total == 0: nothing_evaluated. Missing, negative or mistyped counts: unknown.
 * mutedCount above 0 with no unmuted violations: muted, not passing.
 */
export function productResult(violations, total, unavailable = false, reason = null, muted = UNKNOWN) {
  if (reason === 'muted') return 'muted';
  if (unavailable || reason !== null) return 'unavailable';
  if (violations === UNKNOWN) return UNKNOWN;
  if (violations > 0) return 'violations_found';
  if (muted !== UNKNOWN && muted > 0) return 'muted';
  if (total === UNKNOWN) return 'no_violations_total_unreported';
  return total > 0 ? 'no_violations' : 'nothing_evaluated';
}

// Python `x in (UNKNOWN, None, False)`: equality, so 0 and 0.0 equal False.
function isFalsyFlag(value) {
  if (value === UNKNOWN || value === null || value === false) return true;
  if (value === 0 || value === 0n) return true;
  return value instanceof PyFloat && value.value === 0;
}

/** [unavailable, reason] from the check's own fields; a present non-false flag counts as unavailable. */
function unavailableState(value) {
  const rawFlag = get(value, 'unavailable');
  const rawReason = get(value, 'unavailableReason');
  let reason;
  if (rawReason === UNKNOWN || rawReason === null) reason = null;
  else if (isStr(rawReason)) reason = hasKey(UNAVAILABLE_REASONS, rawReason) ? UNAVAILABLE_REASONS[rawReason] : 'other';
  else reason = 'other';
  const unavailable = !isFalsyFlag(rawFlag);
  if (unavailable && reason === null) reason = 'other';
  return [unavailable, reason];
}

export function selectSecurityCheck(data) {
  const report = get(data, 'report');
  const checks = newDict();
  let withheld = 0;
  for (const [key, value] of (isDict(report) ? entries(report) : [])) {
    if (!fullmatch(CHECK_KEY, key)) {
      withheld += 1;
      continue;
    }
    let violations = int(get(value, 'violationsCount'));
    let total = int(get(value, 'totalCount'));
    const rawTotal = get(value, 'totalCount');
    const malformed = (violations !== UNKNOWN && violations < 0) || (total !== UNKNOWN && total < 0)
      || (rawTotal !== UNKNOWN && total === UNKNOWN);
    if (malformed) {
      violations = UNKNOWN;
      total = UNKNOWN;
    }
    const [unavailable, reason] = unavailableState(value);
    const muted = nonNegative(get(value, 'mutedCount'));
    checks[key] = {
      checklistId: hasKey(CHECKLIST_IDS, key) ? CHECKLIST_IDS[key] : UNMAPPED,
      productResult: productResult(violations, total, unavailable, reason, muted),
      violationsCount: violations,
      totalCount: total,
      mutedCount: muted,
      unavailableReason: reason,
      sampleType: list(get(value, 'sampleType')).filter((item) => isStr(item) && fullmatch(SAMPLE_TYPE, item)),
      // Samples name projects, deployments and environment variables: count only.
      samplesReceived: count(get(value, 'samples')),
    };
  }
  // Muted state is known only for checks that report mutedCount or a muted reason; otherwise it is unknown.
  const values = Object.values(checks);
  const detectable = values.length > 0
    && values.every((c) => c.mutedCount !== UNKNOWN || c.unavailableReason === 'muted');
  return {
    checks,
    withheldCheckKeys: withheld,
    reportPresent: isDict(report),
    mutedDetectable: detectable ? true : UNKNOWN,
    postureMutedCount: nonNegative(get(data, 'posture', 'mutedCount')),
  };
}

export function selectProjectLs(data) {
  const projects = list(get(data, 'projects')).map((item) => ({
    id: strOr(get(item, 'id')),
    name: strOr(get(item, 'name')),
    deprecated: bool(get(item, 'deprecated')),
    nodeVersion: strOr(get(item, 'nodeVersion')),
    updatedAt: int(get(item, 'updatedAt')),
  }));
  return { projects };
}

export function selectFirewallStatus(data) {
  const flow = list(get(data, 'requestFlow')).map((step) => ({
    id: enumValue(get(step, 'id')),
    state: enumValue(get(step, 'state')),
    configurable: bool(get(step, 'configurable')),
    rulesets: list(get(step, 'rulesets')).map((r) => ({
      id: enumValue(get(r, 'id')),
      state: enumValue(get(r, 'state')),
      unavailableReason: isDict(get(r, 'unavailable')) ? enumValue(get(r, 'unavailable', 'reason')) : null,
    })),
  }));
  const bypasses = {};
  for (const kind of ['custom', 'system']) {
    bypasses[kind] = { count: int(get(data, 'bypasses', kind, 'count')), state: enumValue(get(data, 'bypasses', kind, 'state')) };
  }
  const rules = {};
  for (const key of ['active', 'inactive', 'total']) rules[key] = int(get(data, 'rules', key));
  return {
    firewallEnabled: bool(get(data, 'firewallEnabled')),
    attackMode: { enabled: bool(get(data, 'attackMode', 'enabled')) },
    botProtection: feature(get(data, 'botProtection')),
    aiBots: feature(get(data, 'aiBots')),
    owasp: { ...feature(get(data, 'owasp')), requiresUpgrade: bool(get(data, 'owasp', 'requiresUpgrade')) },
    rules,
    draftChanges: int(get(data, 'draftChanges')),
    ipBlocks: int(get(data, 'ipBlocks')),
    bypasses,
    requestFlow: flow,
  };
}

function period(data) {
  return {
    start: strOr(get(data, 'period', 'start')),
    end: strOr(get(data, 'period', 'end')),
    granularityHours: int(get(data, 'period', 'granularity', 'hours')),
  };
}

export function selectFirewallOverview(data) {
  const draft = get(data, 'draft');
  return {
    period: period(data),
    attackMode: { enabled: bool(get(data, 'attackMode', 'enabled')) },
    attacksMitigated: int(get(data, 'stats', 'attacksMitigated')),
    draftPresent: draft === UNKNOWN ? UNKNOWN : draft !== null,
    topRulesCount: count(get(data, 'topRules')),
    annotationsCount: count(get(data, 'annotations')),
  };
}

function managed(data) {
  return list(get(data, 'managed')).map((item) => ({ id: enumValue(get(item, 'id')), action: enumValue(get(item, 'action')) }));
}

export function selectFirewallRules(data) {
  // Custom rule bodies can hold shared-secret header conditions and paths: counts and states only.
  const rules = get(data, 'rules');
  return {
    hasDraft: bool(get(data, 'hasDraft')),
    pendingChanges: int(get(data, 'pendingChanges')),
    customRulesCount: count(rules),
    // Rule shape was not observed (empty list when verified): keep state only.
    customRules: list(rules).map((r) => ({ active: bool(get(r, 'active')) })),
    managedRulesets: managed(data),
  };
}

export function selectFirewallSystemBypass(data) {
  const entriesValue = Array.isArray(data) ? data : get(data, 'bypasses');
  return { entriesCount: count(entriesValue) };
}

export function selectFirewallBotManagement(data) {
  return { managedRulesets: managed(data), unknownBotTrafficRows: count(get(data, 'unknownBotTraffic', 'rows')) };
}

export function selectFirewallTraffic(data) {
  const lists = list(get(data, 'topLists')).map((item) => {
    const rows = list(get(item, 'rows')).map((row) => {
      // Only enum-shaped keys (e.g. an action name) and numbers; IPs, paths and hosts are withheld.
      const kept = newDict();
      for (const [key, value] of (isDict(row) ? entries(row) : [])) {
        if (['key', 'action', 'value', 'count'].includes(key) && (isInt(value) || isStr(value))) {
          kept[key] = isInt(value) ? value : enumValue(value);
        }
      }
      return kept;
    });
    return { dimension: enumValue(get(item, 'dimension')), rows };
  });
  return { period: period(data), topLists: lists };
}

export function selectFirewallAlerts(data) {
  return { activeCount: count(get(data, 'active')), resolvedCount: count(get(data, 'resolved')) };
}

export function selectActivity(data) {
  const events = list(get(data, 'events'));
  const types = newDict();
  for (const event of events) {
    const kind = enumValue(get(event, 'type'));
    const key = isStr(kind) ? kind : UNKNOWN;
    types[key] = (hasKey(types, key) ? types[key] : 0) + 1;
  }
  return { eventsCount: count(get(data, 'events')), eventTypes: types };
}

export function selectWebhooks(data) {
  return { webhooksCount: count(get(data, 'webhooks')), status: enumValue(get(data, 'status')) };
}

export function selectIntegrations(data) {
  return {
    resources: list(get(data, 'resources')).map((r) => {
      const product = get(r, 'product');
      return {
        product: isStr(product) && fullmatch(PRODUCT, product) ? product : UNKNOWN,
        status: enumValue(get(r, 'status')),
        projectCount: count(get(r, 'projects')),
      };
    }),
  };
}

// Strict ISO 8601 UTC-or-offset timestamp; anything looser is withheld as unknown.
export const ISO_TIMESTAMP = new RegExp('^(?:[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])'
  + 'T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]{1,9})?'
  + '(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9]))$');
export const NAMESERVERS = Object.freeze(['external', 'vercel']);

/** Epoch milliseconds (non-negative int) or a strict ISO 8601 string; anything else, null included, is unknown. */
function timestamp(value) {
  if (isInt(value) && value >= 0) return value;
  return isStr(value) && fullmatch(ISO_TIMESTAMP, value) ? value : UNKNOWN;
}

/**
 * Synthetic aliases assigned here; hostnames, registrars and creators never leave the reader.
 *
 * CLI list items (65.3.1 per #81, and the 62.7.0 source) are {name, registrar, nameservers,
 * expiresAt, createdAt, creator}: only the nameservers mode and the two dates are kept.
 * Boolean fields are passed through for forward compatibility.
 */
export function selectDomains(data) {
  const domains = list(get(data, 'domains')).map((item, index) => {
    const flags = newDict();
    for (const [key, value] of (isDict(item) ? entries(item) : [])) {
      if (typeof value === 'boolean' && fullmatch(ENUM, key.toLowerCase())) flags[key] = value;
    }
    const nameservers = get(item, 'nameservers');
    return {
      alias: `domain-${index + 1}`,
      nameservers: isStr(nameservers) && NAMESERVERS.includes(nameservers) ? nameservers : UNKNOWN,
      expiresAt: timestamp(get(item, 'expiresAt')),
      createdAt: timestamp(get(item, 'createdAt')),
      flags,
    };
  });
  return { domainsCount: count(get(data, 'domains')), domains };
}

/** Membership of the one agreed team only; other teams are never printed or counted. */
export function selectTeamCheck(data, slug) {
  for (const team of list(get(data, 'teams'))) {
    if (get(team, 'slug') === slug) {
      return { member: true, plan: enumValue(get(team, 'plan')), current: bool(get(team, 'current')) };
    }
  }
  // Absent from this page is only "not a member" when the list is known to be complete.
  return { member: get(data, 'pagination', 'next') === null ? false : UNKNOWN };
}

export function teamFlags(args) {
  return ['--scope', args.scope];
}

export function projectFlags(args) {
  return ['--scope', args.scope, '--project', args.project];
}

// name: [argv builder, selector, needs project, paginated]
export const READS = Object.freeze({
  whoami: [() => ['whoami'], selectWhoami, false, false],
  'team-check': [() => ['teams', 'list'], null, false, true],
  'security-check': [(a) => ['security', 'check', ...(a.project ? projectFlags(a) : teamFlags(a))], selectSecurityCheck, false, false],
  'project-ls': [(a) => ['project', 'ls', ...teamFlags(a)], selectProjectLs, false, true],
  'firewall-status': [(a) => ['firewall', 'status', ...projectFlags(a)], selectFirewallStatus, true, false],
  'firewall-overview': [(a) => ['firewall', 'overview', ...projectFlags(a)], selectFirewallOverview, true, false],
  'firewall-rules': [(a) => ['firewall', 'rules', 'list', ...projectFlags(a)], selectFirewallRules, true, false],
  'firewall-system-bypass': [(a) => ['firewall', 'system-bypass', 'list', ...projectFlags(a)], selectFirewallSystemBypass, true, false],
  'firewall-bot-management': [(a) => ['firewall', 'bot-management', ...projectFlags(a)], selectFirewallBotManagement, true, false],
  'firewall-traffic': [(a) => ['firewall', 'traffic', 'list', ...projectFlags(a), '--since', a.since, '--dimension', 'action'], selectFirewallTraffic, true, false],
  'firewall-alerts': [(a) => ['firewall', 'alerts', 'list', ...projectFlags(a), '--since', a.since], selectFirewallAlerts, true, false],
  activity: [(a) => ['activity', ...teamFlags(a), '--all', '--since', a.since, '--limit', '100'], selectActivity, false, true],
  webhooks: [(a) => ['webhooks', 'list', ...teamFlags(a)], selectWebhooks, false, false],
  integrations: [(a) => ['integration', 'list', ...teamFlags(a), '--all'], selectIntegrations, false, false],
  domains: [(a) => ['domains', 'list', ...teamFlags(a), '--limit', '100'], selectDomains, false, true],
});

// Agent-mode error payloads carry a machine-readable `reason`. Only these reasons map to a
// specific kind; every other reason is cli_error. Names taken from the CLI 62.7.0 source
// (AGENT_REASON and its API-error helpers), not observed from a live failing read.
export const AGENT_REASONS = Object.freeze({
  permission_denied: 'permission',
  forbidden: 'permission',
  scope_not_accessible: 'permission',
  not_team_member: 'permission',
  login_required: 'not_authenticated',
  not_authorized: 'not_authenticated', // the CLI's reason for HTTP 401
  not_found: 'not_found',
  project_not_found: 'not_found',
  domain_not_found: 'not_found',
  unknown_command: 'unknown_command',
  rate_limited: 'rate_limited',
  payment_required: 'plan_required',
  plan_upgrade_required: 'plan_required',
});

// Python's Unicode-aware \b for str patterns (word = alphanumeric or underscore).
const W = '[\\p{L}\\p{N}_]';
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
// Fallback for plain stderr only: CLI-authored phrases, anchored to a line. API errors end in
// " (<status>)", optionally followed by a full stop. Bare "403", "404" or "permission" anywhere
// in a line is never enough, since team and project names can contain them.
export const STDERR_RULES = Object.freeze([
  ['unknown_command', new RegExp(`is not a valid target directory or subcommand${B}|^(?:error: )?unknown (?:sub)?command${B}`, 'mu')],
  ['personal_scope_rejected', new RegExp('personal account as the scope', 'mu')],
  ['not_authenticated', new RegExp(`^(?:error: )?(?:not logged in|no existing credentials found)${B}|\\(401\\)\\.?$`, 'mu')],
  ['permission', new RegExp(`^(?:error: )?you (?:do not|don't) have permissions? ${B}|\\(403\\)\\.?$`, 'mu')],
  ['not_found', new RegExp('\\(404\\)\\.?$', 'mu')],
]);

/** The `reason` of an agent-mode JSON error payload, or null when the text is not one. */
function agentReason(text) {
  let data;
  try {
    data = pyJsonLoads(text);
  } catch {
    return null;
  }
  if (isDict(data) && hasKey(data, 'reason')) return isStr(data.reason) ? data.reason : '';
  return null;
}

/** A fixed failure kind; the payload's message, hint, scope and next steps are never used. */
export function classify(stdout, stderr) {
  for (const stream of [stdout, stderr]) {
    const reason = agentReason(stream);
    if (reason !== null) {
      const key = reason.toLowerCase();
      return hasKey(AGENT_REASONS, key) ? AGENT_REASONS[key] : 'cli_error';
    }
  }
  const text = pySplitLines(stderr.toLowerCase()).map(pyStrip).join('\n');
  for (const [kind, rule] of STDERR_RULES) {
    if (rule.test(text)) return kind;
  }
  return 'cli_error';
}

function asciiLower(buffer) {
  const out = Buffer.from(buffer);
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] >= 0x41 && out[i] <= 0x5a) out[i] += 0x20;
  }
  return out;
}

const BYTES_WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0b, 0x0c]);

/** True when the CLI has begun an interactive device login; JSON stdout is never scanned. */
function loginFlowStarted(stdout, stderr) {
  const lowered = asciiLower(stderr);
  if (LOGIN_FLOW_MARKERS.some((marker) => lowered.includes(marker))) return true;
  let head = stdout.subarray(0, 4096);
  let start = 0;
  while (start < head.length && BYTES_WHITESPACE.has(head[start])) start += 1;
  head = head.subarray(start);
  if (head.length > 0 && (head[0] === 0x7b || head[0] === 0x5b)) return false;
  const headLower = asciiLower(head);
  return LOGIN_FLOW_MARKERS.some((marker) => headLower.includes(marker));
}

const POSIX = process.platform !== 'win32';
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const monotonic = () => performance.now() / 1000;

function returnCode(child) {
  if (child.exitCode !== null) return child.exitCode;
  return -1; // killed by a signal: Python reports a negative return code
}

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Resolves with true when the promise settles within ms, false otherwise (thread.join(timeout)). */
async function joinWithin(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executable candidates in Python subprocess order: os.path.join(dir, CLI) for every entry of
 * PATH (os.defpath when unset), each tried in turn until one starts, whatever the error.
 */
function executableCandidates() {
  if (CLI.includes('/')) return [CLI];
  const searchPath = process.env.PATH ?? '/bin:/usr/bin';
  return searchPath.split(':').map((dir) => (dir === '' ? `./${CLI}` : path.join(dir, CLI)));
}

async function spawnOne(file, args, stdinMode, detached) {
  let child;
  try {
    child = spawn(file, args, { stdio: [stdinMode, 'pipe', 'pipe'], detached, argv0: CLI });
  } catch {
    return null;
  }
  const spawned = await new Promise((resolve) => {
    child.once('spawn', () => resolve(true));
    child.once('error', () => resolve(false));
  });
  if (!spawned) {
    child.stdout?.destroy();
    child.stderr?.destroy();
    return null;
  }
  return child;
}

/** Start a child; resolves to null when it could not be started (Python's OSError from Popen). */
async function start(args, stdinMode, detached) {
  let child = null;
  for (const file of executableCandidates()) {
    child = await spawnOne(file, args, stdinMode, detached);
    if (child !== null) break;
  }
  if (child === null) return null;
  const exited = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise((resolve) => { child.once('exit', resolve); });
  child.on('error', () => {});
  const collect = (stream) => {
    const chunks = [];
    const state = { chunks, length: 0 };
    state.done = new Promise((resolve) => {
      stream.on('data', (chunk) => { chunks.push(chunk); state.length += chunk.length; });
      stream.once('end', resolve);
      stream.once('close', resolve);
      stream.once('error', resolve);
    });
    state.bytes = () => {
      if (chunks.length > 1) chunks.splice(0, chunks.length, Buffer.concat(chunks));
      return chunks[0] ?? Buffer.alloc(0);
    };
    return state;
  };
  return { child, exited, out: collect(child.stdout), err: collect(child.stderr) };
}

async function kill({ child, exited }) {
  if (!hasExited(child)) {
    try {
      if (POSIX) process.kill(-child.pid, 'SIGKILL'); // the CLI's own child processes too
      else child.kill('SIGKILL');
    } catch {
      // already gone
    }
    await exited;
  }
}

/** Run the CLI with no stdin, streaming its output so a login prompt or oversized output stops it early. */
async function run(args, timeout) {
  const started = await start(args, 'ignore', POSIX);
  if (started === null) throw new ReaderError('cli_unavailable');
  const { child, out, err } = started;
  const deadline = monotonic() + timeout;
  try {
    for (;;) {
      const exited = hasExited(child);
      if (exited) {
        await joinWithin(out.done, 5000);
        await joinWithin(err.done, 5000);
      }
      if (loginFlowStarted(out.bytes(), err.bytes())) {
        // Never wait on, print or relay a device code or URL.
        throw new ReaderError('not_authenticated');
      }
      if (out.length > MAX_OUTPUT_BYTES) throw new ReaderError('output_too_large');
      if (exited) return [returnCode(child), out.bytes(), err.bytes()];
      if (monotonic() > deadline) throw new ReaderError('timeout');
      await sleep(50);
    }
  } finally {
    await kill(started);
    child.stdout.destroy();
    child.stderr.destroy();
  }
}

function loggedOut(data) {
  return isDict(data) && hasKey(data, 'loggedIn') && data.loggedIn === false;
}

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const LENIENT_UTF8 = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

export async function invoke(argv, timeout = TIMEOUT_SECONDS) {
  const [code, stdout, stderr] = await run([...argv, '--json', '--non-interactive'], timeout);
  let data = null;
  let parsed;
  try {
    data = pyJsonLoads(STRICT_UTF8.decode(stdout));
    parsed = true;
  } catch {
    data = null;
    parsed = false;
  }
  // A logged-out whoami exits 1 with {"loggedIn": false} on stdout and nothing on stderr.
  if (parsed && loggedOut(data)) throw new ReaderError('not_authenticated');
  if (code !== 0) throw new ReaderError(classify(LENIENT_UTF8.decode(stdout), LENIENT_UTF8.decode(stderr)));
  // Never treat unparseable output as an empty or final page.
  if (!parsed) throw new ReaderError('invalid_json');
  return data;
}

/** Confirm the CLI is logged in before an account read, so no device-login flow can start. */
export async function requireLogin() {
  const data = await invoke(['whoami'], AUTH_TIMEOUT_SECONDS);
  if (!isDict(data) || !((hasKey(data, 'loggedIn') && data.loggedIn === true)
      || (hasKey(data, 'username') && isStr(data.username)))) {
    throw new ReaderError('not_authenticated');
  }
}

export async function readVersion() {
  // Like subprocess.run(capture_output=True, timeout=...): stdin inherited, no new session.
  const started = await start(['--version'], 'inherit', false);
  if (started === null) throw new ReaderError('cli_unavailable');
  const { child, exited, out, err } = started;
  const finished = Promise.all([out.done, err.done, exited]);
  const inTime = await joinWithin(finished, TIMEOUT_SECONDS * 1000);
  if (!inTime) {
    if (!hasExited(child)) child.kill('SIGKILL');
    await exited;
    child.stdout.destroy();
    child.stderr.destroy();
    throw new ReaderError('cli_unavailable');
  }
  const text = Buffer.concat([out.bytes(), err.bytes()]).toString('latin1');
  const match = /\b([0-9]{1,4})\.([0-9]{1,4})\.([0-9]{1,4})\b/.exec(text);
  if (returnCode(child) !== 0 || !match) throw new ReaderError('cli_error');
  const version = match.slice(1, 4).map(Number);
  let older = false;
  for (let i = 0; i < 3; i += 1) {
    if (version[i] !== MINIMUM_TESTED_VERSION[i]) {
      older = version[i] < MINIMUM_TESTED_VERSION[i];
      break;
    }
  }
  return {
    version: version.join('.'),
    minimumTested: MINIMUM_TESTED_VERSION.join('.'),
    olderThanMinimumTested: older,
    note: 'Recommend updating to the latest CLI before collection; do not install or upgrade it yourself.',
  };
}

export const CURSOR = /^[A-Za-z0-9_.:-]{1,200}$/;
export const DEFAULT_MAX_PAGES = 20;
export const HARD_MAX_PAGES = 50;

/** A later page failed: keep the pages already read, never call it complete. */
export class PartialRead extends Error {
  constructor(kind, result, coverage) {
    super(kind);
    this.kind = kind;
    this.result = result;
    this.coverage = coverage;
  }
}

function sum(values) {
  if (values.some((v) => v === UNKNOWN)) return UNKNOWN;
  return values.reduce((a, b) => a + b, 0);
}

export function combine(read, pages, slug) {
  if (read === 'team-check') {
    for (const page of pages) {
      const match = selectTeamCheck(page, slug);
      if (match.member === true) return match;
    }
    return null; // decided by the caller from end-of-list knowledge
  }
  const selected = pages.map((page) => READS[read][1](page));
  if (read === 'project-ls') return { projects: selected.flatMap((page) => page.projects) };
  if (read === 'domains') {
    const merged = selected.flatMap((page) => page.domains);
    merged.forEach((domain, index) => { domain.alias = `domain-${index + 1}`; }); // aliases stay unique across pages
    return { domainsCount: sum(selected.map((page) => page.domainsCount)), domains: merged };
  }
  if (read === 'activity') {
    const types = newDict();
    for (const page of selected) {
      for (const [kind, n] of entries(page.eventTypes)) types[kind] = (hasKey(types, kind) ? types[kind] : 0) + n;
    }
    return { eventsCount: sum(selected.map((page) => page.eventsCount)), eventTypes: types };
  }
  return selected[0];
}

/** A paginated read that failed before its first page: same coverage shape as a later failure. */
function noPages(error) {
  error.coverage = { pages: 0, complete: false, stoppedBecause: error.kind };
  return error;
}

function cursorKey(value) {
  return `${typeof value === 'string' ? 's' : 'i'}:${value}`;
}

export async function collect(args) {
  const [builder, selector, , paginated] = READS[args.read];
  if (args.read !== 'whoami') {
    try {
      await requireLogin();
    } catch (error) {
      if (error instanceof ReaderError) throw paginated ? noPages(error) : error;
      throw error;
    }
  }
  if (!paginated) {
    const data = await invoke(builder(args));
    return [selector(data), { pages: 1, endOfList: 'not_paginated', complete: UNKNOWN }];
  }
  const pages = [];
  const seen = new Set();
  let cursor = null;
  let end = UNKNOWN;
  let failure = null;
  for (;;) {
    const argv = [...builder(args), ...(cursor !== null ? ['--next', String(cursor)] : [])];
    let data;
    try {
      data = await invoke(argv);
    } catch (error) {
      if (!(error instanceof ReaderError)) throw error;
      if (pages.length === 0) throw noPages(error);
      failure = error.kind; // never treated as end-of-list
      break;
    }
    pages.push(data);
    if (args.read === 'team-check' && selectTeamCheck(data, args.scope).member === true) {
      end = 'not_needed';
      break;
    }
    if (isDict(data) && !hasKey(data, 'pagination')) {
      // No pagination block at all (unverified for activity): keep the data, but the end is
      // not reported, so it is never complete. A block with a bad cursor is still invalid_cursor.
      end = 'not_reported';
      break;
    }
    const nextValue = get(data, 'pagination', 'next');
    if (nextValue === null) {
      end = 'known';
      break;
    }
    if (nextValue === UNKNOWN || typeof nextValue === 'boolean'
        || !(isInt(nextValue) || (isStr(nextValue) && fullmatch(CURSOR, nextValue)))) {
      failure = 'invalid_cursor';
      break;
    }
    if (seen.has(cursorKey(nextValue))) {
      failure = 'repeated_cursor';
      break;
    }
    if (pages.length >= args.maxPages) {
      failure = 'page_cap_reached';
      break;
    }
    seen.add(cursorKey(nextValue));
    cursor = nextValue;
  }
  let result = combine(args.read, pages, args.scope);
  if (args.read === 'team-check' && result === null) result = { member: end === 'known' ? false : UNKNOWN };
  const complete = end === 'not_reported' ? UNKNOWN : ['known', 'not_needed'].includes(end);
  const coverage = { pages: pages.length, endOfList: end !== UNKNOWN ? end : 'not_reached', complete };
  if (end === 'not_reported') coverage.reason = 'no_pagination_block';
  if (failure) {
    coverage.stoppedBecause = failure;
    throw new PartialRead(failure, result, coverage);
  }
  return [result, coverage];
}

// --- argparse emulation (Python 3.14 semantics for this parser's arguments).

class UsageError extends Error {}
class HelpRequested extends Error {}

const READ_CHOICES = ['version', ...Object.keys(READS)];
const OPTION_STRINGS = ['-h', '--help', '--scope', '--project', '--since', '--max-pages'];
const OPTION_DEST = { '-h': 'help', '--help': 'help', '--scope': 'scope', '--project': 'project', '--since': 'since', '--max-pages': 'maxPages' };

function helpText(prog) {
  const choices = `{${READ_CHOICES.join(',')}}`;
  const pad = ' '.repeat(`usage: ${prog} `.length);
  return `usage: ${prog} [-h] [--scope SCOPE] [--project PROJECT] [--since SINCE]\n`
    + `${pad}[--max-pages MAX_PAGES]\n`
    + `${pad}${choices}\n\n`
    + 'Run one documented, read-only Vercel CLI command and print only allow-listed\n'
    + 'fields. Standard library only. The command runs as an argument list (no\n'
    + 'shell), always with --json and --non-interactive, and its raw output never\n'
    + 'leaves this process: only the bundled selector\'s fields are printed. CLI\n'
    + 'stderr is never echoed; failures are classified into fixed, value-free kinds.\n'
    + 'This is the bundled field-selection mechanism for CLI account reads, not a\n'
    + 'secret scanner.\n\n'
    + 'positional arguments:\n'
    + `  ${choices}\n`
    + '                        Documented read to run\n\n'
    + 'options:\n'
    + '  -h, --help            show this help message and exit\n'
    + '  --scope SCOPE         Agreed team slug\n'
    + '  --project PROJECT     Agreed project ID or name\n'
    + '  --since SINCE         Window for traffic, alerts and activity, e.g. 24h or\n'
    + '                        7d\n'
    + '  --max-pages MAX_PAGES\n'
    + `                        Page cap for paginated reads (1-${HARD_MAX_PAGES}); reaching it is\n`
    + '                        incomplete coverage\n';
}

/** Python int(text) for base 10: Unicode whitespace, sign, Unicode decimal digits, single underscores. */
function pyInt(text) {
  const body = pyStrip(text);
  if (!/^[+-]?\p{Nd}(?:_?\p{Nd})*$/u.test(body)) throw new UsageError('int');
  let digits = '';
  for (const ch of body) {
    if (ch === '+' || ch === '-' || ch === '_') {
      if (ch === '-') digits += '-';
      continue;
    }
    let cp = ch.codePointAt(0);
    // Decimal digits come in contiguous runs of ten; find this digit's run start.
    let zero = cp;
    while (zero > 0 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero -= 1;
    cp = (cp - zero) % 10;
    digits += String(cp);
  }
  if (digits.replace('-', '').length > INT_MAX_STR_DIGITS) throw new UsageError('int');
  return BigInt(digits);
}

function parseOptional(arg) {
  if (!arg || arg[0] !== '-') return null;
  if (OPTION_STRINGS.includes(arg)) return [[arg, null]];
  if (arg.length === 1) return null;
  const eq = arg.indexOf('=');
  if (eq >= 0 && OPTION_STRINGS.includes(arg.slice(0, eq))) return [[arg.slice(0, eq), arg.slice(eq + 1)]];
  const tuples = [];
  const prefix = eq >= 0 ? arg.slice(0, eq) : arg;
  const explicit = eq >= 0 ? arg.slice(eq + 1) : null;
  if (arg[1] === '-') {
    for (const option of OPTION_STRINGS) if (option.startsWith(prefix)) tuples.push([option, explicit]);
  } else {
    const shortPrefix = arg.slice(0, 2);
    for (const option of OPTION_STRINGS) {
      if (option === shortPrefix) tuples.push([option, arg.slice(2), 'short']);
      else if (option.startsWith(prefix)) tuples.push([option, explicit]);
    }
  }
  if (tuples.length) return tuples;
  if (/^-\.?\d/u.test(arg)) return null;
  if (arg.includes(' ')) return null;
  return [[null, null]];
}

function parseArgs(argv) {
  const ns = { read: null, scope: null, project: null, since: '24h', maxPages: DEFAULT_MAX_PAGES };
  let readSeen = false;
  const pattern = [];
  const optionTuples = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--') {
      pattern.push('-');
      for (i += 1; i < argv.length; i += 1) pattern.push('A');
      break;
    }
    const tuples = parseOptional(argv[i]);
    if (tuples === null) pattern.push('A');
    else {
      optionTuples.set(i, tuples);
      pattern.push('O');
    }
  }
  const patternText = pattern.join('');
  const extras = [];

  const takeOption = (option, value) => {
    const dest = OPTION_DEST[option];
    if (dest === 'help') throw new HelpRequested();
    if (dest === 'maxPages') {
      const parsed = pyInt(value);
      ns.maxPages = parsed >= -1000000n && parsed <= 1000000n ? Number(parsed) : (parsed > 0n ? Infinity : -Infinity);
    } else {
      ns[dest] = value;
    }
  };

  const consumeOptional = (index) => {
    const tuples = optionTuples.get(index);
    if (tuples.length > 1) throw new UsageError('ambiguous');
    let [option, explicit, short] = tuples[0];
    if (option === null) {
      extras.push(argv[index]);
      return index + 1;
    }
    const actions = [];
    let stop;
    for (;;) {
      const takesArg = OPTION_DEST[option] !== 'help';
      if (explicit !== null && explicit !== undefined) {
        if (!takesArg && option[1] !== '-' && explicit !== '') {
          // Only reachable for -h with a tail: -hX.
          if (!short || explicit[0] === '-') throw new UsageError('ignored explicit argument');
          actions.push([option, null]);
          const next = `-${explicit[0]}`;
          if (OPTION_STRINGS.includes(next)) {
            option = next;
            explicit = explicit.slice(1);
            if (!explicit) explicit = null;
            else if (explicit[0] === '=') { explicit = explicit.slice(1); short = false; } else short = true;
          } else {
            extras.push(`-${explicit}`);
            stop = index + 1;
            break;
          }
        } else if (takesArg) {
          actions.push([option, explicit]);
          stop = index + 1;
          break;
        } else {
          throw new UsageError('ignored explicit argument');
        }
      } else if (takesArg) {
        if (patternText[index + 1] !== 'A') throw new UsageError('expected one argument');
        actions.push([option, argv[index + 1]]);
        stop = index + 2;
        break;
      } else {
        actions.push([option, null]);
        stop = index + 1;
        break;
      }
    }
    for (const [name, value] of actions) takeOption(name, value);
    return stop;
  };

  const consumePositionals = (index) => {
    if (readSeen) return index;
    const match = /^-*A-*/.exec(patternText.slice(index));
    if (!match) return index;
    const args = argv.slice(index, index + match[0].length).filter((_, k) => patternText[index + k] === 'A');
    // Python removes one '--'; after a '--' every later token is 'A', so this keeps the one value.
    const value = args[0];
    if (!READ_CHOICES.includes(value)) throw new UsageError('invalid choice');
    ns.read = value;
    readSeen = true;
    return index + match[0].length;
  };

  const indices = [...optionTuples.keys()];
  const maxOption = indices.length ? Math.max(...indices) : -1;
  let index = 0;
  while (index <= maxOption) {
    let nextOption = index;
    while (nextOption <= maxOption && !optionTuples.has(nextOption)) nextOption += 1;
    if (index !== nextOption) {
      const end = consumePositionals(index);
      if (end > index) {
        index = end;
        continue;
      }
      index = end;
    }
    if (!optionTuples.has(index)) {
      extras.push(...argv.slice(index, nextOption));
      index = nextOption;
    }
    index = consumeOptional(index);
  }
  const stopIndex = consumePositionals(index);
  extras.push(...argv.slice(stopIndex));
  if (!readSeen) throw new UsageError('required');
  if (extras.length) throw new UsageError('unrecognized arguments');
  return ns;
}

function writeStdout(text) {
  process.stdout.write(text);
}

function usageExit() {
  process.stderr.write('Invalid reader command. Use --help for usage.\n');
  return 2;
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
    for (const value of [args.scope, args.project]) {
      if (value !== null && !fullmatch(IDENTIFIER, value)) throw new UsageError('identifier');
    }
    if (!(args.maxPages >= 1 && args.maxPages <= HARD_MAX_PAGES)) throw new UsageError('max-pages');
    if (!fullmatch(SINCE, args.since)) throw new UsageError('since');
  } catch (error) {
    if (error instanceof HelpRequested) {
      writeStdout(helpText(path.basename(process.argv[1] ?? 'cli-read.mjs')));
      return 0;
    }
    if (error instanceof UsageError) return usageExit();
    throw error;
  }
  const output = { read: args.read };
  try {
    if (args.read === 'version') {
      Object.assign(output, { ok: true, result: await readVersion() });
    } else {
      const needsProject = READS[args.read][2];
      if (args.read !== 'whoami' && !args.scope) return usageExit();
      if (needsProject && !args.project) return usageExit();
      const [result, coverage] = await collect(args);
      Object.assign(output, { ok: true, result, coverage });
    }
  } catch (error) {
    if (error instanceof PartialRead) {
      // Pages already read are useful bounded observations, labelled as partial.
      Object.assign(output, { ok: false, failure: error.kind, partialResult: error.result, coverage: error.coverage });
      writeStdout(`${pyJsonDumps(output)}\n`);
      return 1;
    }
    if (error instanceof ReaderError) {
      Object.assign(output, { ok: false, failure: error.kind, coverage: error.coverage || { complete: false } });
      if (error.kind === 'unknown_command') {
        output.note = "Record a capability gap with an 'upgrade the CLI' note; do not retry or guess equivalent commands.";
      } else if (error.kind === 'not_authenticated') {
        output.note = "Ask the user to run 'vercel login' themselves, then retry; never start, open or relay a device-login URL or code.";
      }
      writeStdout(`${pyJsonDumps(output)}\n`);
      return 1;
    }
    throw error;
  }
  writeStdout(`${pyJsonDumps(output)}\n`);
  return 0;
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  process.exitCode = await main();
}
