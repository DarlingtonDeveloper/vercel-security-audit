#!/usr/bin/env node
/**
 * Render sanitised audit Markdown as offline, styled HTML.
 *
 * Node standard library only. No network, JavaScript, raw HTML, images or subprocesses.
 * This renderer is not a secret scanner: review and sanitise the source first.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

// Reads use primitives captured at load, as Python reads via io.open rather than os.open;
// publishing looks fs.* up at call time so platform gaps can be simulated in tests.
const READ = Object.freeze({
  open: fs.openSync, read: fs.readSync, close: fs.closeSync,
});

/** Read at most limit bytes (all when limit is omitted) from a file. */
function readBytes(file, limit = Infinity) {
  const descriptor = READ.open(file, "r");
  try {
    const chunks = [];
    let total = 0;
    while (total < limit) {
      const chunk = Buffer.alloc(Math.min(65536, limit - total));
      const count = READ.read(descriptor, chunk, 0, chunk.length, null);
      if (count === 0) break;
      chunks.push(chunk.subarray(0, count));
      total += count;
    }
    return Buffer.concat(chunks, total);
  } finally {
    READ.close(descriptor);
  }
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS = path.join(path.resolve(SCRIPT_DIR, ".."), "assets");
export const MAX_BYTES = 2_000_000;
export const FONT_FILES = Object.freeze([
  Object.freeze(["Geist", "400", "Geist-Regular.woff2"]),
  Object.freeze(["Geist", "600", "Geist-SemiBold.woff2"]),
  Object.freeze(["Geist Mono", "400", "GeistMono-Regular.woff2"]),
]);
/** key -> [label, css class]; insertion order matches the Python dict. */
export const STATUSES = Object.freeze({
  satisfactory: Object.freeze(["Satisfactory", "good"]),
  action_recommended: Object.freeze(["Action recommended", "action"]),
  needs_confirmation: Object.freeze(["Needs confirmation", "unknown"]),
  not_reviewed: Object.freeze(["Not reviewed", "unreviewed"]),
  not_applicable: Object.freeze(["Not applicable", "na"]),
});
// Fixed suffix for a status matrix Check cell whose setting the owner accepted (#80).
// The status cell stays needs_confirmation; check-report.mjs validates the pairing.
export const OWNER_ACCEPTED_MARKER = "(owner-accepted)";
export const GENERIC_FAILURE = "Could not render report. Check the sanitised Markdown, bundled assets "
  + "and new output path. Existing files were preserved.";

/** True when key is one of STATUSES' own keys (never inherited properties). */
export function isStatus(key) {
  return typeof key === "string" && Object.hasOwn(STATUSES, key);
}

/**
 * Authored, value-free diagnostics: literal messages only, safe to print.
 * Never format source text, keys, paths or evidence into these messages.
 */
export class ReportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReportError";
  }
}

// C library strerror() text, as Python's OSError.strerror reports it.
const STRERROR = {
  EPERM: "Operation not permitted", ENOENT: "No such file or directory", ESRCH: "No such process",
  EINTR: "Interrupted system call", EIO: "Input/output error", ENXIO: "Device not configured",
  E2BIG: "Argument list too long", EBADF: "Bad file descriptor", EAGAIN: "Resource temporarily unavailable",
  ENOMEM: "Cannot allocate memory", EACCES: "Permission denied", EFAULT: "Bad address",
  EBUSY: "Resource busy", EEXIST: "File exists", EXDEV: "Cross-device link",
  ENODEV: "Operation not supported by device", ENOTDIR: "Not a directory", EISDIR: "Is a directory",
  EINVAL: "Invalid argument", ENFILE: "Too many open files in system", EMFILE: "Too many open files",
  ETXTBSY: "Text file busy", EFBIG: "File too large", ENOSPC: "No space left on device",
  ESPIPE: "Illegal seek", EROFS: "Read-only file system", EMLINK: "Too many links",
  ENAMETOOLONG: "File name too long", ELOOP: "Too many levels of symbolic links",
  ENOTEMPTY: "Directory not empty", EDQUOT: "Disc quota exceeded", ESTALE: "Stale NFS file handle",
  ENOSYS: "Function not implemented", ENOTSUP: "Operation not supported",
  EOPNOTSUPP: "Operation not supported on socket", ECONNREFUSED: "Connection refused",
};
const STRERROR_LINUX = {
  ENXIO: "No such device or address", EBUSY: "Device or resource busy", EXDEV: "Invalid cross-device link",
  ENODEV: "No such device", EDQUOT: "Disk quota exceeded", ESTALE: "Stale file handle",
  EOPNOTSUPP: "Operation not supported",
};

