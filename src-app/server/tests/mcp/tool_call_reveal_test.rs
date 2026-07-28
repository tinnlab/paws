//! TEST-42 (ITEM-17 / DEC-1 + DEC-2): `GET /api/mcp/tool-calls/{id}/reveal`.
//!
//! The reveal is the escape hatch that keeps INV-2 satisfiable once the rail and
//! the detail panel render redacted by default: no detail becomes permanently
//! unreachable, but the raw value is behind a permission AND behind ownership.
//!
//! The non-obvious property under test is WHERE the raw value comes from.
//! `record::cap_arguments` redacts BEFORE the insert, so `mcp_tool_calls
//! .arguments_json` never held it — a reveal reading that column would just echo
//! `[redacted]`. The raw arguments live on the paired `message_contents`
//! `tool_use` block. `reveal_returns_the_raw_transcript_value_not_the_redacted_column`
//! is the test that would catch a regression back to the wrong source.
//!
//! The transcript is constructed directly rather than driven through a live model
//! because the `tool_use_id` is chosen by the LLM and so is not addressable from a
//! test; the REDACTION path itself is covered end-to-end through a real tool call
//! in `tool_call_redaction_test.rs`.

use serde_json::json;
use uuid::Uuid;

/// The raw secret only ever present on the transcript block.
const RAW_SECRET: &str = "sk-live-reveal-me-only-to-an-admin";

async fn pool(server: &crate::common::TestServer) -> sqlx::PgPool {
    sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&server.database_url)
        .await
        .unwrap()
}

/// Build a conversation → branch → assistant message → `tool_use` block owned by
/// `user_id`, plus the paired `mcp_tool_calls` row whose `arguments_json` is
/// already REDACTED (exactly as the recorder would have written it).
/// Returns the tool-call row id.
async fn seed_call_with_transcript(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    tool_use_id: &str,
    raw_input: serde_json::Value,
) -> Uuid {
    let conv_id = Uuid::new_v4();
    let branch_id = Uuid::new_v4();
    let msg_id = Uuid::new_v4();
    let call_id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO conversations (id, user_id, title, active_branch_id, created_at, updated_at) \
         VALUES ($1, $2, 'reveal', $3, NOW(), NOW())",
    )
    .bind(conv_id)
    .bind(user_id)
    .bind(branch_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO branches (id, conversation_id, created_at) VALUES ($1, $2, NOW())",
    )
    .bind(branch_id)
    .bind(conv_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO messages (id, role, originated_from_id, created_at) \
         VALUES ($1, 'assistant', $1, NOW())",
    )
    .bind(msg_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO branch_messages (branch_id, message_id, created_at) VALUES ($1, $2, NOW())",
    )
    .bind(branch_id)
    .bind(msg_id)
    .execute(pool)
    .await
    .unwrap();
    // The transcript block: this is the ONLY place the raw value exists.
    sqlx::query(
        "INSERT INTO message_contents (message_id, content_type, content, sequence_order) \
         VALUES ($1, 'tool_use', $2, 0)",
    )
    .bind(msg_id)
    .bind(json!({
        "id": tool_use_id,
        "name": "call_api",
        "server_id": Uuid::new_v4().to_string(),
        "input": raw_input,
    }))
    .execute(pool)
    .await
    .unwrap();
    // The recorded row, redacted at insert time — as the real recorder writes it.
    sqlx::query(
        "INSERT INTO mcp_tool_calls \
         (id, user_id, server_name, tool_name, conversation_id, branch_id, message_id, \
          tool_use_id, arguments_json, status, source) \
         VALUES ($1, $2, 'srv', 'call_api', $3, $4, $5, $6, $7, 'completed', 'chat')",
    )
    .bind(call_id)
    .bind(user_id)
    .bind(conv_id)
    .bind(branch_id)
    .bind(msg_id)
    .bind(tool_use_id)
    .bind(json!({ "api_key": "[redacted]", "endpoint": "https://example.test/v1" }))
    .execute(pool)
    .await
    .unwrap();

    call_id
}

async fn reveal(
    server: &crate::common::TestServer,
    token: Option<&str>,
    call_id: Uuid,
) -> (reqwest::StatusCode, serde_json::Value) {
    let mut req = reqwest::Client::new().get(server.api_url(&format!(
        "/mcp/tool-calls/{call_id}/reveal"
    )));
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    let res = req.send().await.unwrap();
    let status = res.status();
    let body: serde_json::Value = res.json().await.unwrap_or(json!(null));
    (status, body)
}

#[tokio::test]
async fn reveal_is_401_unauthenticated() {
    let server = crate::common::TestServer::start().await;
    let (status, _) = reveal(&server, None, Uuid::new_v4()).await;
    assert_eq!(status, 401, "the reveal must require authentication");
}

#[tokio::test]
async fn reveal_is_403_without_the_admin_edit_permission() {
    let server = crate::common::TestServer::start().await;
    // A user who CAN read their own tool-call history but is not an MCP admin —
    // exactly the account the redaction is protecting the surface for.
    let user = crate::common::test_helpers::create_user_with_only_permissions(
        &server,
        "tcv_no_perm",
        &["profile::read", "mcp_servers::read", "conversations::create"],
    )
    .await;
    let uid = Uuid::parse_str(&user.user_id).unwrap();

    let pool = pool(&server).await;
    let call_id = seed_call_with_transcript(
        &pool,
        uid,
        "toolu_noperm",
        json!({ "api_key": RAW_SECRET }),
    )
    .await;
    pool.close().await;

    // Positive control: they CAN read the (redacted) row.
    let detail: serde_json::Value = reqwest::Client::new()
        .get(server.api_url(&format!("/mcp/tool-calls/{call_id}")))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(detail["arguments_json"]["api_key"], json!("[redacted]"));

    // But the reveal is refused — and leaks nothing in the error body.
    let (status, body) = reveal(&server, Some(&user.token), call_id).await;
    assert_eq!(status, 403, "reveal without mcp_servers_admin::edit must be 403");
    assert_eq!(body["error_code"], json!("INSUFFICIENT_PERMISSIONS"));
    assert!(
        !serde_json::to_string(&body).unwrap().contains(RAW_SECRET),
        "a refused reveal must not leak the value: {body}"
    );
}

