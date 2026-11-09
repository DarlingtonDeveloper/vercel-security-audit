#!/usr/bin/env node
/**
 * Read-only structural QA for bundled-renderer HTML. Node standard library only; never opens a browser.
 *
 * Port of check_report.py. The Document tokenizer reproduces the parts of Python's
 * html.parser.HTMLParser (convert_charrefs=True) that the checker relies on, and JSON
 * inputs are parsed with Python json.loads semantics (int versus float, NaN/Infinity,
 * duplicate-key hook), so the same inputs pass or fail with the same messages.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  OWNER_ACCEPTED_MARKER, PY_WS, ReportError, describeOsError, isOsError, pyStrip, safeLink,
} from "./render-report.mjs";

export { ReportError };

const SCRIPT_FILE = fileURLToPath(import.meta.url);

/** The skill directory, resolved through symlinks as Path(__file__).resolve().parents[1]. */
export function skillDir() {
  let file = SCRIPT_FILE;
  try {
    file = fs.realpathSync(SCRIPT_FILE);
  } catch {
    // Fall back to the unresolved module path.
  }
  return path.dirname(path.dirname(file));
}

export const MAX_BYTES = 8_000_000;
export const LABELS = Object.freeze({
  "Satisfactory": "satisfactory",
  "Action recommended": "action_recommended",
  "Needs confirmation": "needs_confirmation",
  "Not reviewed": "not_reviewed",
  "Not applicable": "not_applicable",
});
const LABEL_MAP = new Map(Object.entries(LABELS));
// Least to most favourable; report-template.md defines the same order. Matrix
// rows with several status cells summarise to their least favourable status.
export const STATUS_ORDER = Object.freeze(["action_recommended", "needs_confirmation", "not_reviewed", "satisfactory", "not_applicable"]);
export const MATRIX_MARKERS = Object.freeze(["Team-wide", "By project"]);
// Python's \b and \d are Unicode-aware in str patterns.
const WORD = "[\\p{L}\\p{N}_]";
export const CHECK_ID = new RegExp(`(?<!${WORD})[A-Z]{3}-\\p{Nd}{2}(?!${WORD})`, "gu");
const WS_RUN = new RegExp(`[${PY_WS}]+`);
const HEADING_ID = new RegExp(`^([A-Z]{3}-\\p{Nd}{2})[${PY_WS}]+-[${PY_WS}]+[^${PY_WS}]`, "u");
const CHECKLIST_ID = /(?:^|(?<=\n))### ([A-Z]{3}-\p{Nd}{2})/gu;

/** Python str.split() with no arguments. */
function pySplit(text) {
  return text.split(WS_RUN).filter(Boolean);
}

/** A Python ValueError raised by the runtime (not an authored failure), e.g. int digit limits. */
class PyValueError extends Error {}
/** Python RecursionError. */
class PyRecursionError extends Error {}
/** Python json.JSONDecodeError. */
class PyJSONDecodeError extends Error {}
/** Python UnicodeDecodeError. */
class PyUnicodeError extends Error {}

/** A JSON float, kept distinct from JSON integers (which parse as BigInt), as Python does. */
export class PyFloat {
  constructor(value) {
    this.value = value;
  }
}

export function checklistGroups() {
  const checklist = fs.readFileSync(path.join(skillDir(), "references", "checklist.md"), "utf8");
  const at = checklist.indexOf("## Optional deeper");
  if (at < 0) throw new PyValueError("not enough values to unpack");
  const parts = [["core", checklist.slice(0, at)], ["optional", checklist.slice(at + "## Optional deeper".length)]];
  const groups = {};
  for (const [name, text] of parts) {
    groups[name] = new Set(Array.from(text.matchAll(CHECKLIST_ID), (match) => match[1]));
  }
  if (groups.core.size !== 24 || groups.optional.size !== 4 || [...groups.core].some((id) => groups.optional.has(id))) {
    throw new ReportError("Bundled checklist IDs are invalid.");
  }
  return groups;
}

/**
 * A literal rule message naming one bundled checklist ID, and optionally status keys.
 *
 * Only values from the bundled checklist and the five status keys are added,
 * so report text can never reach the message; anything else is dropped.
 */
export class CheckError extends ReportError {
  constructor(message, checkId, matrix = null, appendix = null) {
    const groups = checklistGroups();
    const known = new Set([...groups.core, ...groups.optional]);
    const details = [];
    if (known.has(checkId)) details.push("check ID " + checkId);
    for (const [role, status] of [["matrix", matrix], ["appendix", appendix]]) {
      if (STATUS_ORDER.includes(status)) details.push(role + " " + status);
    }
    super(message + (details.length ? " (" + details.join("; ") + ")." : ""));
    this.name = "CheckError";
  }
}

export class Node {
  constructor(tag, attrs = []) {
    this.tag = tag;
    this.attrs = new Map(attrs);
    this.children = [];
    this.names = attrs.map(([name]) => name);
  }

  get text() {
    return this.children.map((child) => (typeof child === "string" ? child : child.text)).join("");
  }

  /** Attribute value like dict.get(name, fallback). */
  attr(name, fallback = undefined) {
    return this.attrs.has(name) ? this.attrs.get(name) : fallback;
  }

  classes() {
    return pySplit(this.attr("class", ""));
  }

