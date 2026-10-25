"""Structural policy regressions only; no live connector safety assertion."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "vercel-security-audit"
REFS = SKILL / "references"


class MCPBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = (REFS / "mcp-boundary.md").read_text()
        blocks = re.findall(r"```json\n(.*?)\n```", cls.text, re.S)
        if len(blocks) != 1:
            raise ValueError("Boundary must have exactly one normative JSON policy")
        cls.policy = json.loads(blocks[0])

    def test_default_deny_and_denial_precedence(self):
        self.assertEqual(self.policy["default"], "deny")
        self.assertEqual(self.policy["precedence"], [
            "deny_tools", "deny_classes", "conditional_tools", "conditional_capabilities"])
        self.assertEqual(set(self.policy["deny_classes"]), {
            "arbitrary_api_or_get", "secret_returning_response", "access_bearing_url_response",
            "create_or_reuse_sharing_url", "configuration_or_resource_mutation"})
        self.assertNotIn("allow_tools", self.policy)

    def test_named_denials_are_complete_unique_and_explained(self):
        rules = self.policy["deny_tools"]
        names = [rule["name"] for rule in rules]
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(set(names), {
            "get_access_to_vercel_url", "web_fetch_vercel_url", "get_project_env",
            "get_shared_env_var", "get_edge_config_tokens", "get_edge_config_token"})
        self.assertTrue(all(rule["reason"] for rule in rules))
        conditional = {rule["name"] for rule in self.policy["conditional_tools"]}
        self.assertFalse(set(names) & conditional)

    def test_every_allowance_requires_all_precollection_gates(self):
        self.assertEqual(set(self.policy["required_gates"]), {
            "authenticated_identity_confirmed", "explicit_scope_authorised", "server_side_scope_verified",
            "input_schema_verified", "response_contract_verified_metadata_only",
            "no_mutation_or_sharing_side_effects", "host_pre_exposure_field_selection_verified",
            "pagination_and_visibility_recorded"})
        for rule in self.policy["conditional_tools"] + self.policy["conditional_capabilities"]:
            with self.subTest(rule=rule.get("id", rule.get("name"))):
                self.assertIs(rule["requires_all_global_gates"], True)

    def test_conditional_capabilities_cover_checks_without_secret_fields(self):
        rules = self.policy["conditional_capabilities"]
        ids = [rule["id"] for rule in rules]
        self.assertEqual(len(ids), len(set(ids)))
        expected = set(re.findall(r"^### ([A-Z]{3}-\d{2})", (REFS / "checklist.md").read_text(), re.M))
        covered = {check for rule in rules for check in rule["checks"]}
        self.assertEqual(covered, expected)
        forbidden = {"value", "values", "encrypted_value", "token", "secret", "url", "email",
                     "log_body", "source_code", "condition_value", "personal_rows"}
        for rule in rules:
            with self.subTest(capability=rule["id"]):
                fields = rule["fields"]
                self.assertTrue(fields)
                self.assertEqual(len(fields), len(set(fields)))
                self.assertFalse(set(fields) & forbidden)
                self.assertNotIn("*", fields)

    def test_environment_filter_false_alone_is_never_an_allowance(self):
        rules = self.policy["conditional_tools"]
        self.assertEqual(len(rules), 1)
        rule = rules[0]
        self.assertEqual(rule["name"], "filter_project_envs")
        self.assertEqual(rule["default"], "deny")
        self.assertEqual(rule["denied_arguments"], [{"decrypt": True}])
        self.assertEqual(rule["required_arguments"], {"decrypt": False})
        self.assertEqual(rule["verification_status"], "unverified_do_not_invoke")
        self.assertEqual(rule["capability"], "environment_metadata")
        capabilities = {item["id"]: item for item in self.policy["conditional_capabilities"]}
        self.assertIn(rule["capability"], capabilities)
        self.assertIs(capabilities[rule["capability"]]["requires_all_global_gates"], True)

    def test_current_inventory_requires_current_state_not_events(self):
        rules = {rule["id"]: rule for rule in self.policy["conditional_capabilities"]}
        inventory = rules["current_sharing_metadata"]
        self.assertIs(inventory["requires_current_nonmutating_inventory_contract"], True)
        self.assertIs(inventory["event_history_is_current_inventory"], False)
        self.assertEqual(inventory["checks"], ["DEP-02"])
        historical_fields = rules["operational_metadata"]["fields"]
        for field in ("current_share_count", "current_automation_bypass_count"):
            self.assertIn(field, inventory["fields"])
            self.assertNotIn(field, historical_fields)

    def test_policy_is_reachable_before_any_account_collection(self):
        discovery = (SKILL / "SKILL.md").read_text().split("### 1.", 1)[1].split("### 2.", 1)[0]
        self.assertIn("references/mcp-boundary.md", discovery)
        capabilities = (REFS / "capabilities.md").read_text()
        boundary = capabilities.split("## Operation boundary", 1)[1].split("## Public sources", 1)[0]
        self.assertIn("mcp-boundary.md", boundary)


if __name__ == "__main__":
    unittest.main()
