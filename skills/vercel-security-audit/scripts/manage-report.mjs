#!/usr/bin/env node
/**
 * Optional, offline versioned report model. Metadata must be pre-sanitised.
 *
 * Node standard library only; no collection, secret scanning, network or remediation.
 * Readable Markdown remains the mandatory, portable deliverable.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// publishNew is shared with the renderer: one output per invocation avoids
// multi-file partial publication; distinct paths may branch a revision.
import {
  MAX_BYTES, OWNER_ACCEPTED_MARKER, STATUSES, ReportError, describeOsError, isOsError, isStatus,
  publishNew, pyStrip, renderReport,
} from "./render-report.mjs";

export { MAX_BYTES, OWNER_ACCEPTED_MARKER, STATUSES, ReportError, describeOsError, publishNew, renderReport };

export const CORE_IDS = Object.freeze(["IAM", "CRE", "DEP", "FWB", "SRC", "SEC", "DOM", "OPS"]
  .flatMap((domain) => [1, 2, 3].map((index) => `${domain}-${String(index).padStart(2, "0")}`)));
export const OPTIONAL_IDS = Object.freeze(["DEP-04", "SRC-04", "SEC-04", "OPS-04"]);
export const CHECK_IDS = Object.freeze([...CORE_IDS, ...OPTIONAL_IDS]);
export const SOURCE_KINDS = Object.freeze(["plugin", "cli", "browser", "owner_statement", "source_review", "documentation"]);
export const CHECK_TEXT = Object.freeze(["statement", "requirement", "rationale", "missing_evidence"]);
export const SCOPE_TEXT = Object.freeze(["included", "excluded", "authorization", "sources_used", "limitations",
  "source_application_review", "documentation_verification"]);
export const SUMMARY_TEXT = Object.freeze(["reviewed_at", "method", "overall_takeaway"]);
export const FOLLOW_UP_TEXT = Object.freeze(["owner_decisions", "deferred_checks", "suggested_recheck"]);
export const RECOMMENDATION_TEXT = Object.freeze(["title", "evidence_and_rationale", "benefit", "responsible_role",
  "where_to_start", "done_when", "impact", "docs"]);
export const ID_PATTERN = "[A-Za-z][A-Za-z0-9_-]{0,63}";
export const OUTCOMES = Object.freeze(["not_collected", "complete", "partial", "failed", "timed_out"]);
export const FAILURE_KINDS = Object.freeze(["none", "permission", "unavailable", "timeout", "limit", "other", "unknown"]);
export const WINDOW_FIELDS = Object.freeze(["requested_start", "requested_end", "covered_start", "covered_end", "retention_boundary"]);
export const QUESTIONNAIRE = Object.freeze({
  "CRE-01": Object.freeze(["Owner token metadata", "Using only your own current metadata in the agreed scope, what is your scoped token count, "
    + "and what scope and expiry metadata is visible? Give redacted aggregate counts and expiry coverage only, or say unavailable. "
    + "If expiry is not_applicable, state a verified reason, such as a verified zero-token inventory. "
    + "Do not supply token values, token strings, sensitive token names or credential screenshots. "
    + "Metadata dates alone do not prove rotation or actual use."]),
  "IAM-02": Object.freeze(["Owner MFA policy and recovery", "Does your own MFA posture meet the agreed policy, and is recoverability arranged "
    + "within that policy? Record the agreed requirement or mark it unresolved. Confirm compliance, recoverability and unresolved "
    + "exceptions at a non-secret level only. Do not provide passwords, recovery codes, authentication method secrets, "
    + "device identifiers or setup details. Your statement does not establish team-wide enrolment or enforcement."]),
  "OPS-01": Object.freeze(["Owner incident delivery responsibility", "Can you confirm incident delivery ownership and escalation responsibility "
    + "for this scope? Identify responsible roles and non-sensitive subscription arrangements, not endpoints, webhook URLs, "
    + "email addresses, names or recipient identifiers. Distinguish configured subscription metadata from delivery readiness "
    + "statements. Actual delivery remains unverified unless separately verified through an approved procedure. "
    + "This questionnaire does not authorize a delivery test."]),
});
const TITLES = ["Team membership and roles", "Sign-in policy coverage", "Invitations and access review",
  "Credential scope and expiry metadata", "Integration permissions and purpose", "Integration lifecycle accountability",
  "Deployment protection scope", "Preview collaboration and sharing", "Deployment inventory and retention intent",
  "Firewall policy intent and scope", "Bot control posture", "Exceptions and rule review",
  "Repository connection and authority", "Production deployment governance", "Contribution and build trust boundaries",
  "Environment variable targeting", "Secret lifecycle responsibility", "Log access, export, and retention",
  "Domain association and intended ownership", "Certificate and transport status", "Domain lifecycle and configuration warnings",
  "Incident notifications, ownership and escalation", "Change traceability and review", "Recovery and configuration follow-up",
  "Application authentication boundaries", "Repository governance evidence",
  "Secret handling and log redaction design", "Application recovery design"];
export const CHECK_TITLES = Object.freeze(Object.fromEntries(CHECK_IDS.map((id, index) => [id, TITLES[index]])));

export const MONTHS = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);

// ---- Python value semantics -------------------------------------------------------
// JSON integers parse to numbers (BigInt beyond the safe range); JSON floats parse to
// boxed Number objects, so `type(value) is int` stays distinguishable after parsing.

/** Python's RecursionError (copy.deepcopy past the interpreter's frame limit). */
export class PyRecursionError extends Error {
  constructor() {
    super("maximum recursion depth exceeded");
    this.name = "RecursionError";
  }
}

class JsonSyntaxError extends Error {}

function isInt(value) {
  return (typeof value === "number" && Number.isInteger(value)) || typeof value === "bigint";
}

function isDict(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function intEquals(a, b) {
  return BigInt(a) === BigInt(b);
}

function codePointLength(text) {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
    }
    count += 1;
  }
  return count;
}

function get(object, key, fallback = null) {
  return Object.hasOwn(object, key) ? object[key] : fallback;
}

function floorDiv(a, b) {
  const quotient = a / b;
  return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? quotient - 1n : quotient;
}

/** Python float.__repr__. */
function floatRepr(value) {
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";
  const [mantissa, exponentText] = value.toExponential().split("e");
  const sign = value < 0 ? "-" : "";
  const digits = mantissa.replace("-", "").replace(".", "");
  const exponent = Number(exponentText);
  if (exponent >= -5 + 1 && exponent < 16) {
    if (exponent >= digits.length - 1) return sign + digits + "0".repeat(exponent - digits.length + 1) + ".0";
    if (exponent >= 0) return sign + digits.slice(0, exponent + 1) + "." + digits.slice(exponent + 1);
    return sign + "0." + "0".repeat(-exponent - 1) + digits;
  }
  const rest = digits.slice(1);
  return sign + digits[0] + (rest ? "." + rest : "") + "e" + (exponent < 0 ? "-" : "+")
    + String(Math.abs(exponent)).padStart(2, "0");
}

const INT_MAX_STR_DIGITS = 4300;

function scalarJson(value) {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw new TypeError("surrogates not allowed");
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") {
    const text = value.toString();
    if (text.replace("-", "").length > INT_MAX_STR_DIGITS) throw new RangeError("int too large");
    return text;
  }
  if (typeof value === "number" || value instanceof Number) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new RangeError("Out of range float values are not JSON compliant");
    if (typeof value === "number" && Number.isInteger(number)) return Object.is(number, -0) ? "0" : String(number);
    return floatRepr(number);
  }
  throw new TypeError("not JSON serializable");
}

/** json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2), iteratively. */
function pythonJson(value) {
  const out = [];
  const ancestors = new Set();
  const stack = [];
  const open = (item, level) => {
    if (Array.isArray(item) || isDict(item)) {
      if (ancestors.has(item)) throw new RangeError("Circular reference detected");
      const entries = Array.isArray(item) ? item.map((child) => [null, child]) : Object.entries(item);
      if (!entries.length) {
        out.push(Array.isArray(item) ? "[]" : "{}");
        return;
      }
      ancestors.add(item);
      out.push(Array.isArray(item) ? "[" : "{");
      stack.push({ item, entries, index: 0, level, close: Array.isArray(item) ? "]" : "}" });
      return;
    }
    out.push(scalarJson(item));
  };
  open(value, 0);
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.entries.length) {
      out.push("\n" + "  ".repeat(frame.level) + frame.close);
      ancestors.delete(frame.item);
      stack.pop();
      continue;
    }
    const [key, child] = frame.entries[frame.index];
    out.push((frame.index ? "," : "") + "\n" + "  ".repeat(frame.level + 1));
    if (key !== null) out.push(scalarJson(key) + ": ");
    frame.index += 1;
    open(child, frame.level + 1);
  }
  return out.join("");
}

// copy.deepcopy is pure Python: from append_evidence (three frames deep under the CLI)
// each container costs two frames and each atomic child one; past 1000 frames it
// raises RecursionError. Reproduce that bound, then copy with structuredClone.
const RECURSION_LIMIT = 1000;
const DEEPCOPY_BASE_FRAMES = 3;

function deepCopy(value) {
  const stack = [[value, 1]];
  while (stack.length) {
    const [item, depth] = stack.pop();
    const container = Array.isArray(item) || isDict(item);
    if (!container) continue;
    const children = Array.isArray(item) ? item : Object.values(item);
    const atomicChild = isDict(item) ? children.length > 0 : children.some((child) => !Array.isArray(child) && !isDict(child));
    if (DEEPCOPY_BASE_FRAMES + 2 * depth + (atomicChild ? 1 : 0) > RECURSION_LIMIT) throw new PyRecursionError();
    for (const child of children) stack.push([child, depth + 1]);
  }
  return structuredClone(value);
}

/** Python pathlib's string normalization of a path argument. */
function pyPath(text) {
  let root = "";
  if (text.startsWith("//") && !text.startsWith("///")) root = "//";
  else if (text.startsWith("/")) root = "/";
  const parts = text.split("/").filter((part) => part !== "" && part !== ".");
  return (root + parts.join("/")) || ".";
}

// ---- Calendar ---------------------------------------------------------------------

function isLeap(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Days from 1970-01-01 to a proleptic Gregorian date. */
function daysFromCivil(year, month, day) {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(days) {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (month <= 2 ? 1 : 0), month, day];
}

const MIN_SECONDS = daysFromCivil(1, 1, 1) * 86400;
const MAX_SECONDS = daysFromCivil(9999, 12, 31) * 86400 + 86399;

/** Broken-down wall time for whole seconds since 1970-01-01 (in any reference). */
function wallTime(seconds) {
  const days = Math.floor(seconds / 86400);
  const rest = seconds - days * 86400;
  const [year, month, day] = civilFromDays(days);
  return { year, month, day, hour: Math.floor(rest / 3600), minute: Math.floor((rest % 3600) / 60), second: rest % 60, seconds };
}

function sameDate(a, b) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** datetime(...) with tzinfo=UTC as microseconds since the epoch, or null (ValueError). */
function utcMoment(year, month, day, hour = 0, minute = 0, second = 0, micro = 0) {
  if (!(year >= 1 && year <= 9999) || !(month >= 1 && month <= 12) || !(day >= 1 && day <= daysInMonth(year, month))
      || !(hour >= 0 && hour <= 23) || !(minute >= 0 && minute <= 59) || !(second >= 0 && second <= 59)) return null;
  const seconds = daysFromCivil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second;
  return BigInt(seconds) * 1000000n + BigInt(micro);
}

function toMicros(value) {
  if (typeof value === "bigint") return value;
  if (value instanceof Date) return BigInt(value.getTime()) * 1000n;
  throw new TypeError("Expected a UTC instant (BigInt microseconds or Date).");
}

// ---- Time zones (the same TZif files Python's zoneinfo reads) ----------------------

export const TZPATH = Object.freeze(["/usr/share/zoneinfo", "/usr/lib/zoneinfo", "/usr/share/lib/zoneinfo", "/etc/zoneinfo"]);
const TZDIR = "/usr/share/zoneinfo"; // The C library's zone directory for TZ lookups.

function bisectRight(list, value) {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (value < list[middle]) high = middle;
    else low = middle + 1;
  }
  return low;
}

function postEpochDaysBeforeYear(year) {
  return daysFromCivil(year, 1, 1);
}

class DayOffset {
  constructor(d, julian, hour = 2, minute = 0, second = 0) {
    const minimum = julian ? 1 : 0;
    if (!(d >= minimum && d <= 365)) throw new RangeError("Invalid day offset");
    Object.assign(this, { d, julian, hour, minute, second });
  }

