//! Regression tests for the MCP runtime REST routes on the **desktop** router
//! assembly.
//!
//! These exist because of a shipped ship-blocker: every MCP runtime route
//! answered
//!
//! ```text
//! 500  Missing request extension: Extension of type
//!      `alloc::sync::Arc<ziee::modules::mcp::client::manager::McpSessionManager>`
//! ```
//!
//! on the desktop build, including the UI's **Test Connection** button. The
//! manager was installed only in `main.rs`, so the standalone `ziee` binary had
//! it and every desktop entrypoint — which boots
//! `server_boot -> ziee::start_server_with_routes -> lib.rs::setup_server` —
//! did not.
//!
//! **Why these live in the desktop crate.** The blind spot was never the
//! harness; it was binary selection. All 57 files under
//! `server/tests/mcp/` spawn the `ziee` binary via `TestServer::start()`, whose
//! router never runs the desktop route-builder closure, so a defect in the
//! desktop assembly is structurally invisible to them no matter what they
//! assert. `TestServer::start_desktop()` spawns `ziee-desktop --headless`, which
//! is the same `setup_server` path the production Tauri shell boots.
//!
//! The assertion is deliberately **"not 500 / not a missing-extension body"**
//! rather than an exact status: the point is that the handler RAN. A 200 (the
//! probe completed) and a 4xx (bad config, unreachable upstream) both prove the
//! extension resolved; only the extension-rejection 500 proves it did not.

use serde_json::json;
use uuid::Uuid;

/// `POST /mcp/system-servers/test-connection` is gated on
/// `mcp_servers_admin::create`; `GET /mcp/servers/{id}/tools` on
/// `mcp_servers::read`.
const PERMS: &[&str] = &["mcp_servers_admin::create", "mcp_servers::read"];

/// The axum rejection body when a handler's `Extension<T>` is not in the
/// request extensions. Matched as a substring so a future axum wording change
/// still trips the status assertion above it.
const MISSING_EXTENSION: &str = "Missing request extension";

fn assert_handler_ran(route: &str, status: reqwest::StatusCode, body: &str) {
    assert!(
        !body.contains(MISSING_EXTENSION),
        "{route} returned the axum missing-extension rejection — the MCP session \
         manager is not installed on this router assembly. \
         `manager::install` must be called from `lib.rs::setup_server` (the \
         desktop boot path), not only from `main.rs`. status={status} body={body}",
    );
    assert!(
        status != reqwest::StatusCode::INTERNAL_SERVER_ERROR,
        "{route} returned 500 — the handler did not run to completion. \
         status={status} body={body}",
    );
}

/// TEST-1 [acceptance] [invariant: INV-1] — the literal reported sequence: the
/// UI's Test Connection button on a system MCP server.
#[tokio::test]
async fn system_test_connection_runs_on_the_desktop_router() {
    let server = crate::common::TestServer::start_desktop().await;
    let admin = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "mcp_routes_admin_testconn",
        PERMS,
    )
    .await;

    // An unreachable loopback URL: the probe is EXPECTED to fail to connect.
    // That failure is reported in the 200 body as `success: false`, which still
    // proves the handler ran. What must never happen is the extension
    // rejection.
    let body = json!({
        "name": "mcp-routes-probe",
        "display_name": "MCP Routes Probe",
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

/// TEST-2 — the `runtime.rs` handler family, so the fix is proven for more than
/// the one route the bug was reported on. Uses a random id: the handler resolves
/// the server row (404 / 403) only AFTER the extension has been extracted, so a
/// non-500 here still proves the extension resolved.
#[tokio::test]
async fn server_tools_route_runs_on_the_desktop_router() {
    let server = crate::common::TestServer::start_desktop().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "mcp_routes_user_tools",
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

// NOTE: a third test probing a BUILT-IN system server through
// `probe_builtin_server` was written and then removed. Built-ins are
// deliberately excluded from `list_system_mcp_servers` ("hide the built-ins
// configured elsewhere"), so its "no built-in visible → return" branch fired
// unconditionally and it passed even against the un-fixed binary. A test that
// cannot fail is worse than no test; the two above both went RED on the
// pre-fix binary and are the real pins.
