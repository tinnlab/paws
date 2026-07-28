//! TEST-17 — `GET /api/mcp/servers/{id}/tools` is the contract the workflow
//! builder's tool step depends on (ITEM-5 server+tool picker, ITEM-6 generated
//! Arguments form).
//!
//! The picker renders one entry per tool from `name` + `description`, and the
//! Arguments form is GENERATED from `input_schema` (`properties` → fields,
//! `required` → required markers). So a response that merely returns 200 with
//! `{"tools":[{"name":...}]}` would silently produce an unusable form. These
//! tests lock the whole payload shape, plus both 403 gates:
//!
//!   1. `list_tools_payload_carries_name_description_and_input_schema`
//!      — user-owned server serving real tools → 200 + full per-tool payload.
//!   2. `list_tools_requires_mcp_servers_read`
//!      — no `mcp_servers::read` → 403 INSUFFICIENT_PERMISSIONS.
//!   3. `list_tools_forbidden_for_user_without_access_to_that_server`
//!      — has `mcp_servers::read` but the server is another user's → 403
//!        USER_NO_ACCESS. Non-admin on purpose: `has_admin_access` lets
//!        `is_admin` / `mcp_servers_admin::*` holders bypass the per-server
//!        access check, so an admin here would make the test vacuous.

use crate::common::{test_helpers, TestServer};
use crate::mcp::fixtures::mock_mcp_server::{MockMcpServer, MockResponse};
use serde_json::json;
use uuid::Uuid;

/// The tool set the mock advertises. Deliberately shaped like something the
/// generated Arguments form has to cope with: a required string, an optional
/// integer with a default, and a second tool so "each tool" is plural.
fn advertised_tools() -> serde_json::Value {
    json!({
        "tools": [
            {
                "name": "search",
                "description": "Search the corpus.",
                "inputSchema": {
                    "type": "object",
                    "required": ["query"],
                    "properties": {
                        "query": { "type": "string", "description": "Search terms" },
                        "limit": { "type": "integer", "default": 10 }
                    }
                }
            },
            {
                "name": "summarize",
                "description": "Summarize a document.",
                "inputSchema": {
                    "type": "object",
                    "required": ["document_id"],
                    "properties": {
                        "document_id": { "type": "string" }
                    }
                }
            }
        ]
    })
}

/// Start a mock MCP server that answers `tools/list` with [`advertised_tools`].
/// The mock's per-method queue is FIFO and drains, so queue several copies —
/// the session manager may connect/list more than once across a test.
async fn start_mock_with_tools() -> MockMcpServer {
    let mock = MockMcpServer::start().await;
    for _ in 0..4 {
        mock.on_method("tools/list", MockResponse::JsonOk(advertised_tools()));
    }
    mock
}

/// Register `url` as a user-owned HTTP MCP server owned by `token`'s user.
/// Mirrors `tests/workflow/mod.rs::register_mock_as_user_server`.
async fn register_user_server(server: &TestServer, token: &str, url: &str) -> String {
    let name = format!("builder_tools_{}", &Uuid::new_v4().to_string()[..8]);
    let res = reqwest::Client::new()
        .post(server.api_url("/mcp/servers"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({
            "name": name,
            "display_name": "Builder tool-picker fixture",
            "transport_type": "http",
            "url": url,
            "enabled": true,
        }))
        .send()
        .await
        .expect("register mock server");
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    assert_eq!(status, 201, "register mock MCP server failed: {status}: {body}");
    let row: serde_json::Value = serde_json::from_str(&body).expect("parse mcp server row");
    row["id"].as_str().expect("server id").to_string()
}

async fn get_tools(
    server: &TestServer,
    token: &str,
    server_id: &str,
) -> (reqwest::StatusCode, String) {
    let res = reqwest::Client::new()
        .get(server.api_url(&format!("/mcp/servers/{server_id}/tools")))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .expect("GET /mcp/servers/{id}/tools");
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    (status, body)
}

// ---------------------------------------------------------------------------
// 1. Payload contract — what the picker + generated form actually consume.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn list_tools_payload_carries_name_description_and_input_schema() {
    let server = TestServer::start().await;
    let mock = start_mock_with_tools().await;
    let user = test_helpers::create_user_with_permissions(
        &server,
        "builder_owner",
        &["mcp_servers::read", "mcp_servers::create"],
    )
    .await;
    let server_id = register_user_server(&server, &user.token, &mock.base_url()).await;

    let (status, body) = get_tools(&server, &user.token, &server_id).await;
    assert_eq!(status, 200, "owner must be able to list this server's tools: {body}");

    let parsed: serde_json::Value = serde_json::from_str(&body)
        .unwrap_or_else(|e| panic!("response was not JSON ({e}): {body}"));
    let tools = parsed["tools"]
        .as_array()
        .unwrap_or_else(|| panic!("response has no `tools` array: {body}"));

    // The picker lists exactly the tools the server advertises.
    let names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();
    assert_eq!(
        names,
        vec!["search", "summarize"],
        "tool names/order must match what the MCP server advertised: {body}"
    );

    // Per-tool: every field the picker + generated form read must be usable.
    for tool in tools {
        let name = tool["name"]
            .as_str()
            .unwrap_or_else(|| panic!("a tool has no string `name`: {body}"));
        assert!(
            !name.is_empty(),
            "tool `name` must be non-empty (it is the picker's value + label): {body}"
        );
        let description = tool["description"]
            .as_str()
            .unwrap_or_else(|| panic!("tool `{name}` has no string `description`: {body}"));
        assert!(
            !description.is_empty(),
            "tool `{name}` `description` must be non-empty (picker secondary line): {body}"
        );
        assert!(
            !tool["input_schema"].is_null(),
            "tool `{name}` `input_schema` must NOT be null — the Arguments form is generated \
             from it, and a null schema renders no fields: {body}"
        );
        let schema = tool["input_schema"]
            .as_object()
            .unwrap_or_else(|| panic!("tool `{name}` `input_schema` is not an object: {body}"));
        assert_eq!(
            schema.get("type").and_then(|t| t.as_str()),
            Some("object"),
            "tool `{name}` `input_schema.type` must be `object`: {body}"
        );
    }

    // The `search` tool's schema must survive the round-trip field-for-field:
    // this is literally what the generated form iterates.
    let search = tools
        .iter()
        .find(|t| t["name"] == "search")
        .unwrap_or_else(|| panic!("`search` tool missing: {body}"));
    let props = search["input_schema"]["properties"]
        .as_object()
        .unwrap_or_else(|| panic!("`search.input_schema.properties` missing: {body}"));
    assert!(
        props.contains_key("query") && props.contains_key("limit"),
        "`search` must expose BOTH declared properties (query, limit) — the form renders one \
         field per property; got keys {:?}: {body}",
        props.keys().collect::<Vec<_>>()
    );
    assert_eq!(
        props["query"]["type"], "string",
        "`query` property type must survive the round-trip (drives the input widget): {body}"
    );
    assert_eq!(
        props["limit"]["type"], "integer",
        "`limit` property type must survive the round-trip (drives the input widget): {body}"
    );
    assert_eq!(
        props["limit"]["default"], 10,
        "`limit` default must survive the round-trip (prefills the generated field): {body}"
    );
    let required = search["input_schema"]["required"]
        .as_array()
        .unwrap_or_else(|| panic!("`search.input_schema.required` missing: {body}"));
    assert_eq!(
        required,
        &vec![json!("query")],
        "`search.input_schema.required` must carry exactly the declared required field — the \
         form marks required inputs from it: {body}"
    );
}

