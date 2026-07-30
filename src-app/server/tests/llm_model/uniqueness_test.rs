//! Regression tests: a duplicate `(provider_id, name)` reaching Postgres and
//! escaping as a generic HTTP 500.
//!
//! `llm_models_provider_id_name_unique UNIQUE (provider_id, name)` (migration
//! `202607140160_llm_model_schema.sql`) is violated whenever a caller reuses a
//! model name inside one provider. Before the fix, both repository wrappers
//! flattened the 23505 through `.map_err(AppError::database_error)` into
//! `500 SYSTEM_DATABASE_ERROR`:
//!
//! * **create** — `POST /api/llm-models` (`repository.rs::create`).
//! * **rename** — `POST /api/llm-models/{model_id}` (`repository.rs::update`).
//!
//! Note the sibling UPLOAD path (`POST /api/llm-models/upload`) already
//! pre-checks for a duplicate; the plain CRUD create/update never got the
//! corresponding treatment. `utils::validate_create_request` is a pure
//! string/param check with no DB lookup.
//!
//! Both tests assert the SPECIFIC status + error code, not merely "not 500",
//! so a future regression to a different wrong code still fails.

use reqwest::StatusCode;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::common::TestServer;
use crate::common::test_helpers::{TestUser, create_user_with_permissions};

async fn model_admin(server: &TestServer, name: &str) -> TestUser {
    create_user_with_permissions(server, name, &["*"]).await
}

/// Return the ids of the first `n` SEEDED providers.
///
/// Deliberately does NOT create a provider: `POST /api/llm-providers` runs the
/// SSRF/base-url validator, which resolves the host — so a synthetic provider
/// makes these tests depend on DNS (`example.invalid` is refused with
/// `INVALID_BASE_URL`). The seed ships 8 providers; the models created here
/// carry unique probe names, so hanging them off a seeded provider is inert.
async fn seeded_provider_ids(server: &TestServer, user: &TestUser, n: usize) -> Vec<String> {
    let resp = reqwest::Client::new()
        .get(server.api_url("/llm-providers"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .expect("list providers request failed");
    assert_eq!(resp.status(), StatusCode::OK, "provider listing");
    let body: Value = resp.json().await.unwrap();
    let providers = body["providers"]
        .as_array()
        .expect("providers array in listing");
    assert!(
        providers.len() >= n,
        "need >= {n} seeded providers, found {}",
        providers.len()
    );
    providers[..n]
        .iter()
        .map(|p| p["id"].as_str().unwrap().to_string())
        .collect()
}

async fn one_provider(server: &TestServer, user: &TestUser) -> String {
    seeded_provider_ids(server, user, 1).await.remove(0)
}

/// A per-test-unique model name so a probe can never collide with a seeded
/// model or with another test running in parallel against the same provider.
fn probe_name(prefix: &str) -> String {
    format!("{prefix}-{}", &Uuid::new_v4().to_string()[..8])
}

async fn post_model(
    server: &TestServer,
    user: &TestUser,
    provider_id: &str,
    name: &str,
) -> reqwest::Response {
    reqwest::Client::new()
        .post(server.api_url("/llm-models"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&json!({
            "provider_id": provider_id,
            "name": name,
            "display_name": name,
            "engine_type": "llamacpp",
            "file_format": "gguf",
        }))
        .send()
        .await
        .expect("create model request failed")
}

/// The update route is a POST (not a PUT) — see `llm_model/routes.rs`.
async fn rename_model(
    server: &TestServer,
    user: &TestUser,
    id: &str,
    name: &str,
) -> reqwest::Response {
    reqwest::Client::new()
        .post(server.api_url(&format!("/llm-models/{id}")))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&json!({ "name": name }))
        .send()
        .await
        .expect("update model request failed")
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
async fn duplicate_model_name_in_one_provider_returns_409_not_500() {
    let server = TestServer::start().await;
    let user = model_admin(&server, "lm_dup").await;
    let provider = one_provider(&server, &user).await;
    let name = probe_name("dup-probe");

    let first = post_model(&server, &user, &provider, &name).await;
    assert_eq!(
        first.status(),
        StatusCode::CREATED,
        "first create should win"
    );

    // Before the fix this was 500 SYSTEM_DATABASE_ERROR.
    let second = post_model(&server, &user, &provider, &name).await;
    assert_error(
        second,
        StatusCode::CONFLICT,
        "RESOURCE_CONFLICT",
        "duplicate model name",
    )
    .await;
}

// ───────────────── rename: collision → 409, not 500 ─────────────────

#[tokio::test]
async fn renaming_model_onto_an_existing_name_returns_409_not_500() {
    let server = TestServer::start().await;
    let user = model_admin(&server, "lm_ren").await;
    let provider = one_provider(&server, &user).await;
    let taken = probe_name("ren-a");

    let a = post_model(&server, &user, &provider, &taken).await;
    assert_eq!(a.status(), StatusCode::CREATED);
    let b = post_model(&server, &user, &provider, &probe_name("ren-b")).await;
    assert_eq!(b.status(), StatusCode::CREATED);
    let b_id = id_of(b).await;

    // Before the fix this was 500 SYSTEM_DATABASE_ERROR.
    let clash = rename_model(&server, &user, &b_id, &taken).await;
    assert_error(
        clash,
        StatusCode::CONFLICT,
        "RESOURCE_CONFLICT",
        "model rename collision",
    )
    .await;
}

// ───────────────── negative controls ─────────────────

/// The constraint is scoped by `provider_id`, so the SAME model name under a
/// DIFFERENT provider must still be accepted. This guards against "fixing" the
/// 409 by making the conflict check too broad.
#[tokio::test]
async fn same_model_name_across_providers_is_allowed() {
    let server = TestServer::start().await;
    let user = model_admin(&server, "lm_cross").await;
    let ps = seeded_provider_ids(&server, &user, 2).await;
    let shared = probe_name("shared-name");

    let a = post_model(&server, &user, &ps[0], &shared).await;
    assert_eq!(a.status(), StatusCode::CREATED);

    let b = post_model(&server, &user, &ps[1], &shared).await;
    assert_eq!(
        b.status(),
        StatusCode::CREATED,
        "a different provider holding the same model name must NOT conflict"
    );
}

/// A rename onto a free name must stay a success — the conflict mapping must
/// not swallow ordinary updates.
#[tokio::test]
async fn renaming_model_to_a_free_name_still_succeeds() {
    let server = TestServer::start().await;
    let user = model_admin(&server, "lm_free").await;
    let provider = one_provider(&server, &user).await;

    let m = post_model(&server, &user, &provider, &probe_name("free-a")).await;
    assert_eq!(m.status(), StatusCode::CREATED);
    let id = id_of(m).await;

    let ok = rename_model(&server, &user, &id, &probe_name("free-b")).await;
    assert_eq!(
        ok.status(),
        StatusCode::OK,
        "renaming onto an unused name must remain a success"
    );
}