function strerror(error) {
  if (error === null || typeof error !== "object") return null;
  if (typeof error.strerror === "string" && error.strerror) return error.strerror;
  const code = typeof error.code === "string" ? error.code : null;
  if (code) {
    if (process.platform === "linux" && Object.hasOwn(STRERROR_LINUX, code)) return STRERROR_LINUX[code];
    if (Object.hasOwn(STRERROR, code)) return STRERROR[code];
    // Node system errors read "CODE: reason, syscall 'path'"; keep only the reason.
    const match = typeof error.message === "string" && /^[A-Z0-9_]+: ([^,]+)/.exec(error.message);
    if (match) return match[1].charAt(0).toUpperCase() + match[1].slice(1);
  }
  return null;
}

/** Name the failing path role and OS reason without echoing the path. */
export function describeOsError(role, error) {
  const reason = strerror(error) || "I/O error";
  return `The ${role} could not be used (${reason}).`;
}

/** True for a Node system error (the equivalent of Python's OSError). */
export function isOsError(error) {
  return error instanceof Error && !(error instanceof ReportError)
    && typeof error.code === "string" && (typeof error.errno === "number" || typeof error.syscall === "string");
}

// ---- Python str semantics -------------------------------------------------

// Characters for which Python's str.isspace() (and re's \s) is true.
export const PY_WS = "\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const STRIP_RE = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "g");

/** Python str.strip() with no arguments. */
export function pyStrip(text) {
  return text.replace(STRIP_RE, "");
}

