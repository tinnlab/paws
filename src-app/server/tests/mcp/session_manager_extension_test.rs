//! TEST-3 — non-regression for the STANDALONE `ziee` binary.
//!
//! The MCP session manager used to be installed only in `main.rs`; it now goes
//! in through the one shared `manager::install` site that `lib.rs::setup_server`
//! also calls. That move is what fixes the desktop build (see
//! `desktop/tauri/tests/mcp_routes/`), and this file is the other half of the
//! contract: the binary that already worked must keep working.
//!
//! Deliberately mirrors the desktop assertions route-for-route so a future edit
//! that reintroduces the split fails on whichever side it breaks.

use uuid::Uuid;

/// `POST /mcp/system-servers/test-connection` is gated on `mcp_servers_admin::create`.
const ADMIN_PERMS: &[&str] = &["mcp_servers_admin::create"];

/// `GET /mcp/servers/{id}/tools` is gated on `mcp_servers::read`. Deliberately
/// no `mcp_servers_admin::*` — that would trip `has_admin_access` and skip the
/// ownership branch, exactly as on the desktop side.
const READ_PERMS: &[&str] = &["mcp_servers::read"];

const MISSING_EXTENSION: &str = "Missing request extension";

/// Codes emitted by the auth/permission extractors, i.e. BEFORE the
/// session-manager extension is looked up. Without this guard a permission
/// regression would short-circuit every request and turn these tests
/// permanently green — the handlers declare `auth: RequirePermissions<..>`
/// ahead of `Extension(session_manager)`, and axum runs extractors in order.
/// Matched on the CODE, not the status: the handlers also return 403
/// (`USER_NO_ACCESS`) from their own body, which is a valid proof.
const PRE_HANDLER_REJECTIONS: &[&str] = &[
    "MISSING_TOKEN",
    "INVALID_TOKEN",
    "INSUFFICIENT_PERMISSIONS",
    "USER_NOT_FOUND",
    "USER_INACTIVE",
];

fn assert_handler_ran(route: &str, status: reqwest::StatusCode, body: &str) {
    for code in PRE_HANDLER_REJECTIONS {
        assert!(
            !body.contains(code),
            "{route} was rejected with {code} before the extension extractor ran — \
             this test proved nothing. status={status} body={body}",
        );
    }
    assert!(
        !body.contains(MISSING_EXTENSION),
        "{route} returned the axum missing-extension rejection on the STANDALONE \
         binary — `install_mcp_session_manager` is no longer reached from \
         `main.rs`. status={status} body={body}",
    );
    assert!(
        status != reqwest::StatusCode::INTERNAL_SERVER_ERROR,
        "{route} returned 500 on the standalone binary. status={status} body={body}",
    );
}

#[tokio::test]
async fn system_test_connection_runs_on_the_standalone_binary() {
    let server = crate::common::TestServer::start().await;
    let admin = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "mcp_ext_standalone_testconn",
        ADMIN_PERMS,
    )
    .await;

    // Exactly the fields `TestMcpConnectionRequest` declares.
    let body = serde_json::json!({
        "transport_type": "http",
        "url": "http://127.0.0.1:1/never-reached",
    });

    let res = reqwest::Client::new()
        .post(server.api_url("/mcp/system-servers/test-connection"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&body)
        .send()
        .await
        .expect("POST /api/mcp/system-servers/test-connection failed to send");

    let status = res.status();
    let text = res.text().await.expect("response body must be readable");
    assert_handler_ran("POST /mcp/system-servers/test-connection", status, &text);

    // Mirrors the desktop assertions exactly — without these, unmounting the
    // route or stubbing the handler would leave this test green.
    assert_eq!(
        status,
        reqwest::StatusCode::OK,
        "test-connection should complete and report the failed probe in a 200 \
         body; got {status} — body={text}",
    );
    assert!(
        text.contains("\"success\""),
        "the 200 body should be a TestMcpConnectionResponse; got {text}",
    );
}

#[tokio::test]
async fn server_tools_route_runs_on_the_standalone_binary() {
    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "mcp_ext_standalone_tools",
        READ_PERMS,
    )
    .await;

    let unknown = Uuid::new_v4();
    let res = reqwest::Client::new()
        .get(server.api_url(&format!("/mcp/servers/{unknown}/tools")))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .expect("GET /api/mcp/servers/{id}/tools failed to send");

    let status = res.status();
    let text = res.text().await.expect("response body must be readable");
    assert_handler_ran("GET /mcp/servers/{id}/tools", status, &text);

    assert_eq!(
        status,
        reqwest::StatusCode::FORBIDDEN,
        "a non-admin asking for a server they cannot access should reach the \
         handler and be refused there; got {status} — body={text}",
    );
    assert!(
        text.contains("USER_NO_ACCESS"),
        "the refusal must come from `can_user_access_server` INSIDE the handler; \
         got {text}",
    );
}
