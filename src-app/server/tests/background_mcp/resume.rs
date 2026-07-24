//! Push-to-resume integration tests (bg-push-resume ITEM-2/3/4).
//!
//! Proves the DETACHED sub-agent → re-engage-the-chat-loop behavior end-to-end
//! against a real `TestServer` with a STUB model (no real LLM key): spawning a
//! conversation-bound `subagent` background run drives to completion and
//! AUTOMATICALLY injects a new turn into the conversation — WITHOUT the test ever
//! calling `check_status`/`collect_result`. The stub model answers
//! `"Hello from stub"`, so that string is both the sub-agent's `final_text`
//! (carried into the injected user message) and the resumed assistant reply.

use std::time::{Duration, Instant};

use serde_json::{Value as Json, json};
use uuid::Uuid;

use crate::common::TestServer;
use crate::common::test_helpers::{TestUser, create_user_with_permissions};

/// A user that can reach the background tools AND read its own conversation
/// messages (to observe the injected resume turn).
async fn resume_user(server: &TestServer, name: &str) -> TestUser {
    create_user_with_permissions(
        server,
        name,
        &["background::use", "conversations::create", "messages::read"],
    )
    .await
}

/// GET the conversation's messages (role + content) via the owner-scoped REST.
async fn conversation_messages(server: &TestServer, token: &str, conv_id: Uuid) -> Vec<Json> {
    let resp = reqwest::Client::new()
        .get(server.api_url(&format!("/conversations/{conv_id}/messages")))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .expect("get conversation messages");
    assert_eq!(resp.status(), 200, "messages listing should 200");
    let page: Json = resp.json().await.expect("parse messages page");
    page["messages"].as_array().cloned().unwrap_or_default()
}

