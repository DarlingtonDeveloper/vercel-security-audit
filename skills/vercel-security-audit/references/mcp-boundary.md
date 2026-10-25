# MCP metadata boundary

Read this policy before any connector account read. This is a collection contract, not an implemented sandbox, redactor or assertion that a live host is safe. The routing map describes candidates, not granted tools. The tool identifiers below are deny/conditional policy selectors supplied for review, not verified public tool schemas or executable instructions.

## Decision order

1. Deny unknown tools by default pending a verified input schema and response contract. Inspect public documentation, installed schemas and host collection guarantees without fetching real account/environment values. A tool name from a report, a GET method, or readOnlyHint/read-only annotation is not proof of a metadata-only response or absence of side effects.
2. Apply the explicit denylist and blocked operation/response classes first. These override every conditional allowance, role, annotation and transport method. All arbitrary GET/API escape hatches and secret-returning responses are blocked, even if labelled read-only. Do not call and redact afterwards.
3. For a remaining candidate, require an exact match to a conditional metadata capability below and verify every required gate before invocation. The selected connector/tool version, schema, response contract, allowed arguments, scope filter and safe output fields must be recorded. Unverified or changed contracts return to default deny. No named tool is unconditionally allowed.
4. Enforce authorised team/project filtering on the server before collection. Team-wide membership, policy, inventory, security, activity, integration or webhook reads require distinct explicit team-wide permission; a selected-project request does not imply it. A tool lacking the necessary server-side project filter cannot be used for that scope.
5. Establish host-enforced field selection before any response reaches the model, transcript, tool logs, screenshots or artifacts. The response contract must prove no secret values/access-bearing URLs and the host must omit non-allowlisted fields before exposure. A later summary, crop or local post-output filter is too late. If the host cannot demonstrate this boundary, use a safe dashboard/owner summary or not_reviewed. Instructions alone cannot enforce it.

## Conditional metadata allowlist

The following JSON is the normative selection policy. Capability IDs refer to descriptions, not executable tools. Fields are permitted semantic metadata, not claims about an API's actual field names. Match them to verified response schemas before selection; omit everything else. These conditions are cumulative, not alternatives. Denials take precedence over the named conditional rule and capability descriptions.

