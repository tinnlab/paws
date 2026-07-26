// Integration coverage for the realtime-sync SSE subscribe endpoint.
//
// The security-critical fan-out/audience routing is covered deterministically
// by the in-source unit tests (`modules/sync/{registry,event}.rs`), and the
// full real path (cross-device delivery + cross-user isolation) by the
// Playwright E2E (`ui/tests/e2e/13-sync`). Here we just assert the HTTP
// endpoint itself: it is auth-gated and opens an event-stream for an
// authenticated user. `reqwest::send()` resolves once the response headers
// arrive, so we can assert status + content-type without consuming the
// (intentionally long-lived) stream body — dropping the response closes it,
// and the server's ConnGuard unregisters the connection.

#[tokio::test]
async fn subscribe_rejects_unauthenticated() {
    let server = crate::common::TestServer::start().await;
    let res = reqwest::Client::new()
        .get(server.api_url("/sync/subscribe"))
        .send()
        .await
        .unwrap();
    assert_eq!(
        res.status(),
        401,
        "GET /sync/subscribe must require authentication"
    );
}

#[tokio::test]
async fn subscribe_with_valid_token_opens_event_stream() {
    let server = crate::common::TestServer::start().await;
    // profile::read is the baseline gate every active user holds.
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "sync_subscriber",
        &["profile::read"],
    )
    .await;

    let res = reqwest::Client::new()
        .get(server.api_url("/sync/subscribe"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .unwrap();

    assert_eq!(
        res.status(),
        200,
        "an authenticated user must be able to open the sync stream"
    );
    let content_type = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    assert!(
        content_type.contains("text/event-stream"),
        "sync subscribe must return an SSE stream, got content-type: {content_type}"
    );
    // Drop `res` here → closes the stream → server unregisters the connection.
}

// audit id all-9e841aed8753 — the connection-cap 429 path exercised through the
// REAL HTTP handler (not just the in-source registry unit test). `register`
// runs in `subscribe_sync` BEFORE the SSE stream is returned (handlers.rs:78),
// so a capped registration surfaces as a 429 HTTP status on the response
// headers. We open PER_USER_MAX_CONNECTIONS (12) streams for one user and hold
// them alive in a Vec (dropping a response would close the stream and free a
// slot), then assert the 13th concurrent subscribe is rejected with 429.
#[tokio::test]
async fn subscribe_rejects_when_per_user_connection_cap_exceeded() {
    const PER_USER_MAX_CONNECTIONS: usize = 12;

    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "sync_cap",
        &["profile::read"],
    )
    .await;
    let client = reqwest::Client::new();

    // Hold the max number of concurrent streams open (kept in scope so the
    // underlying connections stay registered server-side).
    let mut held = Vec::new();
    for i in 0..PER_USER_MAX_CONNECTIONS {
        let res = client
            .get(server.api_url("/sync/subscribe"))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            200,
            "connection {i} (within the cap) must be accepted"
        );
        held.push(res);
    }

    // The next subscribe for the SAME user exceeds the per-user cap → 429.
    let over = client
        .get(server.api_url("/sync/subscribe"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .unwrap();
    assert_eq!(
        over.status(),
        429,
        "subscribe beyond the per-user connection cap must be rejected with 429"
    );

    // Keep the held streams alive until the assertion above has run.
    drop(held);
}

/// Account deactivation cuts off realtime sync: a user who could open the SSE
/// stream is REFUSED on (re)connect once an admin deactivates them, because the
/// subscribe handler's `RequirePermissions<(ProfileRead,)>` extractor re-checks
/// `is_active` from scratch every connect (the same check the stream's periodic
/// 60s re-resolve enforces mid-stream). Their JWT is still cryptographically
/// valid — it's the is_active gate that closes the door.
#[tokio::test]
async fn subscribe_refuses_a_deactivated_user() {
    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "sync_deact",
        &["profile::read"],
    )
    .await;
    let admin = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "sync_deact_admin",
        &["users::edit"],
    )
    .await;

    // Active → the stream opens.
    let ok = reqwest::Client::new()
        .get(server.api_url("/sync/subscribe"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), 200, "an active user must be able to subscribe");
    drop(ok); // close the stream

    // Admin deactivates the user.
    let deact = reqwest::Client::new()
        .post(server.api_url(&format!("/users/{}", user.user_id)))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&serde_json::json!({ "is_active": false }))
        .send()
        .await
        .unwrap();
    assert!(
        deact.status().is_success(),
        "deactivation should succeed; got {}",
        deact.status()
    );

    // Same (still-unexpired) token → reconnect is now refused by the is_active gate.
    let refused = reqwest::Client::new()
        .get(server.api_url("/sync/subscribe"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .unwrap();
    assert!(
        refused.status() == 401 || refused.status() == 403,
        "a deactivated user must be refused the SSE stream; got {}",
        refused.status()
    );
}

/// The SSE stream is bounded by the access token's `exp`: when the JWT lapses
/// mid-stream the server tears the connection down (sync/handlers.rs computes
/// `deadline = exp - now` and `select!`s a `sleep_until(deadline)` arm), so the
/// client is forced to reconnect with a fresh token (which re-runs the auth
/// extractor from scratch). This asserts that teardown actually fires: a stream
/// opened with a still-valid-but-near-expiry token closes on its own shortly
/// after `exp`, even though nothing else (disconnect, deactivation) ends it.
#[tokio::test]
async fn subscribe_stream_closes_when_jwt_expires_midstream() {
    use futures::StreamExt;

    let server = crate::common::TestServer::start().await;
    // A real, active user holding the baseline subscribe gate.
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "sync_jwt_exp",
        &["profile::read"],
    )
    .await;

    // Mint a SHORT-exp (4s) access token for THIS user, signed with the
    // TestServer's JWT secret + iss/aud (harness_inner.rs) so both the auth
    // extractor and the handler's `validate_access_token(...)` accept it.
    // username/email are not validated (only signature + iss/aud + exp), so
    // they can be empty — the user is loaded from `sub`.
    #[derive(serde::Serialize)]
    struct ShortClaims {
        sub: String,
        exp: i64,
        iat: i64,
        iss: String,
        aud: String,
        username: String,
        email: String,
        is_admin: bool,
    }
    let now = chrono::Utc::now().timestamp();
    let claims = ShortClaims {
        sub: user.user_id.clone(),
        exp: now + 4,
        iat: now,
        iss: "ziee".into(),
        aud: "ziee-api".into(),
        username: String::new(),
        email: String::new(),
        is_admin: false,
    };
    let short_token = jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(
            b"test-secret-key-for-jwt-tokens-min-32-chars-long",
        ),
    )
    .expect("sign short-exp access token");

    let res = reqwest::Client::new()
        .get(server.api_url("/sync/subscribe"))
        .header("Authorization", format!("Bearer {short_token}"))
        .send()
        .await
        .expect("open the sync stream");
    assert_eq!(
        res.status(),
        200,
        "a still-valid (near-expiry) token must open the stream"
    );

    let mut stream = res.bytes_stream();

    // First frame must be the `connected` handshake — proves the stream really
    // opened before we assert it closes.
    let first = tokio::time::timeout(std::time::Duration::from_secs(5), stream.next())
        .await
        .expect("handshake frame within 5s")
        .expect("stream yielded a frame")
        .expect("frame is Ok");
    assert!(
        String::from_utf8_lossy(&first).contains("connected"),
        "expected the `connected` handshake as the first SSE frame"
    );

    // Drain until the server closes the stream at the exp deadline. With a 4s
    // token exp the close lands well inside 30s; a regression that drops the
    // exp-deadline `select!` arm would leave the stream open (keep-alive pings)
    // indefinitely → this timeout fires and the test fails instead of hanging.
    let closed = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        while let Some(chunk) = stream.next().await {
            let _ = chunk; // ignore keep-alive comments / buffered frames until EOF
        }
    })
    .await;
    assert!(
        closed.is_ok(),
        "the SSE stream must close once the JWT exp deadline passes; it stayed open >30s"
    );
}

