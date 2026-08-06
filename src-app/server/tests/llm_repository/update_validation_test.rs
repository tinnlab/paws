//! `POST /api/llm-repositories/{id}` — an unvalidated `name`.
//!
//! `validate_auth_config_for_update` bounded the name's LENGTH (128 chars) but
//! nothing else, so a name carrying U+0000 reached the `UPDATE` and Postgres
//! refused it outright (`22021 invalid byte sequence for encoding "UTF8": 0x00`)
//! — a generic 500. A blank name was likewise accepted, silently storing an
//! unnamed repository the UI then renders as an empty row.

use reqwest::StatusCode;
use serde_json::{Value, json};

use crate::common::TestServer;
use crate::common::test_helpers::create_user_with_permissions;

async fn create_repo(server: &TestServer, token: &str, name: &str) -> Value {
    let resp = reqwest::Client::new()
        .post(server.api_url("/llm-repositories"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({
            "name": name,
            "url": "https://example.com/repo",
            "auth_type": "none",
            "enabled": true,
        }))
        .send()
        .await
        .expect("create repository");
    assert_eq!(
        resp.status(),
        StatusCode::CREATED,
        "repository create failed"
    );
    resp.json().await.expect("parse created repository")
}

async fn update_repo(
    server: &TestServer,
    token: &str,
    id: &str,
    patch: Value,
) -> (StatusCode, Value) {
    let resp = reqwest::Client::new()
        .post(server.api_url(&format!("/llm-repositories/{id}")))
        .header("Authorization", format!("Bearer {token}"))
        .json(&patch)
        .send()
        .await
        .expect("update repository");
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    (status, body)
}

#[tokio::test]
async fn update_rejects_nul_and_blank_names_but_accepts_a_normal_rename() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(
        &server,
        "repo_validation",
        &[
            "llm_repositories::read",
            "llm_repositories::create",
            "llm_repositories::edit",
        ],
    )
    .await;
    let repo = create_repo(&server, &admin.token, "validation-repo").await;
    let id = repo["id"].as_str().expect("repository id").to_string();

    let (status, body) = update_repo(
        &server,
        &admin.token,
        &id,
        json!({ "name": "bad\u{0}name" }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "NUL in a repository name must be a validation error, not a 500: {body}"
    );
    assert_eq!(body["error_code"], "VALIDATION_ERROR", "{body}");

    let (status, body) = update_repo(&server, &admin.token, &id, json!({ "name": "   " })).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "a blank repository name must be rejected, not silently stored: {body}"
    );
    assert_eq!(body["error_code"], "VALIDATION_ERROR", "{body}");

    // Positive control: a normal rename still applies.
    let (status, body) = update_repo(
        &server,
        &admin.token,
        &id,
        json!({ "name": "renamed-repo" }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "a normal rename must succeed: {body}"
    );
    assert_eq!(
        body["name"], "renamed-repo",
        "the rename is persisted: {body}"
    );
}
