//! Regression tests for **D4**: `username` had effectively no validation, on
//! any of the four user-settable write paths.
//!
//! Observed against a live instance before the fix:
//!
//! * `POST /api/users` (admin create) accepted
//!   `admin' OR '1'='1; DROP TABLE users;--` with a `201`.
//! * `POST /api/users/{id}` (admin edit) accepted the same string with a `200`,
//!   accepted an EMPTY username with a `200`, and returned
//!   `500 SYSTEM_DATABASE_ERROR` for a 500-character one (the
//!   `users.username character varying(100)` column overflowing).
//! * `POST /api/auth/profile` (self-service) accepted the injection string with
//!   a `200` — this is how the automated explorer locked the admin account out
//!   of login.
//! * `POST /api/auth/register` accepted an injection-shaped username with a
//!   `201`.
//!
//! To be explicit about what this defect is and is not: the injection did NOT
//! execute — the queries are parameterised and the tables were intact. The
//! defect is that a structurally-invalid identifier was persisted and bricked
//! the account. These tests therefore assert on VALIDATION, not on SQL safety.

use reqwest::StatusCode;
use serde_json::{Value, json};

use crate::common::TestServer;
use crate::common::test_helpers::{TestUser, create_user_with_permissions};

/// The exact string the automated explorer persisted into the admin account.
const INJECTION_USERNAME: &str = "admin' OR '1'='1; DROP TABLE users;--";

/// Usernames that must be rejected on every write path. Covers the reported
/// injection shape, the varchar(100) overflow, the empty/blank cases, and a
/// bidi-override spoof.
fn invalid_usernames() -> Vec<(String, &'static str)> {
    vec![
        (INJECTION_USERNAME.to_string(), "reported injection shape"),
        ("admin'OR'1'='1;--".to_string(), "injection without spaces"),
        ("<script>alert(1)</script>".to_string(), "markup"),
        ("a".repeat(101), "one over the varchar(100) column"),
        (
            "z".repeat(500),
            "500 chars (was a 500 SYSTEM_DATABASE_ERROR)",
        ),
        ("".to_string(), "empty"),
        ("   ".to_string(), "whitespace only"),
        ("ab".to_string(), "under the 3-char minimum"),
        ("has space".to_string(), "internal whitespace"),
        ("spoof\u{202E}ed".to_string(), "bidi override"),
    ]
}