/// The subscribe handler enforces a PER-USER connection cap at connect time
/// (`registry.rs` `PER_USER_MAX_CONNECTIONS` = 12 concurrent SSE streams per
/// account): the (cap+1)th `GET /sync/subscribe` for the SAME user is refused
/// with `429 SYNC_USER_LIMIT`. The registry unit test exercises `register()`
/// directly; this proves the cap is surfaced through the real HTTP handler.
/// The cap is keyed on this fresh user's id, so it is isolated from any other
/// test's connections in the process-wide registry.
#[tokio::test]
async fn subscribe_refuses_excess_connections_for_one_user_with_429() {
    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "sync_cap_user",
        &["profile::read"],
    )
    .await;

    let client = reqwest::Client::new();
    // The per-user cap. Hold these responses ALIVE so their server-side
    // connections stay registered (dropping a response closes the stream →
    // ConnGuard unregisters). Each `send()` returns only after the handler has
    // already run `register()`, so by the 12th success all 12 are registered.
    const PER_USER_MAX: usize = 12;
    let mut held = Vec::with_capacity(PER_USER_MAX);
    for i in 0..PER_USER_MAX {
        let res = client
            .get(server.api_url("/sync/subscribe"))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            200,
            "sync connection #{} (under the per-user cap) must open",
            i + 1
        );
        held.push(res);
    }

    // The (cap+1)th concurrent connection for the SAME user must be refused.
    let overflow = client
        .get(server.api_url("/sync/subscribe"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .unwrap();
    assert_eq!(
        overflow.status(),
        429,
        "the (cap+1)th concurrent sync stream for one user must be refused (SYNC_USER_LIMIT)"
    );
    let body = overflow.text().await.unwrap_or_default();
    assert!(
        body.contains("SYNC_USER_LIMIT") || body.contains("Too many open sync connections"),
        "the 429 body should carry the SYNC_USER_LIMIT error, got: {body}"
    );

    // Drop the held responses → closes the 12 streams → ConnGuard unregisters
    // each, leaving the process-wide registry clean for sibling tests.
    drop(held);
}

/// File sync end-to-end through the SSE stream: uploading a file fires
/// `publish_file_changed` (owner-scoped `File`/`Update`), and the uploader's own
/// sync subscription receives a `file`/`update` frame carrying the file id. The
/// generic subscribe test above only proves the stream opens; this proves a
/// file-specific entity is actually delivered over it.
#[tokio::test]
async fn upload_delivers_file_sync_event_to_owner() {
    use crate::common::sync_probe::SyncProbe;
    use std::time::Duration;

    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "sync_file_owner",
        &["files::upload", "files::read"],
    )
    .await;

    let mut probe = SyncProbe::open(&server, &user.token).await;

    // Upload a file (no X-Sync-Connection-Id header → no self-echo suppression,
    // so the uploader's own probe receives the event).
    let form = reqwest::multipart::Form::new().part(
        "file",
        reqwest::multipart::Part::bytes(b"hello sync".to_vec())
            .file_name("sync.txt")
            .mime_str("text/plain")
            .unwrap(),
    );
    let res = reqwest::Client::new()
        .post(server.api_url("/files/upload"))
        .header("Authorization", format!("Bearer {}", user.token))
        .multipart(form)
        .send()
        .await
        .expect("upload");
    assert!(res.status().is_success(), "upload should succeed: {}", res.status());
    let body: serde_json::Value = res.json().await.unwrap();
    let file_id = body["id"].as_str().expect("uploaded file id").to_string();

    let frame = probe
        .expect_event("file", "update", Duration::from_secs(5))
        .await;
    assert_eq!(
        frame.id, file_id,
        "the file sync frame must carry the uploaded file id"
    );
}

