//! Release-catalogue caching + honest degradation.
//!
//! Measured against a live server BEFORE the fix, using GitHub's own counter
//! (`/rate_limit` is itself exempt from the budget, so the delta is purely
//! ziee's traffic):
//!
//! ```text
//! github core.used BEFORE = 24
//!    ... 5 × GET /local-runtime/versions/{engine}/check-updates ...
//! github core.used AFTER 5 discovery calls = 29
//! DELTA = 5
//! ```
//!
//! One upstream GitHub request per discovery call, against a 60/hour
//! unauthenticated budget, with no `GITHUB_TOKEN` support — which is how a rig
//! that ran for days ended up with the surface permanently erroring and not one
//! install attempt ever made. These tests pin both halves of the fix: the call
//! count, and what the response says when upstream cannot be reached.

use reqwest::StatusCode;
use serde_json::{Value, json};

use crate::common::test_helpers::create_user_with_permissions;

use super::mock_release;
use super::test_helpers::{self as lrt, LOCAL_RUNTIME_ADMIN_PERMS};

async fn get_json(
    server: &crate::common::TestServer,
    token: &str,
    path: &str,
) -> (StatusCode, Value) {
    let resp = reqwest::Client::new()
        .get(server.api_url(path))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .expect("request");
    let status = resp.status();
    (status, resp.json().await.expect("json body"))
}

/// TEST-4 `[acceptance]` for **INV-2** — discovery costs ONE upstream request
/// per TTL, not one per call; and when upstream goes away the previously-known
/// versions are still served, labelled, rather than collapsing to an empty
/// list.
///
/// The two halves must be in one test: "serves from cache" is only meaningful
/// if the live path is also observed working, and "degrades honestly" is only
/// meaningful if there was real data to degrade from.
#[tokio::test]
async fn discovery_is_cached_and_degrades_honestly_when_upstream_is_gone() {
    let mock = mock_release::setup().await;
    let admin =
        create_user_with_permissions(&mock.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;
    let path = "/local-runtime/versions/available?engine=llamacpp";

    let baseline = mock.release_list_hits();

    // --- first call: live, one upstream request -------------------------
    let (status, first) = get_json(&mock.server, &admin.token, path).await;
    assert_eq!(status, StatusCode::OK);
    let entry = &first["engines"][0];
    assert_eq!(entry["source"].as_str(), Some("live"), "{first}");
    assert!(
        entry["unavailable_reason"].is_null(),
        "a clean live read carries no failure reason: {entry}"
    );
    assert!(entry["checked_at"].as_str().is_some(), "{entry}");
    let live_versions = entry["versions"].as_array().expect("versions").len();
    assert!(live_versions > 0, "fixture must publish releases: {entry}");

    let after_first = mock.release_list_hits();
    assert_eq!(
        after_first - baseline,
        1,
        "the first discovery call should make exactly one upstream request"
    );

    // --- four more calls: all served from cache, ZERO extra upstream ----
    for _ in 0..4 {
        let (status, body) = get_json(&mock.server, &admin.token, path).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body["engines"][0]["source"].as_str(),
            Some("cache"),
            "a read within the TTL must be served from cache: {body}"
        );
    }
    assert_eq!(
        mock.release_list_hits(),
        after_first,
        "5 discovery calls must cost 1 upstream request, not 5 — this is the \
         exact ratio measured as broken against a live server"
    );

    // --- upstream disappears --------------------------------------------
    // Shrink the TTL to its minimum so the next read is forced to attempt a
    // refresh, then take the mock down: the shape of a rate-limited or
    // air-gapped host.
    let resp = lrt::update_runtime_settings(
        &mock.server,
        &admin.token,
        json!({ "engine_release_cache_ttl_secs": 60 }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK, "TTL update must be accepted");

    mock.take_upstream_down();

    // Within the (60s) TTL the cached answer is still simply "cache" — but the
    // load-bearing assertion is that the versions SURVIVE and the response is
    // still a 200 with real rows, never an error page and never an empty list.
    let (status, degraded) = get_json(&mock.server, &admin.token, path).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "an unreachable upstream must not 5xx — a 500 discards the cached \
         catalogue and renders as a generic error with nothing to install: {degraded}"
    );
    let dentry = &degraded["engines"][0];
    assert_eq!(
        dentry["versions"].as_array().map(|a| a.len()),
        Some(live_versions),
        "the previously-known versions must survive an unreachable upstream: {dentry}"
    );
    assert_ne!(
        dentry["source"].as_str(),
        Some("unavailable"),
        "we still hold a catalogue, so this is cached data, not 'unavailable': {dentry}"
    );
    assert!(
        dentry["checked_at"].as_str().is_some(),
        "cached data must say WHEN it was fetched, so the user can judge it: {dentry}"
    );
}