  yearToEpoch(year) {
    let d = this.d;
    if (this.julian && d >= 59 && isLeap(year)) d += 1;
    return (postEpochDaysBeforeYear(year) + d) * 86400 + this.hour * 3600 + this.minute * 60 + this.second;
  }
}

class CalendarOffset {
  constructor(m, w, d, hour = 2, minute = 0, second = 0) {
    if (!(m >= 1 && m <= 12) || !(w >= 1 && w <= 5) || !(d >= 0 && d <= 6)) throw new RangeError("Invalid calendar offset");
    Object.assign(this, { m, w, d, hour, minute, second });
  }

  yearToEpoch(year) {
    const first = daysFromCivil(year, this.m, 1);
    const firstDay = ((first + 3) % 7 + 7) % 7; // Python calendar: 0 = Monday.
    let monthDay = ((this.d - (firstDay + 1)) % 7 + 7) % 7 + 1;
    monthDay += (this.w - 1) * 7;
    if (monthDay > daysInMonth(year, this.m)) monthDay -= 7;
    return (first + monthDay - 1) * 86400 + this.hour * 3600 + this.minute * 60 + this.second;
  }
}

class TzStr {
  constructor(stdAbbr, stdOffset, dstAbbr, dstOffset, start, end) {
    this.dstDiff = dstOffset - stdOffset;
    this.std = { utcoff: stdOffset, tzname: stdAbbr };
    this.dst = { utcoff: dstOffset, tzname: dstAbbr };
    this.start = start;
    this.end = end;
  }

  transitions(year) {
    return [this.start.yearToEpoch(year), this.end.yearToEpoch(year)];
  }

  getTransInfo(ts, year, fold) {
    let [start, end] = this.transitions(year);
    if (fold === (this.dstDiff >= 0)) end -= this.dstDiff;
    else start += this.dstDiff;
    const isdst = start < end ? (start <= ts && ts < end) : !(end <= ts && ts < start);
    return isdst ? this.dst : this.std;
  }

  getTransInfoFromUtc(ts, year) {
    let [start, end] = this.transitions(year);
    start -= this.std.utcoff;
    end -= this.dst.utcoff;
    const isdst = start < end ? (start <= ts && ts < end) : !(end <= ts && ts < start);
    let ambiguousStart;
    let ambiguousEnd;
    if (this.dstDiff > 0) {
      ambiguousStart = end;
      ambiguousEnd = end + this.dstDiff;
    } else {
      ambiguousStart = start;
      ambiguousEnd = start - this.dstDiff;
    }
    return [isdst ? this.dst : this.std, ambiguousStart <= ts && ts < ambiguousEnd];
  }
}

const TZ_DELTA = /^(?<sign>[+-])?(?<h>[0-9]{1,3})(?::(?<m>[0-9]{2})(?::(?<s>[0-9]{2}))?)?$/;

function parseTzDelta(text) {
  const match = TZ_DELTA.exec(text);
  const [h, m, s] = ["h", "m", "s"].map((name) => Number(match.groups[name] || 0));
  if (h > 24) throw new RangeError("Offset hours out of range");
  const total = h * 3600 + m * 60 + s;
  return match.groups.sign !== "-" ? -total : total;
}

function parseTransitionTime(text) {
  const match = TZ_DELTA.exec(text);
  if (!match) throw new RangeError("Invalid time");
  let [h, m, s] = ["h", "m", "s"].map((name) => Number(match.groups[name] || 0));
  if (h > 167) throw new RangeError("Hour out of range");
  if (match.groups.sign === "-") [h, m, s] = [-h, -m, -s];
  return [h, m, s];
}

/** Python int() of a string (ASCII digits, optional sign, underscores and surrounding whitespace). */
function pyIntText(text) {
  const match = /^[\s]*([+-]?)([0-9]+(?:_[0-9]+)*)[\s]*$/.exec(text);
  if (!match) throw new RangeError("invalid literal for int()");
  const value = Number(match[2].replaceAll("_", ""));
  return match[1] === "-" ? -value : value;
}

function parseDstStartEnd(text) {
  const slash = text.indexOf("/");
  let date = slash < 0 ? text : text.slice(0, slash);
  const time = slash < 0 ? null : text.slice(slash + 1);
  let offset;
  if (date.slice(0, 1) === "M") {
    const match = /^M([0-9]{1,2})\.([0-9])[^\n]([0-9])$/s.exec(date);
    if (!match) throw new RangeError("Invalid dst start/end date");
    offset = new CalendarOffset(Number(match[1]), Number(match[2]), Number(match[3]));
  } else {
    const julian = date.slice(0, 1) === "J";
    if (julian) date = date.slice(1);
    offset = new DayOffset(pyIntText(date), julian);
  }
  if (time !== null) [offset.hour, offset.minute, offset.second] = parseTransitionTime(time);
  return offset;
}

const TZ_STRING = new RegExp("^(?<std>[^<0-9:.+-]+|<[a-zA-Z0-9+-]+>)(?:(?<stdoff>[+-]?[0-9]{1,3}(?::[0-9]{2}(?::[0-9]{2})?)?)"
  + "(?:(?<dst>[^0-9:.+-]+|<[a-zA-Z0-9+-]+>)(?<dstoff>[+-]?[0-9]{1,3}(?::[0-9]{2}(?::[0-9]{2})?)?)?)?)?$", "s");

function stripAngles(text) {
  return text.replace(/^[<>]+|[<>]+$/g, "");
}

/** zoneinfo._parse_tz_str: a TZif footer as a fixed ttinfo or a TzStr. */
function parseTzString(text) {
  const comma = text.indexOf(",");
  const offsetText = comma < 0 ? text : text.slice(0, comma);
  const startEnd = comma < 0 ? null : text.slice(comma + 1);
  const match = TZ_STRING.exec(offsetText);
  if (!match) throw new RangeError("Invalid TZ string");
  const stdAbbr = stripAngles(match.groups.std);
  const dstAbbr = match.groups.dst === undefined ? undefined : stripAngles(match.groups.dst);
  const stdOffset = match.groups.stdoff ? parseTzDelta(match.groups.stdoff) : 0;
  if (match.groups.dst !== undefined) {
    const dstOffset = match.groups.dstoff ? parseTzDelta(match.groups.dstoff) : stdOffset + 3600;
    if (startEnd === null) throw new RangeError("Missing transition rules");
    const second = startEnd.indexOf(",");
    const parts = second < 0 ? [startEnd] : [startEnd.slice(0, second), startEnd.slice(second + 1)];
    if (parts.length !== 2) throw new RangeError("Invalid TZ string");
    return new TzStr(stdAbbr, stdOffset, dstAbbr, dstOffset, parseDstStartEnd(parts[0]), parseDstStartEnd(parts[1]));
  }
  if (startEnd !== null) throw new RangeError("Transition rule present without DST");
  return { utcoff: stdOffset, tzname: stdAbbr };
}

/** zoneinfo._common.load_data plus ZoneInfo._load_file, for one TZif file's bytes. */
function loadTzif(data) {
  let position = 0;
  const need = (count) => {
    if (position + count > data.length) throw new RangeError("Truncated TZif data");
  };
  const header = () => {
    need(44);
    if (data.toString("latin1", position, position + 4) !== "TZif") throw new RangeError("Invalid TZif file: magic not found");
    const versionByte = data[position + 4];
    let version = 1;
    if (versionByte !== 0) {
      version = pyIntText(String.fromCharCode(versionByte));
    }
    const counts = [];
    for (let index = 0; index < 6; index += 1) counts.push(data.readInt32BE(position + 20 + index * 4));
    position += 44;
    const [isutcnt, isstdcnt, leapcnt, timecnt, typecnt, charcnt] = counts;
    return { version, isutcnt, isstdcnt, leapcnt, timecnt, typecnt, charcnt };
  };
  let head = header();
  let timeSize = 4;
  if (head.version !== 1) {
    timeSize = 8;
    position += head.timecnt * 5 + head.typecnt * 6 + head.charcnt + head.leapcnt * 8 + head.isstdcnt + head.isutcnt;
    head = header();
  }
  const transUtc = [];
  const transIdx = [];
  need(head.timecnt * (timeSize + 1));
  for (let index = 0; index < head.timecnt; index += 1) {
    transUtc.push(timeSize === 4 ? data.readInt32BE(position) : Number(data.readBigInt64BE(position)));
    position += timeSize;
  }
  for (let index = 0; index < head.timecnt; index += 1) transIdx.push(data[position + index]);
  position += head.timecnt;
  if (transIdx.length && Math.max(...transIdx) >= head.typecnt) throw new RangeError("Invalid transition index");
  const utcoff = [];
  const isdst = [];
  const abbrind = [];
  need(head.typecnt * 6);
  for (let index = 0; index < head.typecnt; index += 1) {
    utcoff.push(data.readInt32BE(position));
    isdst.push(data.readInt8(position + 4));
    abbrind.push(data.readInt8(position + 5));
    position += 6;
  }
  need(head.charcnt);
  const chars = data.subarray(position, position + head.charcnt);
  position += head.charcnt;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const abbr = abbrind.map((start) => {
    const index = start < 0 ? Math.max(chars.length + start, 0) : start;
    let stop = chars.indexOf(0, index);
    if (stop < 0) stop = chars.length - 1; // bytes.find() == -1 slices to [:-1].
    return decoder.decode(chars.subarray(index, Math.max(stop, index)));
  });
  // Standard/wall and UT/local indicators: unused by zoneinfo, used by the C library's POSIX rule fallback.
  const indicators = position + head.leapcnt * (timeSize + 4);
  const flag = (offset, count, index) => (index < count && indicators + offset + index < data.length
    ? data[indicators + offset + index] !== 0 : false);
  const isstd = utcoff.map((_, index) => flag(0, head.isstdcnt, index));
  const isut = utcoff.map((_, index) => flag(head.isstdcnt, head.isutcnt, index));
  let tzStr = null;
  if (head.version >= 2) {
    position += head.isutcnt + head.isstdcnt + head.leapcnt * 12;
    need(1);
    if (data[position] !== 0x0a) throw new RangeError("Invalid TZif file");
    position += 1;
    const newline = data.indexOf(0x0a, position);
    if (newline < 0) throw new RangeError("Invalid TZif file: unexpected end of file");
    tzStr = decoder.decode(data.subarray(position, newline));
  }
  // ZoneInfo._load_file
  const ttinfoList = utcoff.map((offset, index) => ({ utcoff: offset, tzname: abbr[index] }));
  const transLocal = tsToLocal(transIdx, transUtc, utcoff);
  const ttinfos = transIdx.map((index) => ttinfoList[index]);
  let ttiBefore = null;
  const firstStandard = isdst.findIndex((flag) => !flag);
  if (firstStandard >= 0) ttiBefore = ttinfoList[firstStandard];
  else if (ttinfos.length) ttiBefore = ttinfos[0];
  let tzAfter;
  if (tzStr !== null && tzStr !== "") tzAfter = parseTzString(tzStr);
  else {
    if (!ttinfos.length && !ttinfoList.length) throw new RangeError("No time zone information found.");
    tzAfter = ttinfos.length ? ttinfos[ttinfos.length - 1] : ttinfoList[ttinfoList.length - 1];
  }
  return { transUtc, transLocal, ttinfos, ttiBefore, tzAfter, raw: { transIdx, utcoff, isdst, abbr, isstd, isut } };
}

function tsToLocal(transIdx, transUtc, utcoffsets) {
  if (!transUtc.length) return [[], []];
  const wall = [[...transUtc], [...transUtc]];
  let offset0;
  let offset1;
  if (utcoffsets.length > 1) {
    offset0 = utcoffsets[0];
    offset1 = utcoffsets[transIdx[0]];
    if (offset1 > offset0) [offset1, offset0] = [offset0, offset1];
  } else {
    offset0 = offset1 = utcoffsets[0];
  }
  wall[0][0] += offset0;
  wall[1][0] += offset1;
  for (let index = 1; index < transIdx.length; index += 1) {
    offset0 = utcoffsets[transIdx[index - 1]];
    offset1 = utcoffsets[transIdx[index]];
    if (offset1 > offset0) [offset1, offset0] = [offset0, offset1];
    wall[0][index] += offset0;
    wall[1][index] += offset1;
  }
  return wall;
}