/// Mint an access token (HS256, the test config's secret/iss/aud) that expires
/// `secs` from now, for an existing user id. Mirrors how the real JwtService
/// shapes access-token claims so `validate_access_token` accepts it.
fn mint_access_token(user_id: &str, secs: i64) -> String {
    use jsonwebtoken::{encode, EncodingKey, Header};
    let now = chrono::Utc::now().timestamp();
    let claims = serde_json::json!({
        "sub": user_id,
        "exp": now + secs,
        "iat": now,
        "iss": "ziee",
        "aud": "ziee-api",
        "username": "sync_exp",
        "email": "sync_exp@example.com",
        "is_admin": false,
    });
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(b"test-secret-key-for-jwt-tokens-min-32-chars-long"),
    )
    .unwrap()
}

/// The stream is bounded by the access token's `exp`: a token expiring in ~2s
/// must tear the SSE stream down at the deadline (the `sleep_until(deadline)`
/// arm), so the response body completes on its own — NOT hang until the token
/// would otherwise live for 24h.
#[tokio::test]
async fn subscribe_stream_closes_at_token_expiry() {
    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "sync_exp_user",
        &["profile::read"],
    )
    .await;

    // A short-lived token (still valid NOW, so the stream opens; lapses in ~2s).
    let token = mint_access_token(&user.user_id, 2);
    let res = reqwest::Client::new()
        .get(server.api_url("/sync/subscribe"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200, "stream opens while the token is still valid");

    // Reading the full body returns when the server closes the stream at the
    // exp deadline. A generous 15s timeout guards against the body hanging
    // (which would mean the exp teardown didn't fire).
    let start = std::time::Instant::now();
    let body = tokio::time::timeout(std::time::Duration::from_secs(15), res.bytes()).await;
    assert!(body.is_ok(), "stream must close on token expiry, not hang open");
    let elapsed = start.elapsed();
    assert!(
        elapsed < std::time::Duration::from_secs(14),
        "stream closed well before the 24h fallback (at ~exp); elapsed={elapsed:?}"
    );
}

