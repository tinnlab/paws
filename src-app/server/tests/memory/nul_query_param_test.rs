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

async fn seed_memory(server: &TestServer, user: &TestUser) {
    let resp = reqwest::Client::new()
        .post(server.api_url("/memories"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&json!({
            "content": "User prefers the roadmap in dark mode",
            "kind": "fact",
            "importance": 50,
        }))
        .send()
        .await
        .expect("create memory");
    assert_eq!(resp.status(), StatusCode::CREATED, "seed memory");
}

/// TEST-12 — `?search`.
#[tokio::test]
async fn memories_search_rejects_nul_and_still_searches() {
    let server = TestServer::start().await;
    let user =
        create_user_with_permissions(&server, "mem_nul", &["memory::read", "memory::write"]).await;
    seed_memory(&server, &user).await;

    // (b) HAPPY-PATH COUNTERPART.
    let (status, body) = get(&server, &user.token, "/memories?search=roadmap").await;
    assert_eq!(status, StatusCode::OK, "happy path: {body}");
    assert!(
        body["items"].as_array().is_some_and(|a| !a.is_empty()),
        "the seeded memory must match: {body}"
    );

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

    for (nul_path, benign_path) in [
        ("/memories?kind=%00", "/memories?kind=fact"),
        ("/memories?source=%00", "/memories?source=manual"),
    ] {
        // HAPPY-PATH COUNTERPART — the filter genuinely selects the seeded row
        // (`kind: fact` on creation; `source` defaults to `manual` for a REST
        // create), so a 400 below cannot be a broken filter path.
        let (status, body) = get(&server, &user.token, benign_path).await;
        assert_eq!(status, StatusCode::OK, "happy path {benign_path}: {body}");
        assert!(
            body["items"].as_array().is_some_and(|a| !a.is_empty()),
            "{benign_path} must select the seeded memory: {body}"
        );

        assert_nul_is_rejected(&server, &user.token, nul_path).await;
    }
}
