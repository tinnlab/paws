//! The boot health sweep must not false-fail — or disable — a sandboxed server.
//!
//! Reported symptom: a system stdio server with `run_in_sandbox = true,
//! sandbox_flavor = full, command = Rscript` was auto-disabled at boot with
//!
//! ```text
//! Command 'Rscript' is not allowed on the host.
//!   Allowed commands: [npx, uvx, python, python3, node].
//!   Enable run-in-sandbox to use any command.
//! ```
//!
//! i.e. the admin was told to enable a flag their row already had.
//!
//! Two independent defects produced that:
//!   1. `run_startup_health_check` probed `run_in_sandbox` servers at all —
//!      the guard `enforce_on_create` and `enforce_on_update` both apply, for a
//!      reason documented at the create site that predicts this exact failure
//!      ("if we probed the raw command on the host, false-fail any guest-only
//!      command").
//!   2. It then flipped `enabled = false`, silently undoing an admin's config
//!      from a background task with no human present.
//!
//! These tests drive the REAL sweep (`ziee::mcp_connection_health::
//! run_startup_health_check`) against the test database, so they exercise the
//! shipped logic rather than a restatement of it.

use serde_json::json;
use sqlx::postgres::{PgPool, PgPoolOptions};
use uuid::Uuid;

const ADMIN_PERMS: &[&str] = &["mcp_servers_admin::create"];

/// The host-allowlist rejection. Its presence on a SANDBOXED row is the bug.
const HOST_ALLOWLIST_MSG: &str = "is not allowed on the host";

async fn test_pool(database_url: &str) -> PgPool {
    PgPoolOptions::new()
        .max_connections(2)
        .connect(database_url)
        .await
        .expect("connect to test db")
}