/// The sync stream's FIRST frame is the `connected` handshake carrying a valid
/// UUID `connection_id` — the contract every client depends on to echo
/// `X-Sync-Connection-Id` back for self-echo suppression. The existing open
/// test asserts only the 200 + content-type; this validates the handshake
/// frame's event name + payload shape on the wire.
#[tokio::test]
async fn subscribe_first_frame_is_connected_handshake_with_uuid() {
    use futures_util::StreamExt;
    use std::time::Duration;

    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "sync_handshake",
        &["profile::read"],
    )
    .await;

    let resp = reqwest::Client::new()
        .get(server.api_url("/sync/subscribe"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // Read until the first complete SSE frame (blank-line terminated), bounded.
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let deadline = tokio::time::sleep(Duration::from_secs(10));
    tokio::pin!(deadline);
    let frame = loop {
        tokio::select! {
            _ = &mut deadline => panic!("no handshake frame within 10s; buf={buf:?}"),
            chunk = stream.next() => match chunk {
                Some(Ok(b)) => {
                    buf.push_str(&String::from_utf8_lossy(&b));
                    if let Some(pos) = buf.find("\n\n") {
                        break buf[..pos].to_string();
                    }
                }
                Some(Err(e)) => panic!("stream error: {e}"),
                None => panic!("stream ended before a frame: {buf:?}"),
            }
        }
    };

    // The first frame names the `connected` event ...
    assert!(
        frame.lines().any(|l| l.trim() == "event: connected"),
        "first frame must be the connected handshake: {frame:?}"
    );
    // ... and its data payload carries a parseable UUID connection_id.
    let data_line = frame
        .lines()
        .find_map(|l| l.strip_prefix("data:"))
        .expect("a data: line in the handshake frame");
    let payload: serde_json::Value =
        serde_json::from_str(data_line.trim()).expect("handshake data is JSON");
    let conn = payload["connection_id"].as_str().expect("connection_id present");
    assert!(
        uuid::Uuid::parse_str(conn).is_ok(),
        "connection_id must be a valid UUID, got {conn:?}"
    );
}

/// The per-user connection cap is enforced through the HTTP `/sync/subscribe`
/// path (not just the registry unit test): one user opening more than
/// PER_USER_MAX_CONNECTIONS (12) live streams gets a 429 on the overflow
/// subscribe. The held responses keep the earlier connections registered.
#[tokio::test]
async fn subscribe_enforces_per_user_connection_cap_with_429() {
    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "sync_cap_http",
        &["profile::read"],
    )
    .await;
    let client = reqwest::Client::new();

    // Hold 12 live subscribe streams open (registered on the server).
    let mut held = Vec::new();
    for i in 0..12 {
        let res = client
            .get(server.api_url("/sync/subscribe"))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 200, "connection {i} should open");
        held.push(res); // keep the stream alive → stays registered
    }

    // The 13th subscribe for the SAME user exceeds the per-user cap → 429.
    let overflow = client
        .get(server.api_url("/sync/subscribe"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .unwrap();
    assert_eq!(
        overflow.status(),
        429,
        "the (cap+1)th connection must be refused with 429"
    );

    drop(held);
}


// ---------------------------------------------------------------------------
// Slot reclamation (sse-slot-leak) — the reported production failure.
//
// The per-user cap was charged for connections that no longer existed:
// `register()` claims the slot eagerly in the handler, but the `ConnGuard` that
// releases it was a LOCAL of the `async_stream::stream!` generator body, which
// does not run until the stream's FIRST poll. A client that went away before
// its body was ever polled left a registration with no guard, so the slot was
// held for the life of the process; the registry's only other reaper is
// `deliver`'s send-failure prune, which never runs on a quiescent deployment.
// Measured symptom: a user at the cap was 429'd on `/api/sync/subscribe` AND
// `/api/chat/stream` forever — chat entirely non-functional for that account.
// ---------------------------------------------------------------------------

/// How many concurrent `/sync/subscribe` streams this user can currently open, measured
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
                .get(server.api_url("/sync/subscribe"))
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

/// Ceiling for cap DISCOVERY — comfortably above the per-user cap. Only
/// `cap + 1` connections are ever actually opened (the loop stops at the 429).
const DISCOVERY_CEILING: usize = 64;

/// Discover the server's per-user sync cap by probing the live endpoint with a
/// FRESH user: the number of streams accepted before a 429 IS the cap. Probing
/// beats hardcoding `12` — the constant is private to the framework crate, so a
/// literal here would silently desync if it ever changed.
async fn discover_per_user_cap(server: &crate::common::TestServer) -> usize {
    let probe = crate::common::test_helpers::create_user_with_permissions(
        server,
        "sync_cap_probe",
        &["profile::read"],
    )
    .await;
    let cap = count_available_slots(server, &probe.token, DISCOVERY_CEILING).await;
    assert!(
        cap > 0 && cap < DISCOVERY_CEILING,
        "discovered per-user sync cap {cap} is implausible"
    );
    cap
}

/// TEST-6 [acceptance INV-1] — "Unregister on ANY stream termination — client
/// disconnect, exp, or deactivation."
///
/// The reported production symptom, reproduced and then proven gone through the
/// REAL `GET /api/sync/subscribe`: one user opens and ABANDONS 20 sequential
/// connections (> the per-user cap of 12 — a reconnect storm, e.g. repeated
/// page reloads). Every one must be accepted (a leak 429s partway through), and
/// afterwards the user must still be able to open a FULL set of 12 concurrent
/// streams — i.e. every abandoned slot was reclaimed, not just one.
///
/// SCOPE — be precise. This test uses abandoned **GET**s, and those do NOT leak
/// even before the fix: hyper polls the response body while writing it (measured
/// on the unfixed server — 20 sequential, then 100 sequential, then 400
/// concurrent abandoned raw sockets all leaked 0 slots). So it passes both
/// before and after, and is a regression net rather than a proof.
/// The red-before-fix proof THROUGH THIS ENDPOINT is
/// `head_requests_do_not_leak_connection_slots` below — a `HEAD` response's body
/// IS dropped unpolled, which is the production-reachable form of the leak.
#[tokio::test]
async fn abandoned_reconnects_release_their_slots_and_never_lock_the_user_out() {
    let server = crate::common::TestServer::start().await;
    let per_user_max = discover_per_user_cap(&server).await;
    let storm = per_user_max + 8; // deliberately > the cap
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "sync_reconnect_storm",
        &["profile::read"],
    )
    .await;
    let client = reqwest::Client::new();

    // A reconnect storm: open and abandon STORM connections, one at a time.
    for i in 0..storm {
        let res = client
            .get(server.api_url("/sync/subscribe"))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .expect("subscribe request completes");
        assert_eq!(
            res.status(),
            200,
            "reconnect #{} of {storm} must be accepted — a 429 here means the \
             previous connections' slots were never reclaimed",
            i + 1,
        );
        drop(res); // the client goes away
    }

    // The account is NOT locked out: a fresh connect still succeeds …
    let fresh = client
        .get(server.api_url("/sync/subscribe"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .expect("subscribe request completes");
    assert_eq!(
        fresh.status(),
        200,
        "after {storm} abandoned reconnects a fresh subscribe must still return 200"
    );
    drop(fresh);

    // … and the user's FULL per-user allowance is available again, proving all
    // STORM slots came back rather than a single one.
    let available = count_available_slots(&server, &user.token, per_user_max + 1).await;
    assert_eq!(
        available, per_user_max,
        "the user's whole per-user allowance must be free again after the storm; \
         only {available} of {per_user_max} slots were available"
    );
}

/// TEST-8 [acceptance INV-3] — "Caps: 512 global / 12 per-user …". The cap is
/// still REAL after the fix: this is the guard against "fix the leak by
/// weakening the cap". 12 concurrently-held, ACTIVELY-STREAMING connections
/// (each body polled to its `connected` handshake, so they are unambiguously
/// live) still make the 13th subscribe 429 — and the refusal frees nothing, so
/// a 14th is refused too.
#[tokio::test]
async fn the_per_user_cap_is_still_enforced_for_live_streams() {
    use futures_util::StreamExt;

    let server = crate::common::TestServer::start().await;
    let per_user_max = discover_per_user_cap(&server).await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "sync_cap_live",
        &["profile::read"],
    )
    .await;
    let client = reqwest::Client::new();

    // 12 LIVE streams — each driven far enough to receive its handshake frame,
    // so none of them can be dismissed as "never really opened".
    let mut held = Vec::new();
    for i in 0..per_user_max {
        let res = client
            .get(server.api_url("/sync/subscribe"))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 200, "connection #{} must open", i + 1);
        let mut body = res.bytes_stream();
        let first = tokio::time::timeout(std::time::Duration::from_secs(10), body.next())
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
            .get(server.api_url("/sync/subscribe"))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .unwrap();
        assert_eq!(
            over.status(),
            429,
            "attempt {attempt}: the (cap+1)th LIVE connection must be refused — \
             reclamation must never become a cap raise"
        );
        let body = over.text().await.unwrap_or_default();
        assert!(
            body.contains("SYNC_USER_LIMIT"),
            "the 429 must carry the machine-readable SYNC_USER_LIMIT error code \
             (not merely a human message), got: {body}"
        );
    }

    drop(held);
}

