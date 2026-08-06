//! `POST /api/groups/{id}` (and its create sibling) — an unvalidated group name.
//!
//! `create_group` checked only `name.is_empty()` and `update_group` checked
//! nothing at all, so three shapes of input reached Postgres raw:
//!
//!   * a name over 100 characters — `groups.name` is `character varying(100)`
//!     (`22001 value too long`) → 500;
//!   * a name or description carrying U+0000 — unstorable in a text column at
//!     all (`22021 invalid byte sequence for encoding "UTF8": 0x00`) → 500;
//!   * a blank name on UPDATE — accepted, silently storing an unnamed group
//!     that the admin UI then renders as an empty row.

use reqwest::StatusCode;
use serde_json::{Value, json};

use crate::common::TestServer;
use crate::common::test_helpers::create_user_with_permissions;

async fn create_group(server: &TestServer, token: &str, body: Value) -> (StatusCode, Value) {
    let resp = reqwest::Client::new()
        .post(server.api_url("/groups"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&body)
        .send()
        .await
        .expect("create group");
    let status = resp.status();
    let parsed: Value = resp.json().await.unwrap_or(Value::Null);
    (status, parsed)
}

async fn update_group(
    server: &TestServer,
    token: &str,
    id: &str,
    body: Value,
) -> (StatusCode, Value) {
    let resp = reqwest::Client::new()
        .post(server.api_url(&format!("/groups/{id}")))
        .header("Authorization", format!("Bearer {token}"))
        .json(&body)
        .send()
        .await
        .expect("update group");
    let status = resp.status();
    let parsed: Value = resp.json().await.unwrap_or(Value::Null);
    (status, parsed)
}

fn group_admin_perms() -> &'static [&'static str] {
    &["groups::read", "groups::create", "groups::edit"]
}

#[tokio::test]
async fn update_group_rejects_over_long_nul_and_blank_names() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "group_valid", group_admin_perms()).await;

    let (status, group) = create_group(
        &server,
        &admin.token,
        json!({ "name": "valid-group", "description": "d", "permissions": [] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "group create failed: {group}");
    let id = group["id"].as_str().expect("group id").to_string();

    // 101 chars — one past the varchar(100) column bound.
    let (status, body) = update_group(
        &server,
        &admin.token,
        &id,
        json!({ "name": "a".repeat(101) }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "a 101-character group name must be a validation error, not a 500: {body}"
    );
    assert_eq!(body["error_code"], "VALIDATION_ERROR", "{body}");

    let (status, body) = update_group(
        &server,
        &admin.token,
        &id,
        json!({ "name": "bad\u{0}name" }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "NUL in a group name must be a validation error, not a 500: {body}"
    );
    assert_eq!(body["error_code"], "VALIDATION_ERROR", "{body}");

    let (status, body) = update_group(
        &server,
        &admin.token,
        &id,
        json!({ "description": "bad\u{0}description" }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "NUL in a group description must be a validation error, not a 500: {body}"
    );
    assert_eq!(body["error_code"], "VALIDATION_ERROR", "{body}");

    // A blank name was accepted on UPDATE even though CREATE rejects it.
    let (status, body) = update_group(&server, &admin.token, &id, json!({ "name": "   " })).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "a blank group name must be rejected on update as it is on create: {body}"
    );

    // Positive control: a normal rename + description edit still applies, so the
    // guard is not rejecting everything.
    let (status, body) = update_group(
        &server,
        &admin.token,
        &id,
        json!({ "name": "renamed-group", "description": "a new description" }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "a normal update must succeed: {body}"
    );
    assert_eq!(
        body["name"], "renamed-group",
        "the rename is persisted: {body}"
    );
    assert_eq!(
        body["description"], "a new description",
        "the description edit is persisted: {body}"
    );

    // A name at exactly the column bound is legal.
    let (status, body) = update_group(
        &server,
        &admin.token,
        &id,
        json!({ "name": "b".repeat(100) }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "exactly 100 characters is within the column bound: {body}"
    );
}

#[tokio::test]
async fn create_group_rejects_over_long_and_nul_names() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "group_valid_c", group_admin_perms()).await;

    let (status, body) = create_group(
        &server,
        &admin.token,
        json!({ "name": "a".repeat(101), "permissions": [] }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "a 101-character group name must be rejected at create too: {body}"
    );

    let (status, body) = create_group(
        &server,
        &admin.token,
        json!({ "name": "bad\u{0}name", "permissions": [] }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "NUL in a group name must be rejected at create too: {body}"
    );

    // Positive control.
    let (status, body) = create_group(
        &server,
        &admin.token,
        json!({ "name": "ordinary-group", "permissions": [] }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "a normal create must succeed: {body}"
    );
}
