//! TEST-12 / TEST-13 — `/memories?search`, `?kind` and `?source` refuse a NUL
//! with a typed 400, not a 500.
//!
//! `kind` and `source` were NOT in the reported defect. They are included
//! because `memory/repository.rs` binds them as `kind = $5` / `source = $6` —
//! the same text-bind class as `search` — and the pre-fix reproduction
//! confirmed both returned 500.

use reqwest::StatusCode;
use serde_json::json;

use crate::common::TestServer;
use crate::common::nul_query_param::{assert_nul_is_rejected, get};
use crate::common::test_helpers::{TestUser, create_user_with_permissions};

async fn seed_memory_with(server: &TestServer, user: &TestUser, content: &str, kind: &str) {
    let resp = reqwest::Client::new()
        .post(server.api_url("/memories"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&json!({ "content": content, "kind": kind, "importance": 50 }))
        .send()
        .await
        .expect("create memory");
    assert_eq!(resp.status(), StatusCode::CREATED, "seed memory");
}

async fn seed_memory(server: &TestServer, user: &TestUser) {
    seed_memory_with(
        server,
        user,
        "User prefers the roadmap in dark mode",
        "fact",
    )
    .await;
}

fn contents(body: &serde_json::Value) -> Vec<String> {
    body["items"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|m| m["content"].as_str().unwrap_or_default().to_string())
        .collect()
}

/// TEST-12 — `?search`.
#[tokio::test]
async fn memories_search_rejects_nul_and_still_searches() {
    let server = TestServer::start().await;
    let user =
        create_user_with_permissions(&server, "mem_nul", &["memory::read", "memory::write"]).await;
    seed_memory(&server, &user).await;
    // A SECOND, non-matching row: without it a handler that ignored `search`
    // entirely would return the same body and the happy-path leg would prove
    // nothing about the filter.
    seed_memory_with(&server, &user, "Unrelated note about kittens", "other").await;

    // (b) HAPPY-PATH COUNTERPART — the filter SELECTS, i.e. it returns the
    // matching row and EXCLUDES the other one.
    let (status, body) = get(&server, &user.token, "/memories?search=roadmap").await;
    assert_eq!(status, StatusCode::OK, "happy path: {body}");
    let got = contents(&body);
    assert_eq!(got.len(), 1, "search must select exactly the match: {body}");
    assert!(got[0].contains("roadmap"), "{body}");

    // (a) The defect.
    assert_nul_is_rejected(
        &server,
        &user.token,
        "/memories?page=1&per_page=10&search=%00",
    )
    .await;

    // (c) OWNERSHIP CONTROL.
    let other =
        create_user_with_permissions(&server, "mem_nul2", &["memory::read", "memory::write"]).await;
    let (status, body) = get(&server, &other.token, "/memories?search=roadmap").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        body["items"].as_array().is_some_and(|a| a.is_empty()),
        "another user must not see the owner's memory: {body}"
    );
}

/// TEST-13 — the sibling free-text filters `?kind` and `?source` carry the
/// same guard, each with its own happy-path counterpart.
#[tokio::test]
async fn memories_kind_and_source_filters_reject_nul() {
    let server = TestServer::start().await;
    let user =
        create_user_with_permissions(&server, "mem_kind_nul", &["memory::read", "memory::write"])
            .await;
    seed_memory(&server, &user).await;
    seed_memory_with(&server, &user, "Unrelated note about kittens", "other").await;

    // HAPPY-PATH COUNTERPART, made DISCRIMINATING: `?kind=fact` must return the
    // one `fact` row and EXCLUDE the `other` row. A handler that ignored `kind`
    // would return both and fail here — which is what makes the paired
    // rejection assertion mean something.
    let (status, body) = get(&server, &user.token, "/memories?kind=fact").await;
    assert_eq!(status, StatusCode::OK, "happy path: {body}");
    let got = contents(&body);
    assert_eq!(
        got.len(),
        1,
        "?kind=fact must exclude the 'other' row: {body}"
    );
    assert!(got[0].contains("roadmap"), "{body}");

    // `?source=manual` selects both REST-created rows; the discriminating
    // counterpart is a source that matches NEITHER.
    let (status, body) = get(&server, &user.token, "/memories?source=manual").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        contents(&body).len(),
        2,
        "both rows are source=manual: {body}"
    );
    let (status, body) = get(&server, &user.token, "/memories?source=extraction").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        contents(&body).is_empty(),
        "?source=extraction must exclude both manual rows: {body}"
    );

    for nul_path in ["/memories?kind=%00", "/memories?source=%00"] {
        assert_nul_is_rejected(&server, &user.token, nul_path).await;
    }
}
