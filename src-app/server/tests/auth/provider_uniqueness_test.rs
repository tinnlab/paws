//! Regression tests: a duplicate auth-provider name reaching Postgres and
//! escaping as a generic HTTP 500.
//!
//! `auth_providers_name_key UNIQUE (name)` (migration
//! `202607140050_auth_schema.sql`) is violated whenever an admin reuses an
//! existing provider name. Before the fix, both write paths in
//! `ziee-auth/src/auth/providers/repository.rs` flattened the 23505 through
//! `.map_err(AppError::database_error)` into `500 SYSTEM_DATABASE_ERROR`:
//!
//! * **create** — `POST /api/admin/auth-providers` (`create_provider`, a bare
//!   INSERT with no `ON CONFLICT`).
//! * **rename** — `PUT /api/admin/auth-providers/{id}` (`update_provider`,
//!   `SET name = COALESCE($2, name)`).
//!
//! Both tests assert the SPECIFIC status + error code, not merely "not 500",
//! so a future regression to a different wrong code still fails.

use serde_json::{Value, json};

use crate::common::TestServer;

/// Seed the root admin via setup and return its bearer value.
async fn admin_bearer(server: &TestServer) -> String {
    let r = reqwest::Client::new()
        .post(server.api_url("/app/setup/admin"))
        .json(&json!({
            "username": "rootadmin",
            "email": "root@example.com",
            "password": "ComplexPass1!"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201, "admin setup must succeed");
    let body: Value = r.json().await.unwrap();
    format!("Bearer {}", body["access_token"].as_str().unwrap())
}

/// `enabled: false` keeps the create off the connection-probe path, so the
/// only thing under test is the uniqueness behaviour.
fn provider_body(name: &str) -> Value {
    json!({
        "name": name,
        "provider_type": "oauth2",
        "enabled": false,
        "config": {}
    })
}

async fn post_provider(server: &TestServer, bearer: &str, name: &str) -> reqwest::Response {
    reqwest::Client::new()
        .post(server.api_url("/admin/auth-providers"))
        .header("Authorization", bearer)
        .json(&provider_body(name))
        .send()
        .await
        .expect("create auth-provider request failed")
}

async fn put_provider(
    server: &TestServer,
    bearer: &str,
    id: &str,
    body: Value,
) -> reqwest::Response {
    reqwest::Client::new()
        .put(server.api_url(&format!("/admin/auth-providers/{id}")))
        .header("Authorization", bearer)
        .json(&body)
        .send()
        .await
        .expect("update auth-provider request failed")
}

/// Assert the response carries the given status AND error_code — and, when it
/// does not, surface the body so a failure is diagnosable in one run.
async fn assert_error(res: reqwest::Response, status: reqwest::StatusCode, code: &str, ctx: &str) {
    let got = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    assert_eq!(got, status, "{ctx}: wrong status (body: {body})");
    assert_eq!(
        body.get("error_code").and_then(Value::as_str),
        Some(code),
        "{ctx}: wrong error_code (body: {body})"
    );
}

/// The create response is an envelope: `{ provider, connection_warning }`.
async fn provider_id(res: reqwest::Response) -> String {
    res.json::<Value>().await.unwrap()["provider"]["id"]
        .as_str()
        .expect("create response carries provider.id")
        .to_string()
}

// ───────────────── create: duplicate name → 409, not 500 ─────────────────

#[tokio::test]
async fn duplicate_auth_provider_name_returns_409_not_500() {
    let server = TestServer::start().await;
    let bearer = admin_bearer(&server).await;

    let first = post_provider(&server, &bearer, "dup-probe").await;
    assert_eq!(first.status(), 201, "first create should win");

    // Before the fix this was 500 SYSTEM_DATABASE_ERROR.
    let second = post_provider(&server, &bearer, "dup-probe").await;
    assert_error(
        second,
        reqwest::StatusCode::CONFLICT,
        "RESOURCE_CONFLICT",
        "duplicate auth-provider name",
    )
    .await;
}

// ───────────────── rename: collision → 409, not 500 ─────────────────

#[tokio::test]
async fn renaming_auth_provider_onto_an_existing_name_returns_409_not_500() {
    let server = TestServer::start().await;
    let bearer = admin_bearer(&server).await;

    let a = post_provider(&server, &bearer, "ren-a").await;
    assert_eq!(a.status(), 201);
    let b = post_provider(&server, &bearer, "ren-b").await;
    assert_eq!(b.status(), 201);
    let b_id = provider_id(b).await;

    // Before the fix this was 500 SYSTEM_DATABASE_ERROR (UPDATE has no
    // ON CONFLICT form, so the unique violation needs explicit mapping).
    let clash = put_provider(&server, &bearer, &b_id, json!({ "name": "ren-a" })).await;
    assert_error(
        clash,
        reqwest::StatusCode::CONFLICT,
        "RESOURCE_CONFLICT",
        "auth-provider rename collision",
    )
    .await;
}

// ───────────────── negative controls ─────────────────

/// A non-colliding rename must stay a success — the conflict mapping must not
/// swallow ordinary updates.
#[tokio::test]
async fn renaming_auth_provider_to_a_free_name_still_succeeds() {
    let server = TestServer::start().await;
    let bearer = admin_bearer(&server).await;

    let p = post_provider(&server, &bearer, "free-a").await;
    assert_eq!(p.status(), 201);
    let id = provider_id(p).await;

    let ok = put_provider(&server, &bearer, &id, json!({ "name": "free-b" })).await;
    assert_eq!(
        ok.status(),
        200,
        "renaming onto an unused name must remain a success"
    );
}

/// Updating a provider WITHOUT touching its name must not self-conflict.
#[tokio::test]
async fn updating_auth_provider_without_rename_is_not_a_conflict() {
    let server = TestServer::start().await;
    let bearer = admin_bearer(&server).await;

    let p = post_provider(&server, &bearer, "keep-name").await;
    assert_eq!(p.status(), 201);
    let id = provider_id(p).await;

    let ok = put_provider(&server, &bearer, &id, json!({ "enabled": false })).await;
    assert_eq!(
        ok.status(),
        200,
        "a non-name update must not trip the uniqueness mapping"
    );
}
