//! Regression tests: a duplicate project name reaching Postgres and escaping
//! as a generic HTTP 500.
//!
//! `projects_user_name_unique UNIQUE (user_id, name)` (migration
//! `202607140200_project_schema.sql`) is violated whenever a caller reuses a
//! name they already hold. Before the fix, both write paths flattened the
//! 23505 through `.map_err(AppError::database_error)` into
//! `500 SYSTEM_DATABASE_ERROR`:
//!
//! * **create** — `POST /api/projects` (`repository.rs::create`, a bare
//!   INSERT with no `ON CONFLICT`).
//! * **rename** — `PUT /api/projects/{id}` (`repository.rs::update`, the
//!   per-field `UPDATE projects SET name = ...`).
//!
//! Note the module ALREADY bounds the name at 255 chars (a 300-char name is a
//! clean 400), which is the typical shape of this defect class: a validator
//! exists and the uniqueness case was missed.
//!
//! Every test asserts the SPECIFIC status + error code, not merely "not 500",
//! so a future regression to a different wrong code still fails.

use reqwest::StatusCode;
use serde_json::{Value, json};

use super::helpers::full_project_permissions;
use crate::common::TestServer;
use crate::common::test_helpers::{TestUser, create_user_with_permissions};

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

async fn id_of(res: reqwest::Response) -> String {
    res.json::<Value>().await.unwrap()["id"]
        .as_str()
        .expect("response carries an id")
        .to_string()
}

// ───────────────── create: duplicate name → 409, not 500 ─────────────────

#[tokio::test]
async fn duplicate_project_name_returns_409_not_500() {
    let server = TestServer::start().await;
    let user = project_user(&server, "proj_dup").await;

    let first = post_project(&server, &user, json!({ "name": "dup-probe" })).await;
    assert_eq!(
        first.status(),
        StatusCode::CREATED,
        "first create should win"
    );

    // Before the fix this was 500 SYSTEM_DATABASE_ERROR.
    let second = post_project(&server, &user, json!({ "name": "dup-probe" })).await;
    assert_error(
        second,
        StatusCode::CONFLICT,
        "RESOURCE_CONFLICT",
        "duplicate project name",
    )
    .await;
}

// ───────────────── rename: already handled (characterization) ─────────────────

/// CHARACTERIZATION, not a fix: unlike `create`, the rename path ALREADY had a
/// pre-flight uniqueness check (`handlers.rs::update_project`, audit N8) and
/// answers `422 PROJECT_NAME_DUPLICATE`. Probing a live instance confirmed it
/// — the rename never produced the 500 that `create` did, so it is outside the
/// hunted defect class and its status/code are deliberately left unchanged.
///
/// This test passes both before and after the create fix; it exists so the
/// rename path cannot silently regress INTO the 500 that create had, and so
/// the asymmetry between the two paths is recorded rather than folklore.
#[tokio::test]
async fn renaming_project_onto_an_existing_name_is_a_422_not_a_500() {
    let server = TestServer::start().await;
    let user = project_user(&server, "proj_ren").await;

    let a = post_project(&server, &user, json!({ "name": "ren-a" })).await;
    assert_eq!(a.status(), StatusCode::CREATED);
    let b = post_project(&server, &user, json!({ "name": "ren-b" })).await;
    assert_eq!(b.status(), StatusCode::CREATED);
    let b_id = id_of(b).await;

    let clash = put_project(&server, &user, &b_id, json!({ "name": "ren-a" })).await;
    assert_error(
        clash,
        StatusCode::UNPROCESSABLE_ENTITY,
        "PROJECT_NAME_DUPLICATE",
        "project rename collision",
    )
    .await;
}

// ───────────────── negative controls ─────────────────

/// The unique constraint is scoped by `user_id`, so two DIFFERENT users may
/// each hold the same project name. This is the guard against "fixing" the
/// 409 by making the conflict check too broad.
#[tokio::test]
async fn same_project_name_across_users_is_allowed() {
    let server = TestServer::start().await;
    let alice = project_user(&server, "proj_alice").await;
    let bob = project_user(&server, "proj_bob").await;

    let a = post_project(&server, &alice, json!({ "name": "shared-name" })).await;
    assert_eq!(a.status(), StatusCode::CREATED);

    let b = post_project(&server, &bob, json!({ "name": "shared-name" })).await;
    assert_eq!(
        b.status(),
        StatusCode::CREATED,
        "a different owner holding the same name must NOT conflict"
    );
}

/// Renaming a project to the name it already has is a no-op collision with
/// ITSELF and must stay a success, not become a 409.
#[tokio::test]
async fn renaming_project_to_its_own_name_is_not_a_conflict() {
    let server = TestServer::start().await;
    let user = project_user(&server, "proj_self").await;

    let p = post_project(&server, &user, json!({ "name": "self-name" })).await;
    assert_eq!(p.status(), StatusCode::CREATED);
    let id = id_of(p).await;

    let same = put_project(&server, &user, &id, json!({ "name": "self-name" })).await;
    assert_eq!(
        same.status(),
        StatusCode::OK,
        "renaming a project to its own name must remain a success"
    );
}

/// The pre-existing 255-char bound must survive the conflict fix: an
/// over-long name is still a 400, NOT a 409 and NOT a 500.
#[tokio::test]
async fn overlong_project_name_still_returns_400() {
    let server = TestServer::start().await;
    let user = project_user(&server, "proj_long").await;

    let res = post_project(&server, &user, json!({ "name": "x".repeat(300) })).await;
    assert_eq!(
        res.status(),
        StatusCode::BAD_REQUEST,
        "a 300-char name must stay a 400 length rejection"
    );
}
