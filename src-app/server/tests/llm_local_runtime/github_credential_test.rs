//! An INVALID `GITHUB_TOKEN` must not fail worse than no token at all.
//!
//! ## The defect these pin, measured by hand against a live server
//!
//! ```text
//! anonymous  GET api.github.com/repos/ziee-ai/llama.cpp/releases  -> 200
//! + Authorization: Bearer <placeholder from tests/.env.test>       -> 401 Bad credentials
//! anonymous rate budget at time of measurement: limit=60 remaining=41
//! ```
//!
//! GitHub was fully reachable, yet the server answered:
//!
//! ```text
//! WARN ziee::modules::llm_local_runtime::engine::release_cache:
//!   engine release catalogue unavailable and nothing cached engine=llamacpp
//!   reason=Network error: Failed to list releases: HTTP 401 Unauthorized
//! ```
//!
//! …because `github_token()` filtered only the EMPTY string, so any non-empty
//! value — a placeholder, a typo, an expired PAT — was forwarded as a real
//! credential with no fallback. The operator's engine version list went empty
//! while the UI blamed GitHub.
//!
//! ## Why these are the hermetic half of the proof
//!
//! The e2e (`ui/tests/e2e/local-runtime/version-discovery.spec.ts`) proves the
//! whole production path against real GitHub — which is the one thing a mock
//! cannot do, and which is why it stays real. But a spec that only passes when
//! an external service cooperates would be the only evidence, and that rots.
//! So the fallback LOGIC is pinned HERE, offline and deterministically, against
//! a loopback mock GitHub reached through the already-committed debug-only
//! `LLM_RUNTIME_API_MIRROR` seam. No shared harness file is touched.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode as AxumStatus};
use axum::response::{IntoResponse, Response};
use reqwest::StatusCode;
use serde_json::Value;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

use crate::common::{TestServer, TestServerOptions, test_helpers::create_user_with_permissions};

use super::test_helpers::LOCAL_RUNTIME_ADMIN_PERMS;

/// The placeholder credential these tests present. It is a fabricated literal
/// with no value anywhere — never a real token, and never printed.
const FAKE_TOKEN: &str = "ghp_placeholder0000000000000000000000";

/// How the mock answers an AUTHENTICATED request.
#[derive(Clone, Copy, PartialEq, Eq)]
enum AuthBehavior {
    /// Accept the credential — the valid-token case (INV-4).
    Accept,
    /// `401 Bad credentials` — what GitHub actually returned for the
    /// placeholder in `tests/.env.test`.
    Reject401,
    /// `403` + `x-ratelimit-remaining: 0` — an ACCEPTED credential whose quota
    /// is exhausted. Must NOT trigger the anonymous fallback.
    RateLimit403,
}

#[derive(Clone)]
struct MockState {
    behavior: AuthBehavior,
    /// Every request, recorded as `true` when it carried an `Authorization`
    /// header. The order and length are the assertions.
    requests: Arc<std::sync::Mutex<Vec<bool>>>,
    hits: Arc<AtomicUsize>,
}

/// A loopback stand-in for `api.github.com` that decides purely on the presence
/// of an `Authorization` header — mirroring the measured live behaviour, where
/// the anonymous request succeeded and the credentialed one did not.
async fn releases(State(st): State<MockState>, headers: HeaderMap) -> Response {
    let authenticated = headers.contains_key("authorization");
    st.hits.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut log) = st.requests.lock() {
        log.push(authenticated);
    }

    if authenticated {
        match st.behavior {
            AuthBehavior::Reject401 => {
                return (
                    AxumStatus::UNAUTHORIZED,
                    [("content-type", "application/json")],
                    r#"{"message":"Bad credentials","status":"401"}"#,
                )
                    .into_response();
            }
            AuthBehavior::RateLimit403 => {
                return (
                    AxumStatus::FORBIDDEN,
                    [
                        ("content-type", "application/json"),
                        ("x-ratelimit-remaining", "0"),
                        ("x-ratelimit-limit", "5000"),
                    ],
                    r#"{"message":"API rate limit exceeded","status":"403"}"#,
                )
                    .into_response();
            }
            AuthBehavior::Accept => {}
        }
    }

    // Anonymous (or an accepted credential): serve a real-shaped catalogue.
    // The asset name matches the host so `binary_ready` is true and the
    // catalogue is indistinguishable from a healthy production read.
    let platform = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x86_64"
    };
    let ext = if platform == "windows" {
        "zip"
    } else {
        "tar.gz"
    };
    let body = format!(
        r#"[{{"tag_name":"v0.0.9-mock","draft":false,"prerelease":false,
             "published_at":"2026-08-01T00:00:00Z",
             "assets":[{{"name":"llama-server-{platform}-{arch}-cpu.{ext}","size":12345678}}]}}]"#
    );
    (AxumStatus::OK, [("content-type", "application/json")], body).into_response()
}

struct MockGithub {
    server: TestServer,
    requests: Arc<std::sync::Mutex<Vec<bool>>>,
    hits: Arc<AtomicUsize>,
    _handle: JoinHandle<()>,
}

