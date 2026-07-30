//! `GET /api/mcp/servers/{id}/tools` — upstream-failure status mapping and
//! response-body redaction.
//!
//! Two defects these tests lock down (both reproduced against a live instance
//! before the fix):
//!
//! 1. **Blanket 500.** An MCP server that is up but not ready answered the
//!    JSON-RPC POST with `503`, and this API turned that into
//!    `500 SYSTEM_INTERNAL_ERROR`. An upstream 503 is not an internal fault of
//!    this API; a caller could not tell "the dependency I asked about is down"
//!    apart from "this endpoint is broken".
//!
//! 2. **Raw subprocess stderr on the wire.** A stdio MCP server whose
//!    subprocess died during the handshake answered with
//!    `500 … "Failed to connect: … Server stderr: Traceback (most recent call
//!    last): File …"`. Subprocess stderr carries host filesystem paths,
//!    environment details and — for a server configured with credentials —
//!    potentially secrets. It belongs in the log, not the response body.
//!
//! The disabled-server case (`400 server_disabled`) was already mapped
//! deliberately and correctly; `disabled_server_still_maps_to_400` pins it so a
//! future widening of the upstream mapping can't swallow it.

use crate::common::{TestServer, test_helpers};
use crate::mcp::fixtures::mock_mcp_server::{MockMcpServer, MockResponse};
use serde_json::json;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// A body only an upstream MCP server would produce. If any part of it appears
/// in OUR response, we echoed third-party content back to the caller.
const UPSTREAM_BODY_SENTINEL: &str = "ZIEE_UPSTREAM_BODY_SENTINEL_code_sandbox_not_initialized";

/// A stderr payload shaped exactly like the one observed in the live
/// reproduction: a Python traceback carrying an absolute host path and a
/// credential-looking value.
const STDERR_TRACEBACK: &str = concat!(
    "Traceback (most recent call last):\n",
    "  File \"/home/ziee-operator/.cache/uv/archive-v0/ZIEE_STDERR_SENTINEL/bin/mcp-server-fetch\", line 6, in <module>\n",
    "    from mcp_server_fetch import main\n",
    "ImportError: cannot import name 'McpError' from 'mcp.shared.exceptions'\n",
    "UPSTREAM_TOKEN=sk-ZIEE_STDERR_SECRET_SENTINEL\n",
);

/// A `TestServer` whose create-time MCP health probe is bypassed.
///
/// `connection_health::enforce_on_create` probes any new `enabled: true`
/// non-built-in server and **auto-disables it on failure** — so a server that
/// cannot connect can never be registered in the enabled state directly. The
/// live defect was on a server that passed its probe and broke later (the box's
/// `uv` cache went bad after the row was created), which is exactly the state
/// this debug-only seam reproduces. Same env var the E2E suite uses
/// (`ui/tests/fixtures/test-context.ts`); compiled out of release builds.
async fn server_without_create_probe() -> TestServer {
    TestServer::start_with_options(crate::common::TestServerOptions {
        extra_env: vec![("ZIEE_DISABLE_MCP_HEALTH_CHECK".to_string(), "1".to_string())],
        ..Default::default()
    })
    .await
}

async fn admin(server: &TestServer) -> test_helpers::TestUser {
    test_helpers::create_user_with_permissions(
        server,
        "upstream_map_admin",
        &["mcp_servers_admin::create", "mcp_servers::read"],
    )
    .await
}

/// Register a **system** HTTP server pointed at `url`.
async fn register_http_server(server: &TestServer, token: &str, url: &str) -> String {
    register_system_server(
        server,
        token,
        json!({
            "name": format!("upstream_http_{}", &Uuid::new_v4().to_string()[..8]),
            "display_name": "Upstream mapping fixture (http)",
            "transport_type": "http",
            "url": url,
            "enabled": true,
            "timeout_seconds": 30,
        }),
    )
    .await
}

async fn register_system_server(
    server: &TestServer,
    token: &str,
    payload: serde_json::Value,
) -> String {
    let res = reqwest::Client::new()
        .post(server.api_url("/mcp/system-servers"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&payload)
        .send()
        .await
        .expect("register system MCP server");
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    assert_eq!(
        status, 201,
        "register system MCP server failed: {status}: {body}"
    );
    let row: serde_json::Value = serde_json::from_str(&body).expect("parse mcp server row");
    row["id"].as_str().expect("server id").to_string()
}

async fn get_tools(
    server: &TestServer,
    token: &str,
    server_id: &str,
) -> (reqwest::StatusCode, serde_json::Value, String) {
    let res = reqwest::Client::new()
        .get(server.api_url(&format!("/mcp/servers/{server_id}/tools")))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .expect("GET /mcp/servers/{id}/tools");
    let status = res.status();
    let raw = res.text().await.unwrap_or_default();
    let json: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null);
    (status, json, raw)
}

