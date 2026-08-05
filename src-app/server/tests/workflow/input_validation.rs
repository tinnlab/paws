//! Malformed-upload handling on `POST /api/workflows/import` (the dev
//! multipart install).
//!
//! The import dialog at `/settings/workflows` accepts ANY file, so the most
//! common real upload is not a tar.gz at all — a user drops the raw
//! `workflow.yaml`, or an upload is cut off mid-stream. Those are bad INPUT
//! and must answer 4xx with a message the user can act on; a 500 tells them
//! nothing and reads as a server fault. Mirrors the skill-side
//! `skill/bundle_security_http.rs`, which covers the same endpoint shape.

use reqwest::multipart;

use crate::common::TestServer;
use crate::workflow::{workflow_tarball, workflow_user};

const VALID_YAML: &str = r#"
name: import-smoke
steps:
  - id: only
    kind: llm
    prompt: "hello"
"#;

async fn upload_bundle(server: &TestServer, token: &str, body: Vec<u8>) -> reqwest::Response {
    let form = multipart::Form::new().part(
        "bundle",
        multipart::Part::bytes(body)
            .file_name("bundle.tar.gz")
            .mime_str("application/gzip")
            .unwrap(),
    );
    reqwest::Client::new()
        .post(server.api_url("/workflows/import?name=malformed"))
        .header("Authorization", format!("Bearer {token}"))
        .multipart(form)
        .send()
        .await
        .expect("import request failed")
}

/// Uploading the raw `workflow.yaml` (not a tar.gz) must be a 4xx that names
/// the problem, not a 500.
#[tokio::test]
async fn import_rejects_non_archive_upload() {
    let server = TestServer::start().await;
    let user = workflow_user(&server, "wf_import_garbage").await;

    let resp = upload_bundle(&server, &user.token, VALID_YAML.as_bytes().to_vec()).await;

    let status = resp.status();
    let body: serde_json::Value = resp.json().await.expect("parse error body");
    assert!(
        status.is_client_error(),
        "a non-archive upload must be a 4xx, got {status}: {body}"
    );
    let blob = body.to_string().to_lowercase();
    assert!(
        blob.contains("archive") || blob.contains("tar.gz") || blob.contains("gzip"),
        "expected an actionable not-an-archive message, got: {body}"
    );
}

/// A gzip stream cut off mid-entry (an interrupted upload) fails later than
/// the non-gzip case — after the header decodes — but is still client input.
#[tokio::test]
async fn import_rejects_truncated_archive() {
    let server = TestServer::start().await;
    let user = workflow_user(&server, "wf_import_truncated").await;

    let full = workflow_tarball(VALID_YAML);
    let truncated = full[..full.len() / 2].to_vec();
    let resp = upload_bundle(&server, &user.token, truncated).await;

    let status = resp.status();
    let body: serde_json::Value = resp.json().await.expect("parse error body");
    assert!(
        status.is_client_error(),
        "a truncated upload must be a 4xx, got {status}: {body}"
    );
}

/// Positive control: the same endpoint still installs a well-formed bundle,
/// so the rejections above can't be satisfied by refusing every upload.
#[tokio::test]
async fn import_accepts_valid_bundle() {
    let server = TestServer::start().await;
    let user = workflow_user(&server, "wf_import_valid").await;

    let resp = upload_bundle(&server, &user.token, workflow_tarball(VALID_YAML)).await;

    let status = resp.status();
    let body: serde_json::Value = resp.json().await.expect("parse import body");
    assert_eq!(
        status, 201,
        "a valid bundle must still install; got {status}: {body}"
    );
    assert_eq!(
        body.get("name")
            .and_then(|v| v.as_str())
            .map(|n| n.ends_with("/malformed")),
        Some(true),
        "the installed row should carry the requested dev slug: {body}"
    );
}