impl MockGithub {
    /// `(total_requests, authenticated_flags_in_order)`.
    fn observed(&self) -> (usize, Vec<bool>) {
        let log = self
            .requests
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|e| e.into_inner().clone());
        (self.hits.load(Ordering::SeqCst), log)
    }
}

impl Drop for MockGithub {
    fn drop(&mut self) {
        self._handle.abort();
    }
}

/// Stand up the mock + a `TestServer` whose GitHub API base points at it.
///
/// `token` is `None` for the no-credential case; `Some(_)` injects
/// `GITHUB_TOKEN` into the spawned server's environment, which is exactly how a
/// real operator (and `tests/.env.test`) supplies it.
async fn setup(behavior: AuthBehavior, token: Option<&str>) -> MockGithub {
    let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
    let hits = Arc::new(AtomicUsize::new(0));

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock github");
    let port = listener.local_addr().expect("local_addr").port();
    let mirror = format!("http://127.0.0.1:{port}");

    let app = axum::Router::new()
        .route(
            "/repos/{owner}/{repo}/releases",
            axum::routing::get(releases),
        )
        .with_state(MockState {
            behavior,
            requests: Arc::clone(&requests),
            hits: Arc::clone(&hits),
        });
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app.into_make_service()).await;
    });

    let mut extra_env = vec![("LLM_RUNTIME_API_MIRROR".to_string(), mirror)];
    match token {
        Some(t) => extra_env.push(("GITHUB_TOKEN".to_string(), t.to_string())),
        // The harness inherits the test process's environment, which on a
        // developer box has `tests/.env.test` sourced — so the no-credential
        // case must EXPLICITLY blank it, or it would silently be a
        // has-credential case and the positive control would be a lie.
        None => extra_env.push(("GITHUB_TOKEN".to_string(), String::new())),
    }

    let server = TestServer::start_with_options(TestServerOptions {
        extra_env,
        ..Default::default()
    })
    .await;

    MockGithub {
        server,
        requests,
        hits,
        _handle: handle,
    }
}

async fn check_updates(mock: &MockGithub, token: &str) -> (StatusCode, Value) {
    let resp = reqwest::Client::new()
        .get(
            mock.server
                .api_url("/local-runtime/versions/llamacpp/check-updates"),
        )
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .expect("check-updates request");
    let status = resp.status();
    (status, resp.json().await.expect("json body"))
}