/// Program the mock to answer `tools/list` with a raw HTTP status + body,
/// letting `initialize` succeed — i.e. a server that is UP but not READY,
/// which is the shape of the live reproduction.
async fn mock_answering_tools_list_with(status: u16, body: &str) -> MockMcpServer {
    let mock = MockMcpServer::start().await;
    // FIFO queue; several copies so a reconnect/re-list still hits the
    // programmed response rather than the mock's empty-tools fallback.
    for _ in 0..6 {
        mock.on_method(
            "tools/list",
            MockResponse::Raw {
                status,
                content_type: "application/json",
                body: body.to_string(),
            },
        );
    }
    mock
}

// ---------------------------------------------------------------------------
// 1. Status mapping — upstream failures are not internal server errors
// ---------------------------------------------------------------------------

/// The exact live reproduction: upstream answers 503, we answered 500.
#[tokio::test]
async fn upstream_503_surfaces_as_503_not_500() {
    let server = TestServer::start().await;
    let user = admin(&server).await;

    let upstream_body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "error": { "code": -32603, "message": UPSTREAM_BODY_SENTINEL }
    })
    .to_string();
    let mock = mock_answering_tools_list_with(503, &upstream_body).await;
    let id = register_http_server(&server, &user.token, &mock.base_url()).await;

    let (status, body, raw) = get_tools(&server, &user.token, &id).await;

    assert_eq!(
        status, 503,
        "an upstream 503 must surface as 503, not 500 — body: {raw}"
    );
    assert_eq!(
        body["error_code"].as_str(),
        Some("MCP_UPSTREAM_UNAVAILABLE"),
        "stable error code expected — body: {raw}"
    );
}

/// A slow/timing-out upstream is a different operational condition from an
/// unavailable one, and the status must say so.
#[tokio::test]
async fn upstream_504_surfaces_as_gateway_timeout() {
    let server = TestServer::start().await;
    let user = admin(&server).await;

    let mock = mock_answering_tools_list_with(504, "upstream gateway timeout").await;
    let id = register_http_server(&server, &user.token, &mock.base_url()).await;

    let (status, body, raw) = get_tools(&server, &user.token, &id).await;

    assert_eq!(
        status, 504,
        "an upstream 504 must surface as 504 — body: {raw}"
    );
    assert_eq!(
        body["error_code"].as_str(),
        Some("MCP_UPSTREAM_TIMEOUT"),
        "body: {raw}"
    );
}

/// Any other non-2xx from a reachable upstream is a bad-gateway condition,
/// still not a 500.
#[tokio::test]
async fn upstream_500_surfaces_as_bad_gateway() {
    let server = TestServer::start().await;
    let user = admin(&server).await;

    let mock = mock_answering_tools_list_with(500, "upstream exploded").await;
    let id = register_http_server(&server, &user.token, &mock.base_url()).await;

    let (status, body, raw) = get_tools(&server, &user.token, &id).await;

    assert_eq!(
        status, 502,
        "an upstream 500 is OUR dependency failing, not our own internal fault — body: {raw}"
    );
    assert_eq!(
        body["error_code"].as_str(),
        Some("MCP_UPSTREAM_PROTOCOL_ERROR"),
        "body: {raw}"
    );
}

/// A transport that never connects at all (nothing listening on the port).
#[tokio::test]
async fn unreachable_http_upstream_surfaces_as_bad_gateway() {
    let server = server_without_create_probe().await;
    let user = admin(&server).await;

    // Bind then immediately drop, so the port is (almost certainly) free.
    let dead_port = {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap().port()
    };
    let id = register_http_server(
        &server,
        &user.token,
        &format!("http://127.0.0.1:{dead_port}/mcp"),
    )
    .await;

    let (status, body, raw) = get_tools(&server, &user.token, &id).await;

    assert_eq!(
        status, 502,
        "an unreachable upstream must not be reported as an internal error — body: {raw}"
    );
    assert_eq!(
        body["error_code"].as_str(),
        Some("MCP_UPSTREAM_UNREACHABLE"),
        "body: {raw}"
    );
}

// ---------------------------------------------------------------------------
// 2. Redaction — no upstream payload / subprocess stderr on the wire
// ---------------------------------------------------------------------------

/// The upstream's own response body is third-party content (for a built-in
/// loopback server it is our internal diagnostic; for an external one it is
/// whatever that operator emits). Either way it must not be echoed.
#[tokio::test]
async fn upstream_body_is_not_echoed_into_our_response() {
    let server = TestServer::start().await;
    let user = admin(&server).await;

    let upstream_body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "error": { "code": -32603, "message": UPSTREAM_BODY_SENTINEL }
    })
    .to_string();
    let mock = mock_answering_tools_list_with(503, &upstream_body).await;
    let id = register_http_server(&server, &user.token, &mock.base_url()).await;

    let (_status, _body, raw) = get_tools(&server, &user.token, &id).await;

    assert!(
        !raw.contains(UPSTREAM_BODY_SENTINEL),
        "the upstream response body leaked into our response: {raw}"
    );
    assert!(
        !raw.contains("-32603"),
        "the upstream JSON-RPC error payload leaked into our response: {raw}"
    );
}

