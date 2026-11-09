// Structural policy regressions only; no live connector safety assertion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SKILL = new URL("../skills/vercel-security-audit/", import.meta.url);
const REFS = new URL("references/", SKILL);

function after(text, sep) {
  const index = text.indexOf(sep);
  if (index < 0) throw new Error(`separator not found: ${JSON.stringify(sep)}`);
  return text.slice(index + sep.length);
}
function before(text, sep) {
  const index = text.indexOf(sep);
  return index < 0 ? text : text.slice(0, index);
}
const setOf = (items) => new Set(items);

const text = readFileSync(new URL("mcp-boundary.md", REFS), "utf8");
const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
if (blocks.length !== 1) {
  throw new Error("Boundary must have exactly one normative JSON policy");
}
const policy = JSON.parse(blocks[0]);

test("default deny and denial precedence", () => {
  assert.equal(policy.default, "deny");
  assert.deepEqual(policy.precedence, [
    "deny_tools", "deny_classes", "conditional_tools", "conditional_capabilities"]);
  assert.deepEqual(setOf(policy.deny_classes), setOf([
    "arbitrary_api_or_get", "secret_returning_response", "access_bearing_url_response",
    "create_or_reuse_sharing_url", "configuration_or_resource_mutation"]));
  assert.ok(!("allow_tools" in policy));
});

test("named denials are complete unique and explained", () => {
  const rules = policy.deny_tools;
  const names = rules.map((rule) => rule.name);
  assert.equal(names.length, setOf(names).size);
  assert.deepEqual(setOf(names), setOf([
    "get_access_to_vercel_url", "web_fetch_vercel_url", "get_project_env",
    "get_shared_env_var", "get_edge_config_tokens", "get_edge_config_token"]));
  // Python truthiness: a non-empty reason.
  assert.ok(rules.every((rule) => Boolean(rule.reason)));
  const conditional = setOf(policy.conditional_tools.map((rule) => rule.name));
  assert.ok(!names.some((name) => conditional.has(name)));
});

test("every allowance requires all precollection gates", () => {
  assert.deepEqual(setOf(policy.required_gates), setOf([
    "authenticated_identity_confirmed", "explicit_scope_authorised", "server_side_scope_verified",
    "input_schema_verified", "response_contract_verified_metadata_only",
    "no_mutation_or_sharing_side_effects", "host_pre_exposure_field_selection_verified",
    "pagination_and_visibility_recorded"]));
  for (const rule of [...policy.conditional_tools, ...policy.conditional_capabilities]) {
    assert.equal(rule.requires_all_global_gates, true, rule.id ?? rule.name);
  }
});

test("conditional capabilities cover checks without secret fields", () => {
  const rules = policy.conditional_capabilities;
  const ids = rules.map((rule) => rule.id);
  assert.equal(ids.length, setOf(ids).size);
  const checklist = readFileSync(new URL("checklist.md", REFS), "utf8");
  const expected = setOf([...checklist.matchAll(/^### ([A-Z]{3}-\d{2})/gm)].map((m) => m[1]));
  const covered = setOf(rules.flatMap((rule) => rule.checks));
  assert.deepEqual(covered, expected);
  const forbidden = setOf(["value", "values", "encrypted_value", "token", "secret", "url", "email",
    "log_body", "source_code", "condition_value", "personal_rows"]);
  for (const rule of rules) {
    const fields = rule.fields;
    assert.ok(fields && fields.length > 0, rule.id);
    assert.equal(fields.length, setOf(fields).size, rule.id);
    assert.ok(!fields.some((field) => forbidden.has(field)), rule.id);
    assert.ok(!fields.includes("*"), rule.id);
  }
});

test("environment filter false alone is never an allowance", () => {
  const rules = policy.conditional_tools;
  assert.equal(rules.length, 1);
  const rule = rules[0];
  assert.equal(rule.name, "filter_project_envs");
  assert.equal(rule.default, "deny");
  assert.deepEqual(rule.denied_arguments, [{ decrypt: true }]);
  assert.deepEqual(rule.required_arguments, { decrypt: false });
  assert.equal(rule.verification_status, "unverified_do_not_invoke");
  assert.equal(rule.capability, "environment_metadata");
  const capabilities = Object.fromEntries(policy.conditional_capabilities.map((item) => [item.id, item]));
  assert.ok(Object.hasOwn(capabilities, rule.capability));
  assert.equal(capabilities[rule.capability].requires_all_global_gates, true);
});

test("current inventory requires current state not events", () => {
  const rules = Object.fromEntries(policy.conditional_capabilities.map((rule) => [rule.id, rule]));
  const inventory = rules.current_sharing_metadata;
  assert.equal(inventory.requires_current_nonmutating_inventory_contract, true);
  assert.equal(inventory.event_history_is_current_inventory, false);
  assert.deepEqual(inventory.checks, ["DEP-02"]);
  const historicalFields = rules.operational_metadata.fields;
  for (const field of ["current_share_count", "current_automation_bypass_count"]) {
    assert.ok(inventory.fields.includes(field), field);
    assert.ok(!historicalFields.includes(field), field);
  }
});

test("policy is reachable before any account collection", () => {
  const discovery = before(after(readFileSync(new URL("SKILL.md", SKILL), "utf8"), "### 1."), "### 2.");
  assert.ok(discovery.includes("references/mcp-boundary.md"));
  const capabilities = readFileSync(new URL("capabilities.md", REFS), "utf8");
  const boundary = before(after(capabilities, "## Operation boundary"), "## Public sources");
  assert.ok(boundary.includes("mcp-boundary.md"));
});