/** ZoneInfo.fromutc: the ttinfo for a UTC instant (whole seconds) and the fold flag. */
function zoneFromUtc(zone, timestamp, year) {
  const { transUtc, ttinfos, ttiBefore, tzAfter } = zone;
  const count = transUtc.length;
  if (count >= 1 && timestamp < transUtc[0]) return [ttiBefore, false];
  if ((count === 0 || timestamp > transUtc[count - 1]) && tzAfter instanceof TzStr) return tzAfter.getTransInfoFromUtc(timestamp, year);
  if (count === 0) return [tzAfter, false];
  const index = bisectRight(transUtc, timestamp);
  let previous;
  let tti;
  if (count > 1 && timestamp >= transUtc[1]) {
    previous = ttinfos[index - 2];
    tti = ttinfos[index - 1];
  } else if (timestamp > transUtc[count - 1]) {
    previous = ttinfos[count - 1];
    tti = tzAfter;
  } else {
    previous = ttiBefore;
    tti = ttinfos[0];
  }
  return [tti, previous.utcoff - tti.utcoff > timestamp - transUtc[index - 1]];
}

/** ZoneInfo._find_trans for a local wall time (whole seconds) and fold. */
function zoneFindTrans(zone, local, year, fold) {
  const list = zone.transLocal[fold ? 1 : 0];
  const count = list.length;
  if (count && local < list[0]) return zone.ttiBefore;
  if (!count || local > list[count - 1]) {
    return zone.tzAfter instanceof TzStr ? zone.tzAfter.getTransInfo(local, year, fold ? 1 : 0) : zone.tzAfter;
  }
  return zone.ttinfos[bisectRight(list, local) - 1];
}

/** zoneinfo._tzpath._validate_tzfile_path. */
function validTzKey(key) {
  if (key.startsWith("/")) return false;
  const normal = (text) => {
    const parts = [];
    for (const part of text.split("/")) {
      if (part === "" || part === ".") continue;
      if (part !== ".." || !parts.length || parts[parts.length - 1] === "..") parts.push(part);
      else parts.pop();
    }
    return parts.join("/") || ".";
  };
  const normalized = normal(key);
  if (normalized.length !== key.length) return false;
  return normal("_/" + normalized).startsWith("_/");
}

function isRegularFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

const ZONE_CACHE = new Map();

/** zoneinfo.ZoneInfo(key): an IANA zone read from this host's TZif files. */
export class ZoneInfo {
  constructor(key) {
    if (typeof key !== "string") throw new TypeError("key must be a string");
    if (ZONE_CACHE.has(key)) return ZONE_CACHE.get(key);
    if (!validTzKey(key)) throw new RangeError("ZoneInfo keys must be normalized relative paths");
    const file = key.includes("\0") ? undefined : TZPATH.map((root) => path.join(root, key)).find(isRegularFile);
    if (file === undefined) throw new RangeError("No time zone found with this key");
    this.key = key;
    this.data = loadTzif(fs.readFileSync(file));
    ZONE_CACHE.set(key, this);
    Object.freeze(this);
  }

  /** {wall, name, offset}: local wall seconds and the tzname/utcoffset Python reports. */
  localize(seconds) {
    const year = wallTime(seconds).year;
    const [tti, fold] = zoneFromUtc(this.data, seconds, year);
    const wall = seconds + tti.utcoff;
    if (wall < MIN_SECONDS || wall > MAX_SECONDS) return null;
    const found = zoneFindTrans(this.data, wall, wallTime(wall).year, fold);
    return { wall, name: found.tzname, offset: found.utcoff };
  }
}

/** datetime.timezone(timedelta(seconds=offset), name): a fixed UTC offset. */
export class FixedOffset {
  constructor(offset, name = null) {
    if (!Number.isFinite(offset) || Math.abs(offset) >= 86400) throw new RangeError("offset must be strictly between -24h and 24h");
    this.offset = offset;
    this.name = name;
    Object.freeze(this);
  }

  localize(seconds) {
    const wall = seconds + Math.floor(this.offset);
    if (wall < MIN_SECONDS || wall > MAX_SECONDS) return null;
    const name = this.name !== null ? this.name : (this.offset === 0 ? "UTC" : "");
    return { wall, name, offset: this.offset };
  }
}

export const UTC = new FixedOffset(0);

// The C library's own local time, as datetime.astimezone() with no argument uses it:
// TZ (file, then POSIX rule string) or /etc/localtime, falling back to UTC.

function loadTzifFile(file) {
  try {
    return { data: loadTzif(fs.readFileSync(file)) };
  } catch {
    return null;
  }
}

// macOS ships an older tzcode: POSIX rules expand to 600 years of transitions from 1970,
// rule times are unsigned, and rule-less DST strings borrow the posixrules transitions.
const OLD_TZCODE = process.platform === "darwin";

function libcRuleDay(rule, year) {
  if (rule.kind === "J") return postEpochDaysBeforeYear(year) + rule.n - 1 + (isLeap(year) && rule.n >= 60 ? 1 : 0);
  if (rule.kind === "D") return postEpochDaysBeforeYear(year) + rule.n;
  return Math.floor(new CalendarOffset(rule.m, rule.w, rule.d, 0).yearToEpoch(year) / 86400);
}

/** A tzcode-style POSIX TZ string, or null when the C library would reject it. */
function parseLibcTz(source) {
  let text = source;
  let index = 0;
  const name = () => {
    if (text[index] === "<") {
      const close = text.indexOf(">", index + 1);
      if (close < 0) return null;
      const value = text.slice(index + 1, close);
      index = close + 1;
      return value.length >= 3 ? value : null;
    }
    const value = /^[^0-9,+-]*/.exec(text.slice(index))[0];
    index += value.length;
    return value.length >= 3 ? value : null;
  };
  const number = (maximum) => {
    const match = /^[0-9]+/.exec(text.slice(index));
    if (!match || Number(match[0]) > maximum) return null;
    index += match[0].length;
    return Number(match[0]);
  };
  const seconds = () => {
    const hours = number(167);
    if (hours === null) return null;
    let total = hours * 3600;
    if (text[index] === ":") {
      index += 1;
      const minutes = number(59);
      if (minutes === null) return null;
      total += minutes * 60;
      if (text[index] === ":") {
        index += 1;
        const secs = number(60);
        if (secs === null) return null;
        total += secs;
      }
    }
    return total;
  };
  const signed = () => {
    let negative = false;
    if (text[index] === "-") {
      negative = true;
      index += 1;
    } else if (text[index] === "+") index += 1;
    const value = seconds();
    return value === null ? null : (negative ? -value : value);
  };
  const rule = () => {
    let result;
    if (text[index] === "J") {
      index += 1;
      const n = number(365);
      if (n === null || n < 1) return null;
      result = { kind: "J", n };
    } else if (/[0-9]/.test(text[index] || "")) {
      const n = number(365);
      if (n === null) return null;
      result = { kind: "D", n };
    } else if (text[index] === "M") {
      index += 1;
      const m = number(12);
      if (m === null || m < 1 || text[index] !== ".") return null;
      index += 1;
      const w = number(5);
      if (w === null || w < 1 || text[index] !== ".") return null;
      index += 1;
      const d = number(6);
      if (d === null) return null;
      result = { kind: "M", m, w, d };
    } else return null;
    result.time = 7200;
    if (text[index] === "/") {
      index += 1;
      const time = OLD_TZCODE ? seconds() : signed();
      if (time === null) return null;
      result.time = time;
    }
    return result;
  };
  const std = name();
  if (std === null || index >= text.length) return null;
  const stdWest = signed();
  if (stdWest === null) return null;
  if (index >= text.length) return { fixed: { utcoff: -stdWest, tzname: std } };
  const dst = name();
  if (dst === null) return null;
  let dstWest = stdWest - 3600;
  if (index < text.length && text[index] !== "," && text[index] !== ";") {
    const west = signed();
    if (west === null) return null;
    dstWest = west;
  }
  const zone = { std: { utcoff: -stdWest, tzname: std, isdst: false }, dst: { utcoff: -dstWest, tzname: dst, isdst: true } };
  if (index >= text.length) {
    if (OLD_TZCODE) {
      const table = posixRulesTable(stdWest, dstWest, zone);
      if (table) return { table };
      text = ",M4.1.0,M10.5.0";
    } else text = ",M3.2.0,M11.1.0";
    index = 0;
  }
  if (text[index] !== "," && text[index] !== ";") return null;
  index += 1;
  const start = rule();
  if (start === null || text[index] !== ",") return null;
  index += 1;
  const end = rule();
  if (end === null || index !== text.length) return null;
  if (OLD_TZCODE) return { table: ruleTable(stdWest, dstWest, zone, start, end) };
  return { ...zone, start, end };
}

/** Old tzcode: two transitions a year from 1970 while fewer than TZ_MAX_TIMES (1200). */
function ruleTable(stdWest, dstWest, zone, start, end) {
  const ats = [];
  const types = [];
  for (let year = 1970; ats.length + 2 <= 1200; year += 1) {
    const startTime = libcRuleDay(start, year) * 86400 + start.time + stdWest;
    const endTime = libcRuleDay(end, year) * 86400 + end.time + dstWest;
    if (startTime > endTime) ats.push(endTime, startTime), types.push(1, 0);
    else ats.push(startTime, endTime), types.push(0, 1);
  }
  return { ats, types, ttis: [zone.dst, zone.std] };
}

/** Old tzcode: reuse posixrules transitions, shifted to this string's standard offset. */
function posixRulesTable(stdWest, dstWest, zone) {
  const loaded = loadTzifFile(TZDIR + "/posixrules");
  if (!loaded) return null;
  const { transUtc, raw } = loaded.data;
  const ats = [...transUtc];
  const types = [];
  let theirStd = 0;
  for (const index of raw.transIdx) {
    if (!raw.isdst[index]) {
      theirStd = -raw.utcoff[index];
      break;
    }
  }
  raw.transIdx.forEach((index, position) => {
    types.push(raw.isdst[index] ? 1 : 0);
    if (!raw.isut[index]) ats[position] += stdWest - theirStd; // tzcode never sets its local isdst here.
    if (!raw.isdst[index]) theirStd = -raw.utcoff[index];
  });
  void dstWest;
  return { ats, types, ttis: [zone.std, zone.dst] };
}

function tableLookup(table, seconds) {
  const { ats, types, ttis } = table;
  if (!ats.length || seconds < ats[0]) {
    const standard = ttis.findIndex((tti) => !tti.isdst);
    return ttis[standard >= 0 ? standard : 0];
  }
  let low = 1;
  let high = ats.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (seconds < ats[middle]) high = middle;
    else low = middle + 1;
  }
  return ttis[types[low - 1]];
}

function libcRules() {
  const tz = process.env.TZ;
  const utc = { fixed: { utcoff: 0, tzname: "UTC" } };
  if (tz === undefined) return loadTzifFile("/etc/localtime") || utc;
  if (tz === "") return utc;
  const colon = tz.startsWith(":");
  const name = colon ? tz.slice(1) : tz;
  const file = name === "" ? "/etc/localtime" : (name.startsWith("/") ? name : TZDIR + "/" + name);
  const loaded = loadTzifFile(file);
  if (loaded) return loaded;
  if (!colon) {
    const posix = parseLibcTz(name);
    if (posix) return posix;
  }
  return utc;
}

/** {offset, name} the C library reports (tm_gmtoff, tm_zone) for a UTC instant. */
function libcLocal(seconds) {
  const rules = libcRules();
  if (rules.data) {
    const [tti] = zoneFromUtc(rules.data, seconds, wallTime(seconds).year);
    return { offset: tti.utcoff, name: tti.tzname };
  }
  if (rules.fixed) return { offset: rules.fixed.utcoff, name: rules.fixed.tzname };
  if (rules.table) {
    const tti = tableLookup(rules.table, seconds);
    return { offset: tti.utcoff, name: tti.tzname };
  }
  const year = wallTime(seconds).year;
  const at = (rule, offset) => libcRuleDay(rule, year) * 86400 + rule.time - offset;
  const start = at(rules.start, rules.std.utcoff);
  const end = at(rules.end, rules.dst.utcoff);
  const isdst = start < end ? (start <= seconds && seconds < end) : !(end <= seconds && seconds < start);
  const tti = isdst ? rules.dst : rules.std;
  return { offset: tti.utcoff, name: tti.tzname };
}

const LIBC_LOCAL = Object.freeze({
  localize(seconds) {
    const { offset, name } = libcLocal(seconds);
    const wall = seconds + offset;
    if (wall < MIN_SECONDS || wall > MAX_SECONDS) return null;
    return { wall, name, offset };
  },
});

