//! `DELETE /api/users/{id}` — cascade coverage.
//!
//! A live UI audit reported this endpoint returning 500. The FIRST
//! investigation could not reproduce it and concluded the cascade was safe.
//! That conclusion was wrong, and the reasoning it rested on is preserved here
//! because it is exactly the reasoning that misses the real defect:
//!
//! > deleting a user fans out across ~40 child tables. Every FK referencing
//! > `users` is `ON DELETE CASCADE` or `ON DELETE SET NULL`, every SET NULL
//! > target column is nullable (so no `23502 not-null` from the cascade), and
//! > the schema's ONLY non-cascading FK — `files.current_version_id ->
//! > file_versions(id)` — is `DEFERRABLE INITIALLY DEFERRED` with BOTH sides
//! > inside the cascade closure, so it is satisfied at commit.
//!
//! Every clause of that is true. It is nonetheless not sufficient: a nullable
//! SET NULL target is safe against `23502 not-null`, but NOT against `23505
//! unique_violation`. `hub_entities.created_by` is nullable, and
//! `created_by IS NULL` is the schema's marker for a SYSTEM-WIDE install —
//! carried by two PARTIAL UNIQUE indexes:
//!
//! ```text
//! uniq_hub_template_install   UNIQUE (hub_id) WHERE entity_type = 'assistant'  AND created_by IS NULL
//! uniq_hub_system_mcp_install UNIQUE (hub_id) WHERE entity_type = 'mcp_server' AND created_by IS NULL
//! ```
//!
//! So SET NULL does not merely blank a column — it MOVES the row INTO those
//! indexes' predicate. A user who installed a hub assistant (or system MCP
//! server) whose `hub_id` is ALSO installed system-wide therefore cannot be
//! deleted at all: the cascade tries to make their personal install a second
//! system install of the same `hub_id`, the partial unique index rejects it,
//! and the whole `DELETE FROM users` fails with a 500.
//!
//! That is the state the audit found. On the live rig exactly two of eighteen
//! users failed, always, 69 times across three days — the only two non-admin
//! users holding a `hub_entities` row.
//!
//! `SET NULL` was wrong for a second, quieter reason: `created_by IS NULL`
//! MEANS "system install", so on any hub_id WITHOUT a system counterpart the
//! cascade would have silently PROMOTED a deleted user's personal install to a
//! system-wide one, pointing at an `assistants` row the same cascade just
//! deleted. The fix is `ON DELETE CASCADE` — the tracking row's whole purpose
//! is to track an entity that is itself cascade-deleted with the user.
//!
//! The remaining risk is behavioural rather than schema-shaped: `delete_user`
//! collects skill dirs and file blobs BEFORE the row goes away and cleans them
//! up after, and every one of those cleanups is best-effort/logged. The only
//! error that can reach the client is the DELETE itself. So the test that
//! matters is "a user with as much owned state as the API can create still
//! deletes cleanly", which is what `delete_user_with_owned_rows_succeeds`
//! pins, plus `delete_user_with_hub_install_shadowing_system_install_succeeds`
//! for the state above.

use reqwest::StatusCode;
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;

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

