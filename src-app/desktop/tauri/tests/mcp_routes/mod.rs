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
//! harness; it was binary selection. All 57 files under `server/tests/mcp/`
//! spawn the `ziee` binary via `TestServer::start()`, whose router never runs
//! the desktop route-builder closure, so a defect in the desktop assembly is
//! structurally invisible to them no matter what they assert.
//! `TestServer::start_desktop()` spawns `ziee-desktop --headless`, which is the
//! same `setup_server` path the production Tauri shell boots.
//!
//! **Why each test pins a status AND an error code.** A bare "not 500"
//! assertion is satisfied by a 404/405 from a router that no longer mounts the
//! route, so it cannot distinguish "handler ran" from "route gone". Each test
//! below asserts something only the handler itself can produce.

use serde_json::json;
use uuid::Uuid;

/// `POST /mcp/system-servers/test-connection` is gated on
/// `mcp_servers_admin::create`.
const ADMIN_PERMS: &[&str] = &["mcp_servers_admin::create"];

/// `GET /mcp/servers/{id}/tools` is gated on `mcp_servers::read`.
///
/// Deliberately does NOT include any `mcp_servers_admin::*` permission:
/// `has_admin_access` (`runtime.rs:49-63`) treats ANY of those four as an admin
/// and skips `can_user_access_server` entirely. Granting one here would silently
/// route the test through that bypass, leaving the ownership branch untested and
/// coupling the expected status to the exact contents of `MCP_ADMIN_PERMISSIONS`.
const READ_PERMS: &[&str] = &["mcp_servers::read"];

/// The axum rejection body when a handler's `Extension<T>` is not in the
/// request extensions. Matched as a substring so a future axum wording change
/// still trips the status assertion beside it.
const MISSING_EXTENSION: &str = "Missing request extension";

/// Error codes emitted by the auth/permission extractors, i.e. BEFORE the
/// session-manager extension is looked up.
///
/// axum runs `FromRequestParts` extractors left-to-right and every one of these
/// handlers declares `auth: RequirePermissions<..>` ahead of
/// `Extension(session_manager)`. So any of these short-circuits before the
/// extension lookup and would satisfy a naive "not 500" assertion while proving
/// nothing. Rename a permission constant, change the harness's group seeding, or
/// break token minting, and these tests would turn permanently green with the
/// ship-blocker fully restored.
///
/// Matched on the CODE, not the status, because the handlers themselves also
/// return 403 (`USER_NO_ACCESS` from `can_user_access_server`) from their own
/// body — and that 403 means the extension already resolved, which is a valid
/// proof and must not be rejected here.
const PRE_HANDLER_REJECTIONS: &[&str] = &[
    "MISSING_TOKEN",
    "INVALID_TOKEN",
    "INSUFFICIENT_PERMISSIONS",
    "USER_NOT_FOUND",
    "USER_INACTIVE",
];

/// Assert the handler actually RAN, and that we got far enough to prove it.
fn assert_handler_ran(route: &str, status: reqwest::StatusCode, body: &str) {
    for code in PRE_HANDLER_REJECTIONS {
        assert!(
            !body.contains(code),
            "{route} was rejected with {code} BEFORE the \
             `Extension<Arc<McpSessionManager>>` extractor ran, so this test proved \
             nothing about the fix. Fix the test's permissions, do not relax this \
             assertion. status={status} body={body}",
        );
    }
    assert!(
        !body.contains(MISSING_EXTENSION),
        "{route} returned the axum missing-extension rejection — the MCP session \
         manager is not installed on this router assembly. \
         `install_mcp_session_manager` must be called from `lib.rs::setup_server` \
         (the desktop boot path), not only from `main.rs`. status={status} body={body}",
    );
    assert!(
        status != reqwest::StatusCode::INTERNAL_SERVER_ERROR,
        "{route} returned 500. If the body is not the missing-extension rejection \
         this is some OTHER internal error (e.g. a transient DB failure), not \
         necessarily the session manager. status={status} body={body}",
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
        ADMIN_PERMS,
    )
    .await;

    // Exactly the fields `TestMcpConnectionRequest` declares — it has no
    // `name`/`display_name` and does not `deny_unknown_fields`, so extra keys
    // would be silently dropped and make the payload read as if it exercised
    // something it does not. The loopback URL is unreachable on purpose: the
    // probe is EXPECTED to fail to connect and to report that in a 200 body.
    let body = json!({
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

    // A router that no longer mounts this route answers 405, so pinning 200 +
    // the response shape also pins route existence.
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

/// TEST-2 — the `runtime.rs` handler family, so the fix is proven for more than
/// the one route the bug was reported on.
///
/// Uses a NON-admin user and an id they cannot access, so the request travels
/// all the way into the handler body and is refused by `can_user_access_server`
/// — exercising the ownership branch rather than the `has_admin_access` bypass.
/// `USER_NO_ACCESS` is a code only that handler produces, so this pins route
/// existence too: an unmounted route answers 404/405 with an empty body and
/// fails both assertions below.
#[tokio::test]
async fn server_tools_route_runs_on_the_desktop_router() {
    let server = crate::common::TestServer::start_desktop().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "mcp_routes_user_tools",
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
        "the refusal must come from `can_user_access_server` INSIDE the handler \
         (which proves the extension resolved), not from the router or an \
         extractor; got {text}",
    );
}

// NOTE: a third test probing a BUILT-IN system server through
// `probe_builtin_server` was written and then removed. Built-ins are
// deliberately excluded from `list_system_mcp_servers` ("hide the built-ins
// configured elsewhere"), so its "no built-in visible → return" branch fired
// unconditionally and it passed even against the un-fixed binary. A test that
// cannot fail is worse than no test; the two above both went RED on the pre-fix
// binary and are the real pins.
//
// It IS fixable — discover a built-in by reading `mcp_servers` directly via
// `server.database_url` with `fetch_one().expect(..)`, so an unseeded DB fails
// loudly instead of skipping. That would additionally prove the manager is
// USABLE (`probe_builtin_server` dereferences it) rather than merely present,
// which nothing here covers. Left as a follow-up: it is orthogonal to the
// missing-Extension defect. See TESTS.md.