/// TEST-10 [acceptance INV-4] — "The wire payload is notify-and-refetch only —
/// `{entity, action, id}`, never row data … Each emitting handler picks the
/// `Audience` explicitly." The registry change must not perturb delivery: after
/// a reclamation storm on the SAME user, a mutation still delivers exactly one
/// `{entity, action, id}` frame carrying NO row data to the owner's live
/// stream, and a second user's live stream receives nothing.
#[tokio::test]
async fn owner_scoping_and_notify_only_wire_format_survive_slot_reclamation() {
    use crate::common::sync_probe::SyncProbe;
    use std::time::Duration;

    let server = crate::common::TestServer::start().await;
    let owner = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "sync_reclaim_owner",
        &["files::upload", "files::read", "profile::read"],
    )
    .await;
    let other = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "sync_reclaim_other",
        &["files::upload", "files::read", "profile::read"],
    )
    .await;
    let client = reqwest::Client::new();

    // A reconnect storm on the OWNER, exhausting and reclaiming their slots.
    for _ in 0..20 {
        let res = client
            .get(server.api_url("/sync/subscribe"))
            .header("Authorization", format!("Bearer {}", owner.token))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 200);
        drop(res);
    }

    // Both users now open a live probe (the owner's must still fit).
    let mut owner_probe = SyncProbe::open(&server, &owner.token).await;
    let mut other_probe = SyncProbe::open(&server, &other.token).await;

    let form = reqwest::multipart::Form::new().part(
        "file",
        reqwest::multipart::Part::bytes(b"reclaimed".to_vec())
            .file_name("reclaim.txt")
            .mime_str("text/plain")
            .unwrap(),
    );
    let res = client
        .post(server.api_url("/files/upload"))
        .header("Authorization", format!("Bearer {}", owner.token))
        .multipart(form)
        .send()
        .await
        .expect("upload");
    assert!(res.status().is_success(), "upload should succeed: {}", res.status());
    let body: serde_json::Value = res.json().await.unwrap();
    let file_id = body["id"].as_str().expect("uploaded file id").to_string();

    // The OWNER's stream still receives the notify-only frame …
    let frame = owner_probe
        .expect_event("file", "update", Duration::from_secs(10))
        .await;
    assert_eq!(
        frame.id, file_id,
        "the frame must carry the file id (notify-and-refetch)"
    );
    // NOTE: this asserts the {entity, action, id} triple is intact and correctly
    // routed. It does NOT prove the absence of extra payload fields — SyncProbe
    // parses out exactly those three and discards the rest, so a row-data
    // regression would be invisible here. The wire format's shape is pinned by
    // the sync module's own in-source serialization tests.

    // … and the OTHER user's stream receives NOTHING at all (owner-scoping is
    // untouched by the registry change).
    other_probe.expect_silence(Duration::from_secs(2)).await;
}

