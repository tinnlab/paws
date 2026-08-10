//! Capability-probe tests — ITEM-11 / ITEM-12, pinning INV-4.
//!
//! The defect these exist for was reproduced against a LIVE server: a Vite
//! dev server (`http://127.0.0.1:<port>/models`), `https://api.github.com`
//! and `https://huggingface.co/custom` were all reported `healthy` by
//! `POST /api/llm-repositories/{id}/test`, because the probe asserted only
//! `status == 200` and never read the body.
//!
//! INV-4: a repository is reported `healthy` only when a model-serving
//! capability was positively confirmed; reachability alone is never
//! `healthy`, and a repository whose capability could not be confirmed is
//! never auto-disabled.
//!
//! Every rejection assertion below ships with its happy-path counterpart in
//! the SAME test, so a rejection that passes because the endpoint broke some
//! other way cannot go unnoticed.

use crate::common::TestServer;
use crate::common::TestServerOptions;
use crate::common::test_helpers::create_user_with_permissions;
use axum::{Router, http::StatusCode, response::IntoResponse, routing::get};
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

const REPO_ADMIN_PERMS: &[&str] = &[
    "llm_repositories::read",
    "llm_repositories::create",
    "llm_repositories::edit",
    "llm_repositories::delete",
];

/// A trimmed but faithful Hugging Face `/api/models` payload — a JSON array
/// of model records. This is the shape the probe now requires before it will
/// say `healthy`.
const HF_MODEL_LISTING: &str = r#"[
    {
        "_id": "621ffdc036468d709f17434d",
        "id": "openai-community/gpt2",
        "modelId": "openai-community/gpt2",
        "likes": 2743,
        "private": false,
        "downloads": 12345678,
        "tags": ["transformers", "gpt2"],
        "pipeline_tag": "text-generation"
    }
]"#;

/// Aborts the fixture's serving task on scope exit — success OR panic-unwind —
/// so a failed assertion cannot leak a spawned listener.
struct AbortOnDrop(tokio::task::JoinHandle<()>);
impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Bind a loopback fixture and return `(base_url, guard)`.
async fn spawn_fixture(app: Router) -> (String, AbortOnDrop) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let guard = AbortOnDrop(tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    }));
    (format!("http://127.0.0.1:{}", addr.port()), guard)
}

/// The reported defect, reproduced: a dev server whose SPA fallback answers
/// **200 to every GET** with an HTML document. Reachable; serves no models.
async fn spa_fallback_fixture() -> (String, AbortOnDrop) {
    spawn_fixture(Router::new().fallback(get(|| async {
        (
            StatusCode::OK,
            [("content-type", "text/html")],
            "<!doctype html><html><body><div id=\"root\"></div></body></html>",
        )
            .into_response()
    })))
    .await
}

/// A real model registry: `/api/models` serves a model listing.
async fn model_registry_fixture() -> (String, AbortOnDrop) {
    spawn_fixture(
        Router::new()
            .route(
                "/api/models",
                get(|| async {
                    (
                        StatusCode::OK,
                        [("content-type", "application/json")],
                        HF_MODEL_LISTING,
                    )
                        .into_response()
                }),
            )
            .fallback(get(|| async { "ok" })),
    )
    .await
}

/// Reachable, but there is no model listing here at all — the shape a
/// self-hosted service that simply is not a model registry has. Must be
/// `unverified`, NOT `unhealthy`, or shipping this change would auto-disable
/// working deployments.
async fn no_listing_fixture() -> (String, AbortOnDrop) {
    spawn_fixture(
        Router::new()
            .route("/", get(|| async { "service up" }))
            .fallback(get(|| async { (StatusCode::NOT_FOUND, "not found") })),
    )
    .await
}

/// Rejects everything with 401 — a stale/missing credential. A genuine
/// failure, which must stay `unhealthy` and keep auto-disabling.
async fn unauthorized_fixture() -> (String, AbortOnDrop) {
    spawn_fixture(
        Router::new().fallback(get(|| async { (StatusCode::UNAUTHORIZED, "Unauthorized") })),
    )
    .await
}

/// 200 + valid JSON that is NOT a model listing — proves the check is a
/// SHAPE assertion, not "did the body parse".
async fn valid_json_not_a_listing_fixture() -> (String, AbortOnDrop) {
    spawn_fixture(Router::new().fallback(get(|| async {
        (
            StatusCode::OK,
            [("content-type", "application/json")],
            r#"{"ok": true, "service": "definitely not a model registry"}"#,
        )
            .into_response()
    })))
    .await
}

async fn pool_for(server: &TestServer) -> sqlx::PgPool {
    PgPoolOptions::new()
        .max_connections(2)
        .connect(&server.database_url)
        .await
        .expect("connect to test pool")
}

/// `(enabled, last_health_check_status, last_health_check_reason)`
async fn read_health(pool: &sqlx::PgPool, repo_id: Uuid) -> (bool, String, Option<String>) {
    let row = sqlx::query!(
        r#"SELECT enabled, last_health_check_status, last_health_check_reason
           FROM llm_repositories WHERE id = $1"#,
        repo_id,
    )
    .fetch_one(pool)
    .await
    .expect("read repo row");
    (
        row.enabled,
        row.last_health_check_status,
        row.last_health_check_reason,
    )
}