  find(tag = null, cls = null) {
    const result = [];
    for (const child of this.children) {
      if (child instanceof Node) {
        if ((tag === null || child.tag === tag) && (cls === null || child.classes().includes(cls))) {
          result.push(child);
        }
        result.push(...child.find(tag, cls));
      }
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// html.unescape and html.parser equivalents (Python 3.14 html package).

let ENTITIES = null;
function entities() {
  if (ENTITIES === null) {
    ENTITIES = new Map();
    for (const item of ENTITY_DATA.split(" ")) {
      if (!item) continue;
      const at = item.indexOf("=");
      ENTITIES.set(item.slice(0, at), String.fromCodePoint(...item.slice(at + 1).split(".").map((hex) => parseInt(hex, 16))));
    }
  }
  return ENTITIES;
}

const INVALID_CHARREFS = new Map([
  [0x00, "\ufffd"], [0x0d, "\r"], [0x80, "\u20ac"], [0x81, "\x81"], [0x82, "\u201a"], [0x83, "\u0192"],
  [0x84, "\u201e"], [0x85, "\u2026"], [0x86, "\u2020"], [0x87, "\u2021"], [0x88, "\u02c6"], [0x89, "\u2030"],
  [0x8a, "\u0160"], [0x8b, "\u2039"], [0x8c, "\u0152"], [0x8d, "\x8d"], [0x8e, "\u017d"], [0x8f, "\x8f"],
  [0x90, "\x90"], [0x91, "\u2018"], [0x92, "\u2019"], [0x93, "\u201c"], [0x94, "\u201d"], [0x95, "\u2022"],
  [0x96, "\u2013"], [0x97, "\u2014"], [0x98, "\u02dc"], [0x99, "\u2122"], [0x9a, "\u0161"], [0x9b, "\u203a"],
  [0x9c, "\u0153"], [0x9d, "\x9d"], [0x9e, "\u017e"], [0x9f, "\u0178"],
]);

function invalidCodepoint(num) {
  return (num >= 0x1 && num <= 0x8) || (num >= 0xe && num <= 0x1f) || (num >= 0x7f && num <= 0x9f)
    || (num >= 0xfdd0 && num <= 0xfdef) || num === 0xb || (num & 0xfffe) === 0xfffe;
}

// Python's default sys.get_int_max_str_digits() for decimal int() conversion.
const INT_MAX_STR_DIGITS = 4300;

function replaceCharref(_match, s) {
  if (s[0] === "#") {
    let num;
    if (s[1] === "x" || s[1] === "X") {
      num = parseInt(s.slice(2).replace(/;+$/, ""), 16);
    } else {
      const digits = s.slice(1).replace(/;+$/, "");
      if (digits.length > INT_MAX_STR_DIGITS) throw new PyValueError("Exceeds the limit for integer string conversion");
      num = Number(digits);
    }
    if (INVALID_CHARREFS.has(num)) return INVALID_CHARREFS.get(num);
    if ((num >= 0xd800 && num <= 0xdfff) || num > 0x10ffff) return "\ufffd";
    if (invalidCodepoint(num)) return "";
    return String.fromCodePoint(num);
  }
  const table = entities();
  if (table.has(s)) return table.get(s);
  // Find the longest matching name, as defined by the standard.
  const points = Array.from(s);
  for (let x = points.length - 1; x > 1; x -= 1) {
    const prefix = points.slice(0, x).join("");
    if (table.has(prefix)) return table.get(prefix) + points.slice(x).join("");
  }
  return "&" + s;
}

const CHARREF = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/gu;

/** Python html.unescape. */
export function unescape(s) {
  if (!s.includes("&")) return s;
  return s.replace(CHARREF, replaceCharref);
}

const ATTR_CHARREF = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*)[;=]?/g;

function unescapeAttrValue(s) {
  return s.replace(ATTR_CHARREF, (ref) => {
    // Numeric / hex char refs must always be unescaped.
    if (ref.startsWith("&#")) return unescape(ref);
    // Named references only when an exact match not followed by an equals sign.
    if (!ref.endsWith("=") && entities().has(ref.slice(1))) return unescape(ref);
    return ref;
  });
}

const STARTTAGOPEN = /<[a-zA-Z]/y;
const ENDTAGOPEN = /<\/[a-zA-Z]/y;
const COMMENTCLOSE = /--!?>/g;
const COMMENTABRUPTCLOSE = /-?>/y;
const TAGFIND = /([a-zA-Z][^\t\n\r\f />]*)(?:[\t\n\r\f ]|\/(?!>))*/y;
const ATTRFIND = new RegExp(
  "((?<=['\"\\t\\n\\r\\f /])[^\\t\\n\\r\\f />][^\\t\\n\\r\\f /=>]*)"
  + "([\\t\\n\\r\\f ]*=[\\t\\n\\r\\f ]*('[^']*'|\"[^\"]*\"|(?!['\"])[^>\\t\\n\\r\\f ]*))?"
  + "(?:[\\t\\n\\r\\f ]|/(?!>))*", "y");
const LOCATETAGEND = new RegExp(
  "[a-zA-Z][^\\t\\n\\r\\f />]*[\\t\\n\\r\\f /]*"
  + "(?:(?<=['\"\\t\\n\\r\\f /])[^\\t\\n\\r\\f />][^\\t\\n\\r\\f /=>]*"
  + "(?:[\\t\\n\\r\\f ]*=[\\t\\n\\r\\f ]*(?:'[^']*'|\"[^\"]*\"|(?!['\"])[^>\\t\\n\\r\\f ]*))?"
  + "[\\t\\n\\r\\f /]*)*>?", "y");
const CDATA_CONTENT_ELEMENTS = ["script", "style", "xmp", "iframe", "noembed", "noframes"];
const RCDATA_CONTENT_ELEMENTS = ["textarea", "title"];

function matchAt(regex, text, index) {
  regex.lastIndex = index;
  return regex.exec(text);
}

/**
 * Python html.parser.HTMLParser(convert_charrefs=True), fed the whole text and closed.
 * Subclasses override the handle_* hooks, as in Python.
 */
export class HTMLParser {
  constructor() {
    this.cdataElem = null;
    this.interesting = null;
    this.escapable = true;
  }

  setCdataMode(elem, escapable) {
    this.cdataElem = elem.toLowerCase();
    this.escapable = escapable;
    this.interesting = this.cdataElem === "plaintext"
      ? null
      : new RegExp(`</${this.cdataElem}(?=[\\t\\n\\r\\f />])`, "gi");
  }

  clearCdataMode() {
    this.cdataElem = null;
    this.interesting = null;
    this.escapable = true;
  }

  /** feed(text) followed by close(); equivalent to Python's goahead(0) then goahead(1). */
  parse(rawdata) {
    const n = rawdata.length;
    let i = 0;
    while (i < n) {
      let j;
      if (!this.cdataElem) {
        j = rawdata.indexOf("<", i);
        if (j < 0) j = n;
      } else if (this.interesting === null) {
        j = n;
      } else {
        const match = matchAt(this.interesting, rawdata, i);
        if (!match) break;
        j = match.index;
      }
      if (i < j) {
        const data = rawdata.slice(i, j);
        this.handleData(this.escapable ? unescape(data) : data);
      }
      i = j;
      if (i === n) break;
      let k;
      if (matchAt(STARTTAGOPEN, rawdata, i)) k = this.parseStarttag(rawdata, i);
      else if (rawdata.startsWith("</", i)) k = this.parseEndtag(rawdata, i);
      else if (rawdata.startsWith("<!--", i)) k = this.parseComment(rawdata, i);
      else if (rawdata.startsWith("<?", i)) k = this.parsePi(rawdata, i);
      else if (rawdata.startsWith("<!", i)) k = this.parseHtmlDeclaration(rawdata, i);
      else {
        this.handleData("<");
        k = i + 1;
      }
      if (k < 0) {
        if (matchAt(STARTTAGOPEN, rawdata, i)) {
          // Unterminated start tag at EOF: dropped, as in Python.
        } else if (rawdata.startsWith("</", i)) {
          if (i + 2 === n) this.handleData("</");
          else if (matchAt(ENDTAGOPEN, rawdata, i)) {
            // Unterminated end tag at EOF: dropped.
          } else this.handleComment(rawdata.slice(i + 2));
        } else if (rawdata.startsWith("<!--", i)) {
          let end = n;
          const rest = rawdata.slice(i + 4);
          for (const suffix of ["--!", "--", "-"]) {
            if (rest.endsWith(suffix)) {
              end -= suffix.length;
              break;
            }
          }
          this.handleComment(rawdata.slice(i + 4, end));
        } else if (rawdata.startsWith("<![CDATA[", i)) {
          this.unknownDecl(rawdata.slice(i + 3));
        } else if (rawdata.slice(i, i + 9).toLowerCase() === "<!doctype") {
          this.handleDecl(rawdata.slice(i + 2));
        } else if (rawdata.startsWith("<!", i)) {
          this.handleComment(rawdata.slice(i + 2));
        } else if (rawdata.startsWith("<?", i)) {
          this.handlePi(rawdata.slice(i + 2));
        }
        k = n;
      }
      i = k;
    }
    if (i < n) {
      const data = rawdata.slice(i, n);
      this.handleData(this.escapable ? unescape(data) : data);
    }
  }

  parseHtmlDeclaration(rawdata, i) {
    if (rawdata.startsWith("<!--", i)) return this.parseComment(rawdata, i);
    if (rawdata.startsWith("<![CDATA[", i)) {
      const j = rawdata.indexOf("]]>", i + 9);
      if (j < 0) return -1;
      this.unknownDecl(rawdata.slice(i + 3, j));
      return j + 3;
    }
    if (rawdata.slice(i, i + 9).toLowerCase() === "<!doctype") {
      const gtpos = rawdata.indexOf(">", i + 9);
      if (gtpos === -1) return -1;
      this.handleDecl(rawdata.slice(i + 2, gtpos));
      return gtpos + 1;
    }
    return this.parseBogusComment(rawdata, i);
  }

  parseComment(rawdata, i) {
    let match = matchAt(COMMENTCLOSE, rawdata, i + 4);
    if (!match) {
      match = matchAt(COMMENTABRUPTCLOSE, rawdata, i + 4);
      if (!match) return -1;
    }
    this.handleComment(rawdata.slice(i + 4, match.index));
    return match.index + match[0].length;
  }

  parseBogusComment(rawdata, i) {
    const pos = rawdata.indexOf(">", i + 2);
    if (pos === -1) return -1;
    this.handleComment(rawdata.slice(i + 2, pos));
    return pos + 1;
  }

  parsePi(rawdata, i) {
    const j = rawdata.indexOf(">", i + 2);
    if (j < 0) return -1;
    this.handlePi(rawdata.slice(i + 2, j));
    return j + 1;
  }

  parseStarttag(rawdata, i) {
    matchAt(LOCATETAGEND, rawdata, i + 1);
    const endpos = LOCATETAGEND.lastIndex;
    if (rawdata[endpos - 1] !== ">") return -1;
    const attrs = [];
    const tagMatch = matchAt(TAGFIND, rawdata, i + 1);
    let k = TAGFIND.lastIndex;
    const tag = tagMatch[1].toLowerCase();
    while (k < endpos) {
      const match = matchAt(ATTRFIND, rawdata, k);
      if (!match) break;
      const [, attrname, rest] = match;
      let attrvalue = match[3];
      if (!rest) attrvalue = null;
      else if ((attrvalue.startsWith("'") && attrvalue.endsWith("'"))
               || (attrvalue.startsWith("\"") && attrvalue.endsWith("\""))) {
        attrvalue = attrvalue.slice(1, -1);
      }
      if (attrvalue) attrvalue = unescapeAttrValue(attrvalue);
      attrs.push([attrname.toLowerCase(), attrvalue]);
      k = ATTRFIND.lastIndex;
    }
    const end = pyStrip(rawdata.slice(k, endpos));
    if (end !== ">" && end !== "/>") {
      this.handleData(rawdata.slice(i, endpos));
      return endpos;
    }
    if (end.endsWith("/>")) {
      this.handleStartendtag(tag, attrs);
    } else {
      this.handleStarttag(tag, attrs);
      if (CDATA_CONTENT_ELEMENTS.includes(tag) || tag === "plaintext") this.setCdataMode(tag, false);
      else if (RCDATA_CONTENT_ELEMENTS.includes(tag)) this.setCdataMode(tag, true);
    }
    return endpos;
  }

  parseEndtag(rawdata, i) {
    if (rawdata.indexOf(">", i + 2) < 0) return -1;
    if (!matchAt(ENDTAGOPEN, rawdata, i)) {
      if (rawdata[i + 2] === ">") return i + 3; // "</>" is ignored.
      return this.parseBogusComment(rawdata, i);
    }
    matchAt(LOCATETAGEND, rawdata, i + 2);
    const j = LOCATETAGEND.lastIndex;
    if (rawdata[j - 1] !== ">") return -1;
    const tag = matchAt(TAGFIND, rawdata, i + 2)[1].toLowerCase();
    this.handleEndtag(tag);
    this.clearCdataMode();
    return j;
  }

  handleStartendtag(tag, attrs) {
    this.handleStarttag(tag, attrs);
    this.handleEndtag(tag);
  }

  handleStarttag() {}
  handleEndtag() {}
  handleData() {}
  handleComment() {}
  handleDecl() {}
  handlePi() {}
  unknownDecl() {}
}

export class Document extends HTMLParser {
  static VOID = new Set(["meta", "hr", "br"]);

  constructor(text) {
    super();
    this.root = new Node("document");
    this.stack = [this.root];
    this.declarations = [];
    this.parse(text);
    if (this.stack.length !== 1 || this.declarations.length !== 1 || this.declarations[0] !== "doctype html") {
      throw new ReportError("Expected balanced HTML with one HTML doctype.");
    }
  }

  handleDecl(value) {
    this.declarations.push(value.toLowerCase());
  }

  handleStarttag(tag, attrs) {
    const node = new Node(tag, attrs);
    if (node.names.length !== new Set(node.names).size) {
      throw new ReportError("Duplicate HTML attribute.");
    }
    this.stack[this.stack.length - 1].children.push(node);
    if (!Document.VOID.has(tag)) this.stack.push(node);
    if (this.stack.length > 64) {
      throw new ReportError("HTML nesting exceeds checker limit.");
    }
  }

  handleStartendtag(tag, attrs) {
    this.handleStarttag(tag, attrs);
    if (!Document.VOID.has(tag)) this.handleEndtag(tag);
  }

  handleEndtag(tag) {
    if (this.stack.length === 1 || this.stack[this.stack.length - 1].tag !== tag) {
      throw new ReportError("Unbalanced HTML.");
    }
    this.stack.pop();
  }

  handleData(value) {
    this.stack[this.stack.length - 1].children.push(value);
  }

  handleComment() {
    throw new ReportError("Comments are outside the generated HTML dialect.");
  }

  handlePi() {
    throw new ReportError("Processing instructions are not supported.");
  }

  unknownDecl() {
    throw new ReportError("Unsupported declaration.");
  }
}

// ---------------------------------------------------------------------------
// Inputs.

function readBytes(file, limit) {
  const descriptor = fs.openSync(file, "r");
  try {
    const chunks = [];
    let total = 0;
    while (total < limit) {
      const chunk = Buffer.alloc(Math.min(1 << 20, limit - total));
      const count = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (count === 0) break;
      chunks.push(chunk.subarray(0, count));
      total += count;
    }
    return Buffer.concat(chunks, total);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function readText(file) {
  const data = readBytes(file, MAX_BYTES + 1);
  if (data.length > MAX_BYTES || data.includes(0)) {
    throw new ReportError("Input is invalid or exceeds 8 MB.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
  } catch {
    throw new PyUnicodeError("invalid UTF-8");
  }
}

// Depth at which CPython 3.14's json C scanner raised RecursionError on the
// reference machine (it depends on the C stack, so this is an approximation).
const JSON_MAX_DEPTH = 116218;
const JSON_WS = /[ \t\n\r]*/y;
const JSON_NUMBER = /(-?(?:0|[1-9][0-9]*))(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;
const JSON_STRING_CHUNK = /[^"\\\x00-\x1f]*/y;
const JSON_ESCAPES = { "\"": "\"", "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/**
 * Python json.loads with an object_pairs_hook that rejects duplicate keys.
 * Objects become Maps, integers BigInt, floats PyFloat; iterative, so deep input cannot overflow the JS stack.
 */
export function parsePythonJson(text) {
  const fail = () => {
    throw new PyJSONDecodeError("invalid JSON");
  };
  const skip = (index) => {
    JSON_WS.lastIndex = index;
    JSON_WS.exec(text);
    return JSON_WS.lastIndex;
  };
  const parseString = (index) => {
    // index points just after the opening quote.
    let result = "";
    for (;;) {
      JSON_STRING_CHUNK.lastIndex = index;
      JSON_STRING_CHUNK.exec(text);
      result += text.slice(index, JSON_STRING_CHUNK.lastIndex);
      index = JSON_STRING_CHUNK.lastIndex;
      const char = text[index];
      if (char === "\"") return [result, index + 1];
      if (char !== "\\") fail(); // End of input or an unescaped control character.
      const escape = text[index + 1];
      if (escape === "u") {
        const hex = text.slice(index + 2, index + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
        let code = parseInt(hex, 16);
        index += 6;
        if (code >= 0xd800 && code <= 0xdbff && text.startsWith("\\u", index)) {
          const low = text.slice(index + 2, index + 6);
          if (/^[0-9a-fA-F]{4}$/.test(low)) {
            const lowCode = parseInt(low, 16);
            if (lowCode >= 0xdc00 && lowCode <= 0xdfff) {
              code = 0x10000 + ((code - 0xd800) << 10) + (lowCode - 0xdc00);
              index += 6;
            }
          }
        }
        result += String.fromCodePoint(code);
      } else if (escape !== undefined && Object.hasOwn(JSON_ESCAPES, escape)) {
        result += JSON_ESCAPES[escape];
        index += 2;
      } else {
        fail();
      }
    }
  };
  // Parses one scalar or opens a container; returns [value, nextIndex, container|null].
  const parseValue = (index) => {
    const char = text[index];
    if (char === "\"") return [...parseString(index + 1), null];
    if (char === "{" || char === "[") return [null, index + 1, char];
    if (char === "n" && text.startsWith("null", index)) return [null, index + 4, null];
    if (char === "t" && text.startsWith("true", index)) return [true, index + 4, null];
    if (char === "f" && text.startsWith("false", index)) return [false, index + 5, null];
    if (char === "N" && text.startsWith("NaN", index)) return [new PyFloat(NaN), index + 3, null];
    if (char === "I" && text.startsWith("Infinity", index)) return [new PyFloat(Infinity), index + 8, null];
    JSON_NUMBER.lastIndex = index;
    const match = JSON_NUMBER.exec(text);
    if (match) {
      const end = JSON_NUMBER.lastIndex;
      if (match[2] !== undefined || match[3] !== undefined) return [new PyFloat(Number(match[0])), end, null];
      const digits = match[1].replace(/^-/, "");
      if (digits.length > INT_MAX_STR_DIGITS) throw new PyValueError("Exceeds the limit for integer string conversion");
      return [BigInt(match[1]), end, null];
    }
    if (char === "-" && text.startsWith("-Infinity", index)) return [new PyFloat(-Infinity), index + 9, null];
    return fail();
  };

  const stack = [];
  let index = skip(0);
  let value;
  // State machine: after a value completes, attach it to the parent and continue.
  for (;;) {
    let next, container;
    const top = stack[stack.length - 1];
    if (top && top.kind === "{" && top.key === null) {
      // Expecting a key (or "}" on an empty object).
      if (text[index] === "}" && top.pairs.length === 0 && !top.afterComma) {
        stack.pop();
        value = closeObject(top.pairs);
        index += 1;
      } else {
        if (text[index] !== "\"") fail();
        [top.key, index] = parseString(index + 1);
        index = skip(index);
        if (text[index] !== ":") fail();
        index = skip(index + 1);
        continue;
      }
    } else if (top && top.kind === "[" && top.items.length === 0 && !top.afterComma && text[index] === "]") {
      stack.pop();
      value = top.items;
      index += 1;
    } else {
      [value, next, container] = parseValue(index);
      index = next;
      if (container) {
        if (stack.length + 1 > JSON_MAX_DEPTH) throw new PyRecursionError("maximum recursion depth exceeded");
        stack.push(container === "{" ? { kind: "{", pairs: [], key: null, afterComma: false }
          : { kind: "[", items: [], afterComma: false });
        index = skip(index);
        continue;
      }
    }
    // A value is complete; attach it to its parent, closing containers as needed.
    for (;;) {
      const parent = stack[stack.length - 1];
      if (!parent) {
        index = skip(index);
        if (index !== text.length) fail();
        return value;
      }
      if (parent.kind === "{") {
        parent.pairs.push([parent.key, value]);
        parent.key = null;
      } else {
        parent.items.push(value);
      }
      index = skip(index);
      const close = parent.kind === "{" ? "}" : "]";
      if (text[index] === ",") {
        parent.afterComma = true;
        index = skip(index + 1);
        break;
      }
      if (text[index] !== close) fail();
      index += 1;
      stack.pop();
      value = parent.kind === "{" ? closeObject(parent.pairs) : parent.items;
    }
  }

  function closeObject(pairs) {
    const result = new Map();
    for (const [key, item] of pairs) {
      if (result.has(key)) throw new ReportError("Duplicate JSON key.");
      result.set(key, item);
    }
    return result;
  }
}

export function readJson(file) {
  return parsePythonJson(readText(file));
}

// Python dict / list / int helpers, accepting parsed JSON (Map, BigInt) and plain JS values.
function isDict(value) {
  if (value instanceof Map) return true;
  if (value === null || typeof value !== "object" || Array.isArray(value) || value instanceof PyFloat) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function dictKeys(value) {
  return value instanceof Map ? [...value.keys()] : Object.keys(value);
}

function dictGet(value, key) {
  if (value instanceof Map) return value.has(key) ? value.get(key) : null;
  return Object.hasOwn(value, key) ? value[key] : null;
}

function dictEntries(value) {
  return value instanceof Map ? [...value.entries()] : Object.entries(value);
}

function isInt(value) {
  return typeof value === "bigint" || (typeof value === "number" && Number.isInteger(value));
}

function sameKeys(keys, expected) {
  const set = new Set(keys);
  return set.size === expected.length && expected.every((key) => set.has(key));
}

// ---------------------------------------------------------------------------
// Checks.

/** Conservative generated dialect, not a general HTML/CSS security validator. */
export function checkPassive(root) {
  const tags = new Set("html head meta title style body div header p span h1 h2 h3 h4 h5 h6 aside main ul ol li a section article blockquote pre code strong em hr br footer details summary table thead tbody tr th td".split(" "));
  const attributes = new Map([
    ["html", ["lang"]], ["meta", ["charset", "name", "content", "http-equiv"]],
    ["a", ["href", "rel"]], ["aside", ["aria-label"]], ["div", ["aria-hidden"]],
    ["li", ["value"]], ["th", ["scope"]],
  ]);
  const nodes = root.find();
  for (const node of nodes) {
    const allowed = new Set([...(attributes.get(node.tag) || []), "class", "id"]);
    if (!tags.has(node.tag) || [...node.attrs.keys()].some((name) => !allowed.has(name))) {
      throw new ReportError("HTML is outside the passive generated dialect.");
    }
    if ([...node.attrs.values()].some((value) => value === null)) {
      throw new ReportError("Unexpected valueless attribute.");
    }
    if (/logo/i.test(node.attr("class", "") + " " + node.attr("id", ""))) {
      throw new ReportError("Logo markup is not allowed in the report.");
    }
    if (node.tag === "a") {
      const rel = new Set(pySplit(node.attr("rel", "")));
      if (!safeLink(node.attr("href", null)) || rel.size !== 2 || !rel.has("noopener") || !rel.has("noreferrer")) {
        // Generated navigation anchors have no rel and remain same-document.
        if (!(/^#[a-zA-Z][a-zA-Z0-9_-]*$/.test(node.attr("href", ""))
              && [...node.attrs.keys()].every((name) => name === "href"))) {
          throw new ReportError("Unsafe or non-generated link.");
        }
      }
    }
  }
  for (const tag of ["html", "head", "body", "title", "style", "main", "header", "footer", "h1"]) {
    if (root.find(tag).length !== 1) {
      throw new ReportError("Required document landmark missing or duplicated.");
    }
  }
  const [html] = root.find("html");
  const [head] = root.find("head");
  const [body] = root.find("body");
  const [style] = root.find("style");
  const elementChildren = (node) => node.children.filter((child) => child instanceof Node);
  const rootNodes = elementChildren(root);
  const htmlNodes = elementChildren(html);
  if (rootNodes.length !== 1 || rootNodes[0] !== html
      || htmlNodes.length !== 2 || htmlNodes[0] !== head || htmlNodes[1] !== body
      || !head.children.includes(style)
      || head.find().some((n) => !["meta", "title", "style"].includes(n.tag))
      || body.find().some((n) => ["meta", "title", "style", "head", "html"].includes(n.tag))
      || body.find("main").length !== 1) {
    throw new ReportError("Unexpected document landmark nesting.");
  }
  checkTables(root);
  const identifiers = nodes.filter((n) => n.attrs.has("id")).map((n) => n.attrs.get("id"));
  if (identifiers.length !== new Set(identifiers).size) {
    throw new ReportError("Duplicate HTML ID.");
  }
  for (const link of root.find("a")) {
    const href = link.attrs.get("href");
    if (href.startsWith("#") && !identifiers.includes(href.slice(1))) {
      throw new ReportError("Unresolved local navigation.");
    }
  }
  const policies = [];
  for (const meta of root.find("meta")) {
    if (meta.attrs.has("http-equiv")) {
      if (meta.attrs.get("http-equiv").toLowerCase() !== "content-security-policy") {
        throw new ReportError("Unexpected HTTP-equivalent meta.");
      }
      policies.push(meta);
    }
  }
  if (policies.length !== 1 || !head.children.includes(policies[0])
      || head.children.indexOf(policies[0]) > head.children.indexOf(style)) {
    throw new ReportError("One CSP is required before embedded style.");
  }
  const directives = new Map();
  for (const entry of policies[0].attr("content", "").split(";")) {
    const parts = pySplit(entry);
    if (parts.length) {
      if (directives.has(parts[0])) {
        throw new ReportError("Duplicate CSP directive.");
      }
      directives.set(parts[0], parts.slice(1));
    }
  }
  const expected = new Map(["default-src", "img-src", "connect-src", "script-src", "form-action", "base-uri", "object-src"]
    .map((name) => [name, ["'none'"]]));
  expected.set("style-src", ["'unsafe-inline'"]);
  expected.set("font-src", ["data:"]);
  const sameDirectives = directives.size === expected.size && [...expected].every(([name, values]) => (
    directives.has(name) && directives.get(name).length === values.length
    && directives.get(name).every((value, index) => value === values[index])));
  if (!sameDirectives) {
    throw new ReportError("CSP differs from the bundled deny-by-default policy.");
  }
  // Exact trusted CSS matching avoids claiming a regex is a general CSS parser.
  // This also rejects escapes, imports, remote url(), and hidden logo additions.
  const skill = skillDir();
  const fonts = [];
  for (const [family, weight, filename] of [["Geist", "400", "Geist-Regular.woff2"],
    ["Geist", "600", "Geist-SemiBold.woff2"],
    ["Geist Mono", "400", "GeistMono-Regular.woff2"]]) {
    const data = fs.readFileSync(path.join(skill, "assets", "fonts", filename));
    if (data.subarray(0, 4).toString("latin1") !== "wOF2") {
      throw new ReportError("Bundled WOFF2 is invalid.");
    }
    fonts.push("@font-face{font-family:'" + family + "';font-style:normal;font-weight:" + weight
      + ";font-display:swap;src:url(data:font/woff2;base64," + data.toString("base64") + ") format('woff2');}");
  }
  const css = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(path.join(skill, "assets", "report.css")));
  const expectedStyle = fonts.join("\n") + "\n" + css;
  if (style.text !== expectedStyle) {
    throw new ReportError("Embedded styles/fonts differ from trusted bundled assets.");
  }
  const [header] = root.find("header");
  const [footer] = root.find("footer");
  for (const [node, phrases] of [
    [header, ["Read-only configuration review",
      "This review is not a security certification or a guarantee of compliance."]],
    [footer, ["Read-only configuration review", "Findings apply only to the scope and observation window",
      "this report does not certify security or compliance."]]]) {
    const text = node.text;
    if (phrases.some((phrase) => !text.includes(phrase))) {
      throw new ReportError("Required report disclosure is missing.");
    }
  }
}

/** Element children only; whitespace between generated tags is ignored. */
export function elements(node) {
  if (node.children.some((child) => typeof child === "string" && pyStrip(child))) {
    throw new ReportError("Table structure contains unexpected text outside its cells.");
  }
  return node.children.filter((child) => child instanceof Node);
}

function attrsEqual(node, expected) {
  const entries = Object.entries(expected);
  return node.attrs.size === entries.length && entries.every(([key, value]) => node.attrs.get(key) === value);
}

/** Only the renderer's pipe-table shape: wrapped, one header row, equal widths. */
export function checkTables(root) {
  const wrapped = new Set();
  const containers = [...root.find("main"), ...root.find("section"), ...root.find("article")];
  for (const wrapper of root.find("div", "table-wrap")) {
    if (!containers.some((container) => container.children.includes(wrapper))) {
      throw new ReportError("Tables must sit directly in the report body, a section or a recommendation.");
    }
    if (!attrsEqual(wrapper, { class: "table-wrap" }) || elements(wrapper).map((n) => n.tag).join(" ") !== "table") {
      throw new ReportError("Each table needs exactly one generated table-wrap container.");
    }
    const [table] = elements(wrapper);
    const groups = elements(table);
    if (table.attrs.size || groups.length !== 2 || groups[0].tag !== "thead" || groups[1].tag !== "tbody") {
      throw new ReportError("Tables need exactly one header group followed by one body group.");
    }
    const [head, body] = groups;
    const headerRows = elements(head);
    const bodyRows = elements(body);
    if (head.attrs.size || body.attrs.size || headerRows.length !== 1 || !bodyRows.length) {
      throw new ReportError("Tables need one header row and at least one body row.");
    }
    let width = null;
    for (const [row, cellTag] of [[headerRows[0], "th"], ...bodyRows.map((item) => [item, "td"])]) {
      const cells = elements(row);
      if (row.tag !== "tr" || row.attrs.size || !cells.length || cells.some((cell) => cell.tag !== cellTag)) {
        throw new ReportError("Table header rows need only column headers and body rows only data cells.");
      }
      if (cells.some((cell) => !attrsEqual(cell, cellTag === "th" ? { scope: "col" } : {}))) {
        throw new ReportError("Table cells have attributes outside the generated dialect.");
      }
      if (width !== null && cells.length !== width) {
        throw new ReportError("Table rows have inconsistent column counts.");
      }
      width = cells.length;
    }
    for (const node of [table, head, body, ...headerRows, ...bodyRows]) wrapped.add(node);
    for (const row of [...headerRows, ...bodyRows]) for (const cell of elements(row)) wrapped.add(cell);
  }
  for (const tag of ["table", "thead", "tbody", "tr", "th", "td"]) {
    if (root.find(tag).some((node) => !wrapped.has(node))) {
      throw new ReportError("Table elements appear outside the generated table shape.");
    }
  }
}

/** Status badges outside tables; status-matrix cells are never appendix outcomes. */
export function outcomeBadges(node) {
  const found = [];
  for (const child of node.children) {
    if (child instanceof Node && child.tag !== "table") {
      if (child.classes().includes("status-badge")) found.push(child);
      found.push(...outcomeBadges(child));
    }
  }
  return found;
}

export function checkCounts(root) {
  const groups = checklistGroups();
  const outcomes = new Map();
  const [main] = root.find("main");
  const appendix = root.find("section", "appendix");
  if (!appendix.length) {
    throw new ReportError("No appendix section found. Put check outcomes under second-level headings that begin with Appendix, for example ## Appendix: Identity and access.");
  }
  for (const section of appendix) {
    if (!main.children.includes(section) || section.find("h3").some((heading) => !section.children.includes(heading))) {
      throw new ReportError("Appendix sections and check headings must be direct children of main/section.");
    }
    let current = null;
    let badges = [];
    const finish = () => {
      if (current !== null) {
        if (outcomes.has(current) || badges.length !== 1 || !LABEL_MAP.has(badges[0])) {
          throw new ReportError("Each distinct appendix check needs exactly one known status.");
        }
        outcomes.set(current, LABEL_MAP.get(badges[0]));
      }
    };
    for (const child of section.children) {
      if (!(child instanceof Node)) continue;
      if (child.tag === "h3") {
        finish();
        const match = HEADING_ID.exec(pyStrip(child.text));
        if (!match) {
          throw new ReportError("Appendix check headings must begin with a topic ID and title.");
        }
        current = match[1];
        badges = [];
      }
      if (child.tag === "table") continue;
      const found = child.classes().includes("status-badge") ? [child] : [];
      found.push(...outcomeBadges(child));
      if (found.length && current === null) {
        throw new ReportError("Appendix status lacks a check heading.");
      }
      badges.push(...found.map((node) => pyStrip(node.text)));
    }
    finish();
  }
  const all = new Set([...groups.core, ...groups.optional]);
  if (outcomes.size !== all.size || [...outcomes.keys()].some((id) => !all.has(id))) {
    throw new ReportError("Appendix must contain all 24 core and four optional IDs exactly once. Only checks under second-level headings that begin with Appendix are counted.");
  }
  const counts = {};
  for (const [name, topics] of Object.entries(groups)) {
    const group = {};
    for (const status of Object.values(LABELS)) group[status] = 0;
    for (const topic of topics) group[outcomes.get(topic)] += 1;
    counts[name] = group;
  }
  return [counts, outcomes];
}

/** Tables opening the report: directly in main before any section, then in its first section. */
export function matrixTables(main) {
  const tables = [];
  for (const child of main.children.filter((node) => node instanceof Node)) {
    if (child.tag === "section") {
      if (!child.classes().includes("appendix")) {
        tables.push(...child.children.filter((node) => node instanceof Node && node.classes().includes("table-wrap")));
      }
      break;
    }
    if (child.classes().includes("table-wrap")) tables.push(child);
  }
  return tables.map((wrapper) => elements(wrapper)[0]);
}

/** One status key from a badge, or null for Team-wide / By project. */
export function matrixCell(cell) {
  const parts = cell.children.filter((child) => child instanceof Node);
  if (!parts.length && MATRIX_MARKERS.includes(pyStrip(cell.text))) return null;
  if (parts.length !== 1 || cell.children.some((child) => typeof child === "string" && pyStrip(child))
      || !parts[0].classes().includes("status-badge")
      || !LABEL_MAP.has(pyStrip(parts[0].text))) {
    throw new ReportError("Status matrix cells must hold exactly one status key, Team-wide or By project.");
  }
  return LABEL_MAP.get(pyStrip(parts[0].text));
}

/** Each check's status matrix row must summarise to its appendix outcome. */
export function checkMatrix(root, outcomes) {
  const groups = checklistGroups();
  const [main] = root.find("main");
  const tables = matrixTables(main);
  if (!tables.length) {
    throw new ReportError("No status matrix found. Open the report with the status matrix tables, before the review summary and in the same second-level section.");
  }
  const rows = new Map();
  const accepted = new Set();
  for (const table of tables) {
    const [, body] = elements(table);
    const tableGroups = new Set();
    for (const row of elements(body)) {
      const cells = elements(row);
      const identifiers = new Set(Array.from(cells[0].text.matchAll(CHECK_ID), (match) => match[0]));
      if (identifiers.size !== 1) {
        throw new ReportError("Each status matrix row needs exactly one check ID in its first cell.");
      }
      const [identifier] = identifiers;
      const label = pySplit(cells[0].text).join(" ");
      const lower = label.toLowerCase();
      if (lower.includes("owner-accepted")) {
        if (lower.split("owner-accepted").length - 1 !== 1 || !label.endsWith(" " + OWNER_ACCEPTED_MARKER)) {
          throw new CheckError("Owner-accepted marker must be exactly (owner-accepted) at the end of the Check cell.",
            identifier);
        }
        accepted.add(identifier);
      }
      const group = Object.entries(groups).find(([, topics]) => topics.has(identifier))?.[0] ?? null;
      if (group === null) {
        throw new ReportError("Status matrix has a row for an ID that is not in the bundled checklist.");
      }
      if (rows.has(identifier)) {
        throw new CheckError("Status matrix lists a check more than once.", identifier);
      }
      const statuses = cells.slice(1).map(matrixCell).filter((status) => status !== null);
      if (!statuses.length) {
        throw new CheckError("Status matrix row has no status, only Team-wide or By project.", identifier);
      }
      rows.set(identifier, statuses.reduce((best, status) => (
        STATUS_ORDER.indexOf(status) < STATUS_ORDER.indexOf(best) ? status : best)));
      tableGroups.add(group);
    }
    if (tableGroups.size > 1) {
      throw new ReportError("Optional checks need their own status matrix table, separate from core checks.");
    }
  }
  for (const group of ["core", "optional"]) {
    for (const identifier of [...groups[group]].sort()) {
      if (!rows.has(identifier)) {
        throw new CheckError("Status matrix is missing a check that the appendix contains.", identifier);
      }
      const matrix = rows.get(identifier);
      const appendix = outcomes.get(identifier);
      if (matrix !== appendix) {
        if (STATUS_ORDER.indexOf(matrix) > STATUS_ORDER.indexOf(appendix)) {
          throw new CheckError("Status matrix shows a better result than the appendix.",
            identifier, matrix, appendix);
        }
        throw new CheckError("Status matrix shows a worse result than the appendix.",
          identifier, matrix, appendix);
      }
      if (accepted.has(identifier) && appendix !== "needs_confirmation") {
        throw new CheckError("Owner-accepted marker is on a check whose status is not needs_confirmation.",
          identifier, matrix, appendix);
      }
    }
  }
  return ["matched all 28 checks", [...accepted].sort()];
}

export function checkSummary(summary, counts) {
  if (!isDict(summary) || !sameKeys(dictKeys(summary), ["core", "optional"])) {
    throw new ReportError("Expected summary needs separate core and optional objects.");
  }
  const statuses = Object.values(LABELS);
  for (const group of Object.keys(counts)) {
    const values = dictGet(summary, group);
    if (!isDict(values) || !sameKeys(dictKeys(values), statuses)
        || dictEntries(values).some(([, value]) => !isInt(value) || value < 0)) {
      throw new ReportError("Expected summary needs all five nonnegative integer status counts.");
    }
  }
  const same = (group) => statuses.every((status) => BigInt(dictGet(dictGet(summary, group), status)) === BigInt(counts[group][status]));
  if (!same("core")) {
    throw new ReportError("Expected summary core counts do not match the appendix.");
  }
  if (!same("optional")) {
    throw new ReportError("Expected summary optional counts do not match the appendix.");
  }
}

/** Accept a template-style record or flat records, not a report-builder schema. */
export function checkEvidence(source, outcomes) {
  const records = isDict(source) ? [source] : source;
  if (!Array.isArray(records) || !records.length) {
    throw new ReportError("Evidence needs a record or nonempty list of records.");
  }
  const lookup = outcomes instanceof Map ? outcomes : new Map(Object.entries(outcomes));
  const seen = new Set();
  for (const record of records) {
    if (!isDict(record)) {
      throw new ReportError("Invalid evidence record.");
    }
    const topic = dictGet(record, "topic_id");
    const status = dictGet(record, "status");
    if (typeof topic !== "string" || typeof status !== "string"
        || !lookup.has(topic) || seen.has(topic) || status !== lookup.get(topic)) {
      throw new ReportError("Evidence topic/status does not match appendix.");
    }
    seen.add(topic);
  }
  if (seen.size === 28) return "matched all 28 checks";
  return `matched ${seen.size} of 28 checks; partial source`;
}

// ---------------------------------------------------------------------------
// CLI.

const PROG = "check-report.mjs";
const USAGE = `usage: ${PROG} [-h] [--expected-summary EXPECTED_SUMMARY]
                        [--evidence-json EVIDENCE_JSON]
                        html`;
const HELP = `${USAGE}

Read-only structural QA for bundled-renderer HTML. Stdlib; never opens a
browser.

positional arguments:
  html                  Generated sanitised local HTML

options:
  -h, --help            show this help message and exit
  --expected-summary EXPECTED_SUMMARY
                        JSON with core/optional five-status count objects
  --evidence-json EVIDENCE_JSON
                        Optional template-style evidence record or flat list
                        of records
`;

class UsageError extends Error {}

const NEGATIVE_NUMBER = /^-\d+$|^-\d*\.\d+$/;
const OPTION_NAMES = Object.freeze({
  "-h": "help", "--help": "help", "--expected-summary": "expected_summary", "--evidence-json": "evidence_json",
});
const OPTION_LABELS = { help: "-h/--help", expected_summary: "--expected-summary", evidence_json: "--evidence-json" };

/**
 * argparse's _parse_optional: null for a positional, otherwise {name, explicit}
 * where name is null for an unknown optional.
 */
function classifyArgument(argument) {
  if (!argument.startsWith("-")) return null;
  if (Object.hasOwn(OPTION_NAMES, argument)) return { name: OPTION_NAMES[argument], explicit: null, sep: false };
  if (argument.length === 1) return null;
  const at = argument.indexOf("=");
  if (at >= 0 && Object.hasOwn(OPTION_NAMES, argument.slice(0, at))) {
    return { name: OPTION_NAMES[argument.slice(0, at)], explicit: argument.slice(at + 1), sep: true };
  }
  const matches = [];
  if (argument.startsWith("--")) {
    const prefix = at >= 0 ? argument.slice(0, at) : argument;
    const explicit = at >= 0 ? argument.slice(at + 1) : null;
    for (const option of Object.keys(OPTION_NAMES)) {
      if (option.startsWith(prefix)) matches.push([option, explicit, explicit !== null]);
    }
  } else if (argument.slice(0, 2) === "-h") {
    matches.push(["-h", argument.slice(2), false]);
  }
  if (matches.length > 1) {
    throw new UsageError(`ambiguous option: ${argument} could match ${matches.map(([option]) => option).join(", ")}`);
  }
  if (matches.length === 1) {
    const [option, explicit, sep] = matches[0];
    return { name: OPTION_NAMES[option], explicit, sep, short: option === "-h" };
  }
  if (NEGATIVE_NUMBER.test(argument) || argument.includes(" ")) return null;
  return { name: null, explicit: null, sep: false };
}

/**
 * argparse's consume_optional for -h/--help with an explicit argument: "=" forms are errors;
 * "-hx" chains further single-dash flags, and help runs before an unknown one is reported.
 */
function helpExplicitArgument(option) {
  let { explicit, sep } = option;
  if (explicit === null) return;
  for (;;) {
    if (sep || explicit === "" || explicit[0] === "-") {
      if (explicit === "" && !sep) return;
      throw new UsageError(`argument -h/--help: ignored explicit argument '${explicit}'`);
    }
    if (explicit[0] !== "h") return; // An unknown chained flag; help runs first.
    explicit = explicit.slice(1);
    if (explicit === "") return;
    if (explicit[0] === "=") {
      sep = true;
      explicit = explicit.slice(1);
    }
  }
}

/** argparse equivalent for this CLI (long-option prefixes, --opt=value, --). */
function parseArguments(argv) {
  const options = { expected_summary: null, evidence_json: null };
  const positionals = [];
  const extras = [];
  let onlyPositionals = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (onlyPositionals) {
      positionals.push(argument);
      continue;
    }
    if (argument === "--") {
      onlyPositionals = true;
      continue;
    }
    const option = classifyArgument(argument);
    if (option === null) {
      positionals.push(argument);
      continue;
    }
    if (option.name === null) {
      extras.push(argument);
      continue;
    }
    if (option.name === "help") {
      helpExplicitArgument(option);
      return { help: true };
    }
    let value = option.explicit;
    if (value === null) {
      const next = argv[index + 1];
      if (next === undefined || next === "--" || classifyArgument(next) !== null) {
        throw new UsageError(`argument ${OPTION_LABELS[option.name]}: expected one argument`);
      }
      value = next;
      index += 1;
    }
    options[option.name] = value;
  }
  if (positionals.length < 1) throw new UsageError("the following arguments are required: html");
  extras.push(...positionals.slice(1));
  if (extras.length) throw new UsageError(`unrecognized arguments: ${extras.join(" ")}`);
  // pathlib.Path("") is ".", as argparse's type=Path would produce.
  const asPath = (value) => (value === null ? null : value || ".");
  return { html: asPath(positionals[0]), expectedSummary: asPath(options.expected_summary), evidenceJson: asPath(options.evidence_json) };
}

export function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArguments(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${USAGE}\n${PROG}: error: ${error.message}\n`);
    return 2;
  }
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  let result;
  try {
    const { root } = new Document(readText(args.html));
    checkPassive(root);
    const [counts, outcomes] = checkCounts(root);
    const [matrixParity, accepted] = checkMatrix(root, outcomes);
    if (args.expectedSummary !== null) checkSummary(readJson(args.expectedSummary), counts);
    const evidenceParity = args.evidenceJson !== null
      ? checkEvidence(readJson(args.evidenceJson), outcomes) : "not checked; no evidence JSON supplied";
    result = {
      counts, matrix_parity: matrixParity, owner_accepted_markers: accepted,
      summary_parity: args.expectedSummary !== null ? "matched" : "not checked; no expected summary supplied",
      evidence_parity: evidenceParity, passive_html: "matched bundled structural constraints",
      visual_qa: "not performed", network_qa: "structural only; runtime not observed",
    };
  } catch (error) {
    if (error instanceof ReportError) {
      process.stderr.write(`Report QA failed: ${error.message} No content echoed.\n`);
      return 1;
    }
    if (error instanceof PyJSONDecodeError) {
      process.stderr.write("Report QA failed: a JSON input is not valid JSON. No content echoed.\n");
      return 1;
    }
    if (error instanceof PyUnicodeError) {
      process.stderr.write("Report QA failed: inputs must be UTF-8 text. No content echoed.\n");
      return 1;
    }
    if (isOsError(error)) {
      process.stderr.write(`Report QA failed: ${describeOsError("input file", error)} No content echoed.\n`);
      return 1;
    }
    if (error instanceof PyValueError || error instanceof PyRecursionError || error instanceof RangeError) {
      process.stderr.write("Report QA failed: invalid HTML, counts, JSON or bundled assets. Review locally; no content echoed.\n");
      return 1;
    }
    throw error;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
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


// Python html.entities.html5: "name=hex[.hex]" entries separated by spaces.
const ENTITY_DATA = (
  "Aacute=c1 aacute=e1 Aacute;=c1 aacute;=e1 Abreve;=102 abreve;=103 ac;=223e acd;=223f acE;=223e.333 Acirc=c2 " +
  "acirc=e2 Acirc;=c2 acirc;=e2 acute=b4 acute;=b4 Acy;=410 acy;=430 AElig=c6 aelig=e6 AElig;=c6 aelig;=e6 " +
  "af;=2061 Afr;=1d504 afr;=1d51e Agrave=c0 agrave=e0 Agrave;=c0 agrave;=e0 alefsym;=2135 aleph;=2135 Alpha;=391 " +
  "alpha;=3b1 Amacr;=100 amacr;=101 amalg;=2a3f AMP=26 amp=26 AMP;=26 amp;=26 And;=2a53 and;=2227 andand;=2a55 " +
  "andd;=2a5c andslope;=2a58 andv;=2a5a ang;=2220 ange;=29a4 angle;=2220 angmsd;=2221 angmsdaa;=29a8 " +
  "angmsdab;=29a9 angmsdac;=29aa angmsdad;=29ab angmsdae;=29ac angmsdaf;=29ad angmsdag;=29ae angmsdah;=29af " +
  "angrt;=221f angrtvb;=22be angrtvbd;=299d angsph;=2222 angst;=c5 angzarr;=237c Aogon;=104 aogon;=105 " +
  "Aopf;=1d538 aopf;=1d552 ap;=2248 apacir;=2a6f apE;=2a70 ape;=224a apid;=224b apos;=27 ApplyFunction;=2061 " +
  "approx;=2248 approxeq;=224a Aring=c5 aring=e5 Aring;=c5 aring;=e5 Ascr;=1d49c ascr;=1d4b6 Assign;=2254 " +
  "ast;=2a asymp;=2248 asympeq;=224d Atilde=c3 atilde=e3 Atilde;=c3 atilde;=e3 Auml=c4 auml=e4 Auml;=c4 auml;=e4 " +
  "awconint;=2233 awint;=2a11 backcong;=224c backepsilon;=3f6 backprime;=2035 backsim;=223d backsimeq;=22cd " +
  "Backslash;=2216 Barv;=2ae7 barvee;=22bd Barwed;=2306 barwed;=2305 barwedge;=2305 bbrk;=23b5 bbrktbrk;=23b6 " +
  "bcong;=224c Bcy;=411 bcy;=431 bdquo;=201e becaus;=2235 Because;=2235 because;=2235 bemptyv;=29b0 bepsi;=3f6 " +
  "bernou;=212c Bernoullis;=212c Beta;=392 beta;=3b2 beth;=2136 between;=226c Bfr;=1d505 bfr;=1d51f bigcap;=22c2 " +
  "bigcirc;=25ef bigcup;=22c3 bigodot;=2a00 bigoplus;=2a01 bigotimes;=2a02 bigsqcup;=2a06 bigstar;=2605 " +
  "bigtriangledown;=25bd bigtriangleup;=25b3 biguplus;=2a04 bigvee;=22c1 bigwedge;=22c0 bkarow;=290d " +
  "blacklozenge;=29eb blacksquare;=25aa blacktriangle;=25b4 blacktriangledown;=25be blacktriangleleft;=25c2 " +
  "blacktriangleright;=25b8 blank;=2423 blk12;=2592 blk14;=2591 blk34;=2593 block;=2588 bne;=3d.20e5 " +
  "bnequiv;=2261.20e5 bNot;=2aed bnot;=2310 Bopf;=1d539 bopf;=1d553 bot;=22a5 bottom;=22a5 bowtie;=22c8 " +
  "boxbox;=29c9 boxDL;=2557 boxDl;=2556 boxdL;=2555 boxdl;=2510 boxDR;=2554 boxDr;=2553 boxdR;=2552 boxdr;=250c " +
  "boxH;=2550 boxh;=2500 boxHD;=2566 boxHd;=2564 boxhD;=2565 boxhd;=252c boxHU;=2569 boxHu;=2567 boxhU;=2568 " +
  "boxhu;=2534 boxminus;=229f boxplus;=229e boxtimes;=22a0 boxUL;=255d boxUl;=255c boxuL;=255b boxul;=2518 " +
  "boxUR;=255a boxUr;=2559 boxuR;=2558 boxur;=2514 boxV;=2551 boxv;=2502 boxVH;=256c boxVh;=256b boxvH;=256a " +
  "boxvh;=253c boxVL;=2563 boxVl;=2562 boxvL;=2561 boxvl;=2524 boxVR;=2560 boxVr;=255f boxvR;=255e boxvr;=251c " +
  "bprime;=2035 Breve;=2d8 breve;=2d8 brvbar=a6 brvbar;=a6 Bscr;=212c bscr;=1d4b7 bsemi;=204f bsim;=223d " +
  "bsime;=22cd bsol;=5c bsolb;=29c5 bsolhsub;=27c8 bull;=2022 bullet;=2022 bump;=224e bumpE;=2aae bumpe;=224f " +
  "Bumpeq;=224e bumpeq;=224f Cacute;=106 cacute;=107 Cap;=22d2 cap;=2229 capand;=2a44 capbrcup;=2a49 " +
  "capcap;=2a4b capcup;=2a47 capdot;=2a40 CapitalDifferentialD;=2145 caps;=2229.fe00 caret;=2041 caron;=2c7 " +
  "Cayleys;=212d ccaps;=2a4d Ccaron;=10c ccaron;=10d Ccedil=c7 ccedil=e7 Ccedil;=c7 ccedil;=e7 Ccirc;=108 " +
  "ccirc;=109 Cconint;=2230 ccups;=2a4c ccupssm;=2a50 Cdot;=10a cdot;=10b cedil=b8 cedil;=b8 Cedilla;=b8 " +
  "cemptyv;=29b2 cent=a2 cent;=a2 CenterDot;=b7 centerdot;=b7 Cfr;=212d cfr;=1d520 CHcy;=427 chcy;=447 " +
  "check;=2713 checkmark;=2713 Chi;=3a7 chi;=3c7 cir;=25cb circ;=2c6 circeq;=2257 circlearrowleft;=21ba " +
  "circlearrowright;=21bb circledast;=229b circledcirc;=229a circleddash;=229d CircleDot;=2299 circledR;=ae " +
  "circledS;=24c8 CircleMinus;=2296 CirclePlus;=2295 CircleTimes;=2297 cirE;=29c3 cire;=2257 cirfnint;=2a10 " +
  "cirmid;=2aef cirscir;=29c2 ClockwiseContourIntegral;=2232 CloseCurlyDoubleQuote;=201d CloseCurlyQuote;=2019 " +
  "clubs;=2663 clubsuit;=2663 Colon;=2237 colon;=3a Colone;=2a74 colone;=2254 coloneq;=2254 comma;=2c commat;=40 " +
  "comp;=2201 compfn;=2218 complement;=2201 complexes;=2102 cong;=2245 congdot;=2a6d Congruent;=2261 " +
  "Conint;=222f conint;=222e ContourIntegral;=222e Copf;=2102 copf;=1d554 coprod;=2210 Coproduct;=2210 COPY=a9 " +
  "copy=a9 COPY;=a9 copy;=a9 copysr;=2117 CounterClockwiseContourIntegral;=2233 crarr;=21b5 Cross;=2a2f " +
  "cross;=2717 Cscr;=1d49e cscr;=1d4b8 csub;=2acf csube;=2ad1 csup;=2ad0 csupe;=2ad2 ctdot;=22ef cudarrl;=2938 " +
  "cudarrr;=2935 cuepr;=22de cuesc;=22df cularr;=21b6 cularrp;=293d Cup;=22d3 cup;=222a cupbrcap;=2a48 " +
  "CupCap;=224d cupcap;=2a46 cupcup;=2a4a cupdot;=228d cupor;=2a45 cups;=222a.fe00 curarr;=21b7 curarrm;=293c " +
  "curlyeqprec;=22de curlyeqsucc;=22df curlyvee;=22ce curlywedge;=22cf curren=a4 curren;=a4 curvearrowleft;=21b6 " +
  "curvearrowright;=21b7 cuvee;=22ce cuwed;=22cf cwconint;=2232 cwint;=2231 cylcty;=232d Dagger;=2021 " +
  "dagger;=2020 daleth;=2138 Darr;=21a1 dArr;=21d3 darr;=2193 dash;=2010 Dashv;=2ae4 dashv;=22a3 dbkarow;=290f " +
  "dblac;=2dd Dcaron;=10e dcaron;=10f Dcy;=414 dcy;=434 DD;=2145 dd;=2146 ddagger;=2021 ddarr;=21ca " +
  "DDotrahd;=2911 ddotseq;=2a77 deg=b0 deg;=b0 Del;=2207 Delta;=394 delta;=3b4 demptyv;=29b1 dfisht;=297f " +
  "Dfr;=1d507 dfr;=1d521 dHar;=2965 dharl;=21c3 dharr;=21c2 DiacriticalAcute;=b4 DiacriticalDot;=2d9 " +
  "DiacriticalDoubleAcute;=2dd DiacriticalGrave;=60 DiacriticalTilde;=2dc diam;=22c4 Diamond;=22c4 diamond;=22c4 " +
  "diamondsuit;=2666 diams;=2666 die;=a8 DifferentialD;=2146 digamma;=3dd disin;=22f2 div;=f7 divide=f7 " +
  "divide;=f7 divideontimes;=22c7 divonx;=22c7 DJcy;=402 djcy;=452 dlcorn;=231e dlcrop;=230d dollar;=24 " +
  "Dopf;=1d53b dopf;=1d555 Dot;=a8 dot;=2d9 DotDot;=20dc doteq;=2250 doteqdot;=2251 DotEqual;=2250 " +
  "dotminus;=2238 dotplus;=2214 dotsquare;=22a1 doublebarwedge;=2306 DoubleContourIntegral;=222f DoubleDot;=a8 " +
  "DoubleDownArrow;=21d3 DoubleLeftArrow;=21d0 DoubleLeftRightArrow;=21d4 DoubleLeftTee;=2ae4 " +
  "DoubleLongLeftArrow;=27f8 DoubleLongLeftRightArrow;=27fa DoubleLongRightArrow;=27f9 DoubleRightArrow;=21d2 " +
  "DoubleRightTee;=22a8 DoubleUpArrow;=21d1 DoubleUpDownArrow;=21d5 DoubleVerticalBar;=2225 DownArrow;=2193 " +
  "Downarrow;=21d3 downarrow;=2193 DownArrowBar;=2913 DownArrowUpArrow;=21f5 DownBreve;=311 downdownarrows;=21ca " +
  "downharpoonleft;=21c3 downharpoonright;=21c2 DownLeftRightVector;=2950 DownLeftTeeVector;=295e " +
  "DownLeftVector;=21bd DownLeftVectorBar;=2956 DownRightTeeVector;=295f DownRightVector;=21c1 " +
  "DownRightVectorBar;=2957 DownTee;=22a4 DownTeeArrow;=21a7 drbkarow;=2910 drcorn;=231f drcrop;=230c " +
  "Dscr;=1d49f dscr;=1d4b9 DScy;=405 dscy;=455 dsol;=29f6 Dstrok;=110 dstrok;=111 dtdot;=22f1 dtri;=25bf " +
  "dtrif;=25be duarr;=21f5 duhar;=296f dwangle;=29a6 DZcy;=40f dzcy;=45f dzigrarr;=27ff Eacute=c9 eacute=e9 " +
  "Eacute;=c9 eacute;=e9 easter;=2a6e Ecaron;=11a ecaron;=11b ecir;=2256 Ecirc=ca ecirc=ea Ecirc;=ca ecirc;=ea " +
  "ecolon;=2255 Ecy;=42d ecy;=44d eDDot;=2a77 Edot;=116 eDot;=2251 edot;=117 ee;=2147 efDot;=2252 Efr;=1d508 " +
  "efr;=1d522 eg;=2a9a Egrave=c8 egrave=e8 Egrave;=c8 egrave;=e8 egs;=2a96 egsdot;=2a98 el;=2a99 Element;=2208 " +
  "elinters;=23e7 ell;=2113 els;=2a95 elsdot;=2a97 Emacr;=112 emacr;=113 empty;=2205 emptyset;=2205 " +
  "EmptySmallSquare;=25fb emptyv;=2205 EmptyVerySmallSquare;=25ab emsp13;=2004 emsp14;=2005 emsp;=2003 ENG;=14a " +
  "eng;=14b ensp;=2002 Eogon;=118 eogon;=119 Eopf;=1d53c eopf;=1d556 epar;=22d5 eparsl;=29e3 eplus;=2a71 " +
  "epsi;=3b5 Epsilon;=395 epsilon;=3b5 epsiv;=3f5 eqcirc;=2256 eqcolon;=2255 eqsim;=2242 eqslantgtr;=2a96 " +
  "eqslantless;=2a95 Equal;=2a75 equals;=3d EqualTilde;=2242 equest;=225f Equilibrium;=21cc equiv;=2261 " +
  "equivDD;=2a78 eqvparsl;=29e5 erarr;=2971 erDot;=2253 Escr;=2130 escr;=212f esdot;=2250 Esim;=2a73 esim;=2242 " +
  "Eta;=397 eta;=3b7 ETH=d0 eth=f0 ETH;=d0 eth;=f0 Euml=cb euml=eb Euml;=cb euml;=eb euro;=20ac excl;=21 " +
  "exist;=2203 Exists;=2203 expectation;=2130 ExponentialE;=2147 exponentiale;=2147 fallingdotseq;=2252 Fcy;=424 " +
  "fcy;=444 female;=2640 ffilig;=fb03 fflig;=fb00 ffllig;=fb04 Ffr;=1d509 ffr;=1d523 filig;=fb01 " +
  "FilledSmallSquare;=25fc FilledVerySmallSquare;=25aa fjlig;=66.6a flat;=266d fllig;=fb02 fltns;=25b1 fnof;=192 " +
  "Fopf;=1d53d fopf;=1d557 ForAll;=2200 forall;=2200 fork;=22d4 forkv;=2ad9 Fouriertrf;=2131 fpartint;=2a0d " +
  "frac12=bd frac12;=bd frac13;=2153 frac14=bc frac14;=bc frac15;=2155 frac16;=2159 frac18;=215b frac23;=2154 " +
  "frac25;=2156 frac34=be frac34;=be frac35;=2157 frac38;=215c frac45;=2158 frac56;=215a frac58;=215d " +
  "frac78;=215e frasl;=2044 frown;=2322 Fscr;=2131 fscr;=1d4bb gacute;=1f5 Gamma;=393 gamma;=3b3 Gammad;=3dc " +
  "gammad;=3dd gap;=2a86 Gbreve;=11e gbreve;=11f Gcedil;=122 Gcirc;=11c gcirc;=11d Gcy;=413 gcy;=433 Gdot;=120 " +
  "gdot;=121 gE;=2267 ge;=2265 gEl;=2a8c gel;=22db geq;=2265 geqq;=2267 geqslant;=2a7e ges;=2a7e gescc;=2aa9 " +
  "gesdot;=2a80 gesdoto;=2a82 gesdotol;=2a84 gesl;=22db.fe00 gesles;=2a94 Gfr;=1d50a gfr;=1d524 Gg;=22d9 " +
  "gg;=226b ggg;=22d9 gimel;=2137 GJcy;=403 gjcy;=453 gl;=2277 gla;=2aa5 glE;=2a92 glj;=2aa4 gnap;=2a8a " +
  "gnapprox;=2a8a gnE;=2269 gne;=2a88 gneq;=2a88 gneqq;=2269 gnsim;=22e7 Gopf;=1d53e gopf;=1d558 grave;=60 " +
  "GreaterEqual;=2265 GreaterEqualLess;=22db GreaterFullEqual;=2267 GreaterGreater;=2aa2 GreaterLess;=2277 " +
  "GreaterSlantEqual;=2a7e GreaterTilde;=2273 Gscr;=1d4a2 gscr;=210a gsim;=2273 gsime;=2a8e gsiml;=2a90 GT=3e " +
  "gt=3e GT;=3e Gt;=226b gt;=3e gtcc;=2aa7 gtcir;=2a7a gtdot;=22d7 gtlPar;=2995 gtquest;=2a7c gtrapprox;=2a86 " +
  "gtrarr;=2978 gtrdot;=22d7 gtreqless;=22db gtreqqless;=2a8c gtrless;=2277 gtrsim;=2273 gvertneqq;=2269.fe00 " +
  "gvnE;=2269.fe00 Hacek;=2c7 hairsp;=200a half;=bd hamilt;=210b HARDcy;=42a hardcy;=44a hArr;=21d4 harr;=2194 " +
  "harrcir;=2948 harrw;=21ad Hat;=5e hbar;=210f Hcirc;=124 hcirc;=125 hearts;=2665 heartsuit;=2665 hellip;=2026 " +
  "hercon;=22b9 Hfr;=210c hfr;=1d525 HilbertSpace;=210b hksearow;=2925 hkswarow;=2926 hoarr;=21ff homtht;=223b " +
  "hookleftarrow;=21a9 hookrightarrow;=21aa Hopf;=210d hopf;=1d559 horbar;=2015 HorizontalLine;=2500 Hscr;=210b " +
  "hscr;=1d4bd hslash;=210f Hstrok;=126 hstrok;=127 HumpDownHump;=224e HumpEqual;=224f hybull;=2043 hyphen;=2010 " +
  "Iacute=cd iacute=ed Iacute;=cd iacute;=ed ic;=2063 Icirc=ce icirc=ee Icirc;=ce icirc;=ee Icy;=418 icy;=438 " +
  "Idot;=130 IEcy;=415 iecy;=435 iexcl=a1 iexcl;=a1 iff;=21d4 Ifr;=2111 ifr;=1d526 Igrave=cc igrave=ec " +
  "Igrave;=cc igrave;=ec ii;=2148 iiiint;=2a0c iiint;=222d iinfin;=29dc iiota;=2129 IJlig;=132 ijlig;=133 " +
  "Im;=2111 Imacr;=12a imacr;=12b image;=2111 ImaginaryI;=2148 imagline;=2110 imagpart;=2111 imath;=131 " +
  "imof;=22b7 imped;=1b5 Implies;=21d2 in;=2208 incare;=2105 infin;=221e infintie;=29dd inodot;=131 Int;=222c " +
  "int;=222b intcal;=22ba integers;=2124 Integral;=222b intercal;=22ba Intersection;=22c2 intlarhk;=2a17 " +
  "intprod;=2a3c InvisibleComma;=2063 InvisibleTimes;=2062 IOcy;=401 iocy;=451 Iogon;=12e iogon;=12f Iopf;=1d540 " +
  "iopf;=1d55a Iota;=399 iota;=3b9 iprod;=2a3c iquest=bf iquest;=bf Iscr;=2110 iscr;=1d4be isin;=2208 " +
  "isindot;=22f5 isinE;=22f9 isins;=22f4 isinsv;=22f3 isinv;=2208 it;=2062 Itilde;=128 itilde;=129 Iukcy;=406 " +
  "iukcy;=456 Iuml=cf iuml=ef Iuml;=cf iuml;=ef Jcirc;=134 jcirc;=135 Jcy;=419 jcy;=439 Jfr;=1d50d jfr;=1d527 " +
  "jmath;=237 Jopf;=1d541 jopf;=1d55b Jscr;=1d4a5 jscr;=1d4bf Jsercy;=408 jsercy;=458 Jukcy;=404 jukcy;=454 " +
  "Kappa;=39a kappa;=3ba kappav;=3f0 Kcedil;=136 kcedil;=137 Kcy;=41a kcy;=43a Kfr;=1d50e kfr;=1d528 kgreen;=138 " +
  "KHcy;=425 khcy;=445 KJcy;=40c kjcy;=45c Kopf;=1d542 kopf;=1d55c Kscr;=1d4a6 kscr;=1d4c0 lAarr;=21da " +
  "Lacute;=139 lacute;=13a laemptyv;=29b4 lagran;=2112 Lambda;=39b lambda;=3bb Lang;=27ea lang;=27e8 langd;=2991 " +
  "langle;=27e8 lap;=2a85 Laplacetrf;=2112 laquo=ab laquo;=ab Larr;=219e lArr;=21d0 larr;=2190 larrb;=21e4 " +
  "larrbfs;=291f larrfs;=291d larrhk;=21a9 larrlp;=21ab larrpl;=2939 larrsim;=2973 larrtl;=21a2 lat;=2aab " +
  "lAtail;=291b latail;=2919 late;=2aad lates;=2aad.fe00 lBarr;=290e lbarr;=290c lbbrk;=2772 lbrace;=7b " +
  "lbrack;=5b lbrke;=298b lbrksld;=298f lbrkslu;=298d Lcaron;=13d lcaron;=13e Lcedil;=13b lcedil;=13c " +
  "lceil;=2308 lcub;=7b Lcy;=41b lcy;=43b ldca;=2936 ldquo;=201c ldquor;=201e ldrdhar;=2967 ldrushar;=294b " +
  "ldsh;=21b2 lE;=2266 le;=2264 LeftAngleBracket;=27e8 LeftArrow;=2190 Leftarrow;=21d0 leftarrow;=2190 " +
  "LeftArrowBar;=21e4 LeftArrowRightArrow;=21c6 leftarrowtail;=21a2 LeftCeiling;=2308 LeftDoubleBracket;=27e6 " +
  "LeftDownTeeVector;=2961 LeftDownVector;=21c3 LeftDownVectorBar;=2959 LeftFloor;=230a leftharpoondown;=21bd " +
  "leftharpoonup;=21bc leftleftarrows;=21c7 LeftRightArrow;=2194 Leftrightarrow;=21d4 leftrightarrow;=2194 " +
  "leftrightarrows;=21c6 leftrightharpoons;=21cb leftrightsquigarrow;=21ad LeftRightVector;=294e LeftTee;=22a3 " +
  "LeftTeeArrow;=21a4 LeftTeeVector;=295a leftthreetimes;=22cb LeftTriangle;=22b2 LeftTriangleBar;=29cf " +
  "LeftTriangleEqual;=22b4 LeftUpDownVector;=2951 LeftUpTeeVector;=2960 LeftUpVector;=21bf LeftUpVectorBar;=2958 " +
  "LeftVector;=21bc LeftVectorBar;=2952 lEg;=2a8b leg;=22da leq;=2264 leqq;=2266 leqslant;=2a7d les;=2a7d " +
  "lescc;=2aa8 lesdot;=2a7f lesdoto;=2a81 lesdotor;=2a83 lesg;=22da.fe00 lesges;=2a93 lessapprox;=2a85 " +
  "lessdot;=22d6 lesseqgtr;=22da lesseqqgtr;=2a8b LessEqualGreater;=22da LessFullEqual;=2266 LessGreater;=2276 " +
  "lessgtr;=2276 LessLess;=2aa1 lesssim;=2272 LessSlantEqual;=2a7d LessTilde;=2272 lfisht;=297c lfloor;=230a " +
  "Lfr;=1d50f lfr;=1d529 lg;=2276 lgE;=2a91 lHar;=2962 lhard;=21bd lharu;=21bc lharul;=296a lhblk;=2584 " +
  "LJcy;=409 ljcy;=459 Ll;=22d8 ll;=226a llarr;=21c7 llcorner;=231e Lleftarrow;=21da llhard;=296b lltri;=25fa " +
  "Lmidot;=13f lmidot;=140 lmoust;=23b0 lmoustache;=23b0 lnap;=2a89 lnapprox;=2a89 lnE;=2268 lne;=2a87 " +
  "lneq;=2a87 lneqq;=2268 lnsim;=22e6 loang;=27ec loarr;=21fd lobrk;=27e6 LongLeftArrow;=27f5 " +
  "Longleftarrow;=27f8 longleftarrow;=27f5 LongLeftRightArrow;=27f7 Longleftrightarrow;=27fa " +
  "longleftrightarrow;=27f7 longmapsto;=27fc LongRightArrow;=27f6 Longrightarrow;=27f9 longrightarrow;=27f6 " +
  "looparrowleft;=21ab looparrowright;=21ac lopar;=2985 Lopf;=1d543 lopf;=1d55d loplus;=2a2d lotimes;=2a34 " +
  "lowast;=2217 lowbar;=5f LowerLeftArrow;=2199 LowerRightArrow;=2198 loz;=25ca lozenge;=25ca lozf;=29eb " +
  "lpar;=28 lparlt;=2993 lrarr;=21c6 lrcorner;=231f lrhar;=21cb lrhard;=296d lrm;=200e lrtri;=22bf lsaquo;=2039 " +
  "Lscr;=2112 lscr;=1d4c1 Lsh;=21b0 lsh;=21b0 lsim;=2272 lsime;=2a8d lsimg;=2a8f lsqb;=5b lsquo;=2018 " +
  "lsquor;=201a Lstrok;=141 lstrok;=142 LT=3c lt=3c LT;=3c Lt;=226a lt;=3c ltcc;=2aa6 ltcir;=2a79 ltdot;=22d6 " +
  "lthree;=22cb ltimes;=22c9 ltlarr;=2976 ltquest;=2a7b ltri;=25c3 ltrie;=22b4 ltrif;=25c2 ltrPar;=2996 " +
  "lurdshar;=294a luruhar;=2966 lvertneqq;=2268.fe00 lvnE;=2268.fe00 macr=af macr;=af male;=2642 malt;=2720 " +
  "maltese;=2720 Map;=2905 map;=21a6 mapsto;=21a6 mapstodown;=21a7 mapstoleft;=21a4 mapstoup;=21a5 marker;=25ae " +
  "mcomma;=2a29 Mcy;=41c mcy;=43c mdash;=2014 mDDot;=223a measuredangle;=2221 MediumSpace;=205f Mellintrf;=2133 " +
  "Mfr;=1d510 mfr;=1d52a mho;=2127 micro=b5 micro;=b5 mid;=2223 midast;=2a midcir;=2af0 middot=b7 middot;=b7 " +
  "minus;=2212 minusb;=229f minusd;=2238 minusdu;=2a2a MinusPlus;=2213 mlcp;=2adb mldr;=2026 mnplus;=2213 " +
  "models;=22a7 Mopf;=1d544 mopf;=1d55e mp;=2213 Mscr;=2133 mscr;=1d4c2 mstpos;=223e Mu;=39c mu;=3bc " +
  "multimap;=22b8 mumap;=22b8 nabla;=2207 Nacute;=143 nacute;=144 nang;=2220.20d2 nap;=2249 napE;=2a70.338 " +
  "napid;=224b.338 napos;=149 napprox;=2249 natur;=266e natural;=266e naturals;=2115 nbsp=a0 nbsp;=a0 " +
  "nbump;=224e.338 nbumpe;=224f.338 ncap;=2a43 Ncaron;=147 ncaron;=148 Ncedil;=145 ncedil;=146 ncong;=2247 " +
  "ncongdot;=2a6d.338 ncup;=2a42 Ncy;=41d ncy;=43d ndash;=2013 ne;=2260 nearhk;=2924 neArr;=21d7 nearr;=2197 " +
  "nearrow;=2197 nedot;=2250.338 NegativeMediumSpace;=200b NegativeThickSpace;=200b NegativeThinSpace;=200b " +
  "NegativeVeryThinSpace;=200b nequiv;=2262 nesear;=2928 nesim;=2242.338 NestedGreaterGreater;=226b " +
  "NestedLessLess;=226a NewLine;=a nexist;=2204 nexists;=2204 Nfr;=1d511 nfr;=1d52b ngE;=2267.338 nge;=2271 " +
  "ngeq;=2271 ngeqq;=2267.338 ngeqslant;=2a7e.338 nges;=2a7e.338 nGg;=22d9.338 ngsim;=2275 nGt;=226b.20d2 " +
  "ngt;=226f ngtr;=226f nGtv;=226b.338 nhArr;=21ce nharr;=21ae nhpar;=2af2 ni;=220b nis;=22fc nisd;=22fa " +
  "niv;=220b NJcy;=40a njcy;=45a nlArr;=21cd nlarr;=219a nldr;=2025 nlE;=2266.338 nle;=2270 nLeftarrow;=21cd " +
  "nleftarrow;=219a nLeftrightarrow;=21ce nleftrightarrow;=21ae nleq;=2270 nleqq;=2266.338 nleqslant;=2a7d.338 " +
  "nles;=2a7d.338 nless;=226e nLl;=22d8.338 nlsim;=2274 nLt;=226a.20d2 nlt;=226e nltri;=22ea nltrie;=22ec " +
  "nLtv;=226a.338 nmid;=2224 NoBreak;=2060 NonBreakingSpace;=a0 Nopf;=2115 nopf;=1d55f not=ac Not;=2aec not;=ac " +
  "NotCongruent;=2262 NotCupCap;=226d NotDoubleVerticalBar;=2226 NotElement;=2209 NotEqual;=2260 " +
  "NotEqualTilde;=2242.338 NotExists;=2204 NotGreater;=226f NotGreaterEqual;=2271 NotGreaterFullEqual;=2267.338 " +
  "NotGreaterGreater;=226b.338 NotGreaterLess;=2279 NotGreaterSlantEqual;=2a7e.338 NotGreaterTilde;=2275 " +
  "NotHumpDownHump;=224e.338 NotHumpEqual;=224f.338 notin;=2209 notindot;=22f5.338 notinE;=22f9.338 " +
  "notinva;=2209 notinvb;=22f7 notinvc;=22f6 NotLeftTriangle;=22ea NotLeftTriangleBar;=29cf.338 " +
  "NotLeftTriangleEqual;=22ec NotLess;=226e NotLessEqual;=2270 NotLessGreater;=2278 NotLessLess;=226a.338 " +
  "NotLessSlantEqual;=2a7d.338 NotLessTilde;=2274 NotNestedGreaterGreater;=2aa2.338 NotNestedLessLess;=2aa1.338 " +
  "notni;=220c notniva;=220c notnivb;=22fe notnivc;=22fd NotPrecedes;=2280 NotPrecedesEqual;=2aaf.338 " +
  "NotPrecedesSlantEqual;=22e0 NotReverseElement;=220c NotRightTriangle;=22eb NotRightTriangleBar;=29d0.338 " +
  "NotRightTriangleEqual;=22ed NotSquareSubset;=228f.338 NotSquareSubsetEqual;=22e2 NotSquareSuperset;=2290.338 " +
  "NotSquareSupersetEqual;=22e3 NotSubset;=2282.20d2 NotSubsetEqual;=2288 NotSucceeds;=2281 " +
  "NotSucceedsEqual;=2ab0.338 NotSucceedsSlantEqual;=22e1 NotSucceedsTilde;=227f.338 NotSuperset;=2283.20d2 " +
  "NotSupersetEqual;=2289 NotTilde;=2241 NotTildeEqual;=2244 NotTildeFullEqual;=2247 NotTildeTilde;=2249 " +
  "NotVerticalBar;=2224 npar;=2226 nparallel;=2226 nparsl;=2afd.20e5 npart;=2202.338 npolint;=2a14 npr;=2280 " +
  "nprcue;=22e0 npre;=2aaf.338 nprec;=2280 npreceq;=2aaf.338 nrArr;=21cf nrarr;=219b nrarrc;=2933.338 " +
  "nrarrw;=219d.338 nRightarrow;=21cf nrightarrow;=219b nrtri;=22eb nrtrie;=22ed nsc;=2281 nsccue;=22e1 " +
  "nsce;=2ab0.338 Nscr;=1d4a9 nscr;=1d4c3 nshortmid;=2224 nshortparallel;=2226 nsim;=2241 nsime;=2244 " +
  "nsimeq;=2244 nsmid;=2224 nspar;=2226 nsqsube;=22e2 nsqsupe;=22e3 nsub;=2284 nsubE;=2ac5.338 nsube;=2288 " +
  "nsubset;=2282.20d2 nsubseteq;=2288 nsubseteqq;=2ac5.338 nsucc;=2281 nsucceq;=2ab0.338 nsup;=2285 " +
  "nsupE;=2ac6.338 nsupe;=2289 nsupset;=2283.20d2 nsupseteq;=2289 nsupseteqq;=2ac6.338 ntgl;=2279 Ntilde=d1 " +
  "ntilde=f1 Ntilde;=d1 ntilde;=f1 ntlg;=2278 ntriangleleft;=22ea ntrianglelefteq;=22ec ntriangleright;=22eb " +
  "ntrianglerighteq;=22ed Nu;=39d nu;=3bd num;=23 numero;=2116 numsp;=2007 nvap;=224d.20d2 nVDash;=22af " +
  "nVdash;=22ae nvDash;=22ad nvdash;=22ac nvge;=2265.20d2 nvgt;=3e.20d2 nvHarr;=2904 nvinfin;=29de nvlArr;=2902 " +
  "nvle;=2264.20d2 nvlt;=3c.20d2 nvltrie;=22b4.20d2 nvrArr;=2903 nvrtrie;=22b5.20d2 nvsim;=223c.20d2 " +
  "nwarhk;=2923 nwArr;=21d6 nwarr;=2196 nwarrow;=2196 nwnear;=2927 Oacute=d3 oacute=f3 Oacute;=d3 oacute;=f3 " +
  "oast;=229b ocir;=229a Ocirc=d4 ocirc=f4 Ocirc;=d4 ocirc;=f4 Ocy;=41e ocy;=43e odash;=229d Odblac;=150 " +
  "odblac;=151 odiv;=2a38 odot;=2299 odsold;=29bc OElig;=152 oelig;=153 ofcir;=29bf Ofr;=1d512 ofr;=1d52c " +
  "ogon;=2db Ograve=d2 ograve=f2 Ograve;=d2 ograve;=f2 ogt;=29c1 ohbar;=29b5 ohm;=3a9 oint;=222e olarr;=21ba " +
  "olcir;=29be olcross;=29bb oline;=203e olt;=29c0 Omacr;=14c omacr;=14d Omega;=3a9 omega;=3c9 Omicron;=39f " +
  "omicron;=3bf omid;=29b6 ominus;=2296 Oopf;=1d546 oopf;=1d560 opar;=29b7 OpenCurlyDoubleQuote;=201c " +
  "OpenCurlyQuote;=2018 operp;=29b9 oplus;=2295 Or;=2a54 or;=2228 orarr;=21bb ord;=2a5d order;=2134 " +
  "orderof;=2134 ordf=aa ordf;=aa ordm=ba ordm;=ba origof;=22b6 oror;=2a56 orslope;=2a57 orv;=2a5b oS;=24c8 " +
  "Oscr;=1d4aa oscr;=2134 Oslash=d8 oslash=f8 Oslash;=d8 oslash;=f8 osol;=2298 Otilde=d5 otilde=f5 Otilde;=d5 " +
  "otilde;=f5 Otimes;=2a37 otimes;=2297 otimesas;=2a36 Ouml=d6 ouml=f6 Ouml;=d6 ouml;=f6 ovbar;=233d " +
  "OverBar;=203e OverBrace;=23de OverBracket;=23b4 OverParenthesis;=23dc par;=2225 para=b6 para;=b6 " +
  "parallel;=2225 parsim;=2af3 parsl;=2afd part;=2202 PartialD;=2202 Pcy;=41f pcy;=43f percnt;=25 period;=2e " +
  "permil;=2030 perp;=22a5 pertenk;=2031 Pfr;=1d513 pfr;=1d52d Phi;=3a6 phi;=3c6 phiv;=3d5 phmmat;=2133 " +
  "phone;=260e Pi;=3a0 pi;=3c0 pitchfork;=22d4 piv;=3d6 planck;=210f planckh;=210e plankv;=210f plus;=2b " +
  "plusacir;=2a23 plusb;=229e pluscir;=2a22 plusdo;=2214 plusdu;=2a25 pluse;=2a72 PlusMinus;=b1 plusmn=b1 " +
  "plusmn;=b1 plussim;=2a26 plustwo;=2a27 pm;=b1 Poincareplane;=210c pointint;=2a15 Popf;=2119 popf;=1d561 " +
  "pound=a3 pound;=a3 Pr;=2abb pr;=227a prap;=2ab7 prcue;=227c prE;=2ab3 pre;=2aaf prec;=227a precapprox;=2ab7 " +
  "preccurlyeq;=227c Precedes;=227a PrecedesEqual;=2aaf PrecedesSlantEqual;=227c PrecedesTilde;=227e " +
  "preceq;=2aaf precnapprox;=2ab9 precneqq;=2ab5 precnsim;=22e8 precsim;=227e Prime;=2033 prime;=2032 " +
  "primes;=2119 prnap;=2ab9 prnE;=2ab5 prnsim;=22e8 prod;=220f Product;=220f profalar;=232e profline;=2312 " +
  "profsurf;=2313 prop;=221d Proportion;=2237 Proportional;=221d propto;=221d prsim;=227e prurel;=22b0 " +
  "Pscr;=1d4ab pscr;=1d4c5 Psi;=3a8 psi;=3c8 puncsp;=2008 Qfr;=1d514 qfr;=1d52e qint;=2a0c Qopf;=211a " +
  "qopf;=1d562 qprime;=2057 Qscr;=1d4ac qscr;=1d4c6 quaternions;=210d quatint;=2a16 quest;=3f questeq;=225f " +
  "QUOT=22 quot=22 QUOT;=22 quot;=22 rAarr;=21db race;=223d.331 Racute;=154 racute;=155 radic;=221a " +
  "raemptyv;=29b3 Rang;=27eb rang;=27e9 rangd;=2992 range;=29a5 rangle;=27e9 raquo=bb raquo;=bb Rarr;=21a0 " +
  "rArr;=21d2 rarr;=2192 rarrap;=2975 rarrb;=21e5 rarrbfs;=2920 rarrc;=2933 rarrfs;=291e rarrhk;=21aa " +
  "rarrlp;=21ac rarrpl;=2945 rarrsim;=2974 Rarrtl;=2916 rarrtl;=21a3 rarrw;=219d rAtail;=291c ratail;=291a " +
  "ratio;=2236 rationals;=211a RBarr;=2910 rBarr;=290f rbarr;=290d rbbrk;=2773 rbrace;=7d rbrack;=5d rbrke;=298c " +
  "rbrksld;=298e rbrkslu;=2990 Rcaron;=158 rcaron;=159 Rcedil;=156 rcedil;=157 rceil;=2309 rcub;=7d Rcy;=420 " +
  "rcy;=440 rdca;=2937 rdldhar;=2969 rdquo;=201d rdquor;=201d rdsh;=21b3 Re;=211c real;=211c realine;=211b " +
  "realpart;=211c reals;=211d rect;=25ad REG=ae reg=ae REG;=ae reg;=ae ReverseElement;=220b " +
  "ReverseEquilibrium;=21cb ReverseUpEquilibrium;=296f rfisht;=297d rfloor;=230b Rfr;=211c rfr;=1d52f rHar;=2964 " +
  "rhard;=21c1 rharu;=21c0 rharul;=296c Rho;=3a1 rho;=3c1 rhov;=3f1 RightAngleBracket;=27e9 RightArrow;=2192 " +
  "Rightarrow;=21d2 rightarrow;=2192 RightArrowBar;=21e5 RightArrowLeftArrow;=21c4 rightarrowtail;=21a3 " +
  "RightCeiling;=2309 RightDoubleBracket;=27e7 RightDownTeeVector;=295d RightDownVector;=21c2 " +
  "RightDownVectorBar;=2955 RightFloor;=230b rightharpoondown;=21c1 rightharpoonup;=21c0 rightleftarrows;=21c4 " +
  "rightleftharpoons;=21cc rightrightarrows;=21c9 rightsquigarrow;=219d RightTee;=22a2 RightTeeArrow;=21a6 " +
  "RightTeeVector;=295b rightthreetimes;=22cc RightTriangle;=22b3 RightTriangleBar;=29d0 " +
  "RightTriangleEqual;=22b5 RightUpDownVector;=294f RightUpTeeVector;=295c RightUpVector;=21be " +
  "RightUpVectorBar;=2954 RightVector;=21c0 RightVectorBar;=2953 ring;=2da risingdotseq;=2253 rlarr;=21c4 " +
  "rlhar;=21cc rlm;=200f rmoust;=23b1 rmoustache;=23b1 rnmid;=2aee roang;=27ed roarr;=21fe robrk;=27e7 " +
  "ropar;=2986 Ropf;=211d ropf;=1d563 roplus;=2a2e rotimes;=2a35 RoundImplies;=2970 rpar;=29 rpargt;=2994 " +
  "rppolint;=2a12 rrarr;=21c9 Rrightarrow;=21db rsaquo;=203a Rscr;=211b rscr;=1d4c7 Rsh;=21b1 rsh;=21b1 rsqb;=5d " +
  "rsquo;=2019 rsquor;=2019 rthree;=22cc rtimes;=22ca rtri;=25b9 rtrie;=22b5 rtrif;=25b8 rtriltri;=29ce " +
  "RuleDelayed;=29f4 ruluhar;=2968 rx;=211e Sacute;=15a sacute;=15b sbquo;=201a Sc;=2abc sc;=227b scap;=2ab8 " +
  "Scaron;=160 scaron;=161 sccue;=227d scE;=2ab4 sce;=2ab0 Scedil;=15e scedil;=15f Scirc;=15c scirc;=15d " +
  "scnap;=2aba scnE;=2ab6 scnsim;=22e9 scpolint;=2a13 scsim;=227f Scy;=421 scy;=441 sdot;=22c5 sdotb;=22a1 " +
  "sdote;=2a66 searhk;=2925 seArr;=21d8 searr;=2198 searrow;=2198 sect=a7 sect;=a7 semi;=3b seswar;=2929 " +
  "setminus;=2216 setmn;=2216 sext;=2736 Sfr;=1d516 sfr;=1d530 sfrown;=2322 sharp;=266f SHCHcy;=429 shchcy;=449 " +
  "SHcy;=428 shcy;=448 ShortDownArrow;=2193 ShortLeftArrow;=2190 shortmid;=2223 shortparallel;=2225 " +
  "ShortRightArrow;=2192 ShortUpArrow;=2191 shy=ad shy;=ad Sigma;=3a3 sigma;=3c3 sigmaf;=3c2 sigmav;=3c2 " +
  "sim;=223c simdot;=2a6a sime;=2243 simeq;=2243 simg;=2a9e simgE;=2aa0 siml;=2a9d simlE;=2a9f simne;=2246 " +
  "simplus;=2a24 simrarr;=2972 slarr;=2190 SmallCircle;=2218 smallsetminus;=2216 smashp;=2a33 smeparsl;=29e4 " +
  "smid;=2223 smile;=2323 smt;=2aaa smte;=2aac smtes;=2aac.fe00 SOFTcy;=42c softcy;=44c sol;=2f solb;=29c4 " +
  "solbar;=233f Sopf;=1d54a sopf;=1d564 spades;=2660 spadesuit;=2660 spar;=2225 sqcap;=2293 sqcaps;=2293.fe00 " +
  "sqcup;=2294 sqcups;=2294.fe00 Sqrt;=221a sqsub;=228f sqsube;=2291 sqsubset;=228f sqsubseteq;=2291 sqsup;=2290 " +
  "sqsupe;=2292 sqsupset;=2290 sqsupseteq;=2292 squ;=25a1 Square;=25a1 square;=25a1 SquareIntersection;=2293 " +
  "SquareSubset;=228f SquareSubsetEqual;=2291 SquareSuperset;=2290 SquareSupersetEqual;=2292 SquareUnion;=2294 " +
  "squarf;=25aa squf;=25aa srarr;=2192 Sscr;=1d4ae sscr;=1d4c8 ssetmn;=2216 ssmile;=2323 sstarf;=22c6 Star;=22c6 " +
  "star;=2606 starf;=2605 straightepsilon;=3f5 straightphi;=3d5 strns;=af Sub;=22d0 sub;=2282 subdot;=2abd " +
  "subE;=2ac5 sube;=2286 subedot;=2ac3 submult;=2ac1 subnE;=2acb subne;=228a subplus;=2abf subrarr;=2979 " +
  "Subset;=22d0 subset;=2282 subseteq;=2286 subseteqq;=2ac5 SubsetEqual;=2286 subsetneq;=228a subsetneqq;=2acb " +
  "subsim;=2ac7 subsub;=2ad5 subsup;=2ad3 succ;=227b succapprox;=2ab8 succcurlyeq;=227d Succeeds;=227b " +
  "SucceedsEqual;=2ab0 SucceedsSlantEqual;=227d SucceedsTilde;=227f succeq;=2ab0 succnapprox;=2aba " +
  "succneqq;=2ab6 succnsim;=22e9 succsim;=227f SuchThat;=220b Sum;=2211 sum;=2211 sung;=266a sup1=b9 sup1;=b9 " +
  "sup2=b2 sup2;=b2 sup3=b3 sup3;=b3 Sup;=22d1 sup;=2283 supdot;=2abe supdsub;=2ad8 supE;=2ac6 supe;=2287 " +
  "supedot;=2ac4 Superset;=2283 SupersetEqual;=2287 suphsol;=27c9 suphsub;=2ad7 suplarr;=297b supmult;=2ac2 " +
  "supnE;=2acc supne;=228b supplus;=2ac0 Supset;=22d1 supset;=2283 supseteq;=2287 supseteqq;=2ac6 " +
  "supsetneq;=228b supsetneqq;=2acc supsim;=2ac8 supsub;=2ad4 supsup;=2ad6 swarhk;=2926 swArr;=21d9 swarr;=2199 " +
  "swarrow;=2199 swnwar;=292a szlig=df szlig;=df Tab;=9 target;=2316 Tau;=3a4 tau;=3c4 tbrk;=23b4 Tcaron;=164 " +
  "tcaron;=165 Tcedil;=162 tcedil;=163 Tcy;=422 tcy;=442 tdot;=20db telrec;=2315 Tfr;=1d517 tfr;=1d531 " +
  "there4;=2234 Therefore;=2234 therefore;=2234 Theta;=398 theta;=3b8 thetasym;=3d1 thetav;=3d1 " +
  "thickapprox;=2248 thicksim;=223c ThickSpace;=205f.200a thinsp;=2009 ThinSpace;=2009 thkap;=2248 thksim;=223c " +
  "THORN=de thorn=fe THORN;=de thorn;=fe Tilde;=223c tilde;=2dc TildeEqual;=2243 TildeFullEqual;=2245 " +
  "TildeTilde;=2248 times=d7 times;=d7 timesb;=22a0 timesbar;=2a31 timesd;=2a30 tint;=222d toea;=2928 top;=22a4 " +
  "topbot;=2336 topcir;=2af1 Topf;=1d54b topf;=1d565 topfork;=2ada tosa;=2929 tprime;=2034 TRADE;=2122 " +
  "trade;=2122 triangle;=25b5 triangledown;=25bf triangleleft;=25c3 trianglelefteq;=22b4 triangleq;=225c " +
  "triangleright;=25b9 trianglerighteq;=22b5 tridot;=25ec trie;=225c triminus;=2a3a TripleDot;=20db " +
  "triplus;=2a39 trisb;=29cd tritime;=2a3b trpezium;=23e2 Tscr;=1d4af tscr;=1d4c9 TScy;=426 tscy;=446 TSHcy;=40b " +
  "tshcy;=45b Tstrok;=166 tstrok;=167 twixt;=226c twoheadleftarrow;=219e twoheadrightarrow;=21a0 Uacute=da " +
  "uacute=fa Uacute;=da uacute;=fa Uarr;=219f uArr;=21d1 uarr;=2191 Uarrocir;=2949 Ubrcy;=40e ubrcy;=45e " +
  "Ubreve;=16c ubreve;=16d Ucirc=db ucirc=fb Ucirc;=db ucirc;=fb Ucy;=423 ucy;=443 udarr;=21c5 Udblac;=170 " +
  "udblac;=171 udhar;=296e ufisht;=297e Ufr;=1d518 ufr;=1d532 Ugrave=d9 ugrave=f9 Ugrave;=d9 ugrave;=f9 " +
  "uHar;=2963 uharl;=21bf uharr;=21be uhblk;=2580 ulcorn;=231c ulcorner;=231c ulcrop;=230f ultri;=25f8 " +
  "Umacr;=16a umacr;=16b uml=a8 uml;=a8 UnderBar;=5f UnderBrace;=23df UnderBracket;=23b5 UnderParenthesis;=23dd " +
  "Union;=22c3 UnionPlus;=228e Uogon;=172 uogon;=173 Uopf;=1d54c uopf;=1d566 UpArrow;=2191 Uparrow;=21d1 " +
  "uparrow;=2191 UpArrowBar;=2912 UpArrowDownArrow;=21c5 UpDownArrow;=2195 Updownarrow;=21d5 updownarrow;=2195 " +
  "UpEquilibrium;=296e upharpoonleft;=21bf upharpoonright;=21be uplus;=228e UpperLeftArrow;=2196 " +
  "UpperRightArrow;=2197 Upsi;=3d2 upsi;=3c5 upsih;=3d2 Upsilon;=3a5 upsilon;=3c5 UpTee;=22a5 UpTeeArrow;=21a5 " +
  "upuparrows;=21c8 urcorn;=231d urcorner;=231d urcrop;=230e Uring;=16e uring;=16f urtri;=25f9 Uscr;=1d4b0 " +
  "uscr;=1d4ca utdot;=22f0 Utilde;=168 utilde;=169 utri;=25b5 utrif;=25b4 uuarr;=21c8 Uuml=dc uuml=fc Uuml;=dc " +
  "uuml;=fc uwangle;=29a7 vangrt;=299c varepsilon;=3f5 varkappa;=3f0 varnothing;=2205 varphi;=3d5 varpi;=3d6 " +
  "varpropto;=221d vArr;=21d5 varr;=2195 varrho;=3f1 varsigma;=3c2 varsubsetneq;=228a.fe00 " +
  "varsubsetneqq;=2acb.fe00 varsupsetneq;=228b.fe00 varsupsetneqq;=2acc.fe00 vartheta;=3d1 vartriangleleft;=22b2 " +
  "vartriangleright;=22b3 Vbar;=2aeb vBar;=2ae8 vBarv;=2ae9 Vcy;=412 vcy;=432 VDash;=22ab Vdash;=22a9 " +
  "vDash;=22a8 vdash;=22a2 Vdashl;=2ae6 Vee;=22c1 vee;=2228 veebar;=22bb veeeq;=225a vellip;=22ee Verbar;=2016 " +
  "verbar;=7c Vert;=2016 vert;=7c VerticalBar;=2223 VerticalLine;=7c VerticalSeparator;=2758 VerticalTilde;=2240 " +
  "VeryThinSpace;=200a Vfr;=1d519 vfr;=1d533 vltri;=22b2 vnsub;=2282.20d2 vnsup;=2283.20d2 Vopf;=1d54d " +
  "vopf;=1d567 vprop;=221d vrtri;=22b3 Vscr;=1d4b1 vscr;=1d4cb vsubnE;=2acb.fe00 vsubne;=228a.fe00 " +
  "vsupnE;=2acc.fe00 vsupne;=228b.fe00 Vvdash;=22aa vzigzag;=299a Wcirc;=174 wcirc;=175 wedbar;=2a5f Wedge;=22c0 " +
  "wedge;=2227 wedgeq;=2259 weierp;=2118 Wfr;=1d51a wfr;=1d534 Wopf;=1d54e wopf;=1d568 wp;=2118 wr;=2240 " +
  "wreath;=2240 Wscr;=1d4b2 wscr;=1d4cc xcap;=22c2 xcirc;=25ef xcup;=22c3 xdtri;=25bd Xfr;=1d51b xfr;=1d535 " +
  "xhArr;=27fa xharr;=27f7 Xi;=39e xi;=3be xlArr;=27f8 xlarr;=27f5 xmap;=27fc xnis;=22fb xodot;=2a00 Xopf;=1d54f " +
  "xopf;=1d569 xoplus;=2a01 xotime;=2a02 xrArr;=27f9 xrarr;=27f6 Xscr;=1d4b3 xscr;=1d4cd xsqcup;=2a06 " +
  "xuplus;=2a04 xutri;=25b3 xvee;=22c1 xwedge;=22c0 Yacute=dd yacute=fd Yacute;=dd yacute;=fd YAcy;=42f " +
  "yacy;=44f Ycirc;=176 ycirc;=177 Ycy;=42b ycy;=44b yen=a5 yen;=a5 Yfr;=1d51c yfr;=1d536 YIcy;=407 yicy;=457 " +
  "Yopf;=1d550 yopf;=1d56a Yscr;=1d4b4 yscr;=1d4ce YUcy;=42e yucy;=44e yuml=ff Yuml;=178 yuml;=ff Zacute;=179 " +
  "zacute;=17a Zcaron;=17d zcaron;=17e Zcy;=417 zcy;=437 Zdot;=17b zdot;=17c zeetrf;=2128 ZeroWidthSpace;=200b " +
  "Zeta;=396 zeta;=3b6 Zfr;=2128 zfr;=1d537 ZHcy;=416 zhcy;=436 zigrarr;=21dd Zopf;=2124 zopf;=1d56b Zscr;=1d4b5 " +
  "zscr;=1d4cf zwj;=200d zwnj;=200c ");

if (isMain()) process.exitCode = main();
