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
//! These drive the REAL endpoint (a live `TestServer`). Two different shapes:
//!
//! - The abandoned-**GET** storm tests are a regression net, not a proof: an
//!   abandoned GET does not leak even before the fix, because hyper polls the
//!   response body while writing it (measured: 400 concurrent abandoned raw
//!   sockets leak 0 slots).
//! - `head_requests_do_not_leak_chat_stream_slots` IS the red-before-fix proof
//!   through the real endpoint: axum routes `HEAD` to the `GET` handler and
//!   hyper drops a HEAD response's body unpolled, so before the fix each HEAD
//!   permanently consumed a slot. This is the production-reachable form of the
//!   bug — anything that HEADs a URL triggers it.
//!
//! The registry's own logic is covered by the unit tests in
//! `modules/chat/stream/registry.rs`.

use std::time::Duration;

use crate::common::test_helpers::TestUser;

/// Ceiling for cap DISCOVERY — comfortably above any sane configured per-user
/// cap. Only `cap + 1` connections are ever actually opened (the loop stops at
/// the first 429).
const DISCOVERY_CEILING: usize = 64;

/// Discover the server's CONFIGURED per-user chat-stream cap by probing the
/// live endpoint with a FRESH user: open streams until one is refused; the
/// number accepted IS the cap. Probing beats hardcoding a literal — the cap is
/// deployment-config-driven (`ChatStreamLimits`), the server crate's `modules`
/// tree is private to integration tests, and a hardcoded copy would silently
/// desync the moment an operator (or a default) changes it.
async fn discover_per_user_cap(server: &crate::common::TestServer) -> usize {
    let probe = stream_user(server, "chat_stream_cap_probe").await;
    let cap = count_available_slots(server, &probe.token, DISCOVERY_CEILING).await;
    assert!(
        cap > 0 && cap < DISCOVERY_CEILING,
        "discovered per-user chat-stream cap {cap} is implausible \
         (0 means every subscribe was refused; {DISCOVERY_CEILING} means the \
         cap is at or above the discovery ceiling)"
    );
    cap
}

async fn stream_user(server: &crate::common::TestServer, name: &str) -> TestUser {
    crate::common::test_helpers::create_user_with_permissions(server, name, &["profile::read"]).await
}

/// How many concurrent `/chat/stream` streams this user can currently open, measured
/// through the real 200/429 boundary (the same number an operator would see).
/// Opens streams until one is refused, then closes them all.
///
/// Retried: server-side reclamation is ASYNCHRONOUS — dropping a client
/// response does not synchronously drop the server's stream future, so a slot
/// freed microseconds ago may not be free yet. We poll until the count stops
/// growing or the deadline passes, so the test measures the settled state
/// rather than racing the scheduler.
async fn count_available_slots(
    server: &crate::common::TestServer,
    token: &str,
    ceiling: usize,
) -> usize {
    let client = reqwest::Client::new();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    let mut prev: Option<usize> = None;
    loop {
        let mut held = Vec::new();
        for _ in 0..ceiling {
            let res = client
                .get(server.api_url("/chat/stream"))
                .header("Authorization", format!("Bearer {token}"))
                .send()
                .await
                .expect("subscribe request completes");
            if res.status() != 200 {
                assert_eq!(res.status(), 429, "the only expected refusal is a cap 429");
                // It must be the PER-USER cap, not the global one: a global
                // refusal would silently understate this user's allowance and
                // make every downstream assertion pass vacuously.
                let body = res.text().await.unwrap_or_default();
                assert!(
                    body.contains("USER_LIMIT") || body.contains("Too many open"),
                    "expected the PER-USER cap refusal, got: {body}"
                );
                break;
            }
            held.push(res);
        }
        let n = held.len();
        drop(held);
        // Settled once two consecutive passes agree (normally 2 iterations), or
        // once the ceiling is reached, or at the deadline.
        if prev == Some(n) || n + 1 >= ceiling || std::time::Instant::now() >= deadline {
            return n;
        }
        prev = Some(n);
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}

/// TEST-7 — the reported production symptom on `/api/chat/stream` (the endpoint
/// measured as 429 for `admin`, which made chat entirely non-functional for
/// that account). A reconnect storm well past the per-user cap must leave the
/// user's FULL allowance available, not lock them out.
#[tokio::test]
async fn abandoned_chat_stream_reconnects_release_their_slots() {
    let server = crate::common::TestServer::start().await;
    let cap = discover_per_user_cap(&server).await;
    let storm = cap + 8; // deliberately > the cap
    let user = stream_user(&server, "chat_stream_storm").await;
    let client = reqwest::Client::new();

    for i in 0..storm {
        let res = client
            .get(server.api_url("/chat/stream"))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .expect("chat-stream request completes");
        assert_eq!(
            res.status(),
            200,
            "reconnect #{} of {storm} must be accepted — a 429 here means the \
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
        "after {storm} abandoned reconnects a fresh chat-stream subscribe must return 200"
    );
    drop(fresh);

    // … and the WHOLE per-user allowance is free again, proving every abandoned
    // slot came back rather than a single one.
    let available = count_available_slots(&server, &user.token, cap + 1).await;
    assert_eq!(
        available, cap,
        "the user's whole per-user chat-stream allowance must be free again; \
         only {available} of {cap} slots were available"
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

    let cap = discover_per_user_cap(&server).await;
    let mut held = Vec::new();
    for i in 0..cap {
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
            body.contains("CHAT_STREAM_USER_LIMIT"),
            "the 429 must carry the machine-readable CHAT_STREAM_USER_LIMIT error \
             code (not merely a human message), got: {body}"
        );
    }

    drop(held);
}

/// TEST-20 — the same `HEAD` leak on the chat-token stream. See the sync twin
/// (`sync::subscribe_test::head_requests_do_not_leak_connection_slots`) for the
/// mechanism: axum routes `HEAD` to the `GET` handler and hyper drops the SSE
/// body without ever polling it, so before the fix each HEAD permanently
/// consumed a per-user slot and enough of them made chat non-functional for the
/// account — with no client connected to explain it.
#[tokio::test]
async fn head_requests_do_not_leak_chat_stream_slots() {
    let server = crate::common::TestServer::start().await;
    let cap = discover_per_user_cap(&server).await;
    let user = stream_user(&server, "chat_head_leak").await;
    let client = reqwest::Client::new();

    for i in 0..(cap * 2) {
        let res = client
            .head(server.api_url("/chat/stream"))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .expect("HEAD request completes");
        assert_eq!(
            res.status(),
            200,
            "HEAD #{} must be accepted — a 429 here means the previous HEADs \
             permanently consumed this account's chat-stream slots",
            i + 1
        );
    }

    let available = count_available_slots(&server, &user.token, cap + 1).await;
    assert_eq!(
        available, cap,
        "after {} HEAD requests the user's whole chat-stream allowance must \
         still be free; only {available} of {cap} were",
        cap * 2
    );
}