// ---------------------------------------------------------------------------
// 2. Permission gate — no `mcp_servers::read`.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn list_tools_requires_mcp_servers_read() {
    let server = TestServer::start().await;
    let mock = start_mock_with_tools().await;

    // Owner registers the server (so the id is real — a 403 on a nonexistent
    // id would not prove the permission gate fires before anything else).
    let owner = test_helpers::create_user_with_permissions(
        &server,
        "builder_owner",
        &["mcp_servers::read", "mcp_servers::create"],
    )
    .await;
    let server_id = register_user_server(&server, &owner.token, &mock.base_url()).await;

    // `create_user_with_permissions(_, _, &[])` would NOT work here: registration
    // auto-joins the default group, which already grants `mcp_servers::read`.
    let nobody = test_helpers::create_user_with_no_permissions(&server, "builder_nobody").await;

    let (status, body) = get_tools(&server, &nobody.token, &server_id).await;
    assert_eq!(
        status, 403,
        "a user without `mcp_servers::read` must be refused the tool list: {body}"
    );
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .unwrap_or_else(|e| panic!("403 body was not JSON ({e}): {body}"));
    assert_eq!(
        parsed["error_code"], "INSUFFICIENT_PERMISSIONS",
        "the permission gate (not the per-server access check) must be what refuses: {body}"
    );
}

// ---------------------------------------------------------------------------
// 3. Access gate — has `mcp_servers::read`, but no access to THAT server.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn list_tools_forbidden_for_user_without_access_to_that_server() {
    let server = TestServer::start().await;
    let mock = start_mock_with_tools().await;

    let owner = test_helpers::create_user_with_permissions(
        &server,
        "builder_owner",
        &["mcp_servers::read", "mcp_servers::create"],
    )
    .await;
    let owner_server_id = register_user_server(&server, &owner.token, &mock.base_url()).await;

    // Non-admin, NOT in the default group, holding exactly read+create. Not an
    // admin on purpose — `has_admin_access` (is_admin OR any
    // `mcp_servers_admin::*`) bypasses the per-server access check entirely.
    let outsider = test_helpers::create_user_with_only_permissions(
        &server,
        "builder_outsider",
        &["mcp_servers::read", "mcp_servers::create"],
    )
    .await;

    // Positive control: the outsider CAN list tools on a server they own, so a
    // 403 below can only be the per-server access check — not a missing
    // permission and not a broken fixture.
    let own_server_id = register_user_server(&server, &outsider.token, &mock.base_url()).await;
    let (own_status, own_body) = get_tools(&server, &outsider.token, &own_server_id).await;
    assert_eq!(
        own_status, 200,
        "positive control: the outsider must be able to list their OWN server's tools \
         (otherwise the 403 below proves nothing): {own_body}"
    );

    let (status, body) = get_tools(&server, &outsider.token, &owner_server_id).await;
    assert_eq!(
        status, 403,
        "a user with `mcp_servers::read` but no access to this server must be refused: {body}"
    );
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .unwrap_or_else(|e| panic!("403 body was not JSON ({e}): {body}"));
    assert_eq!(
        parsed["error_code"], "USER_NO_ACCESS",
        "the per-server access check must be what refuses (distinct from the permission gate): \
         {body}"
    );
}
