//! Regression tests: a NUL character (U+0000) in a project text field reaching
//! Postgres and escaping as a generic HTTP 500.
//!
//! A Postgres `text`/`varchar` column cannot hold U+0000 at all — the wire
//! protocol rejects it with `22021 invalid byte sequence for encoding UTF8`,
//! which `AppError::database_error` flattens into `500 SYSTEM_DATABASE_ERROR`.
//!
//! Observed against a live instance before the fix, on `POST /api/projects`:
//!
//! ```text
//! name=abc\0def         -> 500 {"error_code":"SYSTEM_DATABASE_ERROR"}
//! description=abc\0def  -> 500 {"error_code":"SYSTEM_DATABASE_ERROR"}
//! instructions=abc\0def -> 500 {"error_code":"SYSTEM_DATABASE_ERROR"}
//! ```
//!
//! This is the shape `uniqueness_test.rs` calls out: the module already had
//! working LENGTH validators (a 300-char name is a clean 400, a 5 KiB
//! description is a clean 400) and the caps miss this entirely, because a
//! NUL-bearing value can be arbitrarily short.
//!
//! The gate is deliberately NARROW — only U+0000 is rejected. `\n` and `\t` are
//! legitimate in `instructions`/`description` prose, so the happy-path tests
//! below pin that they are still accepted.
//!
//! Every test asserts the SPECIFIC status + error code, not merely "not 500",
//! so a future regression to a different wrong code still fails.

use reqwest::StatusCode;
use serde_json::{Value, json};

use super::helpers::full_project_permissions;
use crate::common::TestServer;
use crate::common::test_helpers::{TestUser, create_user_with_permissions};

/// The exact input reproduced against the running server.
const NUL_BEARING: &str = "abc\u{0}def";

async fn project_user(server: &TestServer, name: &str) -> TestUser {
    create_user_with_permissions(server, name, full_project_permissions()).await
}

async fn post_project(server: &TestServer, user: &TestUser, body: Value) -> reqwest::Response {
    reqwest::Client::new()
        .post(server.api_url("/projects"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&body)
        .send()
        .await
        .expect("create project request failed")
}

async fn put_project(
    server: &TestServer,
    user: &TestUser,
    id: &str,
    body: Value,
) -> reqwest::Response {
    reqwest::Client::new()
        .put(server.api_url(&format!("/projects/{id}")))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&body)
        .send()
        .await
        .expect("update project request failed")
}

/// Assert a 400 carrying the module's `VALIDATION_ERROR` code (the same code
/// the neighbouring length caps use) and a message that names NUL, so the
/// client can tell the user what to fix.
async fn assert_nul_rejected(res: reqwest::Response, ctx: &str) {
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
    let msg = body.get("error").and_then(Value::as_str).unwrap_or("");
    assert!(
        msg.contains("NUL"),
        "{ctx}: message must name the offending character, got {msg:?}"
    );
}

// ───────────────────────── create (POST /projects) ─────────────────────────

#[tokio::test]
async fn create_rejects_nul_in_name() {
    let server = TestServer::start().await;
    let user = project_user(&server, "nul_create_name").await;

    let res = post_project(&server, &user, json!({ "name": NUL_BEARING })).await;
    assert_nul_rejected(res, "create name").await;
}

#[tokio::test]
async fn create_rejects_nul_in_description() {
    let server = TestServer::start().await;
    let user = project_user(&server, "nul_create_desc").await;

    let res = post_project(
        &server,
        &user,
        json!({ "name": "nul-desc-project", "description": NUL_BEARING }),
    )
    .await;
    assert_nul_rejected(res, "create description").await;
}

#[tokio::test]
async fn create_rejects_nul_in_instructions() {
    let server = TestServer::start().await;
    let user = project_user(&server, "nul_create_instr").await;

    let res = post_project(
        &server,
        &user,
        json!({ "name": "nul-instr-project", "instructions": NUL_BEARING }),
    )
    .await;
    assert_nul_rejected(res, "create instructions").await;
}

/// A rejected create must be a clean no-op — no half-written row that a later
/// create of the same name would then collide with.
#[tokio::test]
async fn rejected_create_leaves_no_row_behind() {
    let server = TestServer::start().await;
    let user = project_user(&server, "nul_noop").await;

    let res = post_project(
        &server,
        &user,
        json!({ "name": "reusable-name", "description": NUL_BEARING }),
    )
    .await;
    assert_nul_rejected(res, "create description").await;

    // The same name must still be free.
    let res = post_project(&server, &user, json!({ "name": "reusable-name" })).await;
    assert_eq!(
        res.status(),
        StatusCode::CREATED,
        "the name must be free after a rejected create"
    );
}

// ───────────────────────── rename (PUT /projects/{id}) ─────────────────────

/// The update path shares `validate_project_name` /
/// `validate_project_text_lengths` with create, so the gate must hold there
/// too — the same asymmetry `uniqueness_test.rs` documents for this module.
#[tokio::test]
async fn update_rejects_nul_in_every_text_field() {
    let server = TestServer::start().await;
    let user = project_user(&server, "nul_update").await;

    let created = post_project(&server, &user, json!({ "name": "rename-target" })).await;
    assert_eq!(created.status(), StatusCode::CREATED, "setup: create");
    let id = created.json::<Value>().await.unwrap()["id"]
        .as_str()
        .expect("project id")
        .to_string();

    for (field, ctx) in [
        ("name", "update name"),
        ("description", "update description"),
        ("instructions", "update instructions"),
    ] {
        let res = put_project(&server, &user, &id, json!({ field: NUL_BEARING })).await;
        assert_nul_rejected(res, ctx).await;
    }
}

// ───────────────────────── happy path (must NOT regress) ───────────────────

/// The gate must reject ONLY U+0000. Newlines and tabs are ordinary prose in
/// instructions/description, and a plain project still has to save.
#[tokio::test]
async fn create_still_accepts_ordinary_text_and_whitespace() {
    let server = TestServer::start().await;
    let user = project_user(&server, "nul_happy").await;

    let res = post_project(
        &server,
        &user,
        json!({
            "name": "Quarterly Report",
            "description": "For the finance team.",
            "instructions": "Line one.\n\tIndented line two.\r\nLine three.",
        }),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::CREATED,
        "a normal project with multi-line instructions must still save"
    );

    let body: Value = res.json().await.expect("parse project");
    assert_eq!(body["name"], "Quarterly Report");
    assert_eq!(
        body["instructions"], "Line one.\n\tIndented line two.\r\nLine three.",
        "newlines and tabs must round-trip unmodified"
    );
}
