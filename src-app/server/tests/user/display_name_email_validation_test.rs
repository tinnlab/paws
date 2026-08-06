//! Regression tests: `display_name` and `email` had no bound/charset gate on
//! the user write paths, so both escaped as a generic HTTP 500.
//!
//! Sibling of `username_validation_test.rs` — same defect class, the two other
//! user-settable string fields. `username` got its shared gate in an earlier
//! sweep; these two were left behind.
//!
//! Reproduced against a running server before the fix:
//!
//! ```text
//! POST /api/auth/profile {"display_name": <256 chars>}  -> 500 SYSTEM_DATABASE_ERROR
//! POST /api/auth/profile {"display_name": "abc\0def"}   -> 500 SYSTEM_DATABASE_ERROR
//! POST /api/users        {"display_name": <256 chars>}  -> 500 SYSTEM_DATABASE_ERROR
//! POST /api/users        {"email": <256 chars>}         -> 500 SYSTEM_DATABASE_ERROR
//! POST /api/users        {"email": "abc\0def"}          -> 500 SYSTEM_DATABASE_ERROR
//! ```
//!
//! Two distinct Postgres failures behind one generic body:
//!   * `22001 value too long` — `display_name` and `email` are
//!     `character varying(255)` and nothing bounded them app-side.
//!   * `22021 invalid byte sequence` — U+0000 cannot be stored in a Postgres
//!     text column at all, at any length.
//!
//! `POST /api/users` additionally gated `email` on `is_empty()` ALONE, so
//! `"   "`, `"<script>alert(1)</script>"` and `admin' OR '1'='1;--` were all
//! persisted as email addresses with a 201.
//!
//! Every test asserts the SPECIFIC status + error code, not merely "not 500".

use reqwest::StatusCode;
use serde_json::{Value, json};

use crate::common::TestServer;
use crate::common::test_helpers::{TestUser, create_user_with_permissions};

/// Exactly the column bound — must be ACCEPTED (guards an off-by-one).
const AT_BOUND: usize = 255;

async fn admin(server: &TestServer) -> TestUser {
    create_user_with_permissions(server, "dv_admin", &["users::create", "users::edit"]).await
}

async fn post_json(server: &TestServer, token: &str, path: &str, body: Value) -> reqwest::Response {
    reqwest::Client::new()
        .post(server.api_url(path))
        .header("Authorization", format!("Bearer {token}"))
        .json(&body)
        .send()
        .await
        .expect("request failed")
}

async fn assert_rejected_with(res: reqwest::Response, code: &str, ctx: &str) {
    let got = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    assert_eq!(
        got,
        StatusCode::BAD_REQUEST,
        "{ctx}: expected 400, got {got} (body: {body})"
    );
    assert_eq!(
        body.get("error_code").and_then(Value::as_str),
        Some(code),
        "{ctx}: wrong error_code (body: {body})"
    );
}

/// Display names that must be rejected on every write path: the varchar(255)
/// overflow, the unstorable NUL, other control characters, and a bidi spoof.
fn invalid_display_names() -> Vec<(String, &'static str)> {
    vec![
        ("d".repeat(AT_BOUND + 1), "one over the varchar(255) column"),
        ("d".repeat(5000), "5000 chars (was a 500)"),
        ("abc\u{0}def".to_string(), "NUL (unstorable in Postgres)"),
        ("ring\u{0007}bell".to_string(), "C0 control char"),
        ("spoof\u{202E}ed".to_string(), "bidi override"),
        ("zero\u{200B}width".to_string(), "zero-width space"),
    ]
}

// ───────────── path 1: self-service (POST /auth/profile) ─────────────

#[tokio::test]
async fn self_profile_update_rejects_invalid_display_names() {
    let server = TestServer::start().await;
    // The exact route the automated explorer drove; `profile::edit` is the
    // permission the default group holds.
    let user = create_user_with_permissions(&server, "dv_self", &["profile::edit"]).await;

    for (display_name, why) in invalid_display_names() {
        let res = post_json(
            &server,
            &user.token,
            "/auth/profile",
            json!({ "display_name": display_name }),
        )
        .await;
        assert_rejected_with(
            res,
            "INVALID_DISPLAY_NAME",
            &format!("self profile ({why})"),
        )
        .await;
    }
}

/// A rejected update must be a no-op, not a partial write.
#[tokio::test]
async fn rejected_self_display_name_leaves_the_previous_value_intact() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "dv_intact", &["profile::edit"]).await;

    let ok = post_json(
        &server,
        &user.token,
        "/auth/profile",
        json!({ "display_name": "Original Name" }),
    )
    .await;
    assert_eq!(
        ok.status(),
        StatusCode::OK,
        "setup: set a good display name"
    );

    let res = post_json(
        &server,
        &user.token,
        "/auth/profile",
        json!({ "display_name": "d".repeat(AT_BOUND + 1) }),
    )
    .await;
    assert_rejected_with(res, "INVALID_DISPLAY_NAME", "self profile (over bound)").await;

    let me: Value = reqwest::Client::new()
        .get(server.api_url("/auth/me"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .expect("me request failed")
        .json()
        .await
        .expect("me json");
    assert_eq!(
        me["user"]["display_name"].as_str(),
        Some("Original Name"),
        "a rejected display-name update must not have partially written"
    );
}

#[tokio::test]
async fn self_profile_update_still_accepts_valid_display_names() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "dv_selfok", &["profile::edit"]).await;

    // Free-form prose, non-Latin scripts and emoji are all legitimate.
    for display_name in ["Ada Lovelace-Byron, Jr.", "山田 太郎", "😀 emoji name"] {
        let res = post_json(
            &server,
            &user.token,
            "/auth/profile",
            json!({ "display_name": display_name }),
        )
        .await;
        assert_eq!(
            res.status(),
            StatusCode::OK,
            "a conventional display name ({display_name:?}) must still be accepted"
        );
        let body: Value = res.json().await.expect("parse user");
        assert_eq!(body["display_name"].as_str(), Some(display_name));
    }
}