/** Python's os.path.realpath (non-strict): resolve what exists, keep the rest. */
function realpath(file) {
  const rest = file.split("/").reverse();
  let current = file.startsWith("/") ? "/" : process.cwd();
  const seen = new Map();
  let remaining = rest.length;
  while (remaining) {
    const name = rest.pop();
    if (name === null) {
      seen.set(rest.pop(), current);
      continue;
    }
    remaining -= 1;
    if (!name || name === ".") continue;
    if (name === "..") {
      current = current.slice(0, current.lastIndexOf("/")) || "/";
      continue;
    }
    const next = current === "/" ? current + name : current + "/" + name;
    let target;
    try {
      if (!fs.lstatSync(next).isSymbolicLink()) {
        current = next;
        continue;
      }
      if (seen.has(next)) {
        const known = seen.get(next);
        current = known !== null ? known : next;
        continue;
      }
      target = fs.readlinkSync(next);
    } catch {
      current = next;
      continue;
    }
    seen.set(next, null);
    rest.push(next, null);
    const parts = target.split("/").reverse();
    rest.push(...parts);
    remaining += parts.length;
    if (target.startsWith("/")) current = "/";
  }
  return current;
}

/**
 * The agent host's local zone as [zone or null, IANA key or null].
 *
 * Standard library and local files only: TZ, then the /etc/localtime link.
 * null means "use the C library's local time", which still honours TZ.
 */
export function localZone() {
  let candidate = (process.env.TZ || "").replace(/^:+/, "");
  if (!candidate) {
    let target = "";
    try {
      target = realpath("/etc/localtime");
    } catch {
      target = "";
    }
    const marker = target.indexOf("/zoneinfo/");
    candidate = marker >= 0 ? target.slice(marker + "/zoneinfo/".length) : "";
  }
  if (candidate) {
    try {
      return [new ZoneInfo(candidate), candidate];
    } catch {
      // Unknown key or no tz database: fall back to C-library local time.
    }
  }
  return [null, null];
}

let AVAILABLE = null;

/** zoneinfo.available_timezones(): TZif files under TZPATH (cached per process). */
export function availableTimezones() {
  if (AVAILABLE) return AVAILABLE;
  const zones = new Set();
  const isTzif = (file) => {
    let descriptor;
    try {
      descriptor = fs.openSync(file, "r");
      const buffer = Buffer.alloc(4);
      const count = fs.readSync(descriptor, buffer, 0, 4, 0);
      return count === 4 && buffer.toString("latin1") === "TZif";
    } catch {
      return false;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  };
  for (const root of TZPATH) {
    if (!fs.existsSync(root)) continue;
    const pending = [root];
    while (pending.length) {
      const directory = pending.pop();
      let entries;
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const file = path.join(directory, entry.name);
        let isDirectory = entry.isDirectory();
        if (entry.isSymbolicLink()) {
          try {
            isDirectory = fs.statSync(file).isDirectory();
          } catch {
            isDirectory = false;
          }
          if (isDirectory) continue; // os.walk lists but does not follow directory links.
        }
        if (isDirectory) {
          if (directory === root && (entry.name === "right" || entry.name === "posix")) continue;
          pending.push(file);
          continue;
        }
        const key = path.relative(root, file);
        if (!key || zones.has(key)) continue;
        if (isTzif(file)) zones.add(key);
      }
    }
  }
  zones.delete("posixrules");
  AVAILABLE = zones;
  return zones;
}

/**
 * Load an IANA zone name recorded as review_summary.time_zone, or null.
 *
 * Only exact names listed by this host's time zone database are accepted,
 * so spelling cannot depend on a case-insensitive file system.
 */
export function readerZone(name) {
  try {
    if (typeof name !== "string" || !availableTimezones().has(name)) return null;
    return new ZoneInfo(name);
  } catch {
    return null;
  }
}

function clock(moment, withDate) {
  const text = `${String(moment.hour).padStart(2, "0")}:${String(moment.minute).padStart(2, "0")}`;
  return withDate ? `${moment.day} ${MONTHS[moment.month - 1]} ${moment.year}, ${text}` : text;
}

function span(start, end, single, withDate = true) {
  // single is decided from UTC minutes: across a DST fall-back two instants can share a wall time.
  if (single) return clock(start, withDate);
  if (sameDate(start, end)) return clock(start, withDate) + "-" + clock(end, false);
  return clock(start, true) + " - " + clock(end, true);
}

function zoneLabel(moment) {
  const name = moment.name || "";
  if (/^[A-Za-z]{2,6}$/.test(name)) return name;
  let minutes = Math.floor(moment.offset / 60);
  const sign = minutes >= 0 ? "+" : "-";
  minutes = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Summary-friendly local window with UTC, e.g.
 * '26 Oct 2026, 13:44-14:40 local time (CET, Europe/Paris; 12:44-13:40 UTC)'.
 *
 * start/end are UTC instants (BigInt microseconds since the epoch, or Dates).
 * zone null uses the host's local time. Minutes are truncated; exact UTC
 * timestamps stay in the evidence log.
 */
export function friendlyWindow(start, end, zone = null, key = null) {
  const startMicros = toMicros(start);
  const endMicros = toMicros(end);
  const single = floorDiv(startMicros, 60000000n) === floorDiv(endMicros, 60000000n);
  const startSeconds = Number(floorDiv(startMicros, 1000000n));
  const endSeconds = Number(floorDiv(endMicros, 1000000n));
  const utcStart = wallTime(startSeconds);
  const utcEnd = wallTime(endSeconds);
  const converter = zone === null || zone === undefined ? LIBC_LOCAL : zone;
  const local = [];
  for (const seconds of [startSeconds, endSeconds]) {
    const result = converter.localize(seconds);
    if (result === null) return span(utcStart, utcEnd, single) + " UTC (local time unavailable)";
    local.push({ ...wallTime(result.wall), name: result.name, offset: result.offset });
  }
  const labels = [];
  for (const moment of local) {
    const label = zoneLabel(moment);
    if (!labels.includes(label)) labels.push(label);
  }
  let label = labels.join(" to ");
  if (key && !labels.includes(key)) label += ", " + key;
  const sameDates = sameDate(utcStart, local[0]) && sameDate(utcEnd, local[1]);
  const utc = span(utcStart, utcEnd, single, !(sameDates && sameDate(utcStart, utcEnd)));
  return `${span(local[0], local[1], single)} local time (${label}; ${utc} UTC)`;
}

// ---- Validation -------------------------------------------------------------------

/**
 * Value-free diagnostics: never echo source keys, paths or evidence.
 *
 * Messages are literal strings, so main() can print them to tell failures apart.
 */
export class ModelError extends ReportError {
  constructor(message) {
    super(message);
    this.name = "ModelError";
  }
}

function requireThat(condition, message) {
  if (!condition) throw new ModelError(message);
}

function checkObject(value, required, optional = []) {
  requireThat(isDict(value) && required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key)), "Invalid object fields.");
}

function checkText(value, limit = 8000) {
  let ok = typeof value === "string" && pyStrip(value) !== "" && codePointLength(value) <= limit;
  if (ok) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code < 32 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029) {
        ok = false;
        break;
      }
    }
  }
  requireThat(ok, "Expected bounded, nonempty single-line text.");
}

const ID_RE = new RegExp(`^${ID_PATTERN}$`);

function checkIdentifier(value) {
  checkText(value, 64);
  requireThat(ID_RE.test(value), "Invalid metadata identifier.");
}

function checkTexts(value, minimum = 0, maximum = 100) {
  requireThat(Array.isArray(value) && minimum <= value.length && value.length <= maximum, "Invalid text list.");
  for (const item of value) checkText(item);
}

function checkInteger(value) {
  requireThat(isInt(value) && value >= 1, "Expected a positive integer.");
}

/** A validated UTC timestamp as BigInt microseconds since the epoch. */
function parseUtc(value) {
  checkText(value, 32);
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,6}))?Z$/.exec(value);
  requireThat(match !== null, "Expected a UTC timestamp ending in Z.");
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const micro = match[7] === undefined ? 0 : Number(match[7].padEnd(6, "0"));
  // datetime.fromisoformat accepts 24:00:00 as midnight of the next day.
  let moment;
  if (hour === 24 && minute === 0 && second === 0 && micro === 0) {
    const base = utcMoment(year, month, day);
    if (base !== null) {
      const next = wallTime(Number(base / 1000000n) + 86400);
      moment = utcMoment(next.year, next.month, next.day);
    } else moment = null;
  } else moment = utcMoment(year, month, day, hour, minute, second, micro);
  if (moment === null) throw new ModelError("Invalid UTC calendar time.");
  return moment;
}

/** Deterministic, bounded JSON serialization (also bounds the API). */
export function jsonBytes(value) {
  let data;
  try {
    data = Buffer.from(pythonJson(value) + "\n", "utf8");
  } catch {
    throw new ModelError("Invalid JSON value.");
  }
  requireThat(data.length <= MAX_BYTES, "JSON exceeds 2 MB.");
  return data;
}

function checkEnum(value, choices) {
  checkText(value, 64);
  requireThat(choices.includes(value), "Invalid metadata state.");
}

function checkIds(values, choices = null, minimum = 0) {
  requireThat(Array.isArray(values) && minimum <= values.length && values.length <= 1000, "Invalid identifier list.");
  for (const value of values) checkIdentifier(value);
  requireThat(values.length === new Set(values).size, "Duplicate metadata identifier.");
  if (choices !== null) requireThat(values.every((value) => choices.has(value)), "Unknown metadata identifier.");
}

function checkRecordId(record, seen) {
  checkIdentifier(record.id);
  requireThat(!seen.has(record.id), "Duplicate record ID.");
  seen.add(record.id);
}

function validateConsent(ledger) {
  requireThat(Array.isArray(ledger) && ledger.length === 4, "Require four per-ID optional consent records.");
  const decisions = new Map();
  for (const entry of ledger) {
    checkObject(entry, ["check_id", "decision", "materials", "exclusions", "source_kind", "owner_alias",
      "provenance", "statement_at", "approved_at"]);
    checkEnum(entry.check_id, OPTIONAL_IDS);
    requireThat(!decisions.has(entry.check_id), "Duplicate consent check ID.");
    decisions.set(entry.check_id, entry);
    checkEnum(entry.decision, ["not_requested", "accepted", "declined", "partial"]);
    checkEnum(entry.source_kind, ["owner_statement"]);
    checkIds(entry.exclusions);
    const materials = entry.materials;
    requireThat(Array.isArray(materials) && materials.length <= 100, "Invalid named material list.");
    const seen = new Set();
    for (const material of materials) {
      checkObject(material, ["alias", "scope_alias", "read_boundaries"]);
      checkIdentifier(material.alias);
      checkIdentifier(material.scope_alias);
      checkIds(material.read_boundaries, null, 1);
      const key = material.alias + "\n" + material.scope_alias;
      requireThat(!seen.has(key) && !entry.exclusions.includes(material.alias), "Duplicate or excluded material.");
      seen.add(key);
    }
    const decision = entry.decision;
    if (decision === "partial") requireThat(entry.exclusions.length > 0, "Partial consent must identify excluded material.");
    if (decision === "not_requested") {
      requireThat(!materials.length && ["owner_alias", "provenance", "statement_at", "approved_at"].every((key) => entry[key] === null),
        "Unrequested consent grants no scope.");
      continue;
    }
    checkIdentifier(entry.owner_alias);
    checkText(entry.provenance);
    const statementTime = parseUtc(entry.statement_at);
    if (decision === "declined") {
      requireThat(!materials.length && entry.approved_at === null, "Declined consent grants no material.");
    } else {
      requireThat(materials.length > 0 && parseUtc(entry.approved_at) >= statementTime,
        "Named material requires timestamped owner approval.");
    }
  }
  return decisions;
}

function checkConsented(decisions, checkId, record, observedAt) {
  const consent = decisions.get(checkId);
  requireThat(["accepted", "partial"].includes(consent.decision), "Optional read has no per-ID approval.");
  requireThat(parseUtc(observedAt) >= parseUtc(consent.approved_at), "Observation precedes optional approval.");
  checkIdentifier(get(record, "material_alias"));
  checkIdentifier(get(record, "read_boundary"));
  requireThat(consent.materials.some((material) => material.alias === record.material_alias
    && material.scope_alias === record.scope_alias
    && material.read_boundaries.includes(record.read_boundary)), "Observation exceeds approved named material boundaries.");
}

function checkWindow(value) {
  checkObject(value, WINDOW_FIELDS);
  const times = {};
  for (const key of WINDOW_FIELDS) times[key] = value[key] === null ? null : parseUtc(value[key]);
  for (const [start, end] of [["requested_start", "requested_end"], ["covered_start", "covered_end"]]) {
    requireThat((times[start] === null) === (times[end] === null), "Window endpoints must both be known or unknown.");
    requireThat(times[start] === null || times[start] <= times[end], "Window ends before its start.");
  }
  if (times.requested_start !== null && times.covered_start !== null) {
    requireThat(times.requested_start <= times.covered_start && times.covered_start <= times.covered_end
      && times.covered_end <= times.requested_end, "Covered window exceeds requested window.");
  }
}

