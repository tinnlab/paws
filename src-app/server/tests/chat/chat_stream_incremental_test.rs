//! TEST-5 — acceptance test for INV-2: "a chat turn's tokens must reach the
//! client that is viewing the conversation, WHILE the turn is generating — not
//! only on reload."
//!
//! The reported symptom was a message that spun forever and only appeared after
//! a page reload. That is what "delivery failed" looks like from the outside,
//! and the thing an assertion must be able to distinguish it from: "the frames
//! all arrived at the end" is ALSO satisfied by a reload, so a test that merely
//! collects frames and checks the assembled text cannot fail on this defect.
//!
//! So these assert TIMING, not just arrival: with the stub paced at
//! `CHUNK_DELAY_MS` per delta, a subscribed consumer must observe a `content`
//! frame measurably BEFORE the turn's terminal `complete` frame — i.e. it was
//! being fed during generation.
//!
//! What this does NOT cover, stated plainly: `reqwest` performs no CORS
//! preflight, so this file passes with the entire fix deleted — it passed while
//! the desktop app was completely broken. It is therefore a REGRESSION GUARD on
//! server-side incrementality, not by itself a proof of INV-2.
//!
//! INV-2's acceptance is the CONJUNCTION recorded in TESTS.md: this file (the
//! server really streams during the turn) AND TEST-1/TEST-3 (the preflight a
//! browser must pass in order to receive it) AND the e2e's assertion that a real
//! browser issues the subscription PUT and gets a 2xx. No single test can span
//! both halves, because the failure lived in a browser policy that no
//! same-origin harness enforces — which is exactly why the defect survived a
//! green suite for so long.

use std::time::{Duration, Instant};


use super::helpers;
use crate::common::chat_stream_probe::ChatStreamProbe;
use crate::common::test_helpers::TestUser;

const TURN_TIMEOUT: Duration = Duration::from_secs(30);
/// Per-delta pacing. Large enough that "streamed during the turn" and "delivered
/// in one batch at the end" are separable by a clock, small enough to keep the
/// test quick.
const CHUNK_DELAY_MS: u64 = 400;
/// The gap the first `content` frame must precede `complete` by.
///
/// Deliberately well BELOW `CHUNK_DELAY_MS`. The probe drains the HTTP body in a
/// spawned task and hands frames over an unbounded channel, so what is timed
/// here is when the TEST task dequeues, not when the byte arrived: on a loaded
/// box a long deschedule could leave both frames already queued and collapse the
/// measured gap. Pacing at 400ms and asserting only 150ms keeps the assertion
/// meaningful (a batched delivery measures ~0) while leaving a wide margin for
/// scheduling jitter on the shared host this repo documents.
const MIN_OBSERVED_LEAD_MS: u64 = 150;

async fn chat_user(server: &crate::common::TestServer, name: &str) -> TestUser {
    crate::common::test_helpers::create_user_with_permissions(
        server,
        name,
        &[
            "conversations::create",
            "conversations::read",
            "messages::create",
            "messages::read",
            "llm_models::read",
        ],
    )
    .await
}

#[tokio::test]
async fn a_subscribed_consumer_sees_content_before_the_turn_completes() {
    let server = crate::common::TestServer::start().await;
    let user = chat_user(&server, "incremental_user").await;
    let (_stub, model) =
        helpers::create_stub_model_with_delay(&server, &user.user_id, CHUNK_DELAY_MS).await;
    let model_id = helpers::parse_uuid(&model["id"]);
    let conversation =
        helpers::create_conversation(&server, &user.token, Some(model_id), None).await;
    let conv_id = helpers::parse_uuid(&conversation["id"]);
    let branch_id = helpers::parse_uuid(&conversation["active_branch_id"]);

    // A consumer, subscribed BEFORE the turn starts — the real client's order.
    let mut probe = ChatStreamProbe::open(&server, &user.token).await;
    probe.subscribe(Some(conv_id)).await;

    helpers::send_message_simple(
        &server,
        &user.token,
        conv_id,
        model_id,
        branch_id,
        "stream to me",
    )
    .await;

    // First token, observed live.
    let first_content = probe
        .expect_event(conv_id, "content", TURN_TIMEOUT)
        .await;
    let first_content_at = Instant::now();
    assert!(
        !first_content.text().is_empty(),
        "the first content frame must actually carry a delta, not just exist"
    );

    // …and the turn is still running at that point: the terminal frame lands later.
    probe.expect_event(conv_id, "complete", TURN_TIMEOUT).await;
    let completed_at = Instant::now();

    let lead = completed_at.duration_since(first_content_at);
    assert!(
        lead >= Duration::from_millis(MIN_OBSERVED_LEAD_MS),
        "the first token must reach the consumer DURING generation, not with the \
         terminal frame: only {lead:?} separated the first `content` from \
         `complete` (stub pacing is {CHUNK_DELAY_MS}ms/delta). A batch delivered \
         at the end is indistinguishable from the reload the user had to do."
    );
}

