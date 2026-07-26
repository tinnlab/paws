//! Slot reclamation on the per-user chat-token stream (sse-slot-leak).
//!
//! `GET /api/chat/stream` claims a per-user connection slot eagerly in
//! `register()`, but the `ConnGuard` that releases it was a LOCAL of the
//! `async_stream::stream!` generator body — code that does not run until the
//! stream's FIRST poll. A client that went away before its body was ever polled
//! left a registration with no guard, holding the slot for the life of the
//! process. The registry's other reapers (`publish_frame` / `publish_raw_event`
//! / `set_subscription`) only run when there is something to deliver, so a
//! quiescent deployment never reclaimed anything: every reconnect burned a slot
//! until the account was permanently 429'd and chat stopped working for it.
//!
//! These drive the REAL endpoint (a live `TestServer`), not the registry in
//! isolation — the unit tests in `modules/chat/stream/registry.rs` cover that.

use std::time::Duration;

use crate::common::test_helpers::TestUser;

/// The configured per-user chat-stream cap in the test harness. Mirrors
/// `ChatStreamLimits::default().per_user_max_connections`; asserted against the
/// live endpoint below rather than trusted, so a config change surfaces here.
const CHAT_PER_USER_MAX: usize = 24;

async fn stream_user(server: &crate::common::TestServer, name: &str) -> TestUser {
    crate::common::test_helpers::create_user_with_permissions(server, name, &["profile::read"]).await
}

/// How many concurrent `/chat/stream` connections this user can open right now,
/// measured through the real 200/429 boundary (the same number an operator
/// would observe). Opens until refused, then closes them all.
async fn count_available_slots(
    server: &crate::common::TestServer,
    token: &str,
    ceiling: usize,
) -> usize {
    let client = reqwest::Client::new();
    let mut held = Vec::new();
    for _ in 0..ceiling {
        let res = client
            .get(server.api_url("/chat/stream"))
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .expect("chat-stream request completes");
        if res.status() != 200 {
            assert_eq!(res.status(), 429, "the only expected refusal is the cap 429");
            break;
        }
        held.push(res);
    }
    let n = held.len();
    drop(held);
    n
}

/// TEST-7 — the reported production symptom on `/api/chat/stream` (the endpoint
/// measured as 429 for `admin`, which made chat entirely non-functional for
/// that account). A reconnect storm well past the per-user cap must leave the
/// user's FULL allowance available, not lock them out.
#[tokio::test]
async fn abandoned_chat_stream_reconnects_release_their_slots() {
    const STORM: usize = CHAT_PER_USER_MAX + 8; // deliberately > the cap

    let server = crate::common::TestServer::start().await;
    let user = stream_user(&server, "chat_stream_storm").await;
    let client = reqwest::Client::new();

    for i in 0..STORM {
        let res = client
            .get(server.api_url("/chat/stream"))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .expect("chat-stream request completes");
        assert_eq!(
            res.status(),
            200,
            "reconnect #{} of {STORM} must be accepted — a 429 here means the \
             previous connections' slots were never reclaimed",
            i + 1,
        );
        drop(res); // the client goes away
    }

    // Not locked out: a fresh connect still succeeds …
    let fresh = client
        .get(server.api_url("/chat/stream"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .expect("chat-stream request completes");
    assert_eq!(
        fresh.status(),
        200,
        "after {STORM} abandoned reconnects a fresh chat-stream subscribe must return 200"
    );
    drop(fresh);

    // … and the WHOLE per-user allowance is free again, proving every abandoned
    // slot came back rather than a single one.
    let available = count_available_slots(&server, &user.token, CHAT_PER_USER_MAX + 1).await;
    assert_eq!(
        available, CHAT_PER_USER_MAX,
        "the user's whole per-user chat-stream allowance must be free again; \
         only {available} of {CHAT_PER_USER_MAX} slots were available"
    );
}

/// The chat-stream cap is still REAL after the fix — the guard against "fix the
/// leak by weakening the cap". Connections held ALIVE (each driven to its
/// `connected` handshake) still make the (cap+1)th subscribe 429, and the
/// refusal frees nothing so a second attempt is refused too.
#[tokio::test]
async fn the_chat_stream_per_user_cap_is_still_enforced_for_live_streams() {
    use futures_util::StreamExt;

    let server = crate::common::TestServer::start().await;
    let user = stream_user(&server, "chat_stream_cap_live").await;
    let client = reqwest::Client::new();

    let mut held = Vec::new();
    for i in 0..CHAT_PER_USER_MAX {
        let res = client
            .get(server.api_url("/chat/stream"))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 200, "connection #{} must open", i + 1);
        let mut body = res.bytes_stream();
        let first = tokio::time::timeout(Duration::from_secs(10), body.next())
            .await
            .expect("handshake arrives")
            .expect("a frame")
            .expect("frame ok");
        assert!(
            String::from_utf8_lossy(&first).contains("connected"),
            "stream #{} really opened (handshake received)",
            i + 1
        );
        held.push(body); // keep it live
    }

    for attempt in 0..2 {
        let over = client
            .get(server.api_url("/chat/stream"))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .unwrap();
        assert_eq!(
            over.status(),
            429,
            "attempt {attempt}: the (cap+1)th LIVE chat-stream connection must be \
             refused — reclamation must never become a cap raise"
        );
        let body = over.text().await.unwrap_or_default();
        assert!(
            body.contains("CHAT_STREAM_USER_LIMIT")
                || body.contains("Too many open chat-stream connections"),
            "the 429 must still carry CHAT_STREAM_USER_LIMIT, got: {body}"
        );
    }

    drop(held);
}
