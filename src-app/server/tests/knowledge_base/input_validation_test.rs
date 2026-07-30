//! Regression tests: unvalidated knowledge-base input reaching Postgres and
//! escaping as a generic HTTP 500.
//!
//! Two defects, both observed against a live instance before the fix:
//!
//! * **D1** — `POST /api/knowledge-bases` with a name the caller already holds
//!   violated the UNIQUE index `idx_knowledge_bases_user_name` on
//!   `(user_id, lower(name))`. The bare INSERT's `.map_err(database_error)`
//!   flattened the 23505 into `500 SYSTEM_DATABASE_ERROR`. Renaming one KB onto
//!   another's name (`PUT`) had the same shape.
//! * **D3** — `knowledge_bases.name` is `text`, so no bound existed anywhere:
//!   a 300-character name was accepted with a `201`.
//!
//! Every test below asserts the SPECIFIC status + error code, not merely
//! "not 500", so a future regression to a different wrong code still fails.

use reqwest::StatusCode;
use serde_json::{Value, json};

use crate::common::TestServer;
use crate::common::test_helpers::{TestUser, create_user_with_permissions};

async fn kb_user(server: &TestServer, name: &str) -> TestUser {
    create_user_with_permissions(server, name, &["*"]).await
}

async fn post_kb(server: &TestServer, user: &TestUser, body: Value) -> reqwest::Response {
    reqwest::Client::new()
        .post(server.api_url("/knowledge-bases"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&body)
        .send()
        .await
        .expect("create knowledge base request failed")
}

async fn put_kb(server: &TestServer, user: &TestUser, id: &str, body: Value) -> reqwest::Response {
    reqwest::Client::new()
        .put(server.api_url(&format!("/knowledge-bases/{id}")))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&body)
        .send()
        .await
        .expect("update knowledge base request failed")
}

/// Assert the response carries the given status AND error_code — and, when it
/// does not, surface the body so a failure is diagnosable in one run.
async fn assert_error(res: reqwest::Response, status: StatusCode, code: &str, ctx: &str) {
    let got = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    assert_eq!(got, status, "{ctx}: wrong status (body: {body})");
    assert_eq!(
        body.get("error_code").and_then(Value::as_str),
        Some(code),
        "{ctx}: wrong error_code (body: {body})"
    );
}

// ─────────────────────── D1: duplicate name → 409 ───────────────────────

#[tokio::test]
async fn duplicate_kb_name_returns_409_not_500() {
    let server = TestServer::start().await;
    let user = kb_user(&server, "kb_dup").await;

    let first = post_kb(
        &server,
        &user,
        json!({ "name": "dup-probe", "description": "x" }),
    )
    .await;
    assert_eq!(
        first.status(),
        StatusCode::CREATED,
        "first create should win"
    );

    // Before the fix this was 500 SYSTEM_DATABASE_ERROR.
    let second = post_kb(
        &server,
        &user,
        json!({ "name": "dup-probe", "description": "x" }),
    )
    .await;
    assert_error(
        second,
        StatusCode::CONFLICT,
        "RESOURCE_CONFLICT",
        "duplicate KB name",
    )
    .await;
}

#[tokio::test]
async fn duplicate_kb_name_is_case_insensitive_conflict() {
    let server = TestServer::start().await;
    let user = kb_user(&server, "kb_case").await;

    let first = post_kb(&server, &user, json!({ "name": "Case-Probe" })).await;
    assert_eq!(first.status(), StatusCode::CREATED);

    // The UNIQUE index is on lower(name), so a case variant is the SAME row.
    let second = post_kb(&server, &user, json!({ "name": "case-probe" })).await;
    assert_error(
        second,
        StatusCode::CONFLICT,
        "RESOURCE_CONFLICT",
        "case-variant KB name",
    )
    .await;
}