/// Create an ENABLED repository (so `enforce_on_create` probes it) and
/// return its id.
async fn create_enabled_repo(server: &TestServer, token: &str, name: &str, url: &str) -> Uuid {
    let res = reqwest::Client::new()
        .post(server.api_url("/llm-repositories"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({
            "name": name,
            "url": url,
            "auth_type": "none",
            "enabled": true,
        }))
        .send()
        .await
        .expect("create request failed");
    let status = res.status();
    let body: Value = res.json().await.expect("create response is JSON");
    assert_eq!(status, 201, "create should return 201; body={body}");
    Uuid::parse_str(body["id"].as_str().expect("id")).expect("uuid")
}

/// `POST /llm-repositories/{id}/test` with no form overrides.
async fn probe_by_id(server: &TestServer, token: &str, repo_id: Uuid) -> Value {
    let res = reqwest::Client::new()
        .post(server.api_url(&format!("/llm-repositories/{repo_id}/test")))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({}))
        .send()
        .await
        .expect("probe request failed");
    assert_eq!(res.status(), 200);
    res.json().await.expect("probe response is JSON")
}

// ───────────────────────────────────────────────────────────────────────────
// TEST-17 [acceptance] INV-4 — reachability alone is not `healthy`, and a
// real model listing IS. Both halves in one test.
// ───────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn reachable_web_server_is_not_healthy_while_a_model_listing_is() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "admin", REPO_ADMIN_PERMS).await;
    let pool = pool_for(&server).await;

    // ── Half A: the reported defect. A dev server answering 200 to EVERY
    //    GET with an HTML SPA shell. This is the `http://127.0.0.1:<vite>/models`
    //    row that was displayed as `healthy`.
    let (spa_base, _spa_guard) = spa_fallback_fixture().await;
    let spa_id = create_enabled_repo(
        &server,
        &admin.token,
        "vite-dev-server",
        &format!("{spa_base}/models"),
    )
    .await;

    let spa_result = probe_by_id(&server, &admin.token, spa_id).await;
    assert_eq!(
        spa_result["success"], false,
        "a web server that answers 200 to everything must not pass the probe: {spa_result}"
    );
    let (spa_enabled, spa_status, spa_reason) = read_health(&pool, spa_id).await;
    assert_ne!(
        spa_status, "healthy",
        "INV-4: reachability alone must NEVER be recorded as healthy (reason: {spa_reason:?})"
    );
    assert_eq!(
        spa_status, "unverified",
        "a reachable host with no model listing is unverified"
    );
    assert!(
        spa_enabled,
        "INV-4: an unconfirmable repository must not be auto-disabled"
    );

    // ── Half B: the positive control. A host that actually serves a model
    //    listing IS healthy — so half A cannot be passing merely because the
    //    probe now rejects everything.
    let (registry_base, _registry_guard) = model_registry_fixture().await;
    let registry_id =
        create_enabled_repo(&server, &admin.token, "real-registry", &registry_base).await;

    let registry_result = probe_by_id(&server, &admin.token, registry_id).await;
    assert_eq!(
        registry_result["success"], true,
        "a host serving a model listing must pass: {registry_result}"
    );
    assert_eq!(registry_result["status"], "healthy");
    let (registry_enabled, registry_status, _) = read_health(&pool, registry_id).await;
    assert_eq!(registry_status, "healthy");
    assert!(registry_enabled);
}

// ───────────────────────────────────────────────────────────────────────────
// TEST-18 [acceptance] INV-4 — `unverified` is a distinct outcome: it is
// recorded, it does NOT auto-disable, and a genuine failure still does.
// ───────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn unverified_keeps_the_row_enabled_while_a_real_failure_auto_disables() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "admin", REPO_ADMIN_PERMS).await;
    let pool = pool_for(&server).await;

    // ── Half A: reachable, kind unclassifiable, no model listing.
    let (up_base, _up_guard) = no_listing_fixture().await;
    let unclassifiable_id =
        create_enabled_repo(&server, &admin.token, "self-hosted-thing", &up_base).await;

    let result = probe_by_id(&server, &admin.token, unclassifiable_id).await;
    assert_eq!(result["status"], "unverified", "outcome: {result}");
    assert_eq!(
        result["success"], false,
        "unverified must not be reported as a success"
    );
    let (enabled, status, reason) = read_health(&pool, unclassifiable_id).await;
    assert_eq!(status, "unverified");
    assert!(
        reason.is_some(),
        "unverified must record WHY it could not be confirmed"
    );
    assert!(
        enabled,
        "INV-4: a repository whose capability could not be confirmed must NEVER be auto-disabled"
    );

    // ── Half B: a genuine failure on the same shape of row still disables.
    //    Without this half, half A would also pass if auto-disable had simply
    //    been deleted.
    let (bad_base, _bad_guard) = unauthorized_fixture().await;
    let failing_id = create_enabled_repo(&server, &admin.token, "stale-token", &bad_base).await;
    // The create-flow probe already ran and auto-disabled it; re-enable so the
    // test-button path exercises the auto-disable transition explicitly.
    sqlx::query!(
        "UPDATE llm_repositories SET enabled = TRUE WHERE id = $1",
        failing_id
    )
    .execute(&pool)
    .await
    .expect("re-enable row");

    let bad_result = probe_by_id(&server, &admin.token, failing_id).await;
    assert_eq!(bad_result["status"], "unhealthy", "outcome: {bad_result}");
    assert_eq!(bad_result["success"], false);
    let (bad_enabled, bad_status, bad_reason) = read_health(&pool, failing_id).await;
    assert_eq!(bad_status, "unhealthy");
    assert!(bad_reason.is_some());
    assert!(
        !bad_enabled,
        "a genuine failure on an enabled row must still auto-disable"
    );
}