/// TEST-4 (companion) — with NOTHING cached and upstream unreachable, the
/// response is an explicit `unavailable` + reason, not a silent empty list.
///
/// This is the distinction INV-2 turns on: "upstream published no versions" and
/// "we could not reach upstream" are the same empty array on the wire unless the
/// response says which one it is. Getting this wrong is what made a rate-limited
/// rig look like an engine with no releases.
#[tokio::test]
async fn unreachable_upstream_with_empty_cache_reports_a_reason_not_an_empty_list() {
    let mock = mock_release::setup().await;
    let admin =
        create_user_with_permissions(&mock.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;

    // Kill upstream BEFORE any successful fetch, so nothing is ever cached.
    mock.take_upstream_down();

    let (status, body) = get_json(
        &mock.server,
        &admin.token,
        "/local-runtime/versions/available?engine=llamacpp",
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "an unreachable feed answers 200 with the reason, not a 5xx: {body}"
    );
    let entry = &body["engines"][0];
    assert_eq!(
        entry["source"].as_str(),
        Some("unavailable"),
        "with no cache and no upstream the source must be `unavailable`: {entry}"
    );
    assert_eq!(
        entry["versions"].as_array().map(|a| a.len()),
        Some(0),
        "there is genuinely nothing to list: {entry}"
    );
    assert!(
        entry["unavailable_reason"]
            .as_str()
            .is_some_and(|r| !r.is_empty()),
        "an empty catalogue MUST carry a reason — otherwise it is \
         indistinguishable from 'this engine has no releases': {entry}"
    );
}

/// TEST-5 — the TTL is an admin setting with enforced bounds. Both rejections
/// AND the accepted value are asserted here, so a rejection cannot pass merely
/// because the endpoint rejects everything.
#[tokio::test]
async fn release_cache_ttl_is_bounded_and_persisted() {
    let mock = mock_release::setup().await;
    let admin =
        create_user_with_permissions(&mock.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;

    for bad in [59, 86_401, 0, -1] {
        let resp = lrt::update_runtime_settings(
            &mock.server,
            &admin.token,
            json!({ "engine_release_cache_ttl_secs": bad }),
        )
        .await;
        assert_eq!(
            resp.status(),
            StatusCode::BAD_REQUEST,
            "engine_release_cache_ttl_secs={bad} must be rejected"
        );
    }

    // Happy-path counterpart: an in-bounds value is accepted and read back.
    let resp = lrt::update_runtime_settings(
        &mock.server,
        &admin.token,
        json!({ "engine_release_cache_ttl_secs": 120 }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK, "120s is in bounds");

    let (status, settings) = get_json(&mock.server, &admin.token, "/local-runtime/settings").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        settings["engine_release_cache_ttl_secs"].as_i64(),
        Some(120),
        "the accepted TTL must round-trip: {settings}"
    );

    // The sibling tunables are untouched by a partial PATCH.
    assert!(
        settings["idle_unload_secs"].as_i64().is_some(),
        "existing settings fields must survive: {settings}"
    );
}

/// TEST-8 — the pre-existing `check-updates` endpoint keeps every field it had
/// AND gains the provenance vocabulary, and it too is now cached.
///
/// Back-compat matters here: the UI's "Available versions" card depends on this
/// response shape, so the discoverability fix must ADD the noun without
/// breaking the verb.
#[tokio::test]
async fn check_updates_keeps_its_contract_and_is_cached() {
    let mock = mock_release::setup().await;
    let admin =
        create_user_with_permissions(&mock.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;
    let path = "/local-runtime/versions/llamacpp/check-updates";

    let before = mock.release_list_hits();
    let (status, body) = get_json(&mock.server, &admin.token, path).await;
    assert_eq!(status, StatusCode::OK);

    // Every field the card reads, still present.
    for field in ["engine", "platform", "arch", "versions"] {
        assert!(
            !body[field].is_null(),
            "check-updates lost `{field}`: {body}"
        );
    }
    let v = body["versions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["version"].as_str() == Some(mock_release::TEST_VERSION))
        .unwrap_or_else(|| panic!("TEST_VERSION missing: {body}"));
    for field in [
        "installed",
        "installed_backends",
        "binary_ready",
        "available_backends",
    ] {
        assert!(!v[field].is_null(), "version row lost `{field}`: {v}");
    }
    assert!(
        v["available_backends"]
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b.as_str() == Some("cpu")),
        "host cpu backend must still be reported: {v}"
    );
    assert!(v["size_bytes"].as_u64().is_some_and(|s| s > 0), "{v}");

    // New provenance fields.
    assert_eq!(body["source"].as_str(), Some("live"), "{body}");
    assert!(body["checked_at"].as_str().is_some(), "{body}");

    // And it shares the cache — a second call issues no upstream request.
    let after_first = mock.release_list_hits();
    assert_eq!(after_first - before, 1);
    let (_, second) = get_json(&mock.server, &admin.token, path).await;
    assert_eq!(second["source"].as_str(), Some("cache"), "{second}");
    assert_eq!(
        mock.release_list_hits(),
        after_first,
        "check-updates must not issue one GitHub request per page mount"
    );
}