#[tokio::test]
async fn every_delta_arrives_as_its_own_frame_not_one_batch() {
    // The complementary direction: incremental means MANY frames over time, not
    // one big frame that happens to arrive early.
    let server = crate::common::TestServer::start().await;
    let user = chat_user(&server, "incremental_multi_user").await;
    let (_stub, model) =
        helpers::create_stub_model_with_delay(&server, &user.user_id, CHUNK_DELAY_MS).await;
    let model_id = helpers::parse_uuid(&model["id"]);
    let conversation =
        helpers::create_conversation(&server, &user.token, Some(model_id), None).await;
    let conv_id = helpers::parse_uuid(&conversation["id"]);
    let branch_id = helpers::parse_uuid(&conversation["active_branch_id"]);

    let mut probe = ChatStreamProbe::open(&server, &user.token).await;
    probe.subscribe(Some(conv_id)).await;

    helpers::send_message_simple(
        &server,
        &user.token,
        conv_id,
        model_id,
        branch_id,
        "stream to me",
    )
    .await;

    let frames = probe.collect_until_terminal(conv_id, TURN_TIMEOUT).await;
    let content_frames = frames
        .iter()
        .filter(|f| f.event_type == "content")
        .count();
    assert!(
        content_frames > 1,
        "expected the reply to arrive as multiple content frames; got {content_frames}"
    );
    assert_eq!(
        ChatStreamProbe::assemble_text(&frames),
        "Hello from stub",
        "the incrementally-delivered deltas must still assemble to the full reply"
    );
}

#[tokio::test]
async fn an_unsubscribed_connection_is_the_broken_case_and_receives_nothing() {
    // Overlaps `chat_stream_test.rs::unsubscribed_connection_receives_nothing`
    // on the silence half, deliberately: what THIS adds is the second assertion,
    // that the turn nevertheless PERSISTS. The pair is the whole reported
    // symptom — nothing live, everything on reload — and asserting only the
    // silence half would leave the more surprising claim untested.
    //
    // The NEGATIVE control that gives the two tests above their meaning, and the
    // exact state the desktop app was stuck in: the stream is open and healthy,
    // but never scoped — so `publish_frame` matches no connection and every
    // token is dropped at the registry while the reply persists normally.
    //
    // In the desktop app the subscription PUT never happened because the browser
    // refused its CORS preflight (`X-Chat-Stream-Connection-Id` was not in the
    // allow-list); here it simply is not sent. The observable end state is the
    // same, which is why "reload shows the answer" was the only symptom.
    let server = crate::common::TestServer::start().await;
    let user = chat_user(&server, "unsubscribed_user").await;
    let (_stub, model) = helpers::create_stub_model(&server, &user.user_id).await;
    let model_id = helpers::parse_uuid(&model["id"]);
    let conversation =
        helpers::create_conversation(&server, &user.token, Some(model_id), None).await;
    let conv_id = helpers::parse_uuid(&conversation["id"]);
    let branch_id = helpers::parse_uuid(&conversation["active_branch_id"]);

    // Open the stream but DO NOT subscribe.
    let mut probe = ChatStreamProbe::open(&server, &user.token).await;

    helpers::send_message_simple(
        &server,
        &user.token,
        conv_id,
        model_id,
        branch_id,
        "you will not see this live",
    )
    .await;

    probe.expect_silence(Duration::from_secs(3)).await;

    // …and yet the reply IS persisted — the half that always worked, and the
    // reason the bug presented as "only a reload shows it".
    let history = helpers::get_conversation_history(&server, &user.token, conv_id).await;
    let has_assistant_text = history
        .as_array()
        .expect("history array")
        .iter()
        .any(|m| m["role"].as_str() == Some("assistant"));
    assert!(
        has_assistant_text,
        "the turn must still persist even though nothing was delivered live"
    );
}

/// Keeps the enumerated id greppable in the test this branch added (A11).
const _TEST_ID: &str = "TEST-5";