#[tokio::test]
async fn reveal_returns_the_raw_transcript_value_not_the_redacted_column() {
    let server = crate::common::TestServer::start().await;
    let admin = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "tcv_admin",
        &["mcp_servers::read", "mcp_servers_admin::edit"],
    )
    .await;
    let uid = Uuid::parse_str(&admin.user_id).unwrap();

    let pool = pool(&server).await;
    let call_id = seed_call_with_transcript(
        &pool,
        uid,
        "toolu_reveal",
        json!({ "api_key": RAW_SECRET, "endpoint": "https://example.test/v1" }),
    )
    .await;
    pool.close().await;

    let (status, body) = reveal(&server, Some(&admin.token), call_id).await;
    assert_eq!(status, 200, "an authorized owner may reveal: {body}");
    assert_eq!(body["id"], json!(call_id.to_string()));
    assert_eq!(
        body["raw"],
        json!(true),
        "the transcript block was present, so this is the RAW value"
    );
    assert_eq!(
        body["arguments_json"]["api_key"],
        json!(RAW_SECRET),
        "the reveal must read the transcript block, NOT the pre-redacted \
         mcp_tool_calls.arguments_json column (which holds `[redacted]`): {body}"
    );
    assert_eq!(
        body["arguments_json"]["endpoint"],
        json!("https://example.test/v1"),
        "non-secret arguments come through unchanged"
    );

    // The DEFAULT surface is still redacted — the reveal is an explicit action,
    // never a change to the normal render.
    let detail: serde_json::Value = reqwest::Client::new()
        .get(server.api_url(&format!("/mcp/tool-calls/{call_id}")))
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(detail["arguments_json"]["api_key"], json!("[redacted]"));
}

#[tokio::test]
async fn reveal_is_owner_scoped_even_for_an_admin() {
    let server = crate::common::TestServer::start().await;
    let owner = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "tcv_owner",
        &["mcp_servers::read"],
    )
    .await;
    // A DIFFERENT user who holds the reveal permission. Ownership, not the
    // permission, is what stops them.
    let admin = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "tcv_other_admin",
        &["mcp_servers::read", "mcp_servers_admin::edit"],
    )
    .await;
    let owner_uid = Uuid::parse_str(&owner.user_id).unwrap();

    let pool = pool(&server).await;
    let call_id = seed_call_with_transcript(
        &pool,
        owner_uid,
        "toolu_crossuser",
        json!({ "api_key": RAW_SECRET }),
    )
    .await;
    pool.close().await;

    let (status, body) = reveal(&server, Some(&admin.token), call_id).await;
    assert_eq!(
        status, 404,
        "another user's call must 404 for an admin too (MCP convention): {body}"
    );
    assert!(
        !serde_json::to_string(&body).unwrap().contains(RAW_SECRET),
        "no cross-user value may leak: {body}"
    );

    // A nonexistent id is likewise 404, so 404 does not distinguish
    // "not yours" from "does not exist".
    let (status, _) = reveal(&server, Some(&admin.token), Uuid::new_v4()).await;
    assert_eq!(status, 404);
}

#[tokio::test]
async fn reveal_falls_back_to_the_recorded_arguments_when_the_block_is_gone() {
    let server = crate::common::TestServer::start().await;
    let admin = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "tcv_gone",
        &["mcp_servers::read", "mcp_servers_admin::edit"],
    )
    .await;
    let uid = Uuid::parse_str(&admin.user_id).unwrap();

    let pool = pool(&server).await;
    let call_id =
        seed_call_with_transcript(&pool, uid, "toolu_gone", json!({ "api_key": RAW_SECRET })).await;
    // Simulate the transcript block being pruned/deleted out from under the row.
    sqlx::query("DELETE FROM message_contents WHERE content_type = 'tool_use'")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;

    let (status, body) = reveal(&server, Some(&admin.token), call_id).await;
    assert_eq!(status, 200, "a missing block degrades, it does not error: {body}");
    assert_eq!(body["raw"], json!(false), "the caller is told it is not raw");
    assert_eq!(
        body["arguments_json"]["api_key"],
        json!("[redacted]"),
        "the recorded (redacted) arguments are the fallback"
    );
}

// TEST-42's AUDIT clause ("the reveal is recorded") is asserted in
// `src/modules/mcp/tool_calls/handlers.rs` `#[cfg(test)]`
// (`reveal_audit_names_the_actor_and_the_call_but_never_the_value`), against the
// REAL rendered `tracing` record via a capturing subscriber installed around the
// real emission site.
//
// It cannot be asserted from here: the integration harness spawns the server as a
// SUBPROCESS with inherited stdio (`ziee-test-harness::SpawnedServer` —
// `cmd.spawn()` with no `Stdio` redirect and no log file), so the server's log
// stream is not readable from the test process. Scraping it would require adding
// log capture to the shared SDK harness, which is out of scope for this change.
