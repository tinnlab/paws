//! Regression tests for **D2**: an over-length assistant name overflowed the
//! `assistants.name character varying(255)` column and the resulting Postgres
//! `22001` escaped as a generic `500 SYSTEM_DATABASE_ERROR`.
//!
//! Observed against a live instance before the fix, on `PUT /api/assistants/{id}`:
//! a 200-character name → `200 OK`; **256, 300 and 500 characters → `500`**.
//! The `POST` create path had the identical defect (it only checked for empty).
//!
//! The boundary is asserted on BOTH sides (255 accepted / 256 rejected) so the
//! bound can't silently drift off by one, and on all four write handlers
//! (user create/update + template create/update).

use reqwest::StatusCode;
use serde_json::{Value, json};

use crate::common::TestServer;
use crate::common::test_helpers::{TestUser, create_user_with_permissions};

async fn assistant_user(server: &TestServer, name: &str) -> TestUser {
    create_user_with_permissions(server, name, &["*"]).await
}

async fn post_to(
    server: &TestServer,
    user: &TestUser,
    path: &str,
    body: Value,
) -> reqwest::Response {
    reqwest::Client::new()
        .post(server.api_url(path))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&body)
        .send()
        .await
        .expect("assistant create request failed")
}

async fn put_to(
    server: &TestServer,
    user: &TestUser,
    path: &str,
    body: Value,
) -> reqwest::Response {
    reqwest::Client::new()
        .put(server.api_url(path))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&body)
        .send()
        .await
        .expect("assistant update request failed")
}

async fn assert_validation_error(res: reqwest::Response, ctx: &str) {
    let got = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    assert_eq!(
        got,
        StatusCode::BAD_REQUEST,
        "{ctx}: expected 400, got {got} (body: {body})"
    );
    assert_eq!(
        body.get("error_code").and_then(Value::as_str),
        Some("VALIDATION_ERROR"),
        "{ctx}: wrong error_code (body: {body})"
    );
}

/// Create an assistant and return its id.
async fn create_assistant(server: &TestServer, user: &TestUser, name: &str) -> String {
    let res = post_to(server, user, "/assistants", json!({ "name": name })).await;
    assert_eq!(res.status(), StatusCode::CREATED, "setup: create assistant");
    res.json::<Value>().await.unwrap()["id"]
        .as_str()
        .expect("assistant id")
        .to_string()
}

// ───────────────── D2: update path (the reproduced defect) ─────────────────

#[tokio::test]
async fn over_length_name_on_update_returns_400_not_500() {
    let server = TestServer::start().await;
    let user = assistant_user(&server, "asst_upd").await;
    let id = create_assistant(&server, &user, "probe-asst").await;

    // Exactly the lengths reproduced against the live instance.
    for len in [256usize, 300, 500] {
        let res = put_to(
            &server,
            &user,
            &format!("/assistants/{id}"),
            json!({ "name": "b".repeat(len) }),
        )
        .await;
        assert_validation_error(res, &format!("PUT name of {len} chars")).await;
    }
}

#[tokio::test]
async fn boundary_name_lengths_on_update_behave_correctly() {
    let server = TestServer::start().await;
    let user = assistant_user(&server, "asst_bound").await;
    let id = create_assistant(&server, &user, "probe-bound").await;

    // 255 = exactly the column width → must still be accepted (this was the
    // pre-fix behaviour too; the fix must not regress it).
    let ok = put_to(
        &server,
        &user,
        &format!("/assistants/{id}"),
        json!({ "name": "c".repeat(255) }),
    )
    .await;
    assert_eq!(
        ok.status(),
        StatusCode::OK,
        "255-char name must be accepted"
    );

    // 256 = one over → 400, not the old 500.
    let bad = put_to(
        &server,
        &user,
        &format!("/assistants/{id}"),
        json!({ "name": "c".repeat(256) }),
    )
    .await;
    assert_validation_error(bad, "PUT name of 256 chars").await;
}

/// An update that does not touch the name must be unaffected by the new gate.
#[tokio::test]
async fn update_without_a_name_field_is_unaffected() {
    let server = TestServer::start().await;
    let user = assistant_user(&server, "asst_noname").await;
    let id = create_assistant(&server, &user, "probe-noname").await;

    let res = put_to(
        &server,
        &user,
        &format!("/assistants/{id}"),
        json!({ "description": "just a description change" }),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::OK,
        "name-less update must still succeed"
    );
}