async fn admin(server: &TestServer) -> TestUser {
    create_user_with_permissions(server, "uv_admin", &["*"]).await
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

/// Assert a 400 with the shared `INVALID_USERNAME` code.
async fn assert_invalid_username(res: reqwest::Response, ctx: &str) {
    let got = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    assert_eq!(
        got,
        StatusCode::BAD_REQUEST,
        "{ctx}: expected 400, got {got} (body: {body})"
    );
    assert_eq!(
        body.get("error_code").and_then(Value::as_str),
        Some("INVALID_USERNAME"),
        "{ctx}: wrong error_code (body: {body})"
    );
}

// ───────────────────── path 1: admin create (POST /users) ─────────────────────

#[tokio::test]
async fn admin_create_rejects_invalid_usernames() {
    let server = TestServer::start().await;
    let admin = admin(&server).await;

    for (i, (username, why)) in invalid_usernames().into_iter().enumerate() {
        let res = post_json(
            &server,
            &admin.token,
            "/users",
            json!({
                "username": username,
                "email": format!("uv_create_{i}@example.com"),
                "password": "password123",
            }),
        )
        .await;
        assert_invalid_username(res, &format!("admin create ({why})")).await;
    }
}

#[tokio::test]
async fn admin_create_still_accepts_a_valid_username() {
    let server = TestServer::start().await;
    let admin = admin(&server).await;

    let res = post_json(
        &server,
        &admin.token,
        "/users",
        json!({
            "username": "valid.user-name_1",
            "email": "uv_valid@example.com",
            "password": "password123",
        }),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::CREATED,
        "a conventional username must still be accepted"
    );
}

// ───────────────────── path 2: admin edit (POST /users/{id}) ─────────────────────

#[tokio::test]
async fn admin_edit_rejects_invalid_usernames() {
    let server = TestServer::start().await;
    let admin = admin(&server).await;

    // A throwaway target to rename.
    let created = post_json(
        &server,
        &admin.token,
        "/users",
        json!({
            "username": "rename.target",
            "email": "uv_target@example.com",
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

    // This path previously had NO username validation whatsoever.
    for (username, why) in invalid_usernames() {
        let res = post_json(
            &server,
            &admin.token,
            &format!("/users/{target_id}"),
            json!({ "username": username }),
        )
        .await;
        assert_invalid_username(res, &format!("admin edit ({why})")).await;
    }
}

/// An admin edit that does not touch the username (e.g. a toggle of
/// `is_active`) must be unaffected by the new gate.
#[tokio::test]
async fn admin_edit_without_a_username_field_is_unaffected() {
    let server = TestServer::start().await;
    let admin = admin(&server).await;

    let created = post_json(
        &server,
        &admin.token,
        "/users",
        json!({
            "username": "untouched.user",
            "email": "uv_untouched@example.com",
            "password": "password123",
        }),
    )
    .await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let id = created.json::<Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    let res = post_json(
        &server,
        &admin.token,
        &format!("/users/{id}"),
        json!({ "display_name": "Renamed Display Only" }),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::OK,
        "username-less edit must still succeed"
    );
}

// ───────────────── path 3: self-service (POST /auth/profile) ─────────────────

#[tokio::test]
async fn self_profile_update_rejects_invalid_usernames() {
    let server = TestServer::start().await;
    // A plain user editing their OWN profile — the exact route the automated
    // explorer used to brick the admin account.
    let user = create_user_with_permissions(&server, "uv_self", &["profile::edit"]).await;

    for (username, why) in invalid_usernames() {
        let res = post_json(
            &server,
            &user.token,
            "/auth/profile",
            json!({ "username": username }),
        )
        .await;
        assert_invalid_username(res, &format!("self profile ({why})")).await;
    }
}

/// The account must remain loginable after a rejected rename — i.e. the
/// rejection is a no-op, not a partial write. This is the property whose
/// absence made the original defect account-fatal.
#[tokio::test]
async fn rejected_self_rename_leaves_the_account_loginable() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "uv_intact", &["profile::edit"]).await;

    // Read the current username back so we can log in with it afterwards.
    let me: Value = reqwest::Client::new()
        .get(server.api_url("/auth/me"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .expect("me request failed")
        .json()
        .await
        .expect("me json");
    let username = me["user"]["username"]
        .as_str()
        .expect("username in /auth/me")
        .to_string();

    let res = post_json(
        &server,
        &user.token,
        "/auth/profile",
        json!({ "username": INJECTION_USERNAME }),
    )
    .await;
    assert_invalid_username(res, "self profile (injection)").await;

    // The username must be unchanged...
    let me_after: Value = reqwest::Client::new()
        .get(server.api_url("/auth/me"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .expect("me request failed")
        .json()
        .await
        .expect("me json");
    assert_eq!(
        me_after["user"]["username"].as_str(),
        Some(username.as_str()),
        "a rejected rename must not have partially written"
    );

    // ...and login with it must still work.
    let login = reqwest::Client::new()
        .post(server.api_url("/auth/login"))
        // The password the shared test helper registers every user with.
        .json(&json!({ "username": username, "password": "password123" }))
        .send()
        .await
        .expect("login request failed");
    assert_eq!(
        login.status(),
        StatusCode::OK,
        "account must remain loginable after a rejected rename"
    );
}

#[tokio::test]
async fn self_profile_update_still_accepts_a_valid_username() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "uv_selfok", &["profile::edit"]).await;

    let res = post_json(
        &server,
        &user.token,
        "/auth/profile",
        json!({ "username": "renamed.self-1" }),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::OK,
        "a conventional username must still be accepted"
    );
}

// ───────────────────── path 4: registration (POST /auth/register) ─────────────────────

#[tokio::test]
async fn register_rejects_invalid_usernames() {
    let server = TestServer::start().await;

    for (i, (username, why)) in invalid_usernames().into_iter().enumerate() {
        let res = reqwest::Client::new()
            .post(server.api_url("/auth/register"))
            .json(&json!({
                "username": username,
                "email": format!("uv_reg_{i}@example.com"),
                "password": "password123",
            }))
            .send()
            .await
            .expect("register request failed");
        assert_invalid_username(res, &format!("register ({why})")).await;
    }
}

#[tokio::test]
async fn register_still_accepts_a_valid_username() {
    let server = TestServer::start().await;

    let res = reqwest::Client::new()
        .post(server.api_url("/auth/register"))
        .json(&json!({
            "username": "new.registrant_2",
            "email": "uv_reg_ok@example.com",
            "password": "password123",
        }))
        .send()
        .await
        .expect("register request failed");
    assert_eq!(
        res.status(),
        StatusCode::CREATED,
        "a conventional username must still register (body: {:?})",
        res.status()
    );
}

/// Boundary: exactly 100 characters fits `character varying(100)` and must be
/// accepted; 101 is rejected above. Guards against an off-by-one bound.
#[tokio::test]
async fn exactly_max_length_username_is_accepted() {
    let server = TestServer::start().await;

    let res = reqwest::Client::new()
        .post(server.api_url("/auth/register"))
        .json(&json!({
            "username": "u".repeat(100),
            "email": "uv_reg_max@example.com",
            "password": "password123",
        }))
        .send()
        .await
        .expect("register request failed");
    assert_eq!(
        res.status(),
        StatusCode::CREATED,
        "100-char username must be accepted (the column is varchar(100))"
    );
}