/// THE reported shape: a user whose hub install SHADOWS a system-wide install
/// of the same `hub_id`.
///
/// Both installs go through the real hub endpoints against the embedded seed
/// catalog:
///   * admin  → `POST /hub/assistant-templates/create` → `created_by IS NULL`
///   * owner  → `POST /hub/assistants/create`          → `created_by = owner`
///
/// Pre-fix, deleting `owner` sets their row's `created_by` to NULL, which puts
/// a SECOND `(hub_id, entity_type='assistant', created_by IS NULL)` row into
/// `uniq_hub_template_install` → `23505` → 500 "An internal database error
/// occurred". Post-fix the row cascades away and the delete is a clean 204.
#[tokio::test]
async fn delete_user_with_hub_install_shadowing_system_install_succeeds() {
    let server = TestServer::start().await;
    let admin = admin(&server).await;
    let owner = create_user_with_permissions(
        &server,
        "dc_hub_owner",
        &["hub::assistants::create", "hub::assistants::read"],
    )
    .await;
    let client = reqwest::Client::new();

    // Pick a real assistant out of the embedded seed catalog.
    let listing: Value = client
        .get(server.api_url("/hub/assistants?lang=en"))
        .header("Authorization", format!("Bearer {}", owner.token))
        .send()
        .await
        .expect("list hub assistants")
        .json()
        .await
        .expect("parse hub assistants");
    let hub_id = listing
        .as_array()
        .and_then(|a| a.first())
        .and_then(|a| a["name"].as_str())
        .expect("the seed catalog must ship at least one assistant")
        .to_string();

    // 1. SYSTEM-wide template install (created_by IS NULL).
    let res = post_json(
        &server,
        &admin.token,
        "/hub/assistant-templates/create",
        json!({ "hub_id": hub_id }),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::CREATED,
        "setup: system template install: {}",
        res.text().await.unwrap_or_default()
    );

    // 2. The SAME hub_id installed personally by `owner` (created_by = owner).
    let res = post_json(
        &server,
        &owner.token,
        "/hub/assistants/create",
        json!({ "hub_id": hub_id, "enabled": true }),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::CREATED,
        "setup: user install of the same hub_id: {}",
        res.text().await.unwrap_or_default()
    );

    // Pin the fixture: BOTH rows exist, exactly one of them system-scoped.
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&server.database_url)
        .await
        .expect("connect test db");
    let (total, system): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COUNT(*) FILTER (WHERE created_by IS NULL)
           FROM hub_entities WHERE hub_id = $1 AND entity_type = 'assistant'",
    )
    .bind(&hub_id)
    .fetch_one(&pool)
    .await
    .expect("count hub_entities");
    assert_eq!(
        (total, system),
        (2, 1),
        "fixture must be one system install + one user install of {hub_id}"
    );

    // 3. The delete under test.
    let res = delete_user(&server, &admin.token, &owner.user_id).await;
    let got = res.status();
    assert_eq!(
        got,
        StatusCode::NO_CONTENT,
        "deleting a user whose hub install shadows a system install of the same \
         hub_id must succeed; got {got}: {}",
        res.text().await.unwrap_or_default()
    );

    // The user's tracking row is gone and the system install is untouched —
    // NOT promoted into a second system install.
    let (total, system): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COUNT(*) FILTER (WHERE created_by IS NULL)
           FROM hub_entities WHERE hub_id = $1 AND entity_type = 'assistant'",
    )
    .bind(&hub_id)
    .fetch_one(&pool)
    .await
    .expect("recount hub_entities");
    pool.close().await;
    assert_eq!(
        (total, system),
        (1, 1),
        "the deleted user's hub_entities row must CASCADE away, leaving only \
         the untouched system install"
    );
}

/// The same landmine with no system counterpart: `SET NULL` would have left a
/// row claiming to be a system-wide install of an assistant the cascade just
/// deleted. This has no unique index to trip, so it never 500s — it corrupts
/// silently, which is why it needs its own assertion.
#[tokio::test]
async fn delete_user_does_not_promote_their_hub_install_to_system() {
    let server = TestServer::start().await;
    let admin = admin(&server).await;
    let owner = create_user_with_permissions(
        &server,
        "dc_hub_solo",
        &["hub::assistants::create", "hub::assistants::read"],
    )
    .await;
    let client = reqwest::Client::new();

    let listing: Value = client
        .get(server.api_url("/hub/assistants?lang=en"))
        .header("Authorization", format!("Bearer {}", owner.token))
        .send()
        .await
        .expect("list hub assistants")
        .json()
        .await
        .expect("parse hub assistants");
    let hub_id = listing
        .as_array()
        .and_then(|a| a.first())
        .and_then(|a| a["name"].as_str())
        .expect("the seed catalog must ship at least one assistant")
        .to_string();

    let res = post_json(
        &server,
        &owner.token,
        "/hub/assistants/create",
        json!({ "hub_id": hub_id, "enabled": true }),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::CREATED,
        "setup: user install: {}",
        res.text().await.unwrap_or_default()
    );

    let res = delete_user(&server, &admin.token, &owner.user_id).await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT, "delete must succeed");

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&server.database_url)
        .await
        .expect("connect test db");
    let remaining: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM hub_entities WHERE hub_id = $1 AND entity_type = 'assistant'",
    )
    .bind(&hub_id)
    .fetch_one(&pool)
    .await
    .expect("count hub_entities");
    pool.close().await;
    assert_eq!(
        remaining, 0,
        "the deleted user's hub_entities row must be REMOVED, not blanked into \
         a phantom system-wide install of an assistant that no longer exists"
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
