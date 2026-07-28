//! TEST-18 (ITEM-14): the `mcpToolComplete` SSE frame carries `started_at` +
//! `duration_ms`, and those values BRACKET the real call duration.
//!
//! Timing on the frame is what lets a LIVE rail step show how long a tool took —
//! the `mcp_tool_calls` join alone cannot serve an in-flight step. The
//! load-bearing design property is that there is exactly ONE clock:
//! `McpSession::call_tool` times the dispatch and hands the SAME
//! `started_at`/`elapsed_ms` pair to BOTH the recorder (`mcp_tool_calls`) and this
//! frame, so a step and the stored history can never disagree. The
//! `frame_timing_equals_the_persisted_row` case is what would catch a regression
//! that re-introduced a second clock.
//!
//! Fully deterministic: a scripted OpenAI stub emits one fixed tool call, and the
//! MCP mock DELAYS a known amount so the duration assertion has a real floor to
//! bracket against — no LLM key, no timing guesswork.

use std::time::Duration;

use serde_json::json;
use uuid::Uuid;

use crate::chat::helpers::{create_conversation, parse_uuid, send_body_and_collect_events};
use crate::common::oai_capture_stub::{StubChat, StubPlan, StubToolCall};
use crate::common::stub_chat::register_stub_model;
use crate::common::test_helpers::create_user_with_permissions;
use crate::common::TestServer;
use crate::mcp::fixtures::mock_mcp_server::{MockMcpServer, MockResponse};

/// How long the mock makes the tool take. Comfortably above scheduler noise so
/// the "duration is real, not zero" assertion cannot flake, and small enough that
/// the test stays fast.
const TOOL_DELAY_MS: u64 = 400;

/// A mock advertising one `echo` tool whose `tools/call` sleeps `TOOL_DELAY_MS`.
async fn start_slow_echo_mock() -> MockMcpServer {
    let mock = MockMcpServer::start().await;
    for _ in 0..50 {
        mock.on_method(
            "tools/list",
            MockResponse::JsonOk(json!({
                "tools": [{
                    "name": "echo",
                    "description": "Echo the input",
                    "inputSchema": {
                        "type": "object", "properties": {}, "additionalProperties": true
                    }
                }]
            })),
        );
    }
    for _ in 0..20 {
        mock.on_method(
            "tools/call",
            MockResponse::DelayedJsonOk {
                delay_ms: TOOL_DELAY_MS,
                value: json!({
                    "content": [{ "type": "text", "text": "echo-ok" }],
                    "isError": false,
                }),
            },
        );
    }
    mock
}