function checkOutcome(record) {
  checkEnum(record.outcome, OUTCOMES);
  checkEnum(record.failure_kind, FAILURE_KINDS);
  if (record.outcome === "timed_out") {
    requireThat(record.failure_kind === "timeout", "Timed-out outcome needs timeout metadata.");
  } else if (record.outcome === "failed") {
    requireThat(record.failure_kind !== "none", "Failed outcome needs a sanitised failure kind.");
  } else if (["complete", "not_collected"].includes(record.outcome)) {
    requireThat(record.failure_kind === "none", "Outcome conflicts with failure metadata.");
  }
}

const CHECK_ID_SET = new Set(CHECK_IDS);

function validateCoverage(records, decisions, seen) {
  requireThat(Array.isArray(records) && records.length <= 1000, "Invalid coverage record list.");
  const previous = new Map();
  for (const record of records) {
    checkObject(record, ["id", "feed_id", "usage", "check_ids", "source_kind", "source_description", "scope_alias",
      "material_alias", "read_boundary", "observed_at", "window", "reported_total", "count_basis",
      "received", "inspected", "page_cap", "overall_cap", "next_available", "exhausted", "truncated",
      "outcome", "failure_kind", "missing_sources", "assessment_effect", "retries"]);
    checkRecordId(record, seen);
    checkIdentifier(record.feed_id);
    checkIdentifier(record.scope_alias);
    checkIds(record.check_ids, CHECK_ID_SET, 1);
    checkEnum(record.usage, ["planned", "used"]);
    checkEnum(record.source_kind, SOURCE_KINDS);
    for (const key of ["source_description", "count_basis", "missing_sources", "assessment_effect"]) checkText(record[key]);
    const observedTime = parseUtc(record.observed_at);
    const key = record.feed_id + "\n" + record.scope_alias;
    requireThat(!previous.has(key) || observedTime >= previous.get(key), "Coverage records must be chronological per feed/scope.");
    previous.set(key, observedTime);
    checkWindow(record.window);
    for (const name of ["reported_total", "received", "inspected", "page_cap", "overall_cap"]) {
      const count = record[name];
      requireThat(count === null || (isInt(count) && count >= 0), "Counts must be nonnegative integers or unknown.");
    }
    if (record.received !== null && record.inspected !== null) {
      requireThat(record.inspected <= record.received, "Inspected count exceeds received count.");
    }
    for (const name of ["next_available", "exhausted", "truncated"]) {
      requireThat(record[name] === null || typeof record[name] === "boolean", "Coverage state must be true, false or unknown.");
    }
    for (const name of ["material_alias", "read_boundary"]) {
      if (record[name] !== null) checkIdentifier(record[name]);
    }
    checkOutcome(record);
    if (record.usage === "planned") requireThat(record.outcome === "not_collected", "Planned feeds cannot claim collection.");
    if (record.outcome === "not_collected") {
      requireThat(record.received === null && record.inspected === null && record.window.covered_start === null
        && ["next_available", "exhausted", "truncated"].every((name) => record[name] === null),
      "Uncollected coverage must remain unknown.");
    }
    if (record.outcome === "complete") {
      requireThat(record.exhausted === true && record.next_available === false && record.truncated === false
        && record.received !== null, "Complete collection requires verified end and counts.");
    }
    for (const checkId of record.check_ids) {
      if (OPTIONAL_IDS.includes(checkId) && record.outcome !== "not_collected") {
        checkConsented(decisions, checkId, record, record.observed_at);
      }
    }
    const retries = record.retries;
    requireThat(Array.isArray(retries) && retries.length <= 100, "Invalid retry record list.");
    requireThat(record.outcome !== "not_collected" || !retries.length, "Uncollected feeds cannot contain retry attempts.");
    let lastRetry = null;
    for (const attempt of retries) {
      checkObject(attempt, ["id", "attempted_at", "window", "outcome", "failure_kind", "remaining_gaps"]);
      checkRecordId(attempt, seen);
      const attemptedTime = parseUtc(attempt.attempted_at);
      requireThat((lastRetry === null || attemptedTime >= lastRetry) && attemptedTime <= observedTime,
        "Retry times must be chronological and no later than the coverage record.");
      lastRetry = attemptedTime;
      checkWindow(attempt.window);
      checkOutcome(attempt);
      for (const checkId of record.check_ids) {
        if (OPTIONAL_IDS.includes(checkId) && attempt.outcome !== "not_collected") {
          checkConsented(decisions, checkId, record, attempt.attempted_at);
        }
      }
      checkText(attempt.remaining_gaps);
    }
  }
}

function validateOwners(records, evidenceById, seen) {
  requireThat(Array.isArray(records) && records.length <= 1000, "Invalid owner confirmation list.");
  const previous = new Map();
  for (const record of records) {
    checkObject(record, ["id", "check_id", "scope_alias", "owner_alias", "source_kind", "statement_at",
      "metadata_observed_at", "evidence_refs", "answer"]);
    checkRecordId(record, seen);
    checkEnum(record.check_id, Object.keys(QUESTIONNAIRE));
    checkIdentifier(record.scope_alias);
    checkIdentifier(record.owner_alias);
    checkEnum(record.source_kind, ["owner_statement"]);
    const statementTime = parseUtc(record.statement_at);
    const key = [record.check_id, record.scope_alias, record.owner_alias].join("\n");
    requireThat(!previous.has(key) || statementTime >= previous.get(key), "Owner statements must be chronological.");
    previous.set(key, statementTime);
    if (record.metadata_observed_at !== null) {
      requireThat(parseUtc(record.metadata_observed_at) <= statementTime, "Metadata observation postdates its statement.");
    }
    checkIds(record.evidence_refs, evidenceById);
    for (const reference of record.evidence_refs) {
      const [checkId, entry] = evidenceById.get(reference);
      requireThat(checkId === record.check_id && entry.scope_alias === record.scope_alias
        && entry.source_kind !== "owner_statement", "Owner evidence reference must match separately observed scope/check.");
    }
    checkText(record.answer);
  }
}

/** Validate schema v1 without altering any input or inferring a status. */
export function validateReport(report) {
  jsonBytes(report);
  checkObject(report, ["schema_version", "revision", "scope_alias", "title", "scope",
    "review_summary", "recommendations", "follow_up", "checks", "coverage_limits", "owner_confirmations"]);
  checkInteger(report.schema_version);
  requireThat(intEquals(report.schema_version, 1), "Unsupported schema version.");
  checkInteger(report.revision);
  checkIdentifier(report.scope_alias);
  checkText(report.title, 240);
  const scope = report.scope;
  checkObject(scope, [...SCOPE_TEXT, "optional_consent"]);
  for (const key of SCOPE_TEXT) checkText(scope[key]);
  const decisions = validateConsent(scope.optional_consent);
  const summary = report.review_summary;
  checkObject(summary, [...SUMMARY_TEXT, "confirmed_strengths", "initial_priorities"], ["owner_accepted", "time_zone"]);
  for (const key of SUMMARY_TEXT) checkText(summary[key]);
  if (Object.hasOwn(summary, "time_zone")) {
    requireThat(typeof summary.time_zone === "string" && codePointLength(summary.time_zone) <= 64
      && readerZone(summary.time_zone) !== null,
    "review_summary.time_zone must be an IANA time zone name, such as Europe/London, "
      + "that this host's time zone database lists; omit it to use the agent host's zone.");
  }
  checkTexts(summary.confirmed_strengths);
  checkTexts(summary.initial_priorities, 0, 3);
  checkObject(report.follow_up, FOLLOW_UP_TEXT);
  for (const key of FOLLOW_UP_TEXT) checkText(report.follow_up[key]);
  const checks = report.checks;
  requireThat(Array.isArray(checks) && checks.length === 28, "Require exactly 24 core and 4 optional checks.");
  const checkIds = new Set();
  const evidenceIds = new Set();
  const evidenceById = new Map();
  for (const check of checks) {
    checkObject(check, ["id", "status", "evidence_log", ...CHECK_TEXT]);
    checkText(check.id, 6);
    requireThat(CHECK_IDS.includes(check.id) && !checkIds.has(check.id), "Unknown or duplicate check ID.");
    checkIds.add(check.id);
    checkText(check.status, 32);
    requireThat(isStatus(check.status), "Invalid check status.");
    for (const key of CHECK_TEXT) checkText(check[key]);
    const log = check.evidence_log;
    requireThat(Array.isArray(log), "Expected an evidence log.");
    requireThat(check.status === "not_reviewed" || log.length > 0, "Assessed checks need evidence.");
    if (OPTIONAL_IDS.includes(check.id) && ["not_requested", "declined"].includes(decisions.get(check.id).decision)) {
      requireThat(check.status === "not_reviewed" && !log.length,
        "Unapproved optional checks must be unreviewed without evidence history.");
    }
    let previousTime = null;
    for (const entry of log) {
      checkObject(entry, ["id", "observed_at", "source_kind", "source_description",
        "scope_alias", "observed", "limitation"], ["material_alias", "read_boundary"]);
      checkRecordId(entry, evidenceIds);
      evidenceById.set(entry.id, [check.id, entry]);
      for (const key of ["material_alias", "read_boundary"]) {
        if (Object.hasOwn(entry, key)) checkIdentifier(entry[key]);
      }
      if (OPTIONAL_IDS.includes(check.id)) checkConsented(decisions, check.id, entry, entry.observed_at);
      const observedTime = parseUtc(entry.observed_at);
      requireThat(previousTime === null || observedTime >= previousTime, "Evidence log must be chronological.");
      previousTime = observedTime;
      checkText(entry.source_kind, 32);
      requireThat(SOURCE_KINDS.includes(entry.source_kind), "Invalid evidence source kind.");
      checkIdentifier(entry.scope_alias);
      for (const key of ["source_description", "observed", "limitation"]) checkText(entry[key]);
    }
  }
  validateCoverage(report.coverage_limits, decisions, evidenceIds);
  validateOwners(report.owner_confirmations, evidenceById, evidenceIds);
  const recommendations = report.recommendations;
  requireThat(Array.isArray(recommendations) && recommendations.length <= 100, "Invalid recommendations.");
  for (const recommendation of recommendations) {
    checkObject(recommendation, [...RECOMMENDATION_TEXT, "check_ids", "prerequisites", "steps"]);
    for (const key of RECOMMENDATION_TEXT) checkText(recommendation[key]);
    const ids = recommendation.check_ids;
    checkTexts(ids, 1, 28);
    requireThat(ids.length === new Set(ids).size && ids.every((id) => CHECK_IDS.includes(id)), "Invalid related check IDs.");
    checkTexts(recommendation.prerequisites, 1);
    checkTexts(recommendation.steps, 1);
  }
  validateAccepted(get(summary, "owner_accepted", []), Object.fromEntries(checks.map((check) => [check.id, check])),
    evidenceById, recommendations);
}

/** Owner-accepted settings keep needs_confirmation and leave the action list. */
function validateAccepted(records, checks, evidenceById, recommendations) {
  requireThat(Array.isArray(records) && records.length <= 28, "Invalid owner-accepted settings.");
  const seen = new Set();
  const recommended = new Set(recommendations.flatMap((item) => item.check_ids));
  for (const record of records) {
    checkObject(record, ["check_id", "evidence_ref"]);
    checkText(record.check_id, 6);
    requireThat(CHECK_IDS.includes(record.check_id) && !seen.has(record.check_id),
      "Unknown or duplicate owner-accepted check.");
    seen.add(record.check_id);
    checkIdentifier(record.evidence_ref);
    requireThat(checks[record.check_id].status === "needs_confirmation",
      "Owner-accepted settings must stay needs_confirmation.");
    const [owner, entry] = evidenceById.get(record.evidence_ref) || [null, null];
    requireThat(owner === record.check_id && entry.source_kind === "owner_statement",
      "Owner acceptance needs an owner statement on the same check.");
    requireThat(!recommended.has(record.check_id), "Owner-accepted checks cannot have recommendations.");
  }
}

/**
 * Start an unreviewed draft; creation is not evidence collection or consent.
 *
 * timeZone: the reader's IANA zone name agreed at scope, or null for the host's.
 */