/** Python str.splitlines() without keepends. */
export function splitLines(text) {
  if (text === "") return [];
  const lines = text.split(/\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Python html.escape(text, quote=True). */
export function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

function codePointLength(text) {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

// ---- Links ------------------------------------------------------------------

function partition(text, separator) {
  const index = text.indexOf(separator);
  return index < 0 ? [text, "", ""] : [text.slice(0, index), separator, text.slice(index + separator.length)];
}

function rpartition(text, separator) {
  const index = text.lastIndexOf(separator);
  return index < 0 ? ["", "", text] : [text.slice(0, index), separator, text.slice(index + separator.length)];
}

function validIPv4(text) {
  if (!text) return false;
  const octets = text.split(".");
  if (octets.length !== 4) return false;
  return octets.every((octet) => /^[0-9]{1,3}$/.test(octet) && !(octet.length > 1 && octet[0] === "0")
    && Number(octet) <= 255);
}

/** Python ipaddress.IPv6Address acceptance (including a %scope suffix). */
function validIPv6(text) {
  const [address, separator, scope] = partition(text, "%");
  if (separator && (!scope || scope.includes("%"))) return false;
  if (!address || codePointLength(address) > 45) return false;
  let parts = address.split(":");
  if (parts.length < 3) return false;
  if (parts[parts.length - 1].includes(".")) {
    if (!validIPv4(parts.pop())) return false;
    parts.push("0", "0");
  }
  if (parts.length > 9) return false;
  let skip = null;
  for (let index = 1; index < parts.length - 1; index += 1) {
    if (!parts[index]) {
      if (skip !== null) return false;
      skip = index;
    }
  }
  let high, low;
  if (skip !== null) {
    high = skip;
    low = parts.length - skip - 1;
    if (!parts[0]) {
      high -= 1;
      if (high) return false;
    }
    if (!parts[parts.length - 1]) {
      low -= 1;
      if (low) return false;
    }
    if (8 - (high + low) < 1) return false;
  } else {
    if (parts.length !== 8 || !parts[0] || !parts[parts.length - 1]) return false;
    high = parts.length;
    low = 0;
  }
  parts = parts.slice(0, high).concat(low ? parts.slice(parts.length - low) : []);
  return parts.every((part) => /^[0-9a-fA-F]{0,4}$/.test(part));
}

/** Throws where Python's urlsplit(value) raises ValueError; returns the split parts. */
function urlSplit(value) {
  let url = value;
  let scheme = "";
  let netloc = "";
  let query = "";
  const colon = url.indexOf(":");
  if (colon > 0 && /^[A-Za-z]/.test(url) && /^[A-Za-z0-9+.-]+$/.test(url.slice(0, colon))) {
    scheme = url.slice(0, colon).toLowerCase();
    url = url.slice(colon + 1);
  }
  if (url.slice(0, 2) === "//") {
    let end = url.length;
    for (const delimiter of "/?#") {
      const found = url.indexOf(delimiter, 2);
      if (found >= 0) end = Math.min(end, found);
    }
    netloc = url.slice(2, end);
    url = url.slice(end);
    const open = netloc.includes("["), close = netloc.includes("]");
    if (open !== close) throw new Error("Invalid IPv6 URL");
    if (open && close) {
      const hostAndPort = rpartition(netloc, "@")[2];
      const [before, haveOpen, bracketed] = partition(hostAndPort, "[");
      let hostname;
      if (haveOpen) {
        if (before) throw new Error("Invalid IPv6 URL");
        let port;
        [hostname, , port] = partition(bracketed, "]");
        if (port && !port.startsWith(":")) throw new Error("Invalid IPv6 URL");
      } else {
        hostname = partition(hostAndPort, ":")[0];
      }
      if (hostname.startsWith("v")) {
        if (!/^v[a-fA-F0-9]+\.[^\n]+$/.test(hostname)) throw new Error("IPvFuture address is invalid");
      } else if (!validIPv6(hostname)) {
        throw new Error("Invalid IPv6 address");
      }
    }
  }
  if (url.includes("#")) url = partition(url, "#")[0];
  if (url.includes("?")) query = partition(url, "?")[2];
  if (netloc && /[^\x00-\x7f]/.test(netloc)) {
    const stripped = netloc.replace(/[@:#?]/g, "");
    const normalised = stripped.normalize("NFKC");
    if (stripped !== normalised && /[/?#@:]/.test(normalised)) throw new Error("Invalid netloc");
  }
  return { scheme, netloc, query };
}

/** Only credential-free HTTPS or same-document anchors; never fetch anything. */
export function safeLink(value) {
  if (typeof value !== "string" || !value || /[\x00-\x20\x7f\\]/.test(value)) return null;
  if (/^#[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) return value;
  let url;
  try {
    url = urlSplit(value);
  } catch {
    return null;
  }
  if (url.scheme !== "https") return null;
  const [userinfo, haveInfo, hostinfo] = rpartition(url.netloc, "@");
  void userinfo;
  if (haveInfo) return null; // username is not None (even when empty)
  const [, haveOpen, bracketed] = partition(hostinfo, "[");
  let hostname, port;
  if (haveOpen) {
    [hostname, , port] = partition(bracketed, "]");
    port = partition(port, ":")[2];
  } else {
    [hostname, , port] = partition(hostinfo, ":");
  }
  if (!hostname || url.query) return null;
  if (port) {
    if (!/^[0-9]+$/.test(port)) return null;
    const number = Number(port);
    if (number > 65535 || number !== 443) return null;
  }
  // Percent-encoded URL structure may hide credentials, whitespace or a query.
  if (/%(?:0[0-9a-f]|1[0-9a-f]|20|3a|3f|40|5c|7f)/i.test(value)) return null;
  return value;
}

// ---- Markdown -----------------------------------------------------------------

export const INLINE = /`[^`\n]+`|!\[[^\]\n]*\]\([^)\n]*\)|\[[^\]\n]+\]\([^)\n]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*/g;

export function inline(text) {
  const parts = [];
  let start = 0;
  for (const match of text.matchAll(INLINE)) {
    parts.push(escapeHtml(text.slice(start, match.index)));
    const token = match[0];
    if (token.startsWith("`")) {
      parts.push("<code>" + escapeHtml(token.slice(1, -1)) + "</code>");
    } else if (token.startsWith("![")) {
      parts.push('<span class="omitted-image">[Image omitted from offline report]</span>');
    } else if (token.startsWith("[")) {
      const [label, , value] = partition(token.slice(1), "](");
      const href = safeLink(value.slice(0, -1));
      parts.push(href
        ? '<a href="' + escapeHtml(href) + '" rel="noopener noreferrer">' + escapeHtml(label) + "</a>"
        : escapeHtml(label) + " [link omitted]");
    } else if (token.startsWith("**")) {
      parts.push("<strong>" + escapeHtml(token.slice(2, -2)) + "</strong>");
    } else {
      parts.push("<em>" + escapeHtml(token.slice(1, -1)) + "</em>");
    }
    start = match.index + token.length;
  }
  parts.push(escapeHtml(text.slice(start)));
  return parts.join("");
}

const STATUS_LINE = new RegExp(`^(?:\\*\\*)?Status:(?:\\*\\*)?[${PY_WS}]*([a-z_]+)\\.?$`);

function badge(key) {
  const [label, css] = STATUSES[key];
  return '<span class="status-badge status-' + css + '">' + label + "</span>";
}

export function textLine(text) {
  const status = STATUS_LINE.exec(pyStrip(text));
  if (status && isStatus(status[1])) return badge(status[1]);
  return inline(text);
}

export const MAX_TABLE_COLUMNS = 16;
export const TABLE_ROW = /^\|[^\n]*\|$/;
export const TABLE_SEPARATOR = /^\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+$/;

/** Split a pipe row on unescaped pipes; a backslash-escaped pipe is literal. */
export function tableCells(row) {
  const cells = [];
  let current = "";
  let index = 1;
  while (index < row.length - 1) {
    if (row[index] === "\\" && row[index + 1] === "|" && index + 1 < row.length - 1) {
      current += "|";
      index += 2;
      continue;
    }
    if (row[index] === "|") {
      cells.push(pyStrip(current));
      current = "";
    } else {
      current += row[index];
    }
    index += 1;
  }
  cells.push(pyStrip(current));
  return cells;
}

/** Inline Markdown only; a cell holding exactly one status key becomes its badge. */
export function tableCell(text) {
  if (isStatus(text)) return badge(text);
  return text ? textLine(text) : "";
}

export function renderTable(header, rows) {
  const columns = header.length;
  if (columns > MAX_TABLE_COLUMNS) throw new ReportError("Tables may have at most 16 columns.");
  if (!rows.length) throw new ReportError("Tables need at least one body row.");
  if (rows.some((row) => row.length !== columns)) {
    throw new ReportError("Each table row needs the same number of cells as its header.");
  }
  const parts = ['<div class="table-wrap"><table><thead><tr>'];
  for (const cell of header) parts.push('<th scope="col">' + inline(cell) + "</th>");
  parts.push("</tr></thead><tbody>");
  for (const row of rows) {
    parts.push("<tr>" + row.map((cell) => "<td>" + tableCell(cell) + "</td>").join("") + "</tr>");
  }
  parts.push("</tbody></table></div>");
  return parts.join("");
}

function countOf(text, character) {
  return text.split(character).length - 1;
}

const FENCE = /^```[a-zA-Z0-9_+-]*$/;
const BLOCK_START = /^(?:#{1,6} |[-*] |\p{Nd}+[.)] |>|---$|<!-- pagebreak -->$)/u;
const HEADING = new RegExp(`^(#{1,6})[${PY_WS}]+([^\\n]+)$`);
const LIST_ITEM = new RegExp(`^(?:([-*])[${PY_WS}]+|([0-9]+)[.)][${PY_WS}]+)([^\\n]+)$`);

/** Small documented Markdown subset, escaped by construction; no raw HTML. Returns [title, body, nav]. */
export function markdownBody(source) {
  const lines = splitLines(source);
  if (!lines.length || !lines[0].startsWith("# ") || !pyStrip(lines[0].slice(2))) {
    throw new ReportError("The Markdown report must start with one report title (# Title).");
  }
  const title = pyStrip(lines[0].slice(2));
  if (codePointLength(title) > 240) throw new ReportError("The report title is too long.");
  const output = [], navigation = [], identifiers = new Map();
  const usedIdentifiers = new Set(["report-main"]);
  let sectionOpen = false, articleOpen = false, recommendations = false;
  let listKind = null, fence = false;
  const paragraph = [], code = [];
  let table = null, skipSeparator = false;

  const flushParagraph = () => {
    if (paragraph.length) {
      output.push("<p>" + paragraph.map((line) => textLine(pyStrip(line))).join("<br>") + "</p>");
      paragraph.length = 0;
    }
  };
  const closeTable = () => {
    if (table !== null) {
      output.push(renderTable(table[0], table.slice(1)));
      table = null;
    }
  };
  const closeList = () => {
    if (listKind) {
      output.push("</" + listKind + ">");
      listKind = null;
    }
  };
  const closeArticle = () => {
    if (articleOpen) {
      output.push("</article>");
      articleOpen = false;
    }
  };
  const identifier = (text) => {
    const base = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "section";
    let count = (identifiers.get(base) || 0) + 1;
    let candidate = count === 1 ? base : `${base}-${count}`;
    while (usedIdentifiers.has(candidate)) {
      count += 1;
      candidate = `${base}-${count}`;
    }
    identifiers.set(base, count);
    usedIdentifiers.add(candidate);
    return candidate;
  };

  for (let position = 1; position < lines.length; position += 1) {
    const line = lines[position];
    const stripped = pyStrip(line);
    if (skipSeparator) {
      skipSeparator = false;
      continue;
    }
    if (table !== null) {
      if (stripped.startsWith("|")) {
        if (!TABLE_ROW.test(stripped)) throw new ReportError("Table rows must start and end with a pipe.");
        table.push(tableCells(stripped));
        continue;
      }
      closeTable();
    }
    if (!fence && TABLE_ROW.test(stripped)) {
      const following = position + 1 < lines.length ? pyStrip(lines[position + 1]) : "";
      if (TABLE_SEPARATOR.test(following)) {
        flushParagraph();
        closeList();
        const header = tableCells(stripped);
        if (header.length !== countOf(following, "|") - 1) {
          throw new ReportError("A table separator needs one cell per header cell.");
        }
        table = [header];
        skipSeparator = true;
        continue;
      }
    }
    if (FENCE.test(stripped)) {
      flushParagraph();
      closeList();
      if (fence) {
        output.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
        code.length = 0;
      }
      fence = !fence;
      continue;
    }
    if (fence) {
      code.push(line);
      continue;
    }
    if (!stripped) {
      flushParagraph();
      closeList();
      continue;
    }
    if (BLOCK_START.test(stripped)) flushParagraph();
    const heading = HEADING.exec(stripped);
    if (heading) {
      closeList();
      const level = Math.max(2, heading[1].length);
      const text = heading[2];
      const anchor = identifier(text);
      if (level === 2) {
        closeArticle();
        if (sectionOpen) output.push("</section>");
        const lower = text.toLowerCase();
        recommendations = pyStrip(lower) === "recommendations";
        let classes = "report-section";
        if (lower.includes("initial priorities")) classes += " initial-priorities";
        if (lower.startsWith("appendix")) classes += " appendix";
        output.push('<section class="' + classes + '" id="' + anchor + '">');
        sectionOpen = true;
        navigation.push('<li><a href="#' + anchor + '">' + escapeHtml(text) + "</a></li>");
      } else if (level === 3 && recommendations) {
        closeArticle();
        output.push('<article class="recommendation" id="' + anchor + '">');
        articleOpen = true;
      }
      output.push(`<h${level}>` + inline(text) + `</h${level}>`);
      continue;
    }
    if (stripped === "<!-- pagebreak -->") {
      closeList();
      output.push('<div class="page-break" aria-hidden="true"></div>');
      continue;
    }
    if (stripped === "---") {
      closeList();
      output.push("<hr>");
      continue;
    }
    const item = LIST_ITEM.exec(stripped);
    if (item) {
      const kind = item[1] ? "ul" : "ol";
      if (kind !== listKind) {
        closeList();
        output.push("<" + kind + ">");
        listKind = kind;
      }
      const value = kind === "ol" ? ' value="' + item[2] + '"' : "";
      output.push("<li" + value + ">" + textLine(item[3]) + "</li>");
      continue;
    }
    closeList();
    if (stripped.startsWith(">")) {
      output.push("<blockquote><p>" + inline(pyStrip(stripped.slice(1))) + "</p></blockquote>");
    } else {
      paragraph.push(line);
    }
  }
  if (fence) throw new ReportError("Close all fenced code blocks before rendering.");
  closeTable();
  flushParagraph();
  closeList();
  closeArticle();
  if (sectionOpen) output.push("</section>");
  return [title, output.join("\n"), "<ul>" + navigation.join("") + "</ul>"];
}

/** Path.read_text(encoding="utf-8"): strict UTF-8 with universal newlines. */
function readText(file) {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readBytes(file));
  return text.replace(/\r\n?/g, "\n");
}

export function renderReport(source, language = "en") {
  if (typeof language !== "string" || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) {
    throw new ReportError("Use a valid report language tag.");
  }
  if (typeof source !== "string" || source.includes("\x00")) {
    throw new ReportError("Report input is invalid or exceeds 2 MB.");
  }
  // Python's str.encode("utf-8") raises (a ValueError) on lone surrogates.
  if (!source.isWellFormed()) throw new ReportError("Report input is invalid or exceeds 2 MB.");
  if (Buffer.byteLength(source, "utf8") > MAX_BYTES) throw new ReportError("Report input is invalid or exceeds 2 MB.");
  const [title, body, navigation] = markdownBody(source);
  const fonts = [];
  for (const [family, weight, filename] of FONT_FILES) {
    const data = readBytes(path.join(ASSETS, "fonts", filename));
    if (data.subarray(0, 4).toString("latin1") !== "wOF2") throw new ReportError("Bundled font data is invalid.");
    const encoded = data.toString("base64");
    fonts.push("@font-face{font-family:'" + family + "';font-style:normal;font-weight:" + weight
      + ";font-display:swap;src:url(data:font/woff2;base64," + encoded + ") format('woff2');}");
  }
  const template = readText(path.join(ASSETS, "report.html"));
  const style = fonts.join("\n") + "\n" + readText(path.join(ASSETS, "report.css"));
  const licence = ["OFL.txt", "LICENSE.txt"].map((name) => readText(path.join(ASSETS, "fonts", name))).join("\n\n");
  const values = {
    LANG: language, TITLE: escapeHtml(title), STYLE: style, NAV: navigation, BODY: body,
    FONT_LICENCE: escapeHtml(licence),
  };
  const found = new Set(Array.from(template.matchAll(/\{\{([A-Z_]+)\}\}/g), (match) => match[1]));
  const expected = Object.keys(values);
  if (found.size !== expected.length || !expected.every((key) => found.has(key))) {
    throw new ReportError("Report template placeholders are invalid.");
  }
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => values[key]);
}

// ---- Publishing -------------------------------------------------------------------

// link(2) errors meaning "this filesystem has no hard links here", not "path taken".
export const LINK_UNSUPPORTED_CODES = Object.freeze(new Set(["EPERM", "EXDEV", "ENOTSUP", "EOPNOTSUPP"]));

/**
 * True when a failed link should fall back to exclusive create.
 * An existing target is never a fallback case: it is refused as before.
 */
export function linkUnsupported(error, platform = process.platform) {
  if (error && error.code === "EEXIST") return false;
  return platform === "win32" || Boolean(error && LINK_UNSUPPORTED_CODES.has(error.code));
}

// Staging writes (Python: os.fdopen stream) and exclusive writes (Python: os.write) use
// distinct primitives, so each path's failures can be simulated separately.
function writeStaged(descriptor, data) {
  let offset = 0;
  while (offset < data.length) offset += fs.writevSync(descriptor, [data.subarray(offset)]);
}

function writeAll(descriptor, data) {
  let offset = 0;
  while (offset < data.length) offset += fs.writeSync(descriptor, data, offset, data.length - offset);
}

function makeStaging(directory) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const name = path.join(directory, ".report-" + randomBytes(6).toString("hex") + ".tmp");
    try {
      return [fs.openSync(name, "wx", 0o600), name];
    } catch (error) {
      if (error && error.code === "EEXIST") continue;
      throw error;
    }
  }
  const error = new Error("EEXIST: No usable temporary file name found");
  error.code = "EEXIST";
  error.errno = -17;
  throw error;
}

/** Stage private bytes, then link to the fresh path. False: no hard links. */
function publishLinked(target, data) {
  const [descriptor, staging] = makeStaging(path.dirname(target));
  try {
    try {
      if (typeof fs.fchmodSync === "function") fs.fchmodSync(descriptor, 0o600);
      writeStaged(descriptor, data);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    try {
      fs.linkSync(staging, target);
    } catch (error) {
      if (linkUnsupported(error)) return false;
      throw error;
    }
    return true;
  } finally {
    fs.unlinkSync(staging);
  }
}

/** Create the fresh path exclusively; remove only the file this call created. */
function publishExclusive(target, data) {
  const descriptor = fs.openSync(target, "wx", 0o600); // EEXIST: refused, untouched.
  try {
    try {
      writeAll(descriptor, data);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (error) {
    fs.unlinkSync(target);
    throw error;
  }
}

/**
 * Publish bytes to a fresh path, never replacing an existing file.
 *
 * Where hard links work, bytes are staged privately and linked into place:
 * readers never see a partial file and same-path writers race on link(2), so
 * exactly one wins. Where the filesystem or platform has no hard links, the
 * file is created with O_CREAT|O_EXCL instead, which still refuses an existing
 * path but is not atomic for concurrent readers. Either way a failed write
 * leaves nothing at the destination, so a retry at the same path works.
 * Requires a trusted, local, private output directory.
 */
export function publishNew(target, data) {
  const file = target instanceof URL ? fileURLToPath(target) : String(target);
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  try {
    if (typeof fs.linkSync !== "function" || !publishLinked(file, bytes)) publishExclusive(file, bytes);
  } catch (error) {
    // A platform without a needed fs primitive (Python: AttributeError): report it, never a trace.
    if (error instanceof TypeError && !isOsError(error)) {
      throw new ReportError("This platform cannot create a new private output file.");
    }
    throw error;
  }
}

// ---- CLI ----------------------------------------------------------------------------

const PROG = "render-report.mjs";
const USAGE = `usage: ${PROG} [-h] [--lang LANG] -o OUTPUT source`;
const HELP = `${USAGE}

Render sanitised audit Markdown as offline, styled HTML. Node standard library
only. No network, JavaScript, raw HTML, images or subprocesses. This renderer is
not a secret scanner: review and sanitise the source first.

positional arguments:
  source               Sanitised Markdown report

options:
  -h, --help           show this help message and exit
  --lang LANG          Document language tag, such as en or fr; shell labels
                       remain English
  -o, --output OUTPUT  New self-contained HTML file; existing files are never
                       overwritten
`;

class UsageError extends Error {}

/** A small argparse equivalent for this CLI's flags (with long-option prefixes). */
function parseArguments(argv) {
  const options = { lang: "en", output: null };
  const positionals = [];
  const longOptions = { "--lang": "lang", "--output": "output", "--help": "help" };
  let onlyPositionals = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (onlyPositionals || argument === "-" || !argument.startsWith("-") || /^-\d+$|^-\d*\.\d+$/.test(argument)) {
      positionals.push(argument);
      continue;
    }
    if (argument === "--") {
      onlyPositionals = true;
      continue;
    }
    let name, inlineValue = null;
    if (argument.startsWith("--")) {
      const [flag, equals, rest] = partition(argument, "=");
      if (equals) inlineValue = rest;
      const matches = Object.keys(longOptions).filter((option) => option.startsWith(flag));
      if (Object.hasOwn(longOptions, flag)) name = longOptions[flag];
      else if (matches.length === 1) name = longOptions[matches[0]];
      else if (matches.length > 1) {
        throw new UsageError(`ambiguous option: ${flag} could match ${matches.join(", ")}`);
      } else throw new UsageError(`unrecognized arguments: ${argument}`);
    } else if (argument.startsWith("-h")) {
      name = "help";
      if (argument.length > 2) throw new UsageError(`argument -h/--help: ignored explicit argument '${argument.slice(2)}'`);
    } else if (argument.startsWith("-o")) {
      name = "output";
      if (argument.length > 2) inlineValue = argument.slice(2).replace(/^=/, "");
    } else {
      throw new UsageError(`unrecognized arguments: ${argument}`);
    }
    if (name === "help") {
      if (inlineValue !== null) throw new UsageError(`argument -h/--help: ignored explicit argument '${inlineValue}'`);
      return { help: true };
    }
    const label = name === "lang" ? "--lang" : "-o/--output";
    const metavar = name === "lang" ? "LANG" : "OUTPUT";
    let value = inlineValue;
    if (value === null) {
      const next = argv[index + 1];
      if (next === undefined || (next.startsWith("-") && next !== "-" && !/^-\d+$|^-\d*\.\d+$/.test(next))) {
        throw new UsageError(`argument ${label}: expected one argument`);
      }
      value = next;
      index += 1;
    }
    void metavar;
    options[name] = value;
  }
  const missing = [];
  if (positionals.length < 1) missing.push("source");
  if (options.output === null) missing.push("-o/--output");
  if (missing.length) throw new UsageError(`the following arguments are required: ${missing.join(", ")}`);
  if (positionals.length > 1) throw new UsageError(`unrecognized arguments: ${positionals.slice(1).join(" ")}`);
  return { source: positionals[0], lang: options.lang, output: options.output };
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
  let role = "source file";
  try {
    const data = readBytes(args.source, MAX_BYTES + 1);
    if (data.length > MAX_BYTES) throw new ReportError("Report input exceeds 2 MB.");
    let source;
    try {
      source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
    } catch {
      // The decoder's own message may quote input; keep it out of stderr.
      throw new ReportError("The Markdown report must be UTF-8 text.");
    }
    role = "bundled assets";
    const document = renderReport(source, args.lang);
    role = "output path";
    publishNew(args.output, Buffer.from(document, "utf8"));
  } catch (error) {
    if (error instanceof ReportError) {
      process.stderr.write(`Could not render report: ${error.message} Existing files were preserved.\n`);
      return 1;
    }
    if (isOsError(error)) {
      process.stderr.write(`Could not render report: ${describeOsError(role, error)} `
        + "Output paths must be new. Existing files were preserved.\n");
      return 1;
    }
    process.stderr.write(GENERIC_FAILURE + "\n");
    return 1;
  }
  process.stdout.write("Offline HTML report created. Review it before sharing or printing to PDF.\n");
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

if (isMain()) process.exitCode = main();
