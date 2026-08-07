//! `POST /api/workflows/system/{id}/groups` — a group id that does not exist.
//!
//! Reproduced against the harness before the fix:
//! `500 {"error_code":"SYSTEM_DATABASE_ERROR"}`. `group_workflows.group_id` is
//! an FK to `groups(id)`; the handler validated the WORKFLOW (exists +
//! system-scope) but never the group ids, so a stale id raised `23503` and
//! `AppError::database_error` flattened it into a generic 500.
//!
//! One of four copy-pasted `*/groups` handlers with the identical omission;
//! the guard is now shared (`common::groups::reject_unknown_group_ids`).

use serde_json::{Value as Json, json};

use super::{SIMPLE_OK_YAML, plain_server, system_import_workflow};
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

async fn set_workflow_groups(
    server: &TestServer,
    token: &str,
    id: &str,
    group_ids: &[&str],
) -> reqwest::Response {
    reqwest::Client::new()
        .post(server.api_url(&format!("/workflows/system/{id}/groups")))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({ "group_ids": group_ids }))
        .send()
        .await
        .expect("assign workflow to groups")
}

async fn assigned(server: &TestServer, token: &str, id: &str) -> Vec<String> {
    let body: Json = reqwest::Client::new()
        .get(server.api_url(&format!("/workflows/system/{id}/groups")))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .expect("get workflow groups")
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
async fn workflow_groups_rejects_a_dead_group() {
    let server = plain_server().await;
    let admin = create_user_with_permissions(&server, "gb_wf", &["*"]).await;
    let body = system_import_workflow(&server, &admin.token, "gb-wf-bounds", SIMPLE_OK_YAML).await;
    let wid = body["id"].as_str().expect("workflow id").to_string();
    let dead = dead_group_id(&server, &admin.token, "gb-wf-dead").await;

    let resp = set_workflow_groups(&server, &admin.token, &wid, &[&dead]).await;
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
        assigned(&server, &admin.token, &wid).await.is_empty(),
        "a rejected assignment must not write anything"
    );
}

/// Positive control: a live group still assigns, so the rejection above cannot
/// be satisfied by a handler that refuses everything.
#[tokio::test]
async fn workflow_groups_still_assigns_a_live_group() {
    let server = plain_server().await;
    let admin = create_user_with_permissions(&server, "gb_wf_ok", &["*"]).await;
    let body = system_import_workflow(&server, &admin.token, "gb-wf-ok", SIMPLE_OK_YAML).await;
    let wid = body["id"].as_str().expect("workflow id").to_string();
    let live = create_group(&server, &admin.token, "gb-wf-live").await;

    let ok = set_workflow_groups(&server, &admin.token, &wid, &[&live]).await;
    assert_eq!(ok.status(), 204, "assigning a live group still succeeds");
    assert_eq!(assigned(&server, &admin.token, &wid).await, vec![live]);

    let cleared = set_workflow_groups(&server, &admin.token, &wid, &[]).await;
    assert_eq!(cleared.status(), 204, "clearing the set still succeeds");
    assert!(assigned(&server, &admin.token, &wid).await.is_empty());
}