export function newReport(scopeAlias, title, timeZone = null) {
  const report = {
    schema_version: 1, revision: 1, scope_alias: scopeAlias, title,
    scope: Object.fromEntries(SCOPE_TEXT.map((key) => [key, "Not reviewed; owner confirmation required."])),
    review_summary: Object.fromEntries(SUMMARY_TEXT.map((key) => [key, "Not reviewed."])),
    recommendations: [], coverage_limits: [], owner_confirmations: [],
    follow_up: Object.fromEntries(FOLLOW_UP_TEXT.map((key) => [key, "Owner confirmation required."])),
    checks: CHECK_IDS.map((checkId) => ({
      id: checkId, status: "not_reviewed", statement: "Not inspected.",
      requirement: "Intent not confirmed.", rationale: "Collection not performed.",
      missing_evidence: "Confirm authorization and collection capability.", evidence_log: [],
    })),
  };
  report.scope.optional_consent = OPTIONAL_IDS.map((checkId) => ({
    check_id: checkId, decision: "not_requested", materials: [], exclusions: [],
    source_kind: "owner_statement", owner_alias: null, provenance: null, statement_at: null, approved_at: null,
  }));
  report.scope.source_application_review = "Not authorized; not reviewed.";
  report.scope.limitations = "No collection recorded; coverage is unknown. No feeds recorded does not establish completeness.";
  Object.assign(report.review_summary, { confirmed_strengths: [], initial_priorities: [] });
  if (timeZone !== null && timeZone !== undefined) report.review_summary.time_zone = timeZone;
  validateReport(report);
  return report;
}

/**
 * Return a new revision; old evidence and all unpatched fields are immutable.
 *
 * Status is always supplied by the reviewer, never inferred from observations.
 * Contradictions need human resolution; this is not a semantic evidence judge.
 */
export function appendEvidence(report, patch) {
  validateReport(report);
  jsonBytes(patch);
  checkObject(patch, ["expected_revision"], ["checks", "coverage_limits", "owner_confirmations"]);
  checkInteger(patch.expected_revision);
  requireThat(intEquals(patch.expected_revision, report.revision), "Revision conflict.");
  const changes = get(patch, "checks", []);
  requireThat(Array.isArray(changes) && changes.length <= 28, "Invalid check patch list.");
  let mutated = changes.length > 0;
  const updated = deepCopy(report);
  for (const key of ["coverage_limits", "owner_confirmations"]) {
    if (Object.hasOwn(patch, key)) {
      requireThat(Array.isArray(patch[key]), "Metadata patch must be a list of new records.");
      mutated = mutated || patch[key].length > 0;
      updated[key].push(...deepCopy(patch[key]));
    }
  }
  requireThat(mutated, "Empty patches do not create revisions.");
  const byId = new Map(updated.checks.map((check) => [check.id, check]));
  const supplied = new Set();
  for (const change of changes) {
    checkObject(change, ["id", "status", "statement", "rationale", "evidence_log"], ["requirement", "missing_evidence"]);
    checkText(change.id, 6);
    requireThat(byId.has(change.id) && !supplied.has(change.id), "Unknown or duplicate patched check ID.");
    supplied.add(change.id);
    requireThat(Array.isArray(change.evidence_log) && change.evidence_log.length > 0, "Each patch must append new evidence.");
    const check = byId.get(change.id);
    for (const key of ["status", ...CHECK_TEXT]) {
      if (Object.hasOwn(change, key)) check[key] = deepCopy(change[key]);
    }
    check.evidence_log.push(...deepCopy(change.evidence_log));
  }
  const revision = updated.revision;
  updated.revision = typeof revision === "bigint" ? revision + 1n
    : (revision + 1 > Number.MAX_SAFE_INTEGER ? BigInt(revision) + 1n : revision + 1);
  validateReport(updated);
  return updated;
}

/** Issue #10 interchange shape; counts are derived, never owner-authored. */
export function buildSummary(report) {
  validateReport(report);
  const summary = {};
  for (const group of ["core", "optional"]) summary[group] = Object.fromEntries(Object.keys(STATUSES).map((status) => [status, 0]));
  for (const check of report.checks) {
    const group = CORE_IDS.includes(check.id) ? "core" : "optional";
    summary[group][check.status] += 1;
  }
  return summary;
}

// ---- Markdown -----------------------------------------------------------------------

function known(value) {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function windowText(value) {
  return WINDOW_FIELDS.map((key) => key.replaceAll("_", " ") + ": " + known(value[key])).join("; ");
}

function consentLines(report, checks) {
  const lines = ["### Optional scope decisions", "",
    "Consent is per check and named material; no global approval is inferred. "
    + "Unapproved checks remain not_reviewed. Partial approval excludes the unreviewed remainder.", ""];
  const ledger = Object.fromEntries(report.scope.optional_consent.map((entry) => [entry.check_id, entry]));
  for (const checkId of OPTIONAL_IDS) {
    const consent = ledger[checkId];
    lines.push(`#### ${checkId} - ${CHECK_TITLES[checkId]}`, "",
      "- Decision: " + consent.decision, "- Current check status: " + checks[checkId].status,
      `- Consent source: ${consent.source_kind}; Role alias: ${known(consent.owner_alias)}; `
      + `Provenance: ${known(consent.provenance)}`,
      `- Statement UTC: ${known(consent.statement_at)}; Approval UTC: ${known(consent.approved_at)}`,
      "- Exclusions: " + (consent.exclusions.join(", ") || "none recorded; not permission to read more material."));
    if (!consent.materials.length) lines.push("- Named materials and read boundaries: none approved.");
    for (const material of consent.materials) {
      lines.push(`- Named material: ${material.alias}; Scope: ${material.scope_alias}; `
        + "Approved read boundaries: " + material.read_boundaries.join(", "));
    }
    lines.push("");
  }
  return lines;
}

function coverageLines(records) {
  const lines = ["## Coverage limits", ""];
  if (!records.length) {
    return [...lines, "No collection recorded; coverage is unknown. No planned or used feeds recorded "
      + "does not establish complete coverage or absence of resources.", ""];
  }
  const cursor = (value) => (value === null ? "unknown" : value ? "available" : "unavailable");
  for (const record of records) {
    lines.push(`### ${record.feed_id} - ${record.id}`, "",
      `- Source/feed: ${record.source_description}; Source kind: ${record.source_kind}; `
      + `Scope: ${record.scope_alias}; Observed UTC: ${record.observed_at}; `
      + `Checks: ${record.check_ids.join(", ")}; Usage: ${record.usage}; Outcome: ${record.outcome}; `
      + `Material: ${known(record.material_alias)}; Read boundary: ${known(record.read_boundary)}`,
      "- Window: " + windowText(record.window),
      `- Reported total: ${known(record.reported_total)}; Count basis: ${record.count_basis}`,
      "- Received: " + known(record.received), "- Inspected: " + known(record.inspected),
      `- Page/finding cap: page ${known(record.page_cap)}; overall ${known(record.overall_cap)}`,
      "- Truncation: " + known(record.truncated),
      "- Cursor availability: " + cursor(record.next_available),
      "- End known: " + known(record.exhausted),
      "- Missing sources: " + record.missing_sources, "- Timeouts/failures: " + record.failure_kind,
      "- Retries and outcomes: " + (record.retries.length ? "recorded below" : "not attempted; no retry outcome recorded."));
    for (const attempt of record.retries) {
      lines.push(`- Retry ${attempt.id}; Attempt UTC: ${attempt.attempted_at}; `
        + `Window: ${windowText(attempt.window)}; Outcome: ${attempt.outcome}; `
        + `Failure kind: ${attempt.failure_kind}; Remaining gaps: ${attempt.remaining_gaps}`);
    }
    lines.push("- Assessment effect: " + record.assessment_effect, "");
  }
  return [...lines, "Collection completeness does not prove individual inspection. A count, missing cursor, "
    + "or successful bounded retry alone does not establish the absence of events or resources.", ""];
}

function acceptedLines(records, checks) {
  const lines = ["", "### Deliberate or owner-accepted settings", "",
    "The owner gave a reason for keeping these settings. They stay needs_confirmation, are not initial "
    + "priorities or recommendations, and remain in the appendix. Source-code evidence of intent alone "
    + "is not owner acceptance.", ""];
  if (!records.length) return [...lines, "No owner-accepted settings recorded."];
  for (const record of records) {
    const entry = checks[record.check_id].evidence_log.find((item) => item.id === record.evidence_ref);
    lines.push(`- ${record.check_id} - ${CHECK_TITLES[record.check_id]}: status `
      + `${checks[record.check_id].status}. Owner reason (${entry.source_kind}, ${entry.id}; `
      + `Statement UTC: ${entry.observed_at}; Scope alias: ${entry.scope_alias}): ${entry.observed}`);
  }
  return lines;
}

function questionnaireLines(records) {
  const lines = ["", "### Owner confirmation questionnaire", "",
    "Owner replies are self-statements, not observed configuration. Source: owner_statement. "
    + "No automatic contact, DMs, email, bot requests or notification tests. Communication requires separate approval "
    + "of exact content and destination. Reuse provided answers without re-asking resolved questions. "
    + "Use only each responding Owner's own metadata in the approved scope; do not broaden access, "
    + "inspect another Owner's credentials or request elevated credentials.", ""];
  for (const [checkId, [title, question]] of Object.entries(QUESTIONNAIRE)) {
    lines.push(`#### ${checkId} - ${title}`, "", question, "");
    const answers = records.filter((record) => record.check_id === checkId);
    if (!answers.length) lines.push("- Answer state: not answered; statement time and metadata observation time are unknown.");
    for (const record of answers) {
      lines.push(`- Answer record: ${record.id}; Scope alias: ${record.scope_alias}; Role alias: ${record.owner_alias}; `
        + `Source: ${record.source_kind}; Statement UTC: ${record.statement_at}`,
      "- Metadata observed at: " + known(record.metadata_observed_at),
      "- Separately observed evidence: " + (record.evidence_refs.join(", ") || "none supplied"),
      "- Answer: " + record.answer);
    }
    lines.push("");
  }
  return lines;
}

/** One status column: schema version 1 holds one status per check for the scope. */
function matrixLines(report, checks) {
  const lines = ["## Status at a glance", "",
    "Each check's recorded status for the whole authorised scope. Schema version 1 stores one status "
    + "per check, so there are no per-project columns; the appendix holds the evidence and is the counted outcome.", ""];
  const accepted = new Set(get(report.review_summary, "owner_accepted", []).map((record) => record.check_id));
  if (accepted.size) {
    lines.push(`${OWNER_ACCEPTED_MARKER} marks a setting the owner has confirmed as deliberate, with a reason. `
      + "Its status stays needs_confirmation; see Deliberate or owner-accepted settings.", "");
  }
  for (const [identifiers, label] of [[CORE_IDS, "Check"], [OPTIONAL_IDS, "Optional check"]]) {
    if (identifiers === OPTIONAL_IDS) lines.push("Optional checks, kept separate from the 24 core checks:", "");
    lines.push(`| ${label} | ${report.scope_alias} |`, "| --- | --- |");
    for (const identifier of identifiers) {
      lines.push(`| ${identifier} ${CHECK_TITLES[identifier]}${accepted.has(identifier) ? " " + OWNER_ACCEPTED_MARKER : ""} `
        + `| ${checks[identifier].status} |`);
    }
    lines.push("");
  }
  return lines;
}

// Python's \d matches any Unicode decimal digit and int() reads its value.
const DIGIT = "\\p{Nd}";
const DATE = `(${DIGIT}{1,2}) (${MONTHS.join("|")}) (${DIGIT}{4}), (${DIGIT}{2}):(${DIGIT}{2})`;
const CLOCK = `(${DIGIT}{2}):(${DIGIT}{2})`;
const ND_RE = /\p{Nd}/u;

function digitValue(character) {
  let code = character.codePointAt(0);
  if (code < 128) return code - 48;
  let position = 0;
  while (ND_RE.test(String.fromCodePoint(code - 1))) {
    code -= 1;
    position += 1;
  }
  return position % 10;
}

function pyInt(text) {
  let value = 0;
  for (const character of text) value = value * 10 + digitValue(character);
  return value;
}

/**
 * UTC [start, end] from the UTC part of a friendly window, or null.
 *
 * Reads only the form friendlyWindow writes, e.g. '...; 12:44-13:40 UTC)' or
 * '26 Oct 2026, 12:44-13:40 UTC (local time unavailable)'. Anything else is
 * not parsed, so no overlap check is made. end is the last instant of its minute.
 */
function statedWindow(text) {
  const match = /; ([^;()]+) UTC\)$/u.exec(text) || /^([^;()]+) UTC \(local time unavailable\)$/u.exec(text);
  if (!match) return null;
  const part = match[1];
  const moment = (day, month, year, hour, minute) => utcMoment(pyInt(year), MONTHS.indexOf(month) + 1, pyInt(day),
    pyInt(hour), pyInt(minute));
  const lastInstant = (value) => value + 59999999n;
  const both = new RegExp(`^${DATE} - ${DATE}$`, "u").exec(part);
  if (both) {
    const values = both.slice(1);
    const start = moment(...values.slice(0, 5));
    const end = moment(...values.slice(5));
    return start === null || end === null ? null : [start, lastInstant(end)];
  }
  let values;
  const dated = new RegExp(`^${DATE}(?:-${CLOCK})?$`, "u").exec(part);
  if (!dated) {
    // Undated UTC part: friendlyWindow omits it only when the local date is the UTC date.
    const lead = new RegExp(`^${DATE}`, "u").exec(text);
    const undated = lead && new RegExp(`^${CLOCK}(?:-${CLOCK})?$`, "u").exec(part);
    if (!undated) return null;
    values = [...lead.slice(1, 4), ...undated.slice(1)];
  } else {
    values = dated.slice(1);
  }
  const start = moment(...values.slice(0, 5));
  if (start === null) return null;
  const end = values[5] !== undefined ? moment(...values.slice(0, 3), ...values.slice(5)) : start;
  if (end === null) return null;
  return start <= end ? [start, lastInstant(end)] : null;
}