/// TEST-19 [acceptance INV-1] — the never-polled leak IS reachable through the
/// real endpoint, via `HEAD`.
///
/// axum routes `HEAD` to the `GET` handler (`method_routing.rs`,
/// `call!(req, HEAD, get)`) and then replaces the response body with
/// `Body::empty()` inside `RouteFuture::poll` — synchronously, before the
/// response reaches hyper. The SSE body is therefore DROPPED WITHOUT EVER BEING
/// POLLED: exactly the termination the old guard placement could not see, and
/// unlike an abandoned GET it is remotely triggerable by anything that HEADs a
/// URL — uptime monitors, reverse proxies, link previewers, security scanners.
/// Before the fix, `PER_USER_MAX_CONNECTIONS` HEADs permanently 429 a user's
/// realtime sync (and `GLOBAL_MAX_CONNECTIONS` of them take the whole deployment
/// down) with no client left connected to explain it.
///
/// This is the red-before-fix proof THROUGH THE REAL HTTP ENDPOINT — measured
/// with the fix reverted: `HEAD #13` → `429`.
///
/// SCOPE: it exercises the fix AS A WHOLE. With the guard reverted but the sweep
/// kept, the (cap+1)th HEAD would reclaim the leaked entries and this would
/// still pass, so it does not isolate the guard placement — the unpolled-drop
/// unit tests (`ziee-framework`'s `tests/sync_routes.rs`, and
/// `chat/stream/handler.rs`) do that.
#[tokio::test]
async fn head_requests_do_not_leak_connection_slots() {
    let server = crate::common::TestServer::start().await;
    let per_user_max = discover_per_user_cap(&server).await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "sync_head_leak",
        &["profile::read"],
    )
    .await;
    let client = reqwest::Client::new();

    // NON-VACUITY ANCHOR — pin the premise. If a future axum change, a proxy, or
    // a HEAD-handling layer short-circuited HEAD before the handler, everything
    // below would pass while testing nothing. Hold the user's whole allowance
    // open with LIVE streams and check a HEAD is refused: it can only 429 if it
    // reached `register()`.
    {
        use futures_util::StreamExt;
        let mut held = Vec::new();
        for _ in 0..per_user_max {
            let res = client
                .get(server.api_url("/sync/subscribe"))
                .header("Authorization", format!("Bearer {}", user.token))
                .send()
                .await
                .unwrap();
            assert_eq!(res.status(), 200);
            let mut body = res.bytes_stream();
            let _ = tokio::time::timeout(std::time::Duration::from_secs(10), body.next()).await;
            held.push(body);
        }
        let head = client
            .head(server.api_url("/sync/subscribe"))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .unwrap();
        assert_eq!(
            head.status(),
            429,
            "a HEAD must reach register() — if it is short-circuited before the \
             handler, the rest of this test proves nothing"
        );
        // A HEAD response carries NO body (axum swaps it for `Body::empty()` —
        // which is precisely the mechanism under test), so the error code cannot
        // be read from it. Establish that the refusal is the PER-USER cap — not
        // a global one, which would make the anchor vacuous — with a GET in the
        // same state, whose body IS readable.
        let get_at_cap = client
            .get(server.api_url("/sync/subscribe"))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .unwrap();
        assert_eq!(get_at_cap.status(), 429);
        let body = get_at_cap.text().await.unwrap_or_default();
        assert!(
            body.contains("SYNC_USER_LIMIT"),
            "the refusal at this point must be the PER-USER cap, got: {body}"
        );
        drop(held);
    }
    // Let those streams settle before measuring the HEAD-only behaviour.
    let _ = count_available_slots(&server, &user.token, per_user_max + 1).await;

    // Well past the cap: every one of these registers server-side, and every one
    // has its body dropped unpolled.
    for i in 0..(per_user_max * 2) {
        let res = client
            .head(server.api_url("/sync/subscribe"))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .expect("HEAD request completes");
        assert_eq!(
            res.status(),
            200,
            "HEAD #{} must be accepted — a 429 here means the previous HEADs \
             permanently consumed this account's connection slots",
            i + 1
        );
    }

    // The account must NOT be locked out: its full allowance is still available.
    let available = count_available_slots(&server, &user.token, per_user_max + 1).await;
    assert_eq!(
        available, per_user_max,
        "after {} HEAD requests the user's whole allowance must still be free; \
         only {available} of {per_user_max} slots were",
        per_user_max * 2
    );
}
