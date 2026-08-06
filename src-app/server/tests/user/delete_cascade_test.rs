//! `DELETE /api/users/{id}` — cascade coverage.
//!
//! A live UI audit reported this endpoint returning 500 (19 occurrences). The
//! investigation could NOT reproduce it; these tests are the evidence, and the
//! guard that would catch the reported shape if it is ever introduced.
//!
//! Why an FK violation was the leading hypothesis, and why it is ruled out:
//! deleting a user fans out across ~40 child tables. Every FK referencing
//! `users` is `ON DELETE CASCADE` or `ON DELETE SET NULL`, every SET NULL
//! target column is nullable (so no `23502 not-null` from the cascade), and the
//! schema's ONLY non-cascading FK — `files.current_version_id ->
//! file_versions(id)` — is `DEFERRABLE INITIALLY DEFERRED` with BOTH sides
//! inside the cascade closure, so it is satisfied at commit.
//!
//! The remaining risk is behavioural rather than schema-shaped: `delete_user`
//! collects skill dirs and file blobs BEFORE the row goes away and cleans them
//! up after, and every one of those cleanups is best-effort/logged. The only
//! error that can reach the client is the DELETE itself. So the test that
//! matters is "a user with as much owned state as the API can create still
//! deletes cleanly", which is what `delete_user_with_owned_rows_succeeds`
//! pins.

use reqwest::StatusCode;
use serde_json::{Value, json};

use crate::common::TestServer;
use crate::common::test_helpers::{TestUser, create_user_with_permissions};

async fn admin(server: &TestServer) -> TestUser {
    create_user_with_permissions(server, "dc_admin", &["*"]).await
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

async fn delete_user(server: &TestServer, token: &str, user_id: &str) -> reqwest::Response {
    reqwest::Client::new()
        .delete(server.api_url(&format!("/users/{user_id}")))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .expect("delete request failed")
}

/// The reported shape: a user carrying owned rows across the cascade — an
/// assistant, a project, a conversation (which carries an `active_branch_id`,
/// the one circular conversations<->branches pair), an MCP server, a knowledge
/// base, a memory, and an uploaded file (the `files`/`file_versions` deferred
/// FK plus real on-disk blob cleanup).
#[tokio::test]
async fn delete_user_with_owned_rows_succeeds() {
    let server = TestServer::start().await;
    let admin = admin(&server).await;
    let owner = create_user_with_permissions(
        &server,
        "dc_owner",
        &[
            "projects::create",
            "conversations::create",
            "files::upload",
            "files::read",
            "assistants::create",
            "mcp_servers::create",
            "mcp_servers::read",
            "knowledge_base::manage",
            "memory::use",
            "profile::edit",
        ],
    )
    .await;

    for (label, path, body) in [
        (
            "assistant",
            "/assistants",
            json!({"name":"a","description":"d","instructions":"i"}),
        ),
        ("project", "/projects", json!({"name":"cascade-proj"})),
        (
            "conversation",
            "/conversations",
            json!({"title":"cascade-conv"}),
        ),
        (
            "mcp server",
            "/mcp/servers",
            json!({"name":"cs","display_name":"cs","enabled":false,
                   "transport_type":"http","url":"https://example.com/mcp","timeout_seconds":30}),
        ),
        (
            "knowledge base",
            "/knowledge-bases",
            json!({"name":"kb","description":"d"}),
        ),
        ("memory", "/memories", json!({"content":"remember this"})),
    ] {
        let res = post_json(&server, &owner.token, path, body).await;
        assert_eq!(
            res.status(),
            StatusCode::CREATED,
            "setup: create {label}: {}",
            res.text().await.unwrap_or_default()
        );
    }

    let form = reqwest::multipart::Form::new().part(
        "file",
        reqwest::multipart::Part::bytes(b"cascade fixture".to_vec())
            .file_name("cascade.md".to_string())
            .mime_str("text/markdown")
            .expect("mime"),
    );
    let up = reqwest::Client::new()
        .post(server.api_url("/files/upload"))
        .header("Authorization", format!("Bearer {}", owner.token))
        .multipart(form)
        .send()
        .await
        .expect("upload request failed");
    assert_eq!(up.status(), StatusCode::CREATED, "setup: upload a file");

    let res = delete_user(&server, &admin.token, &owner.user_id).await;
    let got = res.status();
    assert_eq!(
        got,
        StatusCode::NO_CONTENT,
        "deleting a user with owned rows must cascade cleanly, got {got}: {}",
        res.text().await.unwrap_or_default()
    );

    // ...and the row really is gone.
    let res = delete_user(&server, &admin.token, &owner.user_id).await;
    assert_eq!(
        res.status(),
        StatusCode::NOT_FOUND,
        "a second delete must be a 404, not a 500"
    );
}

/// A missing id is a 404, never a 500 — the code path that distinguishes
/// "became admin" from "already gone" after the guarded DELETE.
#[tokio::test]
async fn delete_nonexistent_user_is_404() {
    let server = TestServer::start().await;
    let admin = admin(&server).await;

    let res = delete_user(&server, &admin.token, &uuid::Uuid::new_v4().to_string()).await;
    let got = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    assert_eq!(got, StatusCode::NOT_FOUND, "body: {body}");
    assert_eq!(
        body.get("error_code").and_then(Value::as_str),
        Some("RESOURCE_NOT_FOUND"),
        "body: {body}"
    );
}
