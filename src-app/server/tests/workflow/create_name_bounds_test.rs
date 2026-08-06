//! `POST /api/workflows` — an over-long builder `name`.
//!
//! The posted name is sanitized into a slug that becomes BOTH a path component
//! of the on-disk bundle dir (`<app_data>/workflows/<owner>/local.dev.<owner>/<slug>/…`)
//! and the row name. `check_install_slug_len` bounded it, but only AFTER
//! `extract_tarball_bytes` had already tried to create that directory — so a
//! long name died at the filesystem (`File name too long (os error 36)`) and
//! surfaced as a generic 500 `SYSTEM_INTERNAL_ERROR` instead of the typed 400
//! the length check was written to produce.

use serde_json::{Value as Json, json};

use super::{plain_server, workflow_user};

fn simple_def() -> Json {
    json!({
        "inputs": [{ "name": "topic", "required": true }],
        "steps": [{ "id": "gen", "kind": "llm", "prompt": "say {{ inputs.topic }}" }],
        "outputs": [{ "name": "result", "from": "{{ gen.output }}" }]
    })
}

fn named(name: &str) -> Json {
    let mut def = simple_def();
    def["name"] = json!(name);
    def
}

#[tokio::test]
async fn create_rejects_an_over_long_name_before_touching_the_filesystem() {
    let server = plain_server().await;
    let user = workflow_user(&server, "wf_name_bounds").await;
    let client = reqwest::Client::new();

    let resp = client
        .post(server.api_url("/workflows"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&named(&"a".repeat(1000)))
        .send()
        .await
        .expect("create with a 1000-char name");
    let status = resp.status();
    let body: Json = resp.json().await.unwrap_or(Json::Null);
    assert_eq!(
        status, 400,
        "an over-long name must be a validation error, not a 500: {body}"
    );
    assert_eq!(
        body["error_code"], "WORKFLOW_TOOL_NAME_TOO_LONG",
        "the typed slug-length error must reach the client: {body}"
    );

    // Positive control: a normal name still creates, so the bound is not
    // rejecting everything.
    let resp = client
        .post(server.api_url("/workflows"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&named("a-reasonable-name"))
        .send()
        .await
        .expect("create with a normal name");
    let status = resp.status();
    let body: Json = resp.json().await.unwrap_or(Json::Null);
    assert_eq!(status, 201, "a normal name still creates: {body}");
    assert_eq!(body["display_name"], "a-reasonable-name", "{body}");
}