/// **The serious half.** A stdio MCP server whose subprocess dies during the
/// handshake writes diagnostics to stderr. Those diagnostics used to be
/// appended verbatim to the HTTP response body.
///
/// The subprocess here is a script run through the host-allowlisted `node`
/// launcher (resolved to the embedded Bun runtime), which writes a
/// traceback-shaped payload — absolute host path and a credential-looking
/// value included — to stderr and exits non-zero. That is the environment
/// -independent construction of the live failure, which was originally
/// triggered by a broken `uv` cache.
#[tokio::test]
async fn stdio_connect_failure_does_not_leak_subprocess_stderr() {
    let server = server_without_create_probe().await;
    let user = admin(&server).await;

    // Script that prints the sentinel traceback to stderr, then dies — so
    // `serve()` fails on the initialize handshake with stderr captured.
    let script = std::env::temp_dir().join(format!("ziee-stderr-leak-{}.js", Uuid::new_v4()));
    std::fs::write(
        &script,
        format!(
            "process.stderr.write({});\nprocess.exit(1);\n",
            serde_json::to_string(STDERR_TRACEBACK).unwrap()
        ),
    )
    .expect("write stdio fixture script");

    let server_name = format!("upstream_stdio_{}", &Uuid::new_v4().to_string()[..8]);
    let id = register_system_server(
        &server,
        &user.token,
        json!({
            "name": server_name,
            "display_name": "Upstream mapping fixture (stdio)",
            "transport_type": "stdio",
            "command": "node",
            "args": [script.to_string_lossy()],
            "enabled": true,
            "run_in_sandbox": false,
            "timeout_seconds": 30,
        }),
    )
    .await;

    let (status, body, raw) = get_tools(&server, &user.token, &id).await;
    let _ = std::fs::remove_file(&script);

    // (a) status mapping
    assert_eq!(
        status, 502,
        "a subprocess that fails to start is a dependency failure, not an \
         internal fault of this API — body: {raw}"
    );
    assert_eq!(
        body["error_code"].as_str(),
        Some("MCP_UPSTREAM_UNREACHABLE"),
        "body: {raw}"
    );

    // (b) redaction — the whole point.
    for needle in [
        "Traceback",
        "ZIEE_STDERR_SENTINEL",
        "ZIEE_STDERR_SECRET_SENTINEL",
        "ImportError",
        "Server stderr",
        "/home/ziee-operator",
        "mcp_server_fetch",
    ] {
        assert!(
            !raw.contains(needle),
            "subprocess stderr leaked into the response body (found {needle:?}): {raw}"
        );
    }
    // Strongest form of the same guard: the message must be EXACTLY the
    // developer-authored template. A needle list only catches the leaks we
    // thought of; equality catches any appended text at all.
    assert_eq!(
        body["error"].as_str(),
        Some(
            format!(
                "Could not connect to MCP server '{server_name}'. The server failed to \
                 start or is not reachable; check the server logs for details."
            )
            .as_str()
        ),
        "the message must be the stable template with nothing appended: {raw}"
    );
    // Nothing that looks like an absolute host path at all.
    assert!(
        !raw.contains(".cache/"),
        "a host filesystem path leaked into the response body: {raw}"
    );

    // …and the operator can still correlate the response with the log line.
    assert!(
        body["details"]["trace_id"].is_string(),
        "a trace_id must be returned so the redacted detail stays findable: {raw}"
    );
}

// ---------------------------------------------------------------------------
// 3. Regression guard — the deliberate non-upstream mappings are untouched
// ---------------------------------------------------------------------------

/// A disabled server is a *client* error (the caller asked for something it
/// must first enable) and was already mapped to `400 server_disabled`. The
/// upstream mapping must not swallow it: nothing was ever contacted.
#[tokio::test]
async fn disabled_server_still_maps_to_400() {
    let server = TestServer::start().await;
    let user = admin(&server).await;

    let mock = MockMcpServer::start().await;
    let id = register_system_server(
        &server,
        &user.token,
        json!({
            "name": format!("upstream_disabled_{}", &Uuid::new_v4().to_string()[..8]),
            "display_name": "Upstream mapping fixture (disabled)",
            "transport_type": "http",
            "url": mock.base_url(),
            "enabled": false,
            "timeout_seconds": 30,
        }),
    )
    .await;

    let (status, body, raw) = get_tools(&server, &user.token, &id).await;

    assert_eq!(status, 400, "disabled server must stay a 400 — body: {raw}");
    assert_eq!(
        body["error_code"].as_str(),
        Some("server_disabled"),
        "body: {raw}"
    );
}
