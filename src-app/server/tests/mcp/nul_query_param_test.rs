//! TEST-10 / TEST-11 / TEST-21 — the three MCP free-text query parameters
//! (`/mcp/servers?search`, `/mcp/system-servers?search`,
//! `/mcp/tool-calls?tool_use_id`) refuse a NUL with a typed 400, not a 500.

use reqwest::StatusCode;

use crate::common::TestServer;
use crate::common::nul_query_param::{assert_nul_is_rejected, get};
use crate::common::test_helpers::{create_user_with_no_permissions, create_user_with_permissions};

/// The `name` of every server in a list response.
fn server_names(body: &serde_json::Value) -> Vec<String> {
    body["servers"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|s| s["name"].as_str().unwrap_or_default().to_string())
        .collect()
}

/// Create a user-owned MCP server (http transport, disabled, so no probe).
async fn seed_server(server: &TestServer, token: &str, name: &str) {
    let resp = reqwest::Client::new()
        .post(server.api_url("/mcp/servers"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({
            "name": name,
            "display_name": name,
            "description": "nul query param fixture",
            "enabled": false,
            "transport_type": "http",
            "url": "https://example.com/mcp",
            "timeout_seconds": 30,
        }))
        .send()
        .await
        .expect("create mcp server");
    assert_eq!(resp.status(), StatusCode::CREATED, "seed mcp server {name}");
}

/// TEST-10 — `/mcp/servers?search` (the endpoint from the original report).
#[tokio::test]
async fn mcp_servers_search_rejects_nul_and_still_searches() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(
        &server,
        "mcp_nul",
        &["mcp_servers::read", "mcp_servers::create"],
    )
    .await;

    // Seed TWO servers, only one matching, so the happy-path leg proves the
    // filter SELECTS rather than merely that the list is non-empty. With one
    // seeded server, a handler ignoring `search` returns an identical body.
    seed_server(&server, &user.token, "roadmapper").await;
    seed_server(&server, &user.token, "kittenserver").await;

    // (b) HAPPY-PATH COUNTERPART — selects one, EXCLUDES the other.
    let (status, body) = get(&server, &user.token, "/mcp/servers?search=roadmapper").await;
    assert_eq!(status, StatusCode::OK, "happy path: {body}");
    let names = server_names(&body);
    assert!(
        names.iter().any(|n| n == "roadmapper"),
        "the matching server must be returned: {body}"
    );
    assert!(
        !names.iter().any(|n| n == "kittenserver"),
        "the non-matching server must be EXCLUDED — otherwise the filter is \
         being ignored and this leg proves nothing: {body}"
    );

    // (a) The defect.
    assert_nul_is_rejected(
        &server,
        &user.token,
        "/mcp/servers?page=1&per_page=10&search=%00",
    )
    .await;

    // (c) PERMISSION CONTROL — the 400 above is a validation refusal, not an
    // authz refusal: without the read permission the SAME URL is a 403.
    let nobody = create_user_with_no_permissions(&server, "mcp_nul_noperm").await;
    let (status, _) = get(&server, &nobody.token, "/mcp/servers?search=roadmapper").await;
    assert_eq!(status, StatusCode::FORBIDDEN, "unpermitted caller");
}

/// TEST-11 — `/mcp/system-servers?search` (admin-gated).
#[tokio::test]
async fn mcp_system_servers_search_rejects_nul_behind_the_admin_gate() {
    let server = TestServer::start().await;
    let admin =
        create_user_with_permissions(&server, "mcp_sys_nul", &["mcp_servers_admin::read"]).await;

    // (b) HAPPY-PATH COUNTERPART — DISCRIMINATING. The built-in system servers
    // are boot-seeded, so the baseline is non-empty; a term matching a strict
    // SUBSET is what proves the filter is read. ("search=e" would have matched
    // essentially everything and could not fail.) The term is picked from what
    // this endpoint actually LISTS — several built-ins (web_search,
    // lit_search, citations, memory, …) are deliberately hidden from the
    // System MCP page because they are configured on their own settings pages.
    let (status, all) = get(&server, &admin.token, "/mcp/system-servers?per_page=100").await;
    assert_eq!(status, StatusCode::OK, "{all}");
    let total_all = all["servers"].as_array().map(|a| a.len()).unwrap_or(0);
    assert!(total_all > 1, "several built-in servers are seeded: {all}");

    let (status, body) = get(
        &server,
        &admin.token,
        "/mcp/system-servers?per_page=100&search=background",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "happy path: {body}");
    let matched = server_names(&body);
    assert!(
        !matched.is_empty(),
        "'background' must match a listed built-in: {body}"
    );
    assert!(
        matched.len() < total_all,
        "the filter must select a STRICT SUBSET of the {total_all} servers, \
         else it is being ignored: {body}"
    );
    assert!(
        matched.iter().all(|n| n.contains("background")),
        "every returned server must actually match the term: {body}"
    );

    // (a) The defect.
    assert_nul_is_rejected(
        &server,
        &admin.token,
        "/mcp/system-servers?page=1&per_page=10&search=%00",
    )
    .await;

    // (c) PERMISSION CONTROL — a non-admin gets 403 on BOTH URLs, so the
    // validation error is only ever reached after the admin gate.
    let nobody = create_user_with_no_permissions(&server, "mcp_sys_nul_noperm").await;
    for path in [
        "/mcp/system-servers?search=e",
        "/mcp/system-servers?search=%00",
    ] {
        let (status, _) = get(&server, &nobody.token, path).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "unpermitted caller on {path}"
        );
    }
}