async fn register_http_mcp(server: &TestServer, token: &str, name: &str, url: &str) -> Uuid {
    let res = reqwest::Client::new()
        .post(server.api_url("/mcp/servers"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({
            "name": name,
            "display_name": "tool-timing mock",
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
    Uuid::parse_str(row["id"].as_str().unwrap()).unwrap()
}

#[tokio::test]
async fn mcp_tool_complete_frame_carries_timing_that_brackets_the_real_call() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "tool_timing", &["*"]).await;

    let mock = start_slow_echo_mock().await;
    let mcp_id = register_http_mcp(&server, &user.token, "tool_timing_mock", &mock.base_url()).await;

    // One fixed tool call. The fixed `tool_use_id` also terminates the MCP loop
    // (a repeat is deduped), so the turn ends deterministically.
    let tool_use_id = "toolu_timing_one";
    let stub = StubChat::start(StubPlan {
        text: String::new(),
        tool_calls: vec![StubToolCall {
            id: tool_use_id.to_string(),
            name: "echo".to_string(),
            arguments: "{}".to_string(),
        }],
        ..Default::default()
    })
    .await;
    let model_id_s =
        register_stub_model(&server, &user.token, &user.user_id, &stub.base_url(), true, None).await;
    let model_id = Uuid::parse_str(&model_id_s).unwrap();

    let conversation = create_conversation(&server, &user.token, None, None).await;
    let conversation_id = parse_uuid(&conversation["id"]);
    let branch_id = parse_uuid(&conversation["active_branch_id"]);

    // Auto-approve so the tool executes inline (we need a COMPLETED call, not an
    // approval pause).
    reqwest::Client::new()
        .put(server.api_url(&format!("/conversations/{conversation_id}/mcp-settings")))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&json!({ "approval_mode": "auto_approve", "auto_approved_tools": [] }))
        .send()
        .await
        .unwrap();

    // Outer bracket: wall-clock either side of the whole turn. `started_at` must
    // fall inside it, which is what proves it is a REAL instant rather than a
    // default/epoch value.
    let before = time::OffsetDateTime::now_utc() - Duration::from_secs(5);
    let events = send_body_and_collect_events(
        &server,
        &user.token,
        conversation_id,
        json!({
            "content": "run echo",
            "model_id": model_id,
            "branch_id": branch_id,
            "enable_mcp": true,
            "mcp_config": { "mcp_servers": [{ "server_id": mcp_id, "tools": [] }] },
        }),
        &[],
    )
    .await;
    let after = time::OffsetDateTime::now_utc() + Duration::from_secs(5);

    let names: Vec<&str> = events.iter().map(|e| e.event.as_str()).collect();
    assert_eq!(
        mock.count_for("tools/call"),
        1,
        "exactly one real tool call should have run; events={names:?}"
    );

    // ── The START frame seeds a live step's elapsed clock ────────────────────
    let start = events
        .iter()
        .find(|e| e.event == "mcpToolStart")
        .unwrap_or_else(|| panic!("expected an mcpToolStart frame; events={names:?}"));
    let start_at = start.data["started_at"]
        .as_str()
        .unwrap_or_else(|| panic!("mcpToolStart must carry started_at: {}", start.data));
    let start_at = time::OffsetDateTime::parse(
        start_at,
        &time::format_description::well_known::Rfc3339,
    )
    .expect("mcpToolStart.started_at must be RFC 3339");
    assert!(
        start_at >= before && start_at <= after,
        "mcpToolStart.started_at must be a real instant within the turn"
    );

    // ── The COMPLETE frame carries the AUTHORITATIVE pair ────────────────────
    let complete = events
        .iter()
        .find(|e| e.event == "mcpToolComplete")
        .unwrap_or_else(|| panic!("expected an mcpToolComplete frame; events={names:?}"));
    assert_eq!(complete.data["tool_use_id"], json!(tool_use_id));

    let duration_ms = complete.data["duration_ms"].as_i64().unwrap_or_else(|| {
        panic!("mcpToolComplete must carry duration_ms: {}", complete.data)
    });
    let completed_at_s = complete.data["started_at"].as_str().unwrap_or_else(|| {
        panic!("mcpToolComplete must carry started_at: {}", complete.data)
    });
    let completed_at = time::OffsetDateTime::parse(
        completed_at_s,
        &time::format_description::well_known::Rfc3339,
    )
    .expect("mcpToolComplete.started_at must be RFC 3339");

    // BRACKET, lower bound: the mock slept TOOL_DELAY_MS, so the reported
    // duration cannot be below it (allowing 50ms for millisecond flooring +
    // sleep granularity). This is what proves the value is measured, not 0.
    assert!(
        duration_ms >= (TOOL_DELAY_MS as i64) - 50,
        "duration_ms ({duration_ms}) must be at least the tool's real {TOOL_DELAY_MS}ms"
    );
    // BRACKET, upper bound: it cannot exceed the whole turn.
    let turn_ms = ((after - before).whole_milliseconds()) as i64;
    assert!(
        duration_ms <= turn_ms,
        "duration_ms ({duration_ms}) must not exceed the whole turn ({turn_ms}ms)"
    );
    assert!(
        completed_at >= before && completed_at <= after,
        "mcpToolComplete.started_at must be a real instant within the turn"
    );
    // The dispatch instant is at or after the step's start marker (the session is
    // acquired between the two).
    assert!(
        completed_at >= start_at - Duration::from_secs(1),
        "the authoritative started_at must not precede the step marker"
    );
}

#[tokio::test]
async fn frame_timing_equals_the_persisted_row() {
    // ONE CLOCK: the frame's `started_at`/`duration_ms` must be the SAME pair the
    // recorder wrote to `mcp_tool_calls` — not a second, independently-taken
    // reading. A regression that re-times the call at the SSE emitter would still
    // produce plausible-looking values, and only this equality would catch it.
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "tool_timing_row", &["*"]).await;

    let mock = start_slow_echo_mock().await;
    let mcp_id =
        register_http_mcp(&server, &user.token, "tool_timing_row_mock", &mock.base_url()).await;

    let tool_use_id = "toolu_timing_row";
    let stub = StubChat::start(StubPlan {
        text: String::new(),
        tool_calls: vec![StubToolCall {
            id: tool_use_id.to_string(),
            name: "echo".to_string(),
            arguments: "{}".to_string(),
        }],
        ..Default::default()
    })
    .await;
    let model_id_s =
        register_stub_model(&server, &user.token, &user.user_id, &stub.base_url(), true, None).await;
    let model_id = Uuid::parse_str(&model_id_s).unwrap();

    let conversation = create_conversation(&server, &user.token, None, None).await;
    let conversation_id = parse_uuid(&conversation["id"]);
    let branch_id = parse_uuid(&conversation["active_branch_id"]);

    reqwest::Client::new()
        .put(server.api_url(&format!("/conversations/{conversation_id}/mcp-settings")))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&json!({ "approval_mode": "auto_approve", "auto_approved_tools": [] }))
        .send()
        .await
        .unwrap();

    let events = send_body_and_collect_events(
        &server,
        &user.token,
        conversation_id,
        json!({
            "content": "run echo",
            "model_id": model_id,
            "branch_id": branch_id,
            "enable_mcp": true,
            "mcp_config": { "mcp_servers": [{ "server_id": mcp_id, "tools": [] }] },
        }),
        &[],
    )
    .await;

    let complete = events
        .iter()
        .find(|e| e.event == "mcpToolComplete")
        .expect("expected an mcpToolComplete frame");
    let frame_duration = complete.data["duration_ms"].as_i64().expect("duration_ms");
    let frame_started = complete.data["started_at"].as_str().expect("started_at");

    // The recording insert is fire-and-forget, so poll for the row.
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&server.database_url)
        .await
        .unwrap();
    let mut row = None;
    for _ in 0..60 {
        row = sqlx::query_as::<_, (Option<i64>, chrono::DateTime<chrono::Utc>)>(
            "SELECT duration_ms, started_at FROM mcp_tool_calls WHERE tool_use_id = $1 LIMIT 1",
        )
        .bind(tool_use_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
        if row.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    pool.close().await;
    let (row_duration, row_started) =
        row.expect("the tool call must have been recorded to mcp_tool_calls");

    assert_eq!(
        Some(frame_duration),
        row_duration,
        "the frame's duration_ms must be the SAME value the recorder persisted"
    );
    let frame_started = time::OffsetDateTime::parse(
        frame_started,
        &time::format_description::well_known::Rfc3339,
    )
    .expect("RFC 3339");
    // Compare at millisecond resolution: the row round-trips through
    // TIMESTAMPTZ (microsecond) while the frame is RFC 3339 text, so an exact
    // nanosecond comparison would be testing serialization, not the clock.
    let row_started_ms = row_started.timestamp_millis();
    let frame_started_ms = (frame_started.unix_timestamp_nanos() / 1_000_000) as i64;
    assert_eq!(
        frame_started_ms, row_started_ms,
        "the frame's started_at must be the SAME instant the recorder persisted \
         (frame={frame_started}, row={row_started})"
    );
}
