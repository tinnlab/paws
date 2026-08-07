//! `POST /api/llm-providers/{id}/groups` — a group id that does not exist.
//!
//! Reproduced against the harness before the fix: `500`. This handler is the
//! most explicit of the four — it mapped every repository error, including the
//! `user_group_llm_providers.group_id` FK violation (`23503`), straight to
//! `AppError::internal_error("Database operation failed")`.
//!
//! One of four copy-pasted `*/groups` handlers with the identical omission;
//! the guard is now shared (`common::groups::reject_unknown_group_ids`).
//! Note this endpoint takes a SINGLE `group_id`, not a list — the shared guard
//! is called with a one-element slice, so the contract is identical.

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

async fn create_provider(server: &TestServer, token: &str, name: &str) -> String {
    let resp = reqwest::Client::new()
        .post(server.api_url("/llm-providers"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({
            "name": name,
            "provider_type": "openai",
            "base_url": "https://api.openai.com/v1",
            "api_key": "test-key",
            "enabled": false,
        }))
        .send()
        .await
        .expect("create provider");
    let status = resp.status();
    let body: Json = resp.json().await.expect("parse provider");
    assert_eq!(status, 201, "provider create should 201: {body}");
    body["id"].as_str().expect("provider id").to_string()
}

async fn assign_group(server: &TestServer, token: &str, pid: &str, gid: &str) -> reqwest::Response {
    reqwest::Client::new()
        .post(server.api_url(&format!("/llm-providers/{pid}/groups")))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({ "group_id": gid }))
        .send()
        .await
        .expect("assign provider to group")
}

/// The provider-groups GET returns group OBJECTS, so count rather than compare
/// raw ids.
async fn assigned_count(server: &TestServer, token: &str, pid: &str) -> usize {
    let body: Json = reqwest::Client::new()
        .get(server.api_url(&format!("/llm-providers/{pid}/groups")))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .expect("get provider groups")
        .json()
        .await
        .expect("parse");
    body.as_array()
        .map(Vec::len)
        .or_else(|| body["groups"].as_array().map(Vec::len))
        .unwrap_or_else(|| panic!("unexpected provider-groups body: {body}"))
}

#[tokio::test]
async fn provider_groups_rejects_a_dead_group() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "gb_llm", &["*"]).await;
    let pid = create_provider(&server, &admin.token, "gb-llm-provider").await;
    let dead = dead_group_id(&server, &admin.token, "gb-llm-dead").await;

    let resp = assign_group(&server, &admin.token, &pid, &dead).await;
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
    assert_eq!(
        assigned_count(&server, &admin.token, &pid).await,
        0,
        "a rejected assignment must not write anything"
    );
}

/// Positive control: a live group still assigns.
#[tokio::test]
async fn provider_groups_still_assigns_a_live_group() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "gb_llm_ok", &["*"]).await;
    let pid = create_provider(&server, &admin.token, "gb-llm-ok-provider").await;
    let live = create_group(&server, &admin.token, "gb-llm-live").await;

    let ok = assign_group(&server, &admin.token, &pid, &live).await;
    assert_eq!(ok.status(), 204, "assigning a live group still succeeds");
    assert_eq!(assigned_count(&server, &admin.token, &pid).await, 1);
}
