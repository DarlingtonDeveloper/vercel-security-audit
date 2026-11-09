// Offline structural QA through the checker CLI; synthetic reports only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { renderReport } from "../skills/vercel-security-audit/scripts/render-report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = path.join(ROOT, "skills", "vercel-security-audit");
const CHECKER = path.join(SKILL, "scripts", "check-report.mjs");

// Literal expectations independent of the checker's checklist discovery.
const CORE = ["IAM", "CRE", "DEP", "FWB", "SRC", "SEC", "DOM", "OPS"]
  .flatMap((domain) => [1, 2, 3].map((number) => `${domain}-${String(number).padStart(2, "0")}`));
const OPTIONAL = ["DEP-04", "SRC-04", "SEC-04", "OPS-04"];
const STATES = ["satisfactory", "action_recommended", "needs_confirmation", "not_reviewed", "not_applicable"];
const zip = (keys, values) => Object.fromEntries(keys.map((key, index) => [key, values[index]]));
const SUMMARY = {
  core: zip(STATES, [5, 5, 5, 5, 4]),
  optional: zip(STATES, [0, 0, 0, 4, 0]),
};

const MATRIX = "| Check | Team | `example-site` |\n| --- | --- | --- |\n"
  + "| IAM-01 | satisfactory | Team-wide |\n| DEP-01 | By project | action_recommended |\n"
  + "| OPS-01 | Status: not_applicable | not_reviewed |\n";

/** Every check, matching the appendix; two rows use project-level columns. */
function fullMatrix() {
  const rows = new Map(CORE.map((topic, index) => [topic, `| ${topic} | ${STATES[index % 5]} | Team-wide |`]));
  rows.set("DEP-01", "| DEP-01 | By project | action_recommended |");
  // Least favourable cell wins: not_applicable plus action_recommended is action_recommended.
  rows.set("OPS-01", "| OPS-01 | Status: not_applicable | action_recommended |");
  let table = "| Check | Team | `example-site` |\n| --- | --- | --- |\n" + [...rows.values()].join("\n") + "\n";
  table += "\n| Optional check | Team | `example-site` |\n| --- | --- | --- |\n";
  return table + OPTIONAL.map((topic) => `| ${topic} | not_reviewed | Team-wide |\n`).join("");
}

function fixture(matrix = true, appendixMatrix = false) {
  let source = "# Synthetic QA review\n\n";
  if (matrix) source += "## Status at a glance\n\n" + fullMatrix() + "\n";
  source += "## Summary\n[Docs](https://example.test/docs)\n";
  // A recommendation badge is not an appendix outcome.
  source += "\n## Recommendations\n### Confirm ownership\nStatus: needs_confirmation\n";
  source += "\n## Appendix: check outcomes\n";
  CORE.forEach((topic, index) => {
    source += `\n### ${topic} - Synthetic check\nStatus: ${STATES[index % 5]}\n\nRationale: synthetic.\n`;
    if (appendixMatrix && topic === "IAM-02") source += "\n" + MATRIX;
  });
  source += "\n## Appendix: optional checks\n";
  for (const topic of OPTIONAL) {
    source += `\n### ${topic} - Optional check\nStatus: not_reviewed\n\nRationale: not authorized.\n`;
  }
  return renderReport(source);
}

/** Python str.replace(old, new[, count]). */
function replace(text, old, replacement, count = -1) {
  if (count < 0) return text.split(old).join(replacement);
  let result = text;
  let from = 0;
  for (let done = 0; done < count; done += 1) {
    const at = result.indexOf(old, from);
    if (at < 0) break;
    result = result.slice(0, at) + replacement + result.slice(at + old.length);
    from = at + replacement.length;
  }
  return result;
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "report-qa-"));
}

function snapshot(directory) {
  return Object.fromEntries(fs.readdirSync(directory).sort().map((name) => [name, fs.readFileSync(path.join(directory, name)).toString("base64")]));
}

