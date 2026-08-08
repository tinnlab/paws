//! TEST-2 + TEST-10 — the CAUSE of an answerless assistant turn survives to the
//! client AND across a reload.
//!
//! The defect these pin: a reasoning model (measured on Qwen3.6) emits its whole
//! chain of thought in the OpenAI `reasoning_content` channel, billed against the
//! same completion budget. When reasoning exhausts `max_tokens` the stream ends
//! `finish_reason: "length"` having emitted ZERO content deltas — and ziee then
//! OVERWROTE that reason with the literal `"empty"`, destroying the only evidence
//! that the turn was TRUNCATED rather than genuinely empty. Nothing was
//! persisted either, so on reload the UI re-derived "empty" from the content
//! blocks alone and could not tell the cases apart even in principle.
//!
//! ### Why this file carries its own stub
//!
//! Neither shared harness can drive a MAIN chat turn to `finish_reason: length`:
//!
//! * `common::oai_capture_stub` hardcodes `stop` / `tool_calls`.
//! * `common::stub_chat`'s `budget_once` arm — the one place a `length` finish is
//!   forced today — sits INSIDE its `if is_title_request { … }` branch, so it
//!   only ever answers the title extension's own call, never the assistant turn
//!   whose message we need to re-read.
//!
//! Modifying either to reach around that would be a shared-harness change (B3),
//! so this file spawns its own minimal OpenAI-compatible SSE server instead —
//! the same self-contained-fixture pattern as
//! `ai-providers/tests/adapter_response_test.rs`. Nothing under `tests/common/`
//! is touched.

use axum::{
    Router,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use reqwest::StatusCode;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::net::TcpListener;
use uuid::Uuid;

use super::helpers::{self, create_conversation, parse_uuid, send_and_collect};
use crate::common::TestServer;
use crate::common::test_helpers::create_user_with_permissions;

// ── A minimal OpenAI-compatible stub that can force ANY terminal reason ──────

/// What the stub streams for the one assistant turn under test.
#[derive(Clone)]
struct Script {
    /// Emitted as `reasoning_content` deltas → persisted as a `thinking` block.
    reasoning: Option<&'static str>,
    /// Emitted as `content` deltas → persisted as a `text` block. Empty = none.
    text: &'static str,
    /// The terminal `finish_reason` (verbatim OpenAI wire value).
    finish_reason: &'static str,
    /// Pause (ms) between the deltas and the TERMINAL chunk, streamed
    /// incrementally rather than as one buffered body. Non-zero opens a real
    /// window in which the turn is genuinely in flight — what the cancellation
    /// test needs, since a stop request can only hit a running generation.
    stall_ms: u64,
}

impl Script {
    /// The common case: everything in one buffered response, no stall.
    const fn immediate(
        reasoning: Option<&'static str>,
        text: &'static str,
        finish_reason: &'static str,
    ) -> Script {
        Script {
            reasoning,
            text,
            finish_reason,
            stall_ms: 0,
        }
    }
}

struct StubState {
    script: Script,
}

/// A running stub; its axum task is aborted on drop.
struct FinishStub {
    port: u16,
    handle: tokio::task::JoinHandle<()>,
}

impl Drop for FinishStub {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

impl FinishStub {
    async fn start(script: Script) -> FinishStub {
        let state = Arc::new(StubState { script });
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind finish-stub loopback");
        let port = listener.local_addr().expect("stub local addr").port();

        let app = Router::new()
            .route("/v1/chat/completions", post(chat_completions))
            .route(
                "/v1/models",
                get(|| async {
                    axum::Json(json!({
                        "object": "list",
                        "data": [{ "id": "truncating-model", "object": "model" }]
                    }))
                }),
            )
            .route("/health", get(|| async { "ok" }))
            .with_state(state);

        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app.into_make_service()).await;
        });

        FinishStub { port, handle }
    }

    fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}/v1", self.port)
    }
}