#[tokio::test]
async fn renaming_kb_onto_an_existing_name_returns_409_not_500() {
    let server = TestServer::start().await;
    let user = kb_user(&server, "kb_ren").await;

    let a = post_kb(&server, &user, json!({ "name": "ren-a" })).await;
    assert_eq!(a.status(), StatusCode::CREATED);
    let b = post_kb(&server, &user, json!({ "name": "ren-b" })).await;
    assert_eq!(b.status(), StatusCode::CREATED);
    let b_id = b.json::<Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Before the fix this was 500 SYSTEM_DATABASE_ERROR (UPDATE has no
    // ON CONFLICT form, so the unique violation needed explicit mapping).
    let clash = put_kb(&server, &user, &b_id, json!({ "name": "ren-a" })).await;
    assert_error(
        clash,
        StatusCode::CONFLICT,
        "RESOURCE_CONFLICT",
        "KB rename collision",
    )
    .await;
}

/// Negative control for the conflict rule: the unique index is scoped by
/// `user_id`, so two DIFFERENT users may each hold the same KB name. If this
/// ever 409s, the fix has over-reached into a cross-user collision.
#[tokio::test]
async fn same_kb_name_for_two_different_users_is_allowed() {
    let server = TestServer::start().await;
    let alice = kb_user(&server, "kb_alice").await;
    let bob = kb_user(&server, "kb_bob").await;

    let a = post_kb(&server, &alice, json!({ "name": "shared-name" })).await;
    assert_eq!(a.status(), StatusCode::CREATED, "alice creates");

    let b = post_kb(&server, &bob, json!({ "name": "shared-name" })).await;
    assert_eq!(
        b.status(),
        StatusCode::CREATED,
        "bob must be able to hold the same name — the index is per-user"
    );
}

/// Re-submitting a KB's OWN current name must stay a no-op success, not a
/// self-conflict. Guards against a naive "any matching row → 409" fix.
#[tokio::test]
async fn renaming_kb_to_its_own_current_name_is_not_a_conflict() {
    let server = TestServer::start().await;
    let user = kb_user(&server, "kb_self").await;

    let created = post_kb(&server, &user, json!({ "name": "self-name" })).await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let id = created.json::<Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    let same = put_kb(&server, &user, &id, json!({ "name": "self-name" })).await;
    assert_eq!(
        same.status(),
        StatusCode::OK,
        "re-submitting your own name must succeed"
    );
}

// ─────────────────── D3: name length/format bound → 400 ───────────────────

#[tokio::test]
async fn over_length_kb_name_returns_400_not_201() {
    let server = TestServer::start().await;
    let user = kb_user(&server, "kb_long").await;

    // Before the fix a 300-character name was accepted with a 201.
    let res = post_kb(&server, &user, json!({ "name": "a".repeat(300) })).await;
    assert_error(
        res,
        StatusCode::BAD_REQUEST,
        "INVALID_NAME",
        "300-char KB name",
    )
    .await;

    // 256 is over the 255 bound too (boundary+1).
    let res = post_kb(&server, &user, json!({ "name": "a".repeat(256) })).await;
    assert_error(
        res,
        StatusCode::BAD_REQUEST,
        "INVALID_NAME",
        "256-char KB name",
    )
    .await;
}

#[tokio::test]
async fn exactly_max_length_kb_name_is_accepted() {
    let server = TestServer::start().await;
    let user = kb_user(&server, "kb_max").await;

    // Boundary: 255 must still succeed — the bound must not be off-by-one.
    let res = post_kb(&server, &user, json!({ "name": "a".repeat(255) })).await;
    assert_eq!(
        res.status(),
        StatusCode::CREATED,
        "255-char name must be accepted"
    );
}

#[tokio::test]
async fn over_length_kb_name_rejected_on_rename_too() {
    let server = TestServer::start().await;
    let user = kb_user(&server, "kb_longren").await;

    let created = post_kb(&server, &user, json!({ "name": "short" })).await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let id = created.json::<Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    let res = put_kb(&server, &user, &id, json!({ "name": "a".repeat(300) })).await;
    assert_error(
        res,
        StatusCode::BAD_REQUEST,
        "INVALID_NAME",
        "300-char KB rename",
    )
    .await;
}

#[tokio::test]
async fn empty_and_whitespace_only_kb_names_are_rejected() {
    let server = TestServer::start().await;
    let user = kb_user(&server, "kb_empty").await;

    for name in ["", "   "] {
        let res = post_kb(&server, &user, json!({ "name": name })).await;
        assert_error(
            res,
            StatusCode::BAD_REQUEST,
            "INVALID_NAME",
            &format!("KB name {name:?}"),
        )
        .await;
    }
}

#[tokio::test]
async fn control_character_kb_name_is_rejected() {
    let server = TestServer::start().await;
    let user = kb_user(&server, "kb_ctrl").await;

    // U+202E RIGHT-TO-LEFT OVERRIDE can reorder adjacent text in the KB list.
    let res = post_kb(&server, &user, json!({ "name": "kb\u{202E}spoofed" })).await;
    assert_error(
        res,
        StatusCode::BAD_REQUEST,
        "INVALID_NAME",
        "bidi-override KB name",
    )
    .await;
}

/// Negative control for D3: the bound is LENGTH + control characters, not a
/// markup blacklist. A name containing `<script>` is legal data — the UI
/// escapes on output — and must keep working, so the fix is not silently
/// over-broad.
#[tokio::test]
async fn ordinary_and_markup_bearing_kb_names_within_bound_are_accepted() {
    let server = TestServer::start().await;
    let user = kb_user(&server, "kb_ok").await;

    for name in ["Q3 Papers (draft) \u{2014} v2", "<script>alert(1)</script>"] {
        let res = post_kb(&server, &user, json!({ "name": name })).await;
        assert_eq!(
            res.status(),
            StatusCode::CREATED,
            "in-bound name {name:?} must be accepted"
        );
    }
}