// ───────────────────────── D2: create path ─────────────────────────

#[tokio::test]
async fn over_length_name_on_create_returns_400_not_500() {
    let server = TestServer::start().await;
    let user = assistant_user(&server, "asst_new").await;

    for len in [256usize, 300, 500] {
        let res = post_to(
            &server,
            &user,
            "/assistants",
            json!({ "name": "c".repeat(len) }),
        )
        .await;
        assert_validation_error(res, &format!("POST name of {len} chars")).await;
    }
}

#[tokio::test]
async fn exactly_max_length_name_on_create_is_accepted() {
    let server = TestServer::start().await;
    let user = assistant_user(&server, "asst_newmax").await;

    let res = post_to(
        &server,
        &user,
        "/assistants",
        json!({ "name": "d".repeat(255) }),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::CREATED,
        "255-char name must be accepted on create"
    );
}

// ───────────────────── D2: template handlers too ─────────────────────

#[tokio::test]
async fn over_length_name_on_template_create_returns_400_not_500() {
    let server = TestServer::start().await;
    let user = assistant_user(&server, "asst_tpl").await;

    let res = post_to(
        &server,
        &user,
        "/assistant-templates",
        json!({ "name": "e".repeat(300) }),
    )
    .await;
    assert_validation_error(res, "POST template name of 300 chars").await;
}

#[tokio::test]
async fn over_length_name_on_template_update_returns_400_not_500() {
    let server = TestServer::start().await;
    let user = assistant_user(&server, "asst_tplupd").await;

    let created = post_to(
        &server,
        &user,
        "/assistant-templates",
        json!({ "name": "tpl-probe" }),
    )
    .await;
    assert_eq!(
        created.status(),
        StatusCode::CREATED,
        "setup: create template"
    );
    let id = created.json::<Value>().await.unwrap()["id"]
        .as_str()
        .expect("template id")
        .to_string();

    let res = put_to(
        &server,
        &user,
        &format!("/assistant-templates/{id}"),
        json!({ "name": "e".repeat(300) }),
    )
    .await;
    assert_validation_error(res, "PUT template name of 300 chars").await;
}

// ───────────────── D3 (assistants): empty / control chars ─────────────────

#[tokio::test]
async fn empty_and_whitespace_only_names_are_rejected_on_both_paths() {
    let server = TestServer::start().await;
    let user = assistant_user(&server, "asst_empty").await;
    let id = create_assistant(&server, &user, "probe-empty").await;

    for name in ["", "   "] {
        let res = post_to(&server, &user, "/assistants", json!({ "name": name })).await;
        assert_validation_error(res, &format!("POST name {name:?}")).await;

        // The update path previously had NO name check at all, so a
        // whitespace-only rename silently blanked the assistant's name.
        let res = put_to(
            &server,
            &user,
            &format!("/assistants/{id}"),
            json!({ "name": name }),
        )
        .await;
        assert_validation_error(res, &format!("PUT name {name:?}")).await;
    }
}

#[tokio::test]
async fn control_character_name_is_rejected() {
    let server = TestServer::start().await;
    let user = assistant_user(&server, "asst_ctrl").await;

    let res = post_to(
        &server,
        &user,
        "/assistants",
        json!({ "name": "asst\u{202E}spoofed" }),
    )
    .await;
    assert_validation_error(res, "bidi-override assistant name").await;
}

/// Negative control: the gate is length + control characters, NOT a character
/// blacklist. Ordinary punctuation and non-ASCII text must keep working.
#[tokio::test]
async fn ordinary_names_within_bound_are_accepted() {
    let server = TestServer::start().await;
    let user = assistant_user(&server, "asst_ok").await;

    for name in [
        "Research Helper (v2) \u{2014} EN/FR",
        "\u{7814}\u{7A76}\u{52A9}\u{624B}",
    ] {
        let res = post_to(&server, &user, "/assistants", json!({ "name": name })).await;
        assert_eq!(
            res.status(),
            StatusCode::CREATED,
            "in-bound name {name:?} must be accepted"
        );
    }
}
