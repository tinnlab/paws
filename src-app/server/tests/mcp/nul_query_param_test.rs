//! TEST-10 / TEST-11 / TEST-21 — the three MCP free-text query parameters
//! (`/mcp/servers?search`, `/mcp/system-servers?search`,
//! `/mcp/tool-calls?tool_use_id`) refuse a NUL with a typed 400, not a 500.

use reqwest::StatusCode;

use crate::common::TestServer;
use crate::common::nul_query_param::{assert_nul_is_rejected, get};
use crate::common::test_helpers::{create_user_with_no_permissions, create_user_with_permissions};

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

    // Seed a server the search can actually find.
    let resp = reqwest::Client::new()
        .post(server.api_url("/mcp/servers"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&serde_json::json!({
            "name": "roadmapper",
            "display_name": "roadmapper",
            "description": "nul query param fixture",
            "enabled": false,
            "transport_type": "http",
            "url": "https://example.com/mcp",
            "timeout_seconds": 30,
        }))
        .send()
        .await
        .expect("create mcp server");
    assert_eq!(resp.status(), StatusCode::CREATED, "seed mcp server");

    // (b) HAPPY-PATH COUNTERPART.
    let (status, body) = get(&server, &user.token, "/mcp/servers?search=roadmapper").await;
    assert_eq!(status, StatusCode::OK, "happy path: {body}");
    let names: Vec<String> = body["servers"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|s| s["name"].as_str().unwrap_or_default().to_string())
        .collect();
    assert!(
        names.iter().any(|n| n == "roadmapper"),
        "the seeded server must match: {body}"
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

    // (b) HAPPY-PATH COUNTERPART — the built-in system servers are seeded at
    // boot, so a substring of one of them returns at least one row.
    let (status, body) = get(&server, &admin.token, "/mcp/system-servers?search=e").await;
    assert_eq!(status, StatusCode::OK, "happy path: {body}");
    assert!(
        body["servers"].as_array().is_some_and(|a| !a.is_empty()),
        "at least one built-in system server must match 'e': {body}"
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

    // (b) HAPPY-PATH COUNTERPART — a syntactically fine id that matches
    // nothing must return 200 with an empty page. This proves the parameter
    // genuinely reaches the filter (rather than being ignored, which would
    // make the 400 below meaningless).
    let (status, body) = get(
        &server,
        &user.token,
        "/mcp/tool-calls?tool_use_id=toolu_notarealid",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "happy path: {body}");
    assert_eq!(body["total"], 0, "no call has that id: {body}");

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

/// REGRESSION (blind audit, round 1) — `?tool_use_id=` must stay a filter.
///
/// The repository binds `AND ($5::text IS NULL OR tool_use_id = $5)`, so
/// mapping a blank value to `None` would widen `?tool_use_id=` from an empty
/// page to the caller's ENTIRE tool-call history. `guard_raw` keeps the empty
/// string an empty string.
#[tokio::test]
async fn empty_tool_use_id_still_filters_and_does_not_widen() {
    let server = TestServer::start().await;
    let user =
        create_user_with_permissions(&server, "toolcall_empty", &["mcp_servers::read"]).await;

    let (status, body) = get(&server, &user.token, "/mcp/tool-calls?tool_use_id=").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["total"], 0,
        "an empty tool_use_id must match nothing, not fall back to unfiltered: {body}"
    );
}