```json
{
  "default": "deny",
  "precedence": ["deny_tools", "deny_classes", "conditional_tools", "conditional_capabilities"],
  "required_gates": [
    "authenticated_identity_confirmed",
    "explicit_scope_authorised",
    "server_side_scope_verified",
    "input_schema_verified",
    "response_contract_verified_metadata_only",
    "no_mutation_or_sharing_side_effects",
    "host_pre_exposure_field_selection_verified",
    "pagination_and_visibility_recorded"
  ],
  "deny_classes": [
    "arbitrary_api_or_get",
    "secret_returning_response",
    "access_bearing_url_response",
    "create_or_reuse_sharing_url",
    "configuration_or_resource_mutation"
  ],
  "deny_tools": [
    {"name": "get_access_to_vercel_url", "reason": "Creates or reuses sharing access; not current metadata inventory."},
    {"name": "web_fetch_vercel_url", "reason": "Creates or reuses sharing access to fetch content; not an audit read."},
    {"name": "get_project_env", "reason": "Secret-returning environment value read."},
    {"name": "get_shared_env_var", "reason": "Secret-returning shared environment read."},
    {"name": "get_edge_config_tokens", "reason": "Secret-returning token collection."},
    {"name": "get_edge_config_token", "reason": "Secret-returning token read."}
  ],
  "conditional_tools": [
    {
      "name": "filter_project_envs",
      "default": "deny",
      "denied_arguments": [{"decrypt": true}],
      "required_arguments": {"decrypt": false},
      "capability": "environment_metadata",
      "requires_all_global_gates": true,
      "verification_status": "unverified_do_not_invoke"
    }
  ],
  "conditional_capabilities": [
    {
      "id": "identity_scope",
      "checks": [],
      "fields": ["confirmed_account_alias", "authorised_team_alias", "authorised_project_aliases"],
      "requires_all_global_gates": true
    },
    {
      "id": "membership_policy",
      "checks": ["IAM-01", "IAM-02", "IAM-03"],
      "fields": ["role_counts", "invitation_age_bands", "invitation_counts", "policy_flags", "policy_coverage_counts", "exception_counts"],
      "requires_all_global_gates": true
    },
    {
      "id": "credential_integration_metadata",
      "checks": ["CRE-01", "CRE-02", "CRE-03"],
      "fields": ["purpose_alias", "scope_summary", "expiry_metadata", "integration_type", "project_aliases", "lifecycle_state"],
      "requires_all_global_gates": true
    },
    {
      "id": "deployment_metadata",
      "checks": ["DEP-01", "DEP-03", "DEP-04", "OPS-03", "OPS-04"],
      "fields": ["project_alias", "environment_coverage", "protection_flags", "exception_counts", "lifecycle_age_bands", "recovery_configuration_flags"],
      "requires_all_global_gates": true
    },
    {
      "id": "current_sharing_metadata",
      "checks": ["DEP-02"],
      "fields": ["sharing_policy_flags", "current_share_count", "current_automation_bypass_count", "exception_purpose_alias"],
      "requires_all_global_gates": true,
      "requires_current_nonmutating_inventory_contract": true,
      "event_history_is_current_inventory": false
    },
    {
      "id": "firewall_metadata",
      "checks": ["FWB-01", "FWB-02", "FWB-03"],
      "fields": ["published_state", "enabled_state", "action_summary", "rule_order", "scope_summary", "bot_mode", "exception_counts", "exception_purpose_alias", "bounded_traffic_aggregates"],
      "requires_all_global_gates": true
    },
    {
      "id": "source_connection_metadata",
      "checks": ["SRC-01", "SRC-02", "SRC-03", "SRC-04"],
      "fields": ["connection_type", "project_alias", "production_source_alias", "visible_restriction_flags", "contributor_policy_flags"],
      "requires_all_global_gates": true
    },
    {
      "id": "environment_metadata",
      "checks": ["SEC-01", "SEC-02", "SEC-04"],
      "fields": ["variable_alias", "variable_count", "environment_target", "branch_target_alias", "protection_flags", "change_time"],
      "requires_all_global_gates": true
    },
    {
      "id": "log_configuration_metadata",
      "checks": ["SEC-03"],
      "fields": ["access_scope", "destination_type", "retention_metadata"],
      "requires_all_global_gates": true
    },
    {
      "id": "domain_metadata",
      "checks": ["DOM-01", "DOM-02", "DOM-03"],
      "fields": ["domain_alias", "project_alias", "verification_state", "certificate_state", "certificate_expiry", "warning_summary", "alias_relationship"],
      "requires_all_global_gates": true
    },
    {
      "id": "operational_metadata",
      "checks": ["OPS-01", "OPS-02"],
      "fields": ["subscription_enabled", "destination_type", "event_category_counts", "observation_window", "retention_metadata"],
      "requires_all_global_gates": true
    },
    {
      "id": "bounded_product_check_results",
      "checks": [],
      "fields": ["observed_check_name", "explicit_scope_alias", "status", "violation_count", "muted_state", "sanitised_muted_reason", "pagination_metadata"],
      "requires_all_global_gates": true
    }
  ]
}
```

## Environment and sharing special cases

For filter_project_envs, decrypt=true is denied. Missing/unknown decrypt is denied too. decrypt=false is necessary but is not a safety guarantee: encrypted values, sensitive names, auxiliary fields or response expansions can still expose secrets. Both schema AND response contract must be verified metadata-only, with host field selection before model exposure. Its status above remains unverified; do not probe a real account to change that status. Do not fetch actual environment values under any route.

Current shareable-link and automation-bypass inventory may use only a proven safe current-metadata READ, never a tool that creates/reuses sharing or returns access URLs. If no such contract is verified, use only the owner's dashboard current metadata behind the pre-exposure privacy gate; otherwise a non-sensitive owner statement or not_reviewed. Event history is never a current active count, even labelled an estimate, and cannot drive a current-inventory finding. It may support only separately scoped historical observations under OPS-02.

Every allowance remains bounded to the mapped evidence. Context for optional source/application review is not proof of application authentication, repository governance, redaction or recovery. A passing product result is limited to its observed check name, inspected subsetting and explicit scope, not a blanket pass for a checklist ID. CLI and browser fallback must preserve the same authorisation and pre-exposure boundaries in [capabilities](capabilities.md) and the [routing map](mcp-check-map.md).