async fn chat_completions(
    axum::extract::State(state): axum::extract::State<Arc<StubState>>,
    axum::Json(_body): axum::Json<Value>,
) -> Response {
    let s = state.script.clone();
    if s.stall_ms > 0 {
        return stalling_completion(s);
    }
    let s = &s;
    let mut out = String::new();

    if let Some(r) = s.reasoning {
        push_event(
            &mut out,
            &json!({
                "id": "stub",
                "object": "chat.completion.chunk",
                "choices": [{
                    "index": 0,
                    "delta": { "reasoning_content": r },
                    "finish_reason": null
                }]
            }),
        );
    }
    if !s.text.is_empty() {
        push_event(
            &mut out,
            &json!({
                "id": "stub",
                "object": "chat.completion.chunk",
                "choices": [{ "index": 0, "delta": { "content": s.text }, "finish_reason": null }]
            }),
        );
    }
    push_event(
        &mut out,
        &json!({
            "id": "stub",
            "object": "chat.completion.chunk",
            "choices": [{ "index": 0, "delta": {}, "finish_reason": s.finish_reason }],
            "usage": { "prompt_tokens": 1, "completion_tokens": 4096, "total_tokens": 4097 }
        }),
    );
    out.push_str("data: [DONE]\n\n");

    (
        [(axum::http::header::CONTENT_TYPE, "text/event-stream")],
        out,
    )
        .into_response()
}

/// The same script, but streamed in stages with a real pause before the terminal
/// chunk — so the turn is observably IN FLIGHT while the test cancels it.
fn stalling_completion(s: Script) -> Response {
    let stream = async_stream::stream! {
        if let Some(r) = s.reasoning {
            let mut first = String::new();
            push_event(
                &mut first,
                &json!({
                    "id": "stub",
                    "object": "chat.completion.chunk",
                    "choices": [{
                        "index": 0,
                        "delta": { "reasoning_content": r },
                        "finish_reason": null
                    }]
                }),
            );
            yield Ok::<_, std::convert::Infallible>(axum::body::Bytes::from(first));
        }
        tokio::time::sleep(std::time::Duration::from_millis(s.stall_ms)).await;
        let mut tail = String::new();
        push_event(
            &mut tail,
            &json!({
                "id": "stub",
                "object": "chat.completion.chunk",
                "choices": [{ "index": 0, "delta": {}, "finish_reason": s.finish_reason }],
                "usage": { "prompt_tokens": 1, "completion_tokens": 10, "total_tokens": 11 }
            }),
        );
        tail.push_str("data: [DONE]\n\n");
        yield Ok(axum::body::Bytes::from(tail));
    };

    Response::builder()
        .header(axum::http::header::CONTENT_TYPE, "text/event-stream")
        .body(axum::body::Body::from_stream(stream))
        .expect("build stalling SSE response")
}

fn push_event(out: &mut String, v: &Value) {
    out.push_str("data: ");
    out.push_str(&v.to_string());
    out.push_str("\n\n");
}

// ── Wiring: a `custom` provider pointed at the stub ─────────────────────────

fn chat_perms() -> &'static [&'static str] {
    &[
        "conversations::create",
        "conversations::read",
        "messages::create",
        "messages::read",
        "llm_models::read",
    ]
}