/// TEST-21 — `/mcp/tool-calls?tool_use_id`, an exact-match text bind
/// (`tool_use_id = $5`) that was not in the reported defect.
#[tokio::test]
async fn mcp_tool_calls_tool_use_id_rejects_nul() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "toolcall_nul", &["mcp_servers::read"]).await;

    // (b) HAPPY-PATH COUNTERPART — DISCRIMINATING: two calls are seeded and
    // the filter must select exactly one. Asserting `total == 0` for a
    // nonexistent id on an EMPTY table would prove nothing: the unfiltered
    // list is also 0, so an endpoint ignoring `tool_use_id` passes too.
    insert_call(&server, &user.user_id, "toolu_alpha").await;
    insert_call(&server, &user.user_id, "toolu_beta").await;

    let (status, all) = get(&server, &user.token, "/mcp/tool-calls").await;
    assert_eq!(status, StatusCode::OK, "{all}");
    assert_eq!(all["total"], 2, "two seeded calls are visible: {all}");

    let (status, body) = get(
        &server,
        &user.token,
        "/mcp/tool-calls?tool_use_id=toolu_alpha",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "happy path: {body}");
    assert_eq!(body["total"], 1, "a real id selects one of two: {body}");

    let (_, none) = get(
        &server,
        &user.token,
        "/mcp/tool-calls?tool_use_id=toolu_notarealid",
    )
    .await;
    assert_eq!(none["total"], 0, "an unknown id selects none: {none}");

    // (a) The defect.
    assert_nul_is_rejected(&server, &user.token, "/mcp/tool-calls?tool_use_id=%00").await;

    // (c) PERMISSION CONTROL.
    let nobody = create_user_with_no_permissions(&server, "toolcall_nul_noperm").await;
    let (status, _) = get(
        &server,
        &nobody.token,
        "/mcp/tool-calls?tool_use_id=toolu_notarealid",
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "unpermitted caller");
}

/// Insert an owner-scoped `mcp_tool_calls` row. Mirrors
/// `tool_call_lookup_test.rs::insert_call` — direct SQL, because recording a
/// real call needs a live MCP server.
async fn insert_call(server: &TestServer, user_id: &str, tool_use_id: &str) {
    let pool = sqlx::PgPool::connect(&server.database_url).await.unwrap();
    sqlx::query(
        "INSERT INTO mcp_tool_calls \
         (id, user_id, server_name, tool_name, tool_use_id, status, source) \
         VALUES ($1, $2, 'srv', 'tool', $3, 'completed', 'chat')",
    )
    .bind(uuid::Uuid::new_v4())
    .bind(uuid::Uuid::parse_str(user_id).unwrap())
    .bind(tool_use_id)
    .execute(&pool)
    .await
    .expect("insert tool call");
}

/// REGRESSION (blind audit, round 1) — `?tool_use_id=` must stay a filter.
///
/// The repository binds `AND ($5::text IS NULL OR tool_use_id = $5)`, so
/// mapping a blank value to `None` would widen `?tool_use_id=` from an empty
/// page to the caller's ENTIRE tool-call history. `guard_raw` keeps the empty
/// string an empty string.
///
/// REAL rows are seeded: with an empty table, "filtered = 0" and
/// "unfiltered = 0" are indistinguishable and the test could not fail.
#[tokio::test]
async fn empty_tool_use_id_still_filters_and_does_not_widen() {
    let server = TestServer::start().await;
    let user =
        create_user_with_permissions(&server, "toolcall_empty", &["mcp_servers::read"]).await;
    insert_call(&server, &user.user_id, "toolu_alpha").await;
    insert_call(&server, &user.user_id, "toolu_beta").await;

    // The unfiltered history is NON-EMPTY — this is what gives the assertion
    // below something to fail against.
    let (status, all) = get(&server, &user.token, "/mcp/tool-calls").await;
    assert_eq!(status, StatusCode::OK, "{all}");
    assert_eq!(all["total"], 2, "two seeded calls must be visible: {all}");

    // A real id selects a strict subset — proves the parameter is read.
    let (_, one) = get(
        &server,
        &user.token,
        "/mcp/tool-calls?tool_use_id=toolu_alpha",
    )
    .await;
    assert_eq!(one["total"], 1, "a real id selects one of two: {one}");

    // The regression: an EMPTY value must match nothing, not return both.
    let (status, body) = get(&server, &user.token, "/mcp/tool-calls?tool_use_id=").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["total"], 0,
        "an empty tool_use_id binds the empty string and must match nothing; \
         returning the unfiltered 2 rows is the widening bug: {body}"
    );
}
