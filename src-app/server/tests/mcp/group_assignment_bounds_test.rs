//! `POST /api/mcp/system-servers/{id}/groups` — a group id that does not exist.
//!
//! Reproduced against the harness before the fix:
//! `500 {"error_code":"SYSTEM_DATABASE_ERROR"}`.
//! `user_group_mcp_servers.group_id` is an FK to `groups(id)`, so a group
//! deleted after the admin page loaded its list arrives as a dangling id, the
//! INSERT raises `23503`, and `AppError::database_error` flattens it into a
//! generic 500 the admin cannot act on.
//!
//! This is ONE of four copy-pasted `*/groups` handlers with the identical
//! omission (skills / mcp system-servers / system workflows / llm providers).
//! The guard is now shared — `common::groups::reject_unknown_group_ids` — and
//! each module pins the same contract next to its own endpoint.

use serde_json::{Value as Json, json};

use crate::common::TestServer;
use crate::common::test_helpers::create_user_with_permissions;

async fn create_group(server: &TestServer, token: &str, name: &str) -> String {
    let resp = reqwest::Client::new()
        .post(server.api_url("/groups"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({ "name": name, "description": "x", "permissions": [] }))
        .send()
        .await
        .expect("create group");
    assert_eq!(resp.status(), 201, "group create should 201");
    let group: Json = resp.json().await.expect("parse group");
    group["id"].as_str().expect("group id").to_string()
}

/// A group that existed and is now gone — the production shape (the admin page
/// held it in a list), not a never-existed random uuid.
async fn dead_group_id(server: &TestServer, token: &str, name: &str) -> String {
    let gid = create_group(server, token, name).await;
    let del = reqwest::Client::new()
        .delete(server.api_url(&format!("/groups/{gid}")))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .expect("delete group");
    assert!(del.status().is_success(), "group delete should succeed");
    gid
}

async fn create_system_server(server: &TestServer, token: &str, name: &str) -> String {
    let resp = reqwest::Client::new()
        .post(server.api_url("/mcp/system-servers"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({
            "name": name,
            "display_name": name,
            "description": "group-bounds fixture",
            "enabled": true,
            "transport_type": "stdio",
            "command": "uvx",
            "args": ["mcp-server-fetch"],
            "timeout_seconds": 60
        }))
        .send()
        .await
        .expect("create system server");
    let status = resp.status();
    let body: Json = resp.json().await.expect("parse server");
    assert_eq!(status, 201, "system server create should 201: {body}");
    body["id"].as_str().expect("server id").to_string()
}

async fn set_server_groups(
    server: &TestServer,
    token: &str,
    id: &str,
    group_ids: &[&str],
) -> reqwest::Response {
    reqwest::Client::new()
        .post(server.api_url(&format!("/mcp/system-servers/{id}/groups")))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({ "group_ids": group_ids }))
        .send()
        .await
        .expect("assign server to groups")
}

async fn assigned(server: &TestServer, token: &str, id: &str) -> Vec<String> {
    let body: Json = reqwest::Client::new()
        .get(server.api_url(&format!("/mcp/system-servers/{id}/groups")))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .expect("get server groups")
        .json()
        .await
        .expect("parse");
    body.as_array()
        .expect("group id array")
        .iter()
        .map(|g| g.as_str().expect("group id").to_string())
        .collect()
}

#[tokio::test]
async fn mcp_server_groups_rejects_a_dead_group() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "gb_mcp", &["*"]).await;
    let sid = create_system_server(&server, &admin.token, "gb-mcp-server").await;
    let dead = dead_group_id(&server, &admin.token, "gb-mcp-dead").await;

    let resp = set_server_groups(&server, &admin.token, &sid, &[&dead]).await;
    let status = resp.status();
    let body: Json = resp.json().await.unwrap_or(Json::Null);
    assert_eq!(
        status, 400,
        "a dead group id must be a validation error, not a 500: {body}"
    );
    assert_eq!(
        body["error_code"], "GROUP_NOT_FOUND",
        "the shared typed error must reach the client: {body}"
    );
    assert!(
        body["error"].as_str().unwrap_or_default().contains(&dead),
        "the message must name the offending id: {body}"
    );
    assert!(
        assigned(&server, &admin.token, &sid).await.is_empty(),
        "a rejected assignment must not write anything"
    );
}

/// Positive control: the guard rejects only ids that are genuinely gone.
#[tokio::test]
async fn mcp_server_groups_still_assigns_a_live_group() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "gb_mcp_ok", &["*"]).await;
    let sid = create_system_server(&server, &admin.token, "gb-mcp-ok-server").await;
    let live = create_group(&server, &admin.token, "gb-mcp-live").await;

    let ok = set_server_groups(&server, &admin.token, &sid, &[&live]).await;
    assert_eq!(ok.status(), 204, "assigning a live group still succeeds");
    assert_eq!(assigned(&server, &admin.token, &sid).await, vec![live]);

    // Clearing the set stays a valid no-op — an empty list is not "unknown ids".
    let cleared = set_server_groups(&server, &admin.token, &sid, &[]).await;
    assert_eq!(cleared.status(), 204, "clearing the set still succeeds");
    assert!(assigned(&server, &admin.token, &sid).await.is_empty());
}
