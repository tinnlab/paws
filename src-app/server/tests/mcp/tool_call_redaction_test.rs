//! TEST-23 (ITEM-17): a tool invoked with a secret-bearing argument stores
//! `[redacted]`, and the DEFAULT detail response never returns the raw value.
//!
//! Drives a real tool call through the real recording chokepoint
//! (`McpSession::call_tool` → `record::cap_arguments` → the insert), then reads
//! back through the real REST surface — so this covers the whole path, not just
//! the pure redactor (which `record.rs`'s own `#[cfg(test)]` pins).

use std::time::Duration;

use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use super::fixtures::mock_mcp_server::{MockMcpServer, MockResponse};

async fn register_mock_server(
    server: &crate::common::TestServer,
    token: &str,
    name: &str,
    url: &str,
) -> String {
    let res = reqwest::Client::new()
        .post(server.api_url("/mcp/servers"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({
            "name": name,
            "display_name": "Redaction mock",
            "transport_type": "http",
            "url": url,
            "enabled": true,
        }))
        .send()
        .await
        .unwrap();
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    assert_eq!(status, 201, "register mock server: {status}: {body}");
    let row: serde_json::Value = serde_json::from_str(&body).unwrap();
    row["id"].as_str().unwrap().to_string()
}

async fn pool(server: &crate::common::TestServer) -> sqlx::PgPool {
    sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&server.database_url)
        .await
        .unwrap()
}

async fn wait_for_row(pool: &sqlx::PgPool, user_id: Uuid) -> (Uuid, serde_json::Value) {
    for _ in 0..40 {
        let row = sqlx::query(
            "SELECT id, arguments_json FROM mcp_tool_calls \
             WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .unwrap();
        if let Some(r) = row {
            return (r.get("id"), r.get("arguments_json"));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("no mcp_tool_calls row recorded for {user_id} within timeout");
}

/// The literal secret values the tool is called with. NONE may appear in the
/// stored row or in any default API response.
const SECRETS: &[&str] = &[
    "session=deadbeef",
    "sk-live-must-not-persist",
    "hunter2-xauth",
    "Bearer zzz-top-secret",
    "pw-in-credentials",
];

#[tokio::test]
async fn secret_bearing_arguments_are_redacted_in_storage_and_in_the_default_detail() {
    let server = crate::common::TestServer::start().await;
    let mock = MockMcpServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "tcr_redact",
        &["mcp_servers::create", "mcp_servers::read"],
    )
    .await;
    let uid = Uuid::parse_str(&user.user_id).unwrap();

    mock.on_method(
        "tools/call",
        MockResponse::JsonOk(json!({
            "content": [{ "type": "text", "text": "done" }],
            "isError": false,
        })),
    );
    let id = register_mock_server(&server, &user.token, "tcr_mock", &mock.base_url()).await;

    // Every denylist key the feature closed, at the top level, nested, and inside
    // an array — plus two legitimate lookalikes that must SURVIVE.
    let arguments = json!({
        "cookie": SECRETS[0],
        "openai_api_key": SECRETS[1],
        "nested": {
            "X-Auth-Token": SECRETS[2],
            "credentials": { "password": SECRETS[4] },
        },
        "headers": [{ "Bearer-Token": SECRETS[3] }],
        // Exact-match rule: these are user-meaningful arguments (INV-2) and must
        // come back intact.
        "token_count": 128,
        "password_policy": "strict",
    });

    let status = reqwest::Client::new()
        .post(server.api_url(&format!("/mcp/servers/{id}/tools/echo/call")))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&json!({ "arguments": arguments }))
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(status, 200, "tool call should succeed");

    // 1. STORAGE: the row itself never held the raw values.
    let pool = pool(&server).await;
    let (row_id, stored) = wait_for_row(&pool, uid).await;
    pool.close().await;

    assert_eq!(stored["cookie"], json!("[redacted]"));
    assert_eq!(stored["openai_api_key"], json!("[redacted]"));
    assert_eq!(stored["nested"]["X-Auth-Token"], json!("[redacted]"));
    assert_eq!(stored["nested"]["credentials"], json!("[redacted]"));
    assert_eq!(stored["headers"][0]["Bearer-Token"], json!("[redacted]"));
    assert_eq!(
        stored["token_count"],
        json!(128),
        "exact-match keeps `token_count` (INV-2)"
    );
    assert_eq!(stored["password_policy"], json!("strict"));

    let stored_str = serde_json::to_string(&stored).unwrap();
    for secret in SECRETS {
        assert!(
            !stored_str.contains(secret),
            "secret `{secret}` persisted into mcp_tool_calls: {stored_str}"
        );
    }

    // 2. DEFAULT DETAIL: the single-row GET never returns a raw value either.
    let detail: serde_json::Value = reqwest::Client::new()
        .get(server.api_url(&format!("/mcp/tool-calls/{row_id}")))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let detail_str = serde_json::to_string(&detail).unwrap();
    for secret in SECRETS {
        assert!(
            !detail_str.contains(secret),
            "secret `{secret}` returned by the default detail response: {detail_str}"
        );
    }
    assert_eq!(detail["arguments_json"]["cookie"], json!("[redacted]"));

    // 3. DEFAULT LIST: same guarantee on the collection response.
    let list: serde_json::Value = reqwest::Client::new()
        .get(server.api_url("/mcp/tool-calls"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let list_str = serde_json::to_string(&list).unwrap();
    for secret in SECRETS {
        assert!(
            !list_str.contains(secret),
            "secret `{secret}` returned by the default list response"
        );
    }
}

#[tokio::test]
async fn secrets_in_a_tool_result_are_redacted_too() {
    // The recorder sanitizes the RESULT as well as the arguments — a tool that
    // echoes a credential back must not persist it either.
    let server = crate::common::TestServer::start().await;
    let mock = MockMcpServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "tcr_result",
        &["mcp_servers::create", "mcp_servers::read"],
    )
    .await;
    let uid = Uuid::parse_str(&user.user_id).unwrap();

    mock.on_method(
        "tools/call",
        MockResponse::JsonOk(json!({
            "content": [{ "type": "text", "text": "ok" }],
            "isError": false,
            "structuredContent": {
                "cookie": "session=leaked-from-result",
                "credentials": { "user": "u" },
                "count": 3,
            },
        })),
    );
    let id = register_mock_server(&server, &user.token, "tcr_result_mock", &mock.base_url()).await;

    reqwest::Client::new()
        .post(server.api_url(&format!("/mcp/servers/{id}/tools/echo/call")))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&json!({ "arguments": {} }))
        .send()
        .await
        .unwrap();

    let pool = pool(&server).await;
    let mut result_json = json!(null);
    for _ in 0..40 {
        let row = sqlx::query(
            "SELECT result_json FROM mcp_tool_calls WHERE user_id = $1 \
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind(uid)
        .fetch_optional(&pool)
        .await
        .unwrap();
        if let Some(r) = row {
            if let Some(v) = r.get::<Option<serde_json::Value>, _>("result_json") {
                result_json = v;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    pool.close().await;

    let s = serde_json::to_string(&result_json).unwrap();
    assert!(
        !s.contains("session=leaked-from-result"),
        "a secret echoed in the tool RESULT must not persist: {s}"
    );
    assert!(s.contains("[redacted]"), "the result was actually sanitized: {s}");
    assert!(s.contains("\"count\":3"), "non-secret result fields survive: {s}");
}