function run(args) {
  const result = spawnSync(process.execPath, [CHECKER, ...args], { encoding: "utf8", timeout: 10000 });
  return { returncode: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** A JSON value is written with JSON.stringify; a string is written verbatim (Python json.dumps text). */
function check(document, summary = SUMMARY, evidence = null) {
  const directory = tempDir();
  try {
    const report = path.join(directory, "report.html");
    fs.writeFileSync(report, document, "utf8");
    const command = [report];
    if (summary !== null) {
      const file = path.join(directory, "summary.json");
      fs.writeFileSync(file, typeof summary === "string" ? summary : JSON.stringify(summary), "utf8");
      command.push("--expected-summary", file);
    }
    if (evidence !== null) {
      const file = path.join(directory, "evidence.json");
      fs.writeFileSync(file, typeof evidence === "string" ? evidence : JSON.stringify(evidence), "utf8");
      command.push("--evidence-json", file);
    }
    const before = snapshot(directory);
    const result = run(command);
    assert.deepEqual(snapshot(directory), before);
    return result;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const clone = (value) => JSON.parse(JSON.stringify(value));

test("complete report counts match all five states separately", () => {
  const result = check(fixture());
  assert.equal(result.returncode, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.counts, SUMMARY);
  assert.equal(output.summary_parity, "matched");
  assert.equal(output.visual_qa, "not performed");
  assert.equal(output.network_qa, "structural only; runtime not observed");
});

test("each status mismatch is rejected including zero optional counts", () => {
  const document = fixture();
  for (const group of Object.keys(SUMMARY)) {
    for (const status of STATES) {
      const wrong = clone(SUMMARY);
      wrong[group][status] += 1;
      assert.equal(check(document, wrong).returncode, 1, `${group} ${status}`);
    }
  }
});

test("summary requires exact groups, all states and integer counts", () => {
  const document = fixture();
  // Python json.dumps writes 5.0 as a float literal; JSON.stringify cannot, so that case is literal text.
  const float = JSON.stringify({ ...SUMMARY, core: { ...SUMMARY.core, satisfactory: "FLOAT" } }).replace("\"FLOAT\"", "5.0");
  for (const invalid of [{}, { core: SUMMARY.core },
    { ...SUMMARY, extra: {} },
    { ...SUMMARY, optional: { not_reviewed: 4 } },
    { ...SUMMARY, optional: { ...SUMMARY.optional, satisfactory: false } },
    float,
    { ...SUMMARY, core: { ...SUMMARY.core, satisfactory: -1 } }]) {
    assert.equal(check(document, invalid).returncode, 1, typeof invalid === "string" ? invalid : JSON.stringify(invalid));
  }
});

test("duplicate, missing, unknown or multiple status appendix checks fail", () => {
  const document = fixture();
  const mutations = [
    replace(document, "IAM-02 - Synthetic check", "IAM-01 - Synthetic check"),
    replace(document, "IAM-01 - Synthetic check", "ZZZ-01 - Synthetic check"),
    replace(document, "<span class=\"status-badge status-good\">Satisfactory</span>", "", 1),
    replace(document, ">Satisfactory</span>", ">Invented status</span>", 1),
    replace(document, ">Satisfactory</span>", ">Satisfactory</span><span class=\"status-badge\">Not reviewed</span>", 1),
    replace(document, "<section class=\"report-section appendix\"", "<section class=\"report-section\""),
  ];
  mutations.forEach((mutated, index) => {
    assert.equal(check(mutated).returncode, 1, `index ${index}`);
  });
});

test("passive HTML rejects active elements, attributes and remote assets", () => {
  const document = fixture();
  const additions = [
    "<script>alert(1)</script>", "<script type=\"application/json\">{}</script>",
    "<img src=\"https://example.test/pixel\">", "<svg><path></path></svg>",
    "<iframe src=\"https://example.test/frame\"></iframe>",
    "<object data=\"file:///private/example\"></object>",
    "<link rel=\"stylesheet\" href=\"https://example.test/style\">",
    "<link rel=\"preconnect\" href=\"https://example.test\">",
    "<meta http-equiv=\"refresh\" content=\"0;url=https://example.test\">",
    "<form action=\"https://example.test\"></form>",
    "<p onclick=\"alert(1)\">Active</p>",
    "<p style=\"background:url(https://example.test/pixel)\">Inline CSS</p>",
    "<a href=\"https://example.test\" ping=\"https://example.test/ping\">Docs</a>",
    "<a href=\"javascript:alert(1)\">Active link</a>",
    "<a href=\"https://user:password@example.test\">Credentials</a>",
    "<a href=\"https://example.test?token=synthetic\">Query</a>",
    "<div background=\"https://example.test/pixel\">Old HTML</div>",
    "<base href=\"https://example.test/\">",
  ];
  for (const addition of additions) {
    assert.equal(check(replace(document, "</head>", addition + "</head>")).returncode, 1, addition);
  }
});

test("CSP and embedded styles/fonts are required and tamper evident", () => {
  const document = fixture();
  const mutations = [
    replace(document, "script-src 'none'", "script-src https:"),
    replace(document, "default-src 'none';", "default-src *;"),
    replace(document, "font-src data:", "font-src https:"),
    replace(document, "Content-Security-Policy", "Not-CSP"),
    replace(document, "</style>", "@import \"https://example.test/remote.css\";</style>"),
    replace(document, "</style>", "p{background:url(https://example.test/pixel)}</style>"),
    replace(document, "</style>", String.raw`p{background:u\72l(https://example.test/pixel)}</style>`),
    replace(document, "data:font/woff2;base64,", "https://example.test/font?data=", 1),
    replace(document, "data:font/woff2;base64,d09GMg", "data:font/woff2;base64,AAAAAA", 1),
    replace(document, "</head>", "<style>p{color:red}</style></head>"),
  ];
  mutations.forEach((mutated, index) => {
    assert.notEqual(mutated, document, `index ${index}`);
    assert.equal(check(mutated).returncode, 1, `index ${index}`);
  });
});

test("required disclosures and no logo", () => {
  const document = fixture();
  for (const old of ["Read-only configuration review",
    "not a security certification or a guarantee of compliance.",
    "Findings apply only to the scope and observation window",
    "this report does not certify security or compliance."]) {
    assert.equal(check(replace(document, old, "")).returncode, 1, old);
  }
  assert.equal(check(replace(document, "</header>", "<span class=\"official-logo\">Vercel</span></header>")).returncode, 1);
});

test("no JSON does not claim parity and single evidence is partial", () => {
  let result = check(fixture(), null);
  assert.equal(result.returncode, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).summary_parity.includes("not checked"));
  result = check(fixture(), null, {
    topic_id: "CRE-01", status: "not_reviewed",
    scope_alias: "example-team", observed: { expiry_visibility: "not_shown" },
  });
  assert.equal(result.returncode, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.evidence_parity, "matched 1 of 28 checks; partial source");
  assert.ok(output.summary_parity.includes("not checked"));
});

test("structured evidence checks IDs, statuses and complete parity", () => {
  const document = fixture();
  const records = CORE.map((topic, index) => ({ topic_id: topic, status: STATES[index % 5] }));
  records.push(...OPTIONAL.map((topic) => ({ topic_id: topic, status: "not_reviewed" })));
  const result = check(document, SUMMARY, records);
  assert.equal(result.returncode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).evidence_parity, "matched all 28 checks");
  for (const invalid of [[], {}, { checks: records }, [...records, records[0]],
    { topic_id: "CRE-01", status: "satisfactory" },
    { topic_id: "ZZZ-01", status: "not_reviewed" },
    { topic_id: "CRE-01", status: "unknown" }]) {
    assert.equal(check(document, SUMMARY, invalid).returncode, 1, JSON.stringify(invalid));
  }
});

test("repository example works without a new report schema", () => {
  const source = fs.readFileSync(path.join(ROOT, "examples", "security-audit.md"), "utf8");
  const expected = {
    core: zip(STATES, [12, 2, 6, 3, 1]),
    optional: zip(STATES, [0, 0, 0, 4, 0]),
  };
  const result = check(renderReport(source), expected);
  assert.equal(result.returncode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).counts, expected);
});

test("status matrix badges are not counted as appendix outcomes", () => {
  for (const [placement, document] of [["summary", fixture(true)],
    ["summary and appendix", fixture(true, true)]]) {
    assert.ok(document.split("<td><span class=\"status-badge").length - 1 >= 4, placement);
    const result = check(document);
    assert.equal(result.returncode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).counts, SUMMARY);
  }
});