/** Summary time lines: zone used, stated review window, evidence span, overlap flag. */
function timeLines(report, zone, key, source) {
  const summary = report.review_summary;
  let zoneText;
  if (source === "reader") zoneText = `${key}, the reader's time zone agreed at scope.`;
  else if (key) zoneText = `the agent host's time zone (${key}); no reader time zone was recorded.`;
  else if (zone !== null) zoneText = "the agent host's time zone (named by its UTC offset below); no reader time zone was recorded.";
  else zoneText = "the agent host's local time zone (name unavailable); no reader time zone was recorded.";
  const lines = ["- Times shown in: " + zoneText, "- Review window (stated): " + summary.reviewed_at];
  const times = report.checks.flatMap((check) => check.evidence_log.map((entry) => parseUtc(entry.observed_at)));
  if (!times.length) return [...lines, "- Evidence collected between (from observations): no observations logged yet."];
  const first = times.reduce((a, b) => (b < a ? b : a));
  const last = times.reduce((a, b) => (b > a ? b : a));
  lines.push("- Evidence collected between (from observations): " + friendlyWindow(first, last, zone, key)
    + ", first to last logged observation. Exact UTC times are in the appendix.");
  const stated = statedWindow(summary.reviewed_at);
  if (stated && (last < stated[0] || first > stated[1])) {
    lines.push("- Time check: the stated review window and the logged observation times do not overlap. "
      + "Correct the review window or explain the difference before sharing.");
  }
  return lines;
}

/**
 * Build readable guided Markdown; author text is never a template or code.
 *
 * Summary times use review_summary.time_zone when recorded. Otherwise they use
 * zone (an optional ZoneInfo or FixedOffset standing in for the host's) or the host's own zone.
 */
export function buildMarkdown(report, zone = null) {
  const counts = buildSummary(report);
  const recorded = get(report.review_summary, "time_zone");
  let source = "host";
  let key;
  if (recorded !== null && readerZone(recorded) !== null) {
    [zone, key, source] = [readerZone(recorded), recorded, "reader"];
  } else if (zone !== null && zone !== undefined) {
    key = zone.key ?? null;
  } else {
    [zone, key] = localZone();
  }
  const summary = report.review_summary;
  const scope = report.scope;
  const checks = Object.fromEntries(report.checks.map((check) => [check.id, check]));
  const lines = ["# " + report.title, "",
    "Read-only configuration review. Not a security certification. Local draft; review before sharing.", ""];
  lines.push(...matrixLines(report, checks));
  lines.push("## Review summary", "",
    `- Revision: ${report.revision}`, `- Scope alias: ${report.scope_alias}`,
    ...timeLines(report, zone, key, source),
    "- Method: " + summary.method,
    "- Overall takeaway: " + summary.overall_takeaway);
  for (const [group, total] of [["core", 24], ["optional", 4]]) {
    lines.push(`- ${group[0].toUpperCase() + group.slice(1)} coverage (${total}): `
      + Object.entries(counts[group]).map(([status, count]) => `${status}: ${count}`).join("; "));
  }
  lines.push("- Changes made: none. Recommendations are proposed actions, not work performed.", "",
    "This point-in-time configuration review is not penetration testing, certification, compliance assessment, "
    + "or ongoing monitoring. A satisfactory setting does not establish application security.", "",
    "## Initial priorities", "");
  const priorities = summary.initial_priorities.map((text, index) => `${index + 1}. ${text}`);
  lines.push(...(priorities.length ? priorities : ["No initial priorities recorded."]));
  lines.push("", "## Confirmed strengths", "");
  const strengths = summary.confirmed_strengths.map((text) => "- " + text);
  lines.push(...(strengths.length ? strengths : ["No confirmed strengths recorded."]));
  lines.push("", "## Scope, missing evidence, and limitations", "");
  const scopeLabels = ["Included", "Excluded", "Authorization", "Sources used", "Limitations",
    "Source/application review", "Documentation verification"];
  lines.push(...SCOPE_TEXT.map((name, index) => `- ${scopeLabels[index]}: ${scope[name]}`));
  lines.push("", "Unavailable fields mean unknown, not disabled. Owner statements are not observed configuration. "
    + "Contradictory and stale evidence requires human resolution. Authored summary and recommendations "
    + "are preserved on append and must be reviewed again against the complete history.", "");
  lines.push(...consentLines(report, checks));
  lines.push(...coverageLines(report.coverage_limits));
  lines.push("## Recommendations", "");
  if (!report.recommendations.length) lines.push("No recommendations recorded. Review unresolved checks before sharing.", "");
  report.recommendations.forEach((recommendation, offset) => {
    lines.push(`### ${offset + 1} - ${recommendation.title}`, "",
      "- Related checks / status: " + recommendation.check_ids.map((identifier) => `${identifier}: ${checks[identifier].status}`).join("; "),
      "- Evidence and rationale: " + recommendation.evidence_and_rationale,
      "- Benefit: " + recommendation.benefit, "- Who: " + recommendation.responsible_role);
    lines.push(...recommendation.prerequisites.map((text) => "- Before changing: " + text));
    lines.push("- Where to start: " + recommendation.where_to_start, "");
    lines.push(...recommendation.steps.map((text, index) => `${index + 1}. ${text}`));
    lines.push("", "- Done when: " + recommendation.done_when,
      "- Impact / rollback: " + recommendation.impact, "- Docs: " + recommendation.docs, "");
  });
  lines.push("## Follow-up and completion", "");
  const followLabels = ["Owner decisions needed", "Deferred checks", "Suggested recheck"];
  lines.push(...FOLLOW_UP_TEXT.map((name, index) => `- ${followLabels[index]}: ${report.follow_up[name]}`));
  lines.push(...acceptedLines(get(summary, "owner_accepted", []), checks));
  lines.push(...questionnaireLines(report.owner_confirmations));
  for (const [identifiers, heading] of [[CORE_IDS, "Appendix: required core checks"],
    [OPTIONAL_IDS, "Appendix: optional checks, excluded from core coverage"]]) {
    lines.push("", "## " + heading, "");
    for (const identifier of identifiers) {
      const check = checks[identifier];
      lines.push(`### ${identifier} - ${CHECK_TITLES[identifier]}`, "", "Status: " + check.status, "",
        "- Requirement or intent: " + check.requirement,
        "- Current statement: " + check.statement, "- Rationale: " + check.rationale,
        "- Missing evidence / next confirmation: " + check.missing_evidence);
      if (!check.evidence_log.length) lines.push("- Evidence log: no observations recorded.");
      for (const entry of check.evidence_log) {
        lines.push(`- Evidence ${entry.id}; UTC: ${entry.observed_at}; Scope: ${entry.scope_alias}; `
          + `Source: ${entry.source_kind}; Description: ${entry.source_description}`,
        "- Observed: " + entry.observed, "- Limitation: " + entry.limitation);
        if (Object.hasOwn(entry, "material_alias") || Object.hasOwn(entry, "read_boundary")) {
          lines.push(`- Evidence material: ${known(get(entry, "material_alias"))}; `
            + `Read boundary: ${known(get(entry, "read_boundary"))}`);
        }
      }
      lines.push("");
    }
  }
  const markdown = lines.join("\n");
  requireThat(Buffer.byteLength(markdown, "utf8") <= MAX_BYTES, "Markdown exceeds 2 MB.");
  return markdown;
}

// ---- JSON input -------------------------------------------------------------------

function setKey(object, key, value) {
  Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
}

const NUMBER_RE = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;

/**
 * json.loads with Python's grammar and object_pairs_hook/parse_constant hooks:
 * duplicate keys and NaN/Infinity raise ModelError when reached; anything else
 * invalid raises JsonSyntaxError. Iterative, so nesting depth is not bounded by the stack.
 */
function parsePythonJson(text) {
  let index = 0;
  const skip = () => {
    while (index < text.length) {
      const character = text[index];
      if (character !== " " && character !== "\t" && character !== "\n" && character !== "\r") break;
      index += 1;
    }
  };
  const fail = () => {
    throw new JsonSyntaxError();
  };
  const parseString = () => {
    index += 1; // opening quote
    let result = "";
    let chunkStart = index;
    while (true) {
      if (index >= text.length) fail();
      const code = text.charCodeAt(index);
      if (code === 0x22) {
        result += text.slice(chunkStart, index);
        index += 1;
        return result;
      }
      if (code < 0x20) fail();
      if (code !== 0x5c) {
        index += 1;
        continue;
      }
      result += text.slice(chunkStart, index);
      const escape = text[index + 1];
      const simple = { "\"": "\"", "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      if (escape !== undefined && Object.hasOwn(simple, escape)) {
        result += simple[escape];
        index += 2;
      } else if (escape === "u") {
        const hex = text.slice(index + 2, index + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
        result += String.fromCharCode(parseInt(hex, 16));
        index += 6;
      } else fail();
      chunkStart = index;
    }
  };
  const constant = () => {
    throw new ModelError("Non-finite JSON numbers are invalid.");
  };
  const parseScalar = () => {
    const character = text[index];
    if (character === "\"") return parseString();
    if (text.startsWith("null", index)) {
      index += 4;
      return null;
    }
    if (text.startsWith("true", index)) {
      index += 4;
      return true;
    }
    if (text.startsWith("false", index)) {
      index += 5;
      return false;
    }
    if (text.startsWith("NaN", index) || text.startsWith("Infinity", index) || text.startsWith("-Infinity", index)) constant();
    NUMBER_RE.lastIndex = index;
    const match = NUMBER_RE.exec(text);
    if (!match) fail();
    index = NUMBER_RE.lastIndex;
    if (match[1] !== undefined || match[2] !== undefined) return new Number(Number(match[0])); // eslint-disable-line no-new-wrappers
    const digits = match[0].replace("-", "");
    if (digits.length > INT_MAX_STR_DIGITS) fail();
    const number = Number(match[0]);
    if (Number.isSafeInteger(number)) return Object.is(number, -0) ? 0 : number;
    return BigInt(match[0]);
  };
  const finishObject = (pairs) => {
    const object = {};
    const keys = new Set();
    for (const [key, value] of pairs) {
      requireThat(!keys.has(key), "Duplicate JSON object key.");
      keys.add(key);
      setKey(object, key, value);
    }
    return object;
  };
  if (text.charCodeAt(0) === 0xfeff) fail();
  skip();
  const stack = [];
  let value;
  let haveValue = false;
  while (true) {
    if (!haveValue) {
      if (index >= text.length) fail();
      const character = text[index];
      if (character === "[") {
        index += 1;
        skip();
        if (text[index] === "]") {
          index += 1;
          value = [];
          haveValue = true;
        } else stack.push({ array: [] });
        continue;
      }
      if (character === "{") {
        index += 1;
        skip();
        if (text[index] === "}") {
          index += 1;
          value = finishObject([]);
          haveValue = true;
          continue;
        }
        if (text[index] !== "\"") fail();
        const key = parseString();
        skip();
        if (text[index] !== ":") fail();
        index += 1;
        skip();
        stack.push({ pairs: [], key });
        continue;
      }
      value = parseScalar();
      haveValue = true;
      continue;
    }
    if (!stack.length) break;
    const frame = stack[stack.length - 1];
    skip();
    if (frame.array) {
      frame.array.push(value);
      if (text[index] === ",") {
        index += 1;
        skip();
        haveValue = false;
        continue;
      }
      if (text[index] !== "]") fail();
      index += 1;
      stack.pop();
      value = frame.array;
      continue;
    }
    frame.pairs.push([frame.key, value]);
    if (text[index] === ",") {
      index += 1;
      skip();
      if (text[index] !== "\"") fail();
      frame.key = parseString();
      skip();
      if (text[index] !== ":") fail();
      index += 1;
      skip();
      haveValue = false;
      continue;
    }
    if (text[index] !== "}") fail();
    index += 1;
    stack.pop();
    value = finishObject(frame.pairs);
  }
  skip();
  if (index !== text.length) fail();
  return value;
}

/** Bound reads before parsing; reject duplicate keys and nonstandard numbers. */
export function loadJson(file) {
  const descriptor = fs.openSync(file, "r");
  let data;
  try {
    const chunks = [];
    let total = 0;
    while (total < MAX_BYTES + 1) {
      const chunk = Buffer.alloc(Math.min(65536, MAX_BYTES + 1 - total));
      const count = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (count === 0) break;
      chunks.push(chunk.subarray(0, count));
      total += count;
    }
    data = Buffer.concat(chunks, total);
  } finally {
    fs.closeSync(descriptor);
  }
  requireThat(data.length <= MAX_BYTES, "JSON exceeds 2 MB.");
  try {
    return parsePythonJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data));
  } catch (error) {
    if (error instanceof ModelError) throw error; // Keep the specific duplicate-key / non-finite diagnostics.
    throw new ModelError("Invalid JSON input.");
  }
}