async fn row(pool: &PgPool, id: Uuid) -> (bool, Option<String>, Option<String>) {
    sqlx::query_as::<_, (bool, Option<String>, Option<String>)>(
        "SELECT enabled, last_health_check_status, last_health_check_reason \
         FROM mcp_servers WHERE id = $1",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .expect("SELECT mcp_servers")
}

/// Create a system MCP server and return its id. `create` does not probe
/// sandboxed rows, so a sandboxed one lands `enabled: true`.
async fn create_system_server(
    server: &crate::common::TestServer,
    token: &str,
    body: serde_json::Value,
) -> Uuid {
    let res = reqwest::Client::new()
        .post(server.api_url("/mcp/system-servers"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&body)
        .send()
        .await
        .expect("POST /api/mcp/system-servers failed to send");
    let status = res.status();
    let text = res.text().await.expect("body");
    assert!(status.is_success(), "create failed: {status} — {text}");
    serde_json::from_str::<serde_json::Value>(&text)
        .expect("create response JSON")
        .get("id")
        .and_then(|v| v.as_str())
        .expect("created id")
        .parse()
        .expect("id parses")
}

/// TEST-1 [acceptance] [invariant: INV-1] — the reported row shape survives a
/// boot sweep untouched and is never probed on the host.
#[tokio::test]
async fn boot_sweep_does_not_host_probe_or_disable_a_sandboxed_stdio_server() {
    let server = crate::common::TestServer::start().await;
    let admin = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "boot_probe_admin_sandboxed",
        ADMIN_PERMS,
    )
    .await;
    let pool = test_pool(&server.database_url).await;

    // The owner's `rcpa` row, reduced to what matters.
    let id = create_system_server(
        &server,
        &admin.token,
        json!({
            "name": "boot-probe-rcpa",
            "display_name": "Boot Probe RCPA",
            "transport_type": "stdio",
            "command": "Rscript",
            "args": ["-e", "rcpa.mcpserver::start_stdio_server()"],
            "enabled": true,
            "run_in_sandbox": true,
            "sandbox_flavor": "full",
        }),
    )
    .await;

    let (enabled_before, _, _) = row(&pool, id).await;
    assert!(enabled_before, "create must leave a sandboxed row enabled");

    ziee::mcp_connection_health::run_startup_health_check(pool.clone()).await;

    let (enabled, status, reason) = row(&pool, id).await;
    let reason_text = reason.unwrap_or_default();

    assert!(
        !reason_text.contains(HOST_ALLOWLIST_MSG),
        "a sandboxed server must never be probed on the host path — it cannot \
         run a guest-only command there, and the resulting message tells the \
         admin to enable a flag this row already sets. reason={reason_text}",
    );
    assert!(
        enabled,
        "the boot sweep must not disable an admin's sandboxed server; \
         status={status:?} reason={reason_text}",
    );
    assert_eq!(
        status.as_deref(),
        Some("untested"),
        "a skipped sandboxed row should be recorded as untested rather than left \
         with a stale badge from a previous run; reason={reason_text}",
    );

    pool.close().await;
}

/// TEST-2 [acceptance] [invariant: INV-2] — a genuinely unreachable, NON-sandboxed
/// server is recorded unhealthy but is NOT disabled by the background sweep.
#[tokio::test]
async fn boot_sweep_records_but_does_not_disable_an_unreachable_server() {
    let server = crate::common::TestServer::start().await;
    let admin = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "boot_probe_admin_unreachable",
        ADMIN_PERMS,
    )
    .await;
    let pool = test_pool(&server.database_url).await;

    // Created disabled so the create-time probe (which DOES auto-disable, by
    // design — a human is acting there) does not run; then enabled directly in
    // the DB so the sweep sees an enabled, unreachable row.
    //
    // Deliberately STDIO with a host-allowed command, not HTTP: `probe` resolves
    // stored OAuth via the process-global `Repos` for HTTP rows only, and that
    // global is not initialised in the test process — an HTTP row here panics on
    // harness plumbing instead of exercising the sweep. `node` is on the host
    // allowlist and the script does not exist, so the launch fails for a real,
    // non-sandbox reason. NOT `run_in_sandbox`, so the sweep must still probe it.
    let id = create_system_server(
        &server,
        &admin.token,
        json!({
            "name": "boot-probe-unreachable",
            "display_name": "Boot Probe Unreachable",
            "transport_type": "stdio",
            "command": "node",
            "args": ["/nonexistent/boot-probe-never-here.js"],
            "enabled": false,
        }),
    )
    .await;
    sqlx::query("UPDATE mcp_servers SET enabled = true WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .expect("enable row");

    ziee::mcp_connection_health::run_startup_health_check(pool.clone()).await;

    let (enabled, status, reason) = row(&pool, id).await;
    assert_eq!(
        status.as_deref(),
        Some("unhealthy"),
        "the sweep must still RECORD the failure; reason={reason:?}",
    );
    assert!(
        reason.is_some(),
        "an unhealthy verdict must carry its reason so the badge can explain itself",
    );
    assert!(
        enabled,
        "a background sweep must not undo an admin's configuration — it records, \
         only a user action (create/enable) may disable",
    );

    pool.close().await;
}

/// TEST-4 — Test Connection tells the truth about a stored sandboxed row instead
/// of emitting the host-allowlist message.
#[tokio::test]
async fn test_connection_reports_that_it_cannot_validate_a_sandboxed_server() {
    let server = crate::common::TestServer::start().await;
    let admin = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "boot_probe_admin_testconn",
        ADMIN_PERMS,
    )
    .await;
    let pool = test_pool(&server.database_url).await;

    let id = create_system_server(
        &server,
        &admin.token,
        json!({
            "name": "boot-probe-testconn",
            "display_name": "Boot Probe TestConn",
            "transport_type": "stdio",
            "command": "Rscript",
            "args": ["-e", "rcpa.mcpserver::start_stdio_server()"],
            "enabled": true,
            "run_in_sandbox": true,
            "sandbox_flavor": "full",
        }),
    )
    .await;

    let res = reqwest::Client::new()
        .post(server.api_url("/mcp/system-servers/test-connection"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&json!({ "id": id, "transport_type": "stdio", "command": "Rscript" }))
        .send()
        .await
        .expect("POST test-connection failed to send");

    let status = res.status();
    let text = res.text().await.expect("body");
    assert!(status.is_success(), "{status} — {text}");
    assert!(
        !text.contains(HOST_ALLOWLIST_MSG),
        "Test Connection always probes on the host, so for a sandboxed row it must \
         say it cannot validate it — not blame the host allowlist and send the \
         admin after a flag their row already sets. body={text}",
    );
    assert!(
        text.contains("cannot validate"),
        "the response should state the limitation explicitly; body={text}",
    );

    // TEST-6 [invariant: INV-2] — and it must not be RECORDED as a verdict.
    //
    // The response carries `success: false` because no handshake happened, and
    // the record block keys off exactly that field. Left alone it writes
    // `unhealthy`, painting the badge red with a message whose own text says
    // the server is fine — and re-creating the red badge the boot skip exists
    // to clear. "Could not test" is not "failed".
    let (enabled, status, reason) = row(&pool, id).await;
    assert_eq!(
        status.as_deref(),
        Some("untested"),
        "a test that could not run is not a failed test; reason={reason:?}",
    );
    assert!(
        enabled,
        "Test Connection must not disable a server it could not even probe",
    );

    pool.close().await;
}