test("matrix status cannot stand in for an appendix status line", () => {
  let source = "# Synthetic QA review\n\n## Appendix: check outcomes\n";
  [...CORE, ...OPTIONAL].forEach((topic, index) => {
    const status = topic !== "IAM-01" ? `Status: ${STATES[index % 5]}\n` : "| Status |\n| --- |\n| satisfactory |\n";
    source += `\n### ${topic} - Synthetic check\n${status}`;
  });
  assert.equal(check(renderReport(source), null).returncode, 1);
});

test("only the generated table shape is accepted", () => {
  const document = fixture(true);
  assert.equal(check(document).returncode, 0);
  const row = "<tr><td>IAM-01</td><td><span class=\"status-badge status-good\">Satisfactory</span></td><td>Team-wide</td></tr>";
  assert.ok(document.includes(row));
  const wrapperStart = "<div class=\"table-wrap\"><table>";
  for (const mutated of [
    replace(document, row, "<tr><td>IAM-01</td><td>x</td></tr>"),
    replace(document, row, replace(row, "<td>IAM-01</td>", "<th scope=\"col\">IAM-01</th>")),
    replace(document, row, replace(row, "<td>IAM-01</td>", "<td style=\"color:red\">IAM-01</td>")),
    replace(document, "<th scope=\"col\">Team</th>", "<th scope=\"row\">Team</th>"),
    replace(document, "<th scope=\"col\">Team</th>", "<th>Team</th>"),
    replace(document, row, "text" + row),
    replace(document, wrapperStart, "<div class=\"table-wrap\" id=\"matrix\"><table>"),
    replace(replace(document, wrapperStart, "<table>"), "</table></div>", "</table>"),
    replace(replace(document, wrapperStart, "<p><span><table>"), "</table></div>", "</table></span></p>"),
    replace(document, "<table><thead>", "<table><tbody></tbody><thead>"),
    replace(document, "<tbody>", "<tbody><tr></tr>"),
    replace(document, "</tbody>", "</tbody><tbody><tr><td>a</td><td>b</td><td>c</td></tr></tbody>"),
    replace(document, "<thead><tr>", "<thead><tr><th scope=\"col\">x</th></tr><tr>"),
    replace(document, "</td>", "</td><td><table></table></td>", 1),
  ]) {
    const label = mutated.slice(Math.max(0, mutated.indexOf("table-wrap") - 20)).slice(0, 160);
    assert.notEqual(mutated, document, label);
    assert.equal(check(mutated).returncode, 1, label);
  }
});