/// Join a message's text content blocks. The listing returns each message with a
/// `contents` array of `{content_type, content: {text}}` blocks (see
/// `messages_test.rs`); join the `text` fields of the text blocks.
fn message_text(msg: &Json) -> String {
    msg["contents"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|b| b.get("content").and_then(|c| c.get("text")).and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

fn role_of(msg: &Json) -> String {
    msg["role"].as_str().unwrap_or_default().to_string()
}

/// Set up a stub-model conversation and spawn a `subagent` background run on it.
/// Returns `(user, conversation_id)`. Deliberately does NOT poll check_status or
/// collect_result — the whole point is that the model needs neither.
async fn spawn_subagent_on_stub_conversation(server: &TestServer, name: &str) -> (TestUser, Uuid) {
    let user = resume_user(server, name).await;

    let (_stub, model) = crate::chat::helpers::create_stub_model(server, &user.user_id).await;
    let model_id = Uuid::parse_str(model["id"].as_str().unwrap()).unwrap();
    let conv = crate::chat::helpers::create_conversation(
        server,
        &user.token,
        Some(model_id),
        Some("bg-resume conv"),
    )
    .await;
    let conv_id = Uuid::parse_str(conv["id"].as_str().unwrap()).unwrap();

    // spawn_background {subagent} WITH x-conversation-id — the chat LLM launching a
    // detached sub-agent from inside its conversation. `super::jsonrpc` /
    // `super::structured` are the parent module's JSON-RPC helpers.
    let spawn = super::jsonrpc(
        server,
        &user.token,
        Some(conv_id),
        "tools/call",
        json!({
            "name": "spawn_background",
            "arguments": { "spec": { "task": "Say a one-line hello." } }
        }),
    )
    .await;
    let sc = super::structured(&spawn);
    assert_eq!(sc["status"], "pending", "spawn returns a pending handle: {sc}");
    (user, conv_id)
}

/// Wait until the conversation has ≥ `min` messages (the resume injects a
/// user+assistant pair), or the deadline elapses.
async fn wait_for_messages(
    server: &TestServer,
    user: &TestUser,
    conv_id: Uuid,
    min: usize,
    within: Duration,
) -> Vec<Json> {
    let deadline = Instant::now() + within;
    loop {
        let msgs = conversation_messages(server, &user.token, conv_id).await;
        if msgs.len() >= min {
            return msgs;
        }
        if Instant::now() >= deadline {
            return msgs; // return whatever we have; the caller asserts
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

// TEST-5: a completed conversation-bound sub-agent AUTOMATICALLY injects a new
// turn (a `[Background task complete]` user message carrying the sub-agent's
// result + a fresh assistant reply) — WITHOUT the test ever polling
// check_status/collect_result. This is the core push-to-resume proof.
#[tokio::test]
async fn resume_injects_new_turn_without_polling() {
    let server = TestServer::start().await;
    let (user, conv_id) = spawn_subagent_on_stub_conversation(&server, "bg_resume_push").await;

    // The conversation began empty (the detached sub-agent writes nothing to it);
    // the ONLY thing that can add messages is the automatic resume. Wait for the
    // injected user+assistant pair. NO check_status / collect_result is called.
    let msgs = wait_for_messages(&server, &user, conv_id, 2, Duration::from_secs(45)).await;
    assert!(
        msgs.len() >= 2,
        "push-to-resume must inject a user+assistant turn into the conversation; got {} message(s): {msgs:?}",
        msgs.len()
    );

    // The injected USER message carries the [Background task complete] framing +
    // the sub-agent's real result ("Hello from stub").
    let injected = msgs
        .iter()
        .find(|m| role_of(m) == "user" && message_text(m).contains("[Background task complete]"))
        .unwrap_or_else(|| panic!("no injected [Background task complete] user message: {msgs:?}"));
    let injected_text = message_text(injected);
    assert!(
        injected_text.contains("Hello from stub"),
        "the injected turn carries the sub-agent's final_text: {injected_text}"
    );
    assert!(
        injected_text.contains("Say a one-line hello."),
        "the injected turn names the completed task: {injected_text}"
    );

    // And the loop actually RAN on it → a fresh assistant reply with REAL content
    // exists (not just a started-but-empty row): the stub answers "Hello from
    // stub" again on the resumed turn. NOTE this assertion is load-bearing BECAUSE
    // the detached sub-agent persists its own transcript to `workflow_runs`, NOT
    // to the conversation's chat messages — so an assistant "Hello from stub" in
    // THIS conversation can only have come from the resumed turn.
    let assistant_answered = msgs
        .iter()
        .any(|m| role_of(m) == "assistant" && message_text(m).contains("Hello from stub"));
    assert!(
        assistant_answered,
        "the resumed turn produced a real assistant reply (stub answer), not an empty row: {msgs:?}"
    );
}

// TEST-6: a single sub-agent completion resumes the conversation EXACTLY ONCE
// (DEC-4 runaway-safety). After the resumed turn settles + an extra grace wait,
// exactly ONE `[Background task complete]` user message exists — the completion
// does not re-fire in a loop. (The subagent-ONLY separation — a sandbox_exec
// completion never resumes — is structural: the hook lives only in
// `execute_subagent_run`; TEST-4 guards the `should_resume` predicate.)
#[tokio::test]
async fn resume_fires_exactly_once_per_completion() {
    let server = TestServer::start().await;
    let (user, conv_id) = spawn_subagent_on_stub_conversation(&server, "bg_resume_once").await;

    // Wait for the resume to land.
    let _ = wait_for_messages(&server, &user, conv_id, 2, Duration::from_secs(45)).await;
    // Extra grace so any (erroneous) second resume would have fired by now.
    tokio::time::sleep(Duration::from_secs(3)).await;

    let msgs = conversation_messages(&server, &user.token, conv_id).await;
    let injected_count = msgs
        .iter()
        .filter(|m| role_of(m) == "user" && message_text(m).contains("[Background task complete]"))
        .count();
    assert_eq!(
        injected_count, 1,
        "a single sub-agent completion must resume the conversation exactly once (no runaway); \
         found {injected_count} injected turns: {msgs:?}"
    );
}

// TEST-7 (security branch): if the user LOSES access to the run's model between
// spawn and completion, the resume re-check (mirroring the scheduler's fire-time
// re-check) must SKIP the resume — no turn is injected — while the result still
// lives in the run row. Deterministic: a DELAYED stub keeps the sub-agent turn
// in flight long enough to revoke the provider→group access (DB delete) before
// the resume's re-check runs.
#[tokio::test]
async fn resume_skipped_when_model_access_revoked() {
    let server = TestServer::start().await;
    let user = resume_user(&server, "bg_resume_revoked").await;

    // A stub that paces its deltas so the sub-agent turn is slow enough to revoke
    // access before it completes + resumes.
    let (_stub, model) =
        crate::chat::helpers::create_stub_model_with_delay(&server, &user.user_id, 200).await;
    let model_id = Uuid::parse_str(model["id"].as_str().unwrap()).unwrap();
    let provider_id = Uuid::parse_str(model["provider_id"].as_str().unwrap()).unwrap();
    let conv = crate::chat::helpers::create_conversation(
        &server,
        &user.token,
        Some(model_id),
        Some("bg-resume revoked conv"),
    )
    .await;
    let conv_id = Uuid::parse_str(conv["id"].as_str().unwrap()).unwrap();

    let spawn = super::jsonrpc(
        &server,
        &user.token,
        Some(conv_id),
        "tools/call",
        json!({
            "name": "spawn_background",
            "arguments": { "spec": { "task": "Say a one-line hello." } }
        }),
    )
    .await;
    let sc = super::structured(&spawn);
    let run_id = sc["run_id"].as_str().expect("run_id").to_string();

    // Revoke the user's access to the model's provider by removing it from every
    // group (user_group_llm_providers). The sub-agent turn only requires
    // provider.enabled (still true), so it still completes — but the resume's
    // fire-time access re-check now returns false → skip.
    let pool = sqlx::PgPool::connect(&server.database_url).await.unwrap();
    sqlx::query("DELETE FROM user_group_llm_providers WHERE provider_id = $1")
        .bind(provider_id)
        .execute(&pool)
        .await
        .expect("revoke provider group access");

    // Wait until the run is terminal (here we DO poll check_status — this test is
    // about the revoke branch, not the no-poll contract), then grace-wait so any
    // (erroneous) resume would have injected a turn by now.
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        let body = super::jsonrpc(
            &server,
            &user.token,
            Some(conv_id),
            "tools/call",
            json!({ "name": "check_status", "arguments": { "run_id": run_id } }),
        )
        .await;
        if super::structured(&body)["terminal"].as_bool().unwrap_or(false) {
            break;
        }
        assert!(Instant::now() < deadline, "run did not reach terminal in 45s");
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    tokio::time::sleep(Duration::from_secs(3)).await;

    let msgs = conversation_messages(&server, &user.token, conv_id).await;
    let injected = msgs
        .iter()
        .filter(|m| role_of(m) == "user" && message_text(m).contains("[Background task complete]"))
        .count();
    assert_eq!(
        injected, 0,
        "with model access revoked, the resume must be SKIPPED (no injected turn); got {injected}: {msgs:?}"
    );
}