// ---- CLI ----------------------------------------------------------------------------

export const UNCHANGED = "Inputs and existing files were not modified.";
const PROG = "manage-report.mjs";
const DESCRIPTION = `Optional, offline versioned report model. Metadata must be pre-sanitised.
Node standard library only; no collection, secret scanning, network or remediation.
Readable Markdown remains the mandatory, portable deliverable.`;
const COMMANDS = ["init", "validate", "append", "build", "export-summary"];
const HELP = {
  "": `usage: ${PROG} [-h] {init,validate,append,build,export-summary} ...

${DESCRIPTION}

positional arguments:
  {init,validate,append,build,export-summary}
    init                Create an unreviewed version-1 draft

options:
  -h, --help            show this help message and exit
`,
  init: `usage: ${PROG} init [-h] --scope-alias SCOPE_ALIAS --title TITLE
                              [--time-zone TIME_ZONE] -o OUTPUT

options:
  -h, --help            show this help message and exit
  --scope-alias SCOPE_ALIAS
  --title TITLE
  --time-zone TIME_ZONE
                        Reader's IANA time zone agreed at scope, e.g.
                        Europe/London
  -o, --output OUTPUT
`,
  validate: `usage: ${PROG} validate [-h] source

positional arguments:
  source      Pre-sanitised report JSON

options:
  -h, --help  show this help message and exit
`,
  append: `usage: ${PROG} append [-h] -o OUTPUT --patch PATCH source

positional arguments:
  source               Pre-sanitised report JSON

options:
  -h, --help           show this help message and exit
  -o, --output OUTPUT  Fresh private output file; existing paths are refused
  --patch PATCH        Metadata patch with expected_revision and new checks,
                       coverage or Owner records
`,
  build: `usage: ${PROG} build [-h] -o OUTPUT [--format {markdown,html}]
                               [--lang LANG]
                               source

positional arguments:
  source                Pre-sanitised report JSON

options:
  -h, --help            show this help message and exit
  -o, --output OUTPUT   Fresh private output file; existing paths are refused
  --format {markdown,html}
  --lang LANG           HTML language tag; shell labels remain English
`,
  "export-summary": `usage: ${PROG} export-summary [-h] -o OUTPUT source

positional arguments:
  source               Pre-sanitised report JSON

options:
  -h, --help           show this help message and exit
  -o, --output OUTPUT  Fresh private output file; existing paths are refused
`,
};

class UsageError extends Error {}
class HelpRequested extends Error {
  constructor(command) {
    super("help");
    this.command = command;
  }
}

function parserSpec(command) {
  const options = [{ strings: ["-h", "--help"], dest: "help", nargs: 0 }];
  const positionals = [];
  if (command === "") {
    positionals.push({ dest: "command", parser: true });
  } else if (command === "init") {
    options.push({ strings: ["--scope-alias"], dest: "scope_alias", required: true },
      { strings: ["--title"], dest: "title", required: true },
      { strings: ["--time-zone"], dest: "time_zone" },
      { strings: ["-o", "--output"], dest: "output", required: true });
  } else {
    positionals.push({ dest: "source" });
    if (command !== "validate") options.push({ strings: ["-o", "--output"], dest: "output", required: true });
    if (command === "append") options.push({ strings: ["--patch"], dest: "patch", required: true });
    if (command === "build") {
      options.push({ strings: ["--format"], dest: "format", choices: ["markdown", "html"], default: "markdown" },
        { strings: ["--lang"], dest: "lang", default: "en" });
    }
  }
  const byString = new Map();
  for (const option of options) for (const string of option.strings) byString.set(string, option);
  return { command, options, positionals, byString };
}

/** argparse's _parse_optional: null (positional) or a list of [option, string, sep, explicit]. */
function classify(spec, arg) {
  if (!arg || arg[0] !== "-") return null;
  if (spec.byString.has(arg)) return [[spec.byString.get(arg), arg, null, null]];
  if (arg.length === 1) return null;
  const equals = arg.indexOf("=");
  if (equals >= 0 && spec.byString.has(arg.slice(0, equals))) {
    return [[spec.byString.get(arg.slice(0, equals)), arg.slice(0, equals), "=", arg.slice(equals + 1)]];
  }
  const tuples = [];
  const prefix = equals >= 0 ? arg.slice(0, equals) : arg;
  const sep = equals >= 0 ? "=" : null;
  const explicit = equals >= 0 ? arg.slice(equals + 1) : null;
  if (arg[1] === "-") {
    for (const [string, option] of spec.byString) if (string.startsWith(prefix)) tuples.push([option, string, sep, explicit]);
  } else {
    const short = arg.slice(0, 2);
    for (const [string, option] of spec.byString) {
      if (string === short) tuples.push([option, string, "", arg.slice(2)]);
      else if (string.startsWith(prefix)) tuples.push([option, string, sep, explicit]);
    }
  }
  if (tuples.length) return tuples;
  if (/^-\.?[0-9]/.test(arg)) return null;
  if (arg.includes(" ")) return null;
  return [[null, arg, null, null]];
}

/** argparse's parse_known_args for one parser; returns [namespace, extras]. */
function parseKnown(spec, args) {
  const pattern = [];
  const optionAt = new Map();
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--") {
      pattern.push("-");
      for (index += 1; index < args.length; index += 1) pattern.push("A");
      break;
    }
    const tuples = classify(spec, args[index]);
    if (tuples === null) pattern.push("A");
    else {
      optionAt.set(index, tuples);
      pattern.push("O");
    }
  }
  const namespace = {};
  const seen = new Set();
  const extras = [];
  const positionals = [...spec.positionals];
  let subExtras = [];
  const takeValue = (option, values) => {
    seen.add(option);
    if (option.dest === "help") throw new HelpRequested(spec.command);
    const value = values[0];
    if (option.choices && !option.choices.includes(value)) throw new UsageError("invalid choice");
    namespace[option.dest] = value;
  };
  const consumePositionals = (start) => {
    if (!positionals.length) return start;
    const rest = pattern.slice(start).join("");
    const positional = positionals[0];
    const match = (positional.parser ? /^-*A[-AO]*/ : /^-*A-*/).exec(rest);
    if (!match) return start;
    let values = args.slice(start, start + match[0].length);
    const dash = rest.slice(0, match[0].length).indexOf("-");
    if (positional.parser) {
      if (rest[0] === "-") values = values.slice(1);
    } else if (dash >= 0) values.splice(values.indexOf("--"), 1);
    positionals.shift();
    seen.add(positional);
    if (positional.parser) {
      const [command, ...remainder] = values;
      if (!COMMANDS.includes(command)) throw new UsageError("invalid choice");
      namespace.command = command;
      const [subNamespace, subRemaining] = parseKnown(parserSpec(command), remainder);
      Object.assign(namespace, subNamespace);
      subExtras = subRemaining;
    } else {
      namespace[positional.dest] = values[0];
    }
    return start + match[0].length;
  };
  const consumeOptional = (start) => {
    const tuples = optionAt.get(start);
    if (tuples.length > 1) throw new UsageError("ambiguous option");
    let [option, string, sep, explicit] = tuples[0];
    const actions = [];
    let stop;
    while (true) {
      if (option === null) {
        extras.push(args[start]);
        return start + 1;
      }
      if (explicit !== null) {
        const count = option.nargs === 0 ? 0 : 1;
        if (count === 0 && string[1] !== "-" && explicit !== "") {
          if (sep || explicit[0] === "-") throw new UsageError("ignored explicit argument");
          actions.push([option, []]);
          const next = "-" + explicit[0];
          if (spec.byString.has(next)) {
            option = spec.byString.get(next);
            string = next;
            explicit = explicit.slice(1);
            if (!explicit) sep = explicit = null;
            else if (explicit[0] === "=") {
              sep = "=";
              explicit = explicit.slice(1);
            } else sep = "";
          } else {
            extras.push("-" + explicit);
            stop = start + 1;
            break;
          }
        } else if (count === 1) {
          stop = start + 1;
          actions.push([option, [explicit]]);
          break;
        } else {
          throw new UsageError("ignored explicit argument");
        }
      } else {
        const count = option.nargs === 0 ? 0 : (pattern[start + 1] === "A" ? 1 : -1);
        if (count < 0) throw new UsageError("expected one argument");
        stop = start + 1 + count;
        actions.push([option, args.slice(start + 1, stop)]);
        break;
      }
    }
    for (const [action, values] of actions) takeValue(action, values);
    return stop;
  };
  let start = 0;
  const maxOption = optionAt.size ? Math.max(...optionAt.keys()) : -1;
  while (start <= maxOption) {
    let next = start;
    while (next <= maxOption && !optionAt.has(next)) next += 1;
    if (start !== next) {
      const end = consumePositionals(start);
      if (end > start) {
        start = end;
        continue;
      }
      start = end;
    }
    if (!optionAt.has(start)) {
      extras.push(...args.slice(start, next));
      start = next;
    }
    start = consumeOptional(start);
  }
  const stop = consumePositionals(start);
  extras.push(...args.slice(stop));
  const missing = [...spec.options, ...spec.positionals].filter((item) => (item.required || !item.strings) && !seen.has(item));
  if (missing.length) throw new UsageError("the following arguments are required");
  for (const option of spec.options) {
    if (!Object.hasOwn(namespace, option.dest) && option.dest !== "help") namespace[option.dest] = option.default ?? null;
  }
  return [namespace, [...extras, ...subExtras]];
}

function parseArguments(argv) {
  const [namespace, extras] = parseKnown(parserSpec(""), argv);
  if (extras.length) throw new UsageError("unrecognized arguments");
  return namespace;
}

/** Run the CLI; returns the process exit code. */
export function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArguments(argv);
  } catch (error) {
    if (error instanceof HelpRequested) {
      process.stdout.write(HELP[error.command]);
      return 0;
    }
    process.stderr.write("Invalid report command. Use --help for usage.\n");
    return 2;
  }
  let role = "source file";
  try {
    let data;
    if (args.command === "init") {
      data = jsonBytes(newReport(args.scope_alias, args.title, args.time_zone));
    } else {
      const report = loadJson(pyPath(args.source));
      validateReport(report);
      if (args.command === "validate") {
        process.stdout.write("Report model is valid. Evidence truth and sanitisation still require human review.\n");
        return 0;
      }
      if (args.command === "append") {
        role = "patch file";
        data = jsonBytes(appendEvidence(report, loadJson(pyPath(args.patch))));
      } else if (args.command === "export-summary") {
        data = jsonBytes(buildSummary(report));
      } else {
        const markdown = buildMarkdown(report);
        role = "bundled assets";
        data = Buffer.from(args.format === "html" ? renderReport(markdown, args.lang) : markdown, "utf8");
      }
    }
    role = "output path";
    publishNew(pyPath(args.output), data);
  } catch (error) {
    if (error instanceof ReportError) {
      process.stderr.write(`Could not manage report: ${error.message} ${UNCHANGED}\n`);
    } else if (isOsError(error)) {
      process.stderr.write(`Could not manage report: ${describeOsError(role, error)} `
        + `Output paths must be new. ${UNCHANGED}\n`);
    } else {
      process.stderr.write("Could not manage report. Check the pre-sanitised schema, revision, bundled assets "
        + `and fresh output path. ${UNCHANGED}\n`);
    }
    return 1;
  }
  process.stdout.write("New private report artifact created. Review before sharing; Markdown remains required.\n");
  return 0;
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) process.exitCode = main();

void fileURLToPath;