/// Register a `custom` provider at `base_url` + a model carrying
/// `max_tokens: 4096` (the live-rig configuration), and grant `user_id` access.
async fn create_model(server: &TestServer, user_id: &str, base_url: &str) -> Value {
    let admin = create_user_with_permissions(
        server,
        "empty_cause_admin",
        &[
            "llm_models::read",
            "llm_models::create",
            "llm_providers::read",
            "llm_providers::create",
            "llm_providers::edit",
        ],
    )
    .await;
    let client = reqwest::Client::new();

    let provider_resp = client
        .post(server.api_url("/llm-providers"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&json!({
            "name": format!("EmptyCause {}", &Uuid::new_v4().to_string()[..8]),
            "provider_type": "custom",
            "enabled": true,
            "api_key": "test",
            "base_url": base_url,
        }))
        .send()
        .await
        .expect("provider create request");
    assert_eq!(
        provider_resp.status(),
        StatusCode::CREATED,
        "provider create failed"
    );
    let provider: Value = provider_resp.json().await.expect("provider json");

    let model_resp = client
        .post(server.api_url("/llm-models"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&json!({
            "provider_id": provider["id"],
            "name": "truncating-model",
            "display_name": "Truncating Model",
            "description": "reasoning model that exhausts its completion budget",
            "enabled": true,
            "engine_type": "none",
            "file_format": "gguf",
            "capabilities": { "chat": true, "completion": true, "embedding": false },
            "parameters": { "max_tokens": 4096 }
        }))
        .send()
        .await
        .expect("model create request");
    assert_eq!(
        model_resp.status(),
        StatusCode::CREATED,
        "model create failed"
    );
    let model: Value = model_resp.json().await.expect("model json");

    helpers::ensure_user_has_model_access(server, user_id, &model).await;
    model
}

/// Fetch one assistant message back over the PUBLIC read path — the same
/// endpoint the frontend uses on reload.
async fn refetch_message(
    server: &TestServer,
    token: &str,
    conv_id: Uuid,
    message_id: Uuid,
) -> Value {
    let resp = reqwest::Client::new()
        .get(server.api_url(&format!("/conversations/{}/messages", conv_id)))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .expect("messages request");
    assert_eq!(resp.status(), StatusCode::OK, "messages fetch failed");
    let page: Value = resp.json().await.expect("messages json");

    page["messages"]
        .as_array()
        .expect("messages array")
        .iter()
        .find(|m| m["id"].as_str() == Some(&message_id.to_string()))
        .cloned()
        .unwrap_or_else(|| panic!("assistant message {message_id} not in the re-read page: {page}"))
}

/// Drive ONE turn against a stub scripted with `script`, and hand back the
/// collected frames plus everything needed to re-read the message.
async fn run_scripted_turn(
    user_name: &str,
    script: Script,
) -> (TestServer, String, Uuid, helpers::CollectedTurn) {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, user_name, chat_perms()).await;
    let stub = FinishStub::start(script).await;
    let model = create_model(&server, &user.user_id, &stub.base_url()).await;
    let model_id = parse_uuid(&model["id"]);

    // Preset the title so the title extension makes no second provider call.
    let conversation =
        create_conversation(&server, &user.token, Some(model_id), Some("preset")).await;
    let conv_id = parse_uuid(&conversation["id"]);
    let branch_id = parse_uuid(&conversation["active_branch_id"]);

    let turn = send_and_collect(&server, &user.token, conv_id, branch_id, model_id, "hi").await;
    // `stub` stays alive until here; the server is returned so the caller can
    // still re-read the persisted message over REST.
    (server, user.token, conv_id, turn)
}

/// Re-read a message until its `completion_state` is non-NULL (or time runs
/// out). The cancel path finalizes AFTER the client-visible frame, so the write
/// is not ordered against the HTTP response the way the normal path's is.
async fn await_completion_state(
    server: &TestServer,
    token: &str,
    conv_id: Uuid,
    message_id: Uuid,
) -> Value {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    let mut last = Value::Null;
    while std::time::Instant::now() < deadline {
        last = refetch_message(server, token, conv_id, message_id).await;
        if last.get("completion_state").is_some_and(|v| !v.is_null()) {
            return last;
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    last
}

// ── TEST-2: a budget-truncated turn keeps its reason AND records the cause ──

#[tokio::test]
async fn budget_truncated_turn_keeps_length_and_persists_the_cause() {
    // The production shape: all output went to `reasoning_content`, the budget
    // ran out, and the stream ended `length` with zero content deltas.
    let script = Script::immediate(
        Some("a very long chain of thought that never reaches an answer"),
        "",
        "length",
    );
    let (server, token, conv_id, turn) = run_scripted_turn("budget_truncated_user", script).await;

    let complete = turn
        .frames
        .iter()
        .find(|f| f.event_type == "complete")
        .expect("a complete frame");

    // INV-2: the provider's terminal reason is NOT destroyed. This is the
    // assertion the old `final_finish_reason = "empty"` overwrite broke.
    assert_eq!(
        complete.data["finish_reason"], "length",
        "the provider's `length` must survive to the client, got: {}",
        complete.data
    );
    // INV-1: and the answerless fact rides ALONGSIDE it, classified.
    assert_eq!(
        complete.data["completion_state"], "budget_truncated",
        "a length-terminated answerless turn is budget_truncated, got: {}",
        complete.data
    );
    // A benign notice, never a hard error banner.
    assert!(
        turn.frames.iter().all(|f| f.event_type != "error"),
        "no error frame for an answerless turn, got: {:?}",
        turn.frames
            .iter()
            .map(|f| &f.event_type)
            .collect::<Vec<_>>()
    );

    // INV-2 (the reload half): the cause is PERSISTED, so it survives a page
    // reload — the notice is re-derived from stored state, and a stream frame
    // the client no longer holds cannot carry it.
    let message = refetch_message(&server, &token, conv_id, turn.assistant_message_id).await;
    assert_eq!(
        message["completion_state"], "budget_truncated",
        "the re-read message must carry the budget-truncated state, got: {message}"
    );

    // Sanity: it really was answerless — only a thinking block was stored.
    let contents = message["contents"].as_array().expect("contents array");
    assert!(
        contents
            .iter()
            .all(|c| c["content_type"] != "text" && c["content_type"] != "tool_use"),
        "the turn must have persisted no visible answer, got: {message}"
    );
}

// ── TEST-10: a healthy answered turn records NOTHING ────────────────────────

#[tokio::test]
async fn answered_turn_persists_no_completion_state() {
    // The control. A turn that produced an answer must leave `completion_state`
    // NULL — the column exists only to explain answerless turns, so a healthy
    // turn that acquired a state would make the notice fire on a good answer.
    let script = Script::immediate(Some("brief thought"), "here is the answer", "stop");
    let (server, token, conv_id, turn) = run_scripted_turn("answered_user", script).await;

    let complete = turn
        .frames
        .iter()
        .find(|f| f.event_type == "complete")
        .expect("a complete frame");
    assert_eq!(complete.data["finish_reason"], "stop");
    assert!(
        complete.data.get("completion_state").is_none()
            || complete.data["completion_state"].is_null(),
        "an answered turn must carry no completion_state, got: {}",
        complete.data
    );

    let message = refetch_message(&server, &token, conv_id, turn.assistant_message_id).await;
    assert!(
        message.get("completion_state").is_none() || message["completion_state"].is_null(),
        "an answered turn must persist a NULL completion_state, got: {message}"
    );
    assert!(
        turn.text.contains("here is the answer"),
        "the control turn must actually have answered, got: {:?}",
        turn.text
    );
}

// ── A `length` turn that DID answer is also healthy ─────────────────────────

#[tokio::test]
async fn truncated_turn_that_still_answered_persists_no_completion_state() {
    // `length` alone is NOT a defect: a model can be cut off after producing a
    // perfectly useful (if incomplete) answer. Only `length` AND no visible
    // answer is the reported failure, so the classifier must not fire on the
    // reason alone.
    let script = Script::immediate(
        Some("thinking"),
        "a partial answer that got cut o",
        "length",
    );
    let (server, token, conv_id, turn) =
        run_scripted_turn("truncated_but_answered_user", script).await;

    let complete = turn
        .frames
        .iter()
        .find(|f| f.event_type == "complete")
        .expect("a complete frame");
    assert_eq!(complete.data["finish_reason"], "length");
    assert!(
        complete.data.get("completion_state").is_none()
            || complete.data["completion_state"].is_null(),
        "a truncated turn that ANSWERED carries no completion_state, got: {}",
        complete.data
    );

    let message = refetch_message(&server, &token, conv_id, turn.assistant_message_id).await;
    assert!(
        message.get("completion_state").is_none() || message["completion_state"].is_null(),
        "a truncated turn that ANSWERED must persist NULL, got: {message}"
    );
}

// ── A normal `stop` with no answer IS the genuinely-empty case ──────────────

#[tokio::test]
async fn stop_with_no_answer_persists_empty() {
    // The matrix's missing cell: `length`+no-answer, `stop`+answer and
    // `length`+answer were covered, but not the one case for which "the model
    // returned an empty response … please try again" is actually TRUE. Without
    // it, deleting that copy entirely would still pass.
    let script = Script::immediate(Some("brief thought"), "", "stop");
    let (server, token, conv_id, turn) = run_scripted_turn("stop_no_answer_user", script).await;

    let complete = turn
        .frames
        .iter()
        .find(|f| f.event_type == "complete")
        .expect("a complete frame");
    assert_eq!(complete.data["finish_reason"], "stop");
    assert_eq!(
        complete.data["completion_state"], "empty",
        "a normally-terminated answerless turn is `empty`, got: {}",
        complete.data
    );

    let message = refetch_message(&server, &token, conv_id, turn.assistant_message_id).await;
    assert_eq!(
        message["completion_state"], "empty",
        "the re-read message must carry `empty`, got: {message}"
    );
}

// ── A content-policy termination is NOT "the model had nothing to say" ──────

#[tokio::test]
async fn content_filtered_turn_is_not_classified_empty() {
    // The defect: the classifier's catch-all turned every unenumerated terminal
    // reason into `empty`, so a safety-filtered turn told the user "the model
    // returned an empty response … Please try again" — a positive claim about a
    // cause it did not have, and retry advice for something an identical retry
    // reproduces deterministically (INV-3).
    let script = Script::immediate(Some("considering the request"), "", "content_filter");
    let (server, token, conv_id, turn) = run_scripted_turn("content_filter_user", script).await;

    let complete = turn
        .frames
        .iter()
        .find(|f| f.event_type == "complete")
        .expect("a complete frame");
    // INV-2: the provider's own reason still survives intact…
    assert_eq!(
        complete.data["finish_reason"], "content_filter",
        "the provider's content_filter must survive to the client, got: {}",
        complete.data
    );
    // …and the answerless cause names the content policy, never `empty`.
    assert_eq!(
        complete.data["completion_state"], "content_filtered",
        "a content-filtered answerless turn must not be `empty`, got: {}",
        complete.data
    );

    let message = refetch_message(&server, &token, conv_id, turn.assistant_message_id).await;
    assert_eq!(
        message["completion_state"], "content_filtered",
        "the re-read message must carry `content_filtered`, got: {message}"
    );
}

// ── A CANCELLED turn records `aborted`, end to end ──────────────────────────

#[tokio::test]
async fn cancelled_turn_persists_aborted() {
    // `aborted` is ~47% of the measured notices, and until now the single line
    // of real wiring that records it (`mark_turn_end(Cancelled)`) was executed by
    // no test at all — only the pure classifier was covered. This drives the REAL
    // stop path: a genuinely in-flight turn, cancelled over the public stop
    // endpoint, then re-read exactly as the frontend re-reads it after a reload.
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "cancelled_turn_user", chat_perms()).await;
    let stub = FinishStub::start(Script {
        reasoning: Some("a long chain of thought the user does not wait for"),
        text: "",
        finish_reason: "stop",
        // Long enough that the stop request lands while the turn is running.
        stall_ms: 4000,
    })
    .await;
    let model = create_model(&server, &user.user_id, &stub.base_url()).await;
    let model_id = parse_uuid(&model["id"]);

    let conversation =
        create_conversation(&server, &user.token, Some(model_id), Some("preset")).await;
    let conv_id = parse_uuid(&conversation["id"]);
    let branch_id = parse_uuid(&conversation["active_branch_id"]);

    let response = helpers::send_message_simple(
        &server,
        &user.token,
        conv_id,
        model_id,
        branch_id,
        "start something long",
    )
    .await;
    let status = response.status();
    let body: Value = response.json().await.expect("send response json");
    assert_eq!(status, StatusCode::OK, "send failed: {body}");
    let assistant_message_id = parse_uuid(&body["assistant_message_id"]);

    // Let the reasoning delta land, then stop the turn mid-flight.
    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    let stop = reqwest::Client::new()
        .post(server.api_url(&format!(
            "/conversations/{conv_id}/messages/{assistant_message_id}/stop"
        )))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .expect("stop request");
    assert_eq!(
        stop.status(),
        StatusCode::NO_CONTENT,
        "stop must find an in-flight generation (409 = the turn already finished; \
         raise the stub stall if this ever becomes flaky)"
    );

    // The persisted state is the RELOAD path's source of truth: the frontend's
    // live "interrupted" flag resets on reload, so without this the abandoned
    // turn re-renders as "the model returned an empty response".
    let message = await_completion_state(&server, &user.token, conv_id, assistant_message_id).await;
    assert_eq!(
        message["completion_state"], "aborted",
        "a cancelled turn must persist `aborted`, never `empty`, got: {message}"
    );
    drop(stub);
}