/// The bound is counted in CHARACTERS, matching `character varying(255)`.
/// 255 astral chars are 1020 bytes — a byte bound would wrongly reject a value
/// Postgres stores fine.
#[tokio::test]
async fn display_name_bound_is_characters_not_bytes() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "dv_chars", &["profile::edit"]).await;

    let astral = "😀".repeat(AT_BOUND);
    assert!(
        astral.len() > AT_BOUND,
        "fixture must exceed the byte count"
    );

    let res = post_json(
        &server,
        &user.token,
        "/auth/profile",
        json!({ "display_name": astral }),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::OK,
        "255 astral characters fit varchar(255) and must be accepted"
    );
}

// ───────────── path 2: admin create (POST /users) ─────────────

#[tokio::test]
async fn admin_create_rejects_invalid_display_names() {
    let server = TestServer::start().await;
    let admin = admin(&server).await;

    for (i, (display_name, why)) in invalid_display_names().into_iter().enumerate() {
        let res = post_json(
            &server,
            &admin.token,
            "/users",
            json!({
                "username": format!("dv.create.{i}"),
                "email": format!("dv_create_{i}@example.com"),
                "password": "password123",
                "display_name": display_name,
            }),
        )
        .await;
        assert_rejected_with(
            res,
            "INVALID_DISPLAY_NAME",
            &format!("admin create ({why})"),
        )
        .await;
    }
}

#[tokio::test]
async fn admin_create_rejects_invalid_emails() {
    let server = TestServer::start().await;
    let admin = admin(&server).await;

    // The two 500-producers plus the shapes `is_empty()` alone let through.
    let invalid = vec![
        (
            format!("{}@example.com", "e".repeat(AT_BOUND)),
            "over the varchar(255) column",
        ),
        ("e".repeat(5000), "5000 chars (was a 500)"),
        (
            "abc\u{0}def@example.com".to_string(),
            "NUL (unstorable in Postgres)",
        ),
        (String::new(), "empty"),
        ("   ".to_string(), "whitespace only"),
        ("<script>alert(1)</script>".to_string(), "markup"),
        (
            "admin' OR '1'='1; DROP TABLE users;--".to_string(),
            "injection shape",
        ),
        ("no-at-sign".to_string(), "no @"),
        ("a@b..com".to_string(), "consecutive dots in domain"),
    ];

    for (i, (email, why)) in invalid.into_iter().enumerate() {
        let res = post_json(
            &server,
            &admin.token,
            "/users",
            json!({
                "username": format!("dv.email.{i}"),
                "email": email,
                "password": "password123",
            }),
        )
        .await;
        assert_rejected_with(res, "INVALID_EMAIL", &format!("admin create email ({why})")).await;
    }
}

#[tokio::test]
async fn admin_create_still_accepts_a_valid_user() {
    let server = TestServer::start().await;
    let admin = admin(&server).await;

    let res = post_json(
        &server,
        &admin.token,
        "/users",
        json!({
            "username": "valid.created.user",
            "email": "valid.created.user@example.com",
            "password": "password123",
            "display_name": "Valid Created User",
        }),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::CREATED,
        "a conventional user must still be created"
    );
    let body: Value = res.json().await.expect("parse user");
    assert_eq!(body["email"], "valid.created.user@example.com");
    assert_eq!(body["display_name"], "Valid Created User");
}

/// Boundary: exactly 255 characters fits `character varying(255)` and must be
/// accepted; 256 is rejected above. Guards against an off-by-one bound.
#[tokio::test]
async fn admin_create_accepts_display_name_at_exactly_the_bound() {
    let server = TestServer::start().await;
    let admin = admin(&server).await;

    let res = post_json(
        &server,
        &admin.token,
        "/users",
        json!({
            "username": "dv.at.bound",
            "email": "dv_at_bound@example.com",
            "password": "password123",
            "display_name": "d".repeat(AT_BOUND),
        }),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::CREATED,
        "a 255-char display name must be accepted (the column is varchar(255))"
    );
}

// ───────────── path 3: admin edit (POST /users/{id}) ─────────────

/// Same defect, same file, same fix — the admin edit path had no display-name
/// gate either. Not in the reported audit set, but it is the identical 500.
#[tokio::test]
async fn admin_edit_rejects_invalid_display_names() {
    let server = TestServer::start().await;
    let admin = admin(&server).await;

    let created = post_json(
        &server,
        &admin.token,
        "/users",
        json!({
            "username": "dv.edit.target",
            "email": "dv_edit_target@example.com",
            "password": "password123",
        }),
    )
    .await;
    assert_eq!(
        created.status(),
        StatusCode::CREATED,
        "setup: create target"
    );
    let target_id = created.json::<Value>().await.unwrap()["id"]
        .as_str()
        .expect("user id")
        .to_string();

    for (display_name, why) in invalid_display_names() {
        let res = post_json(
            &server,
            &admin.token,
            &format!("/users/{target_id}"),
            json!({ "display_name": display_name }),
        )
        .await;
        assert_rejected_with(res, "INVALID_DISPLAY_NAME", &format!("admin edit ({why})")).await;
    }

    // ...and a good one still lands.
    let res = post_json(
        &server,
        &admin.token,
        &format!("/users/{target_id}"),
        json!({ "display_name": "Renamed By Admin" }),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::OK,
        "a valid rename must still work"
    );
}