test("table failures name the rule without echoing content", () => {
  const document = fixture(true);
  const row = "<tr><td>IAM-01</td><td><span class=\"status-badge status-good\">Satisfactory</span></td><td>Team-wide</td></tr>";
  const result = check(replace(document, row, "<tr><td>SYNTHETIC_SECRET_CANARY</td><td>x</td></tr>"));
  assert.equal(result.returncode, 1);
  assert.ok(result.stderr.includes("Table rows have inconsistent column counts."));
  assert.ok(!result.stderr.includes("SYNTHETIC_SECRET_CANARY"));
});

test("appendix records must be directly in main, not nested or elsewhere", () => {
  const document = fixture();
  const heading = "<h3>IAM-01 - Synthetic check</h3>";
  for (const mutated of [
    replace(document, heading, "<div>" + heading + "</div>"),
    replace(document, "</footer>", "<section class=\"appendix\"><h3>IAM-01 - Duplicate</h3></section></footer>"),
  ]) {
    assert.notEqual(mutated, document, mutated.slice(-80));
    assert.equal(check(mutated).returncode, 1, mutated.slice(-80));
  }
});

test("malformed HTML and input JSON fail without echoing content", () => {
  const document = fixture();
  // fixture()[:-20] in Python slices code points; the rendered HTML ends in ASCII, so UTF-16 slicing is equal.
  for (const malformed of ["", "SYNTHETIC_SECRET_CANARY", document.slice(0, -20),
    replace(document, "<html lang=\"en\">", "<html lang=\"en\" lang=\"fr\">"),
    replace(document, "</body>", "<div>".repeat(70) + "</div>".repeat(70) + "</body>")]) {
    const result = check(malformed);
    assert.equal(result.returncode, 1);
    assert.equal(result.stdout, "");
    assert.ok(!result.stderr.includes("SYNTHETIC_SECRET_CANARY"));
    assert.ok(!result.stderr.includes("Traceback"));
  }
  const directory = tempDir();
  try {
    const report = path.join(directory, "report.html");
    const summary = path.join(directory, "summary.json");
    fs.writeFileSync(report, document, "utf8");
    for (const data of [Buffer.from("{"), Buffer.from([0xff]), Buffer.from("{}\x00"),
      Buffer.from("{\"core\":{},\"core\":{},\"optional\":{}}")]) {
      fs.writeFileSync(summary, data);
      const result = run([report, "--expected-summary", summary]);
      assert.equal(result.returncode, 1);
      assert.equal(result.stdout, "");
      assert.ok(!result.stderr.includes("Traceback"));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("checker never launches a browser, process or network operation", async () => {
  const require = createRequire(import.meta.url);
  const forbidden = () => {
    throw new Error("Forbidden checker I/O");
  };
  const targets = [
    [require("node:net"), ["Socket", "connect", "createConnection"]],
    [require("node:dns"), ["lookup", "resolve"]],
    [require("node:http"), ["request", "get"]],
    [require("node:https"), ["request", "get"]],
    [require("node:child_process"), ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]],
  ];
  const directory = tempDir();
  const saved = [];
  const savedFetch = globalThis.fetch;
  const writes = { stdout: process.stdout.write, stderr: process.stderr.write };
  let output = "";
  let errors = "";
  try {
    const report = path.join(directory, "report.html");
    fs.writeFileSync(report, fixture(), "utf8");
    for (const [module, names] of targets) {
      for (const name of names) {
        saved.push([module, name, module[name]]);
        module[name] = forbidden;
      }
    }
    globalThis.fetch = forbidden;
    syncBuiltinESMExports();
    // A fresh module instance, loaded while the forbidden stubs are in place.
    const checker = await import(`${pathToFileURL(CHECKER).href}?offline=${Date.now()}`);
    let code;
    process.stdout.write = (chunk) => {
      output += chunk;
      return true;
    };
    process.stderr.write = (chunk) => {
      errors += chunk;
      return true;
    };
    try {
      code = checker.main([report]);
    } finally {
      process.stdout.write = writes.stdout;
      process.stderr.write = writes.stderr;
    }
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(output).counts, SUMMARY);
    assert.equal(errors, "");
  } finally {
    for (const [module, name, value] of saved) module[name] = value;
    globalThis.fetch = savedFetch;
    syncBuiltinESMExports();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
