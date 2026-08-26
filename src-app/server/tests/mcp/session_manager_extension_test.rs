//! TEST-4 — non-regression for the STANDALONE `ziee` binary.
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

const PERMS: &[&str] = &["mcp_servers_admin::create", "mcp_servers::read"];

const MISSING_EXTENSION: &str = "Missing request extension";

fn assert_handler_ran(route: &str, status: reqwest::StatusCode, body: &str) {
    assert!(
        !body.contains(MISSING_EXTENSION),
        "{route} returned the axum missing-extension rejection on the STANDALONE \
         binary — `manager::install` is no longer reached from `main.rs`. \
         status={status} body={body}",
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
        PERMS,
    )
    .await;

    let body = serde_json::json!({
        "name": "mcp-ext-probe",
        "display_name": "MCP Extension Probe",
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
    let text = res.text().await.unwrap_or_default();
    assert_handler_ran("POST /mcp/system-servers/test-connection", status, &text);
}

#[tokio::test]
async fn server_tools_route_runs_on_the_standalone_binary() {
    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "mcp_ext_standalone_tools",
        PERMS,
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
    let text = res.text().await.unwrap_or_default();
    assert_handler_ran("GET /mcp/servers/{id}/tools", status, &text);
}