// ───────────────────────────────────────────────────────────────────────────
// TEST-19 — the check is a SHAPE assertion, not "the body parsed as JSON".
//
// Halves A and B are fully offline (loopback fixtures) so the core assertion
// never depends on name resolution. Half C additionally drives the
// host-CLASSIFICATION path through the debug-only `LLM_REPOSITORY_HF_API_BASE`
// seam (DEC-14) — it needs `huggingface.co` to RESOLVE (never to be reached),
// the same assumption the suite's existing Hugging Face repository tests make.
// ───────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn valid_json_that_is_not_a_model_listing_is_rejected() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "admin", REPO_ADMIN_PERMS).await;
    let pool = pool_for(&server).await;

    // ── Half A: 200 + parseable JSON that is not a model listing.
    let (bad_base, _bad_guard) = valid_json_not_a_listing_fixture().await;
    let bad_id = create_enabled_repo(&server, &admin.token, "json-not-listing", &bad_base).await;

    let result = probe_by_id(&server, &admin.token, bad_id).await;
    assert_eq!(
        result["status"], "unverified",
        "a body that merely PARSES is not evidence of a model listing: {result}"
    );
    let (enabled, status, _) = read_health(&pool, bad_id).await;
    assert_ne!(status, "healthy");
    assert!(enabled, "a shape mismatch must not auto-disable");

    // ── Half B: the same code path, a body that IS a listing. Without this
    //    half, half A would also pass if JSON parsing had simply broken.
    let (good_base, _good_guard) = model_registry_fixture().await;
    let good_id = create_enabled_repo(&server, &admin.token, "json-listing", &good_base).await;
    let good_result = probe_by_id(&server, &admin.token, good_id).await;
    assert_eq!(
        good_result["status"], "healthy",
        "the same path with a real listing must be healthy: {good_result}"
    );
}

#[tokio::test]
async fn a_hugging_face_host_is_probed_against_the_hugging_face_listing_surface() {
    // Drives the HOST-classification branch: the repository URL's host decides
    // WHICH listing surface is probed. The debug-only seam redirects that
    // surface at a loopback fixture, so no request leaves the machine — but
    // `huggingface.co` must still resolve for the create-time URL validation
    // (a DNS failure here is environmental, not a defect in the probe).
    let (bad_base, _bad_guard) = valid_json_not_a_listing_fixture().await;
    let (good_base, _good_guard) = model_registry_fixture().await;

    let server = TestServer::start_with_options(TestServerOptions {
        extra_env: vec![("LLM_REPOSITORY_HF_API_BASE".to_string(), bad_base)],
        ..Default::default()
    })
    .await;
    let admin = create_user_with_permissions(&server, "admin", REPO_ADMIN_PERMS).await;
    let pool = pool_for(&server).await;

    let hf_id = create_enabled_repo(
        &server,
        &admin.token,
        "hf-shaped",
        &format!("https://huggingface.co/org-{}", Uuid::new_v4()),
    )
    .await;
    let result = probe_by_id(&server, &admin.token, hf_id).await;
    assert_eq!(
        result["status"], "unverified",
        "a Hugging Face host whose listing surface returns a non-listing must not \
         be healthy: {result}"
    );
    let (enabled, status, _) = read_health(&pool, hf_id).await;
    assert_ne!(status, "healthy");
    assert!(enabled);

    // Positive control on the SAME classification path: the seam now points at
    // a fixture that serves a real listing.
    let good_server = TestServer::start_with_options(TestServerOptions {
        extra_env: vec![("LLM_REPOSITORY_HF_API_BASE".to_string(), good_base)],
        ..Default::default()
    })
    .await;
    let good_admin = create_user_with_permissions(&good_server, "admin", REPO_ADMIN_PERMS).await;
    let good_pool = pool_for(&good_server).await;
    let good_id = create_enabled_repo(
        &good_server,
        &good_admin.token,
        "hf-shaped-ok",
        &format!("https://huggingface.co/org-{}", Uuid::new_v4()),
    )
    .await;
    let good_result = probe_by_id(&good_server, &good_admin.token, good_id).await;
    assert_eq!(
        good_result["status"], "healthy",
        "the same classification path with a real listing must be healthy: {good_result}"
    );
    let (_, good_status, _) = read_health(&good_pool, good_id).await;
    assert_eq!(good_status, "healthy");
}