/// TEST-3 `[acceptance]` for **INV-4** — a VALID token stays authenticated.
///
/// The happy-path counterpart to the fallback. If the fix downgraded to
/// anonymous whenever a token was present (or issued a gratuitous second
/// request), an operator's budget would silently drop from 5000/hr to 60/hr —
/// a regression invisible to any test that only checks "versions appeared".
/// So this asserts the exact request LOG: one request, and it carried the
/// credential.
#[tokio::test]
async fn valid_token_stays_authenticated_with_exactly_one_request() {
    let mock = setup(AuthBehavior::Accept, Some(FAKE_TOKEN)).await;
    let admin =
        create_user_with_permissions(&mock.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;

    let (status, body) = check_updates(&mock, &admin.token).await;
    assert_eq!(status, StatusCode::OK);

    let (total, log) = mock.observed();
    assert_eq!(
        total, 1,
        "an accepted credential must cost exactly ONE upstream request — a \
         second one would double-spend the operator's budget"
    );
    assert_eq!(
        log,
        vec![true],
        "the single request must have carried the Authorization header; \
         silently going anonymous cuts the operator from 5000/hr to 60/hr"
    );
    assert_eq!(
        body["credential_status"], "used",
        "an accepted token reports `used`, so an operator can confirm their \
         credential is actually in effect"
    );
    assert_eq!(body["source"], "live");
    assert!(body["unavailable_reason"].is_null());
    assert!(
        !body["versions"].as_array().expect("versions").is_empty(),
        "the catalogue must be served"
    );
}

/// TEST-4 `[acceptance]` for **INV-1** — a REJECTED token falls back to
/// anonymous, and discovery still works.
///
/// This is the reported defect, reproduced exactly: the mock answers 401 to an
/// authenticated request and 200 to an anonymous one, which is what live GitHub
/// did. Pre-fix this path produced `source: unavailable` and an empty list.
/// Removing the fallback turns this red.
#[tokio::test]
async fn rejected_token_falls_back_to_anonymous_and_discovery_succeeds() {
    let mock = setup(AuthBehavior::Reject401, Some(FAKE_TOKEN)).await;
    let admin =
        create_user_with_permissions(&mock.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;

    let (status, body) = check_updates(&mock, &admin.token).await;
    assert_eq!(status, StatusCode::OK);

    let (total, log) = mock.observed();
    assert_eq!(
        total, 2,
        "one authenticated attempt, then ONE anonymous re-issue — never more, \
         because the anonymous budget is 60/hr/IP"
    );
    assert_eq!(
        log,
        vec![true, false],
        "the credential must be tried FIRST (so a valid one is never wasted) \
         and dropped only after GitHub refused it"
    );

    assert_eq!(
        body["source"], "live",
        "the anonymous-rescued catalogue is genuinely fresh"
    );
    assert!(
        body["unavailable_reason"].is_null(),
        "a rescued read must NOT claim GitHub was unreachable — it was not"
    );
    let versions = body["versions"].as_array().expect("versions");
    assert!(
        !versions.is_empty(),
        "the whole point: an invalid credential must not empty the version \
         list when the anonymous path works"
    );
    assert_eq!(versions[0]["version"], "v0.0.9-mock");
    assert_eq!(
        body["credential_status"], "rejected",
        "and the operator is told WHY they are on the anonymous budget"
    );
}

/// TEST-5 — a RATE-LIMITED (but accepted) token must NOT fall back.
///
/// The negative control for TEST-4. A 403 carrying `x-ratelimit-remaining: 0`
/// is a quota problem with a correct remedy (wait, or raise it), not a
/// credential problem; retrying anonymously would spend the scarce 60/hr/IP
/// budget to hide the 403 the operator needs to see. If the classifier
/// collapsed the two, this test would observe a second request.
#[tokio::test]
async fn rate_limited_token_does_not_trigger_anonymous_retry() {
    let mock = setup(AuthBehavior::RateLimit403, Some(FAKE_TOKEN)).await;
    let admin =
        create_user_with_permissions(&mock.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;

    let (status, body) = check_updates(&mock, &admin.token).await;
    assert_eq!(status, StatusCode::OK, "still a degraded 200, not a 500");

    let (total, log) = mock.observed();
    assert_eq!(
        total, 1,
        "a rate limit must cost exactly one request — no anonymous retry"
    );
    assert_eq!(log, vec![true], "and that request kept the credential");

    assert_eq!(
        body["source"], "unavailable",
        "nothing cached and the refresh failed"
    );
    assert_eq!(
        body["credential_status"], "used",
        "the token was ACCEPTED and merely throttled — reporting it as \
         `rejected` would send the operator to replace a working credential"
    );
    let reason = body["unavailable_reason"]
        .as_str()
        .expect("a failed refresh must always carry a reason");
    assert!(reason.contains("403"), "reason names the status: {reason}");
    assert!(
        !reason.contains("GITHUB_TOKEN"),
        "a rate limit must not be blamed on the credential: {reason}"
    );
}

/// TEST-6 `[acceptance]` for **INV-2** — a rejected credential is REPORTABLE as
/// a rejected credential, and is distinguishable from a plain outage.
///
/// Both situations are exercised in ONE test, because "distinguishable" is a
/// claim about a PAIR: asserting only the rejected case would pass just as well
/// if every response said `rejected`. Covers both discovery endpoints, since
/// `check-updates` and `/versions/available` build their responses through
/// different code (`handlers.rs` vs `binary_manager.rs`) and an omission in
/// either would leave one surface mute.
#[tokio::test]
async fn rejected_credential_is_distinguishable_from_an_outage() {
    // --- (a) credential rejected, upstream otherwise healthy ---------------
    let rejected = setup(AuthBehavior::Reject401, Some(FAKE_TOKEN)).await;
    let admin_a =
        create_user_with_permissions(&rejected.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;

    let (_, updates) = check_updates(&rejected, &admin_a.token).await;
    assert_eq!(updates["credential_status"], "rejected");
    assert_eq!(updates["source"], "live");

    let resp = reqwest::Client::new()
        .get(
            rejected
                .server
                .api_url("/local-runtime/versions/available?engine=llamacpp"),
        )
        .header("Authorization", format!("Bearer {}", admin_a.token))
        .send()
        .await
        .expect("available request");
    assert_eq!(resp.status(), StatusCode::OK);
    let available: Value = resp.json().await.expect("json");
    let engine = &available["engines"][0];
    assert_eq!(
        engine["credential_status"], "rejected",
        "the discovery endpoint must carry the same verdict as check-updates \
         — they are built by different code, and a caller may use either"
    );

    // --- (b) no credential at all, upstream unreachable --------------------
    // A closed port is the honest stand-in for "GitHub is down": the request
    // fails at the transport, exactly as it would air-gapped.
    let outage = setup(AuthBehavior::Accept, None).await;
    let admin_b =
        create_user_with_permissions(&outage.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;
    outage._handle.abort();
    // Give the aborted listener a moment to stop accepting.
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let (status, down) = check_updates(&outage, &admin_b.token).await;
    assert_eq!(status, StatusCode::OK, "an outage is still a degraded 200");
    assert_eq!(
        down["source"], "unavailable",
        "nothing cached and upstream is gone"
    );
    assert_eq!(
        down["credential_status"], "absent",
        "THE distinction: an outage with no credential reports `absent`, not \
         `rejected` — so 'GitHub is down' and 'your token is wrong' are two \
         readable states instead of one indistinguishable failure"
    );
    let reason = down["unavailable_reason"]
        .as_str()
        .expect("an outage must carry a reason");
    assert!(
        !reason.contains("GITHUB_TOKEN"),
        "an outage must not be blamed on a credential that was never sent: \
         {reason}"
    );
    assert!(
        !reason.contains(FAKE_TOKEN) && !reason.contains("Bearer"),
        "no reason string may ever carry a credential value"
    );
}
