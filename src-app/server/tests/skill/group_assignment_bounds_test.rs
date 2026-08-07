//! `POST /api/skills/system/{id}/groups` — a group id that does not exist.
//!
//! Reproduced against the harness before the fix: assigning a system skill to
//! a group whose row is gone answered
//! `500 {"error_code":"SYSTEM_DATABASE_ERROR"}`. `group_skills.group_id` is an
//! FK (`group_skills_group_id_fkey`), so the INSERT raised `23503` and
//! `AppError::database_error` flattened it into a generic 500.
//!
//! The admin skills page loads the group list once (`UserGroup.list`) and
//! saves later, so a group deleted in between is exactly the stale id that
//! reaches this handler — the same shape the live exploration rig hit four
//! times. The group-CENTRIC sibling
//! (`PUT /api/groups/{id}/system-skills`) already validated its body ids;
//! this direction did not.

use serde_json::{Value as Json, json};

use crate::common::TestServer;
use crate::common::test_helpers::{TestUser, create_user_with_permissions};
use crate::hub::mock_release_server::{MockHub, MockItem, MockVersion, spawn_mock_hub};

fn skill_md(name: &str) -> String {
    format!(
        r#"---
name: {name}
description: Test system skill {name}.
when_to_use: When the test needs a system skill named {name}.
allowed-tools: Read
metadata:
  author: ziee
  license: MIT
---

# {name}

BODY_MARKER for {name}.
"#
    )
}

async fn server_with_one_skill() -> (TestServer, MockHub) {
    let md: &'static str = Box::leak(skill_md("bounds-skill").into_boxed_str());
    let mock = spawn_mock_hub(vec![MockVersion {
        version: "9.9.1-test",
        prerelease: true,
        items: vec![MockItem::bundle(
            "skill",
            "io.github.test/bounds-skill",
            vec![("SKILL.md", md)],
        )],
    }])
    .await;
    let server = TestServer::start_with_options(crate::common::TestServerOptions {
        extra_env: mock.test_env(),
        ..Default::default()
    })
    .await;
    (server, mock)
}

async fn admin(server: &TestServer, name: &str) -> TestUser {
    create_user_with_permissions(
        server,
        name,
        &[
            "hub::catalog::read",
            "hub::catalog::manage",
            "skills::read",
            "skills::install",
            "skills::manage",
            "skills::manage_system",
            "skills::assign_to_groups",
            "groups::read",
            "groups::create",
            "groups::delete",
        ],
    )
    .await
}

/// Refresh the catalog, install the system skill, return its id.
async fn install_system_skill(server: &TestServer, token: &str) -> String {
    let client = reqwest::Client::new();
    let refresh = client
        .post(server.api_url("/hub/refresh"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .expect("refresh");
    assert_eq!(refresh.status(), 200, "hub refresh must 200");

    let resp = client
        .post(server.api_url("/skills/system/install-from-hub"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({ "hub_id": "io.github.test/bounds-skill" }))
        .send()
        .await
        .expect("install system skill");
    let status = resp.status();
    let body: Json = resp.json().await.expect("parse install body");
    assert_eq!(status, 201, "system skill install should 201: {body}");
    body["skill"]["id"].as_str().expect("skill id").to_string()
}

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

async fn set_skill_groups(
    server: &TestServer,
    token: &str,
    skill_id: &str,
    group_ids: &[&str],
) -> reqwest::Response {
    reqwest::Client::new()
        .post(server.api_url(&format!("/skills/system/{skill_id}/groups")))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({ "group_ids": group_ids }))
        .send()
        .await
        .expect("set skill groups")
}

async fn assigned_groups(server: &TestServer, token: &str, skill_id: &str) -> Vec<String> {
    let body: Json = reqwest::Client::new()
        .get(server.api_url(&format!("/skills/system/{skill_id}/groups")))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .expect("get skill groups")
        .json()
        .await
        .expect("parse groups");
    body.as_array()
        .expect("group id array")
        .iter()
        .map(|g| g.as_str().expect("group id").to_string())
        .collect()
}

#[tokio::test]
async fn set_groups_rejects_an_unknown_group_id() {
    let (server, _mock) = server_with_one_skill().await;
    let admin = admin(&server, "sk_grp_bounds_unknown").await;
    let sid = install_system_skill(&server, &admin.token).await;

    let unknown = uuid::Uuid::new_v4().to_string();
    let resp = set_skill_groups(&server, &admin.token, &sid, &[&unknown]).await;
    let status = resp.status();
    let body: Json = resp.json().await.unwrap_or(Json::Null);
    assert_eq!(
        status, 400,
        "an unknown group id must be a validation error, not a 500: {body}"
    );
    assert_eq!(
        body["error_code"], "GROUP_NOT_FOUND",
        "the typed dangling-group error must reach the client: {body}"
    );
    assert!(
        body["error"]
            .as_str()
            .unwrap_or_default()
            .contains(&unknown),
        "the message must name the offending id so the admin can act: {body}"
    );

    assert!(
        assigned_groups(&server, &admin.token, &sid)
            .await
            .is_empty(),
        "a rejected assignment must not write anything"
    );
}

/// Positive control: the guard rejects only ids that are genuinely gone — a
/// real group still assigns, so the 400 above cannot be satisfied by a
/// handler that refuses everything.
#[tokio::test]
async fn set_groups_still_assigns_a_real_group() {
    let (server, _mock) = server_with_one_skill().await;
    let admin = admin(&server, "sk_grp_bounds_ok").await;
    let sid = install_system_skill(&server, &admin.token).await;
    let gid = create_group(&server, &admin.token, "sk-bounds-ok-grp").await;

    let resp = set_skill_groups(&server, &admin.token, &sid, &[&gid]).await;
    assert_eq!(resp.status(), 204, "assigning a real group still succeeds");
    assert_eq!(
        assigned_groups(&server, &admin.token, &sid).await,
        vec![gid.clone()]
    );

    // Clearing the set is still a no-op-safe 204 (the empty body must not be
    // caught by the new guard).
    let cleared = set_skill_groups(&server, &admin.token, &sid, &[]).await;
    assert_eq!(cleared.status(), 204, "clearing the set still succeeds");
    assert!(
        assigned_groups(&server, &admin.token, &sid)
            .await
            .is_empty()
    );
}

/// The exact production shape: the admin UI loaded the group, the group was
/// deleted, and the stale id is saved. Also pins that a partly-valid set is
/// rejected WHOLE — the surviving group must not be assigned.
#[tokio::test]
async fn set_groups_rejects_a_group_deleted_after_the_page_loaded() {
    let (server, _mock) = server_with_one_skill().await;
    let admin = admin(&server, "sk_grp_bounds_stale").await;
    let sid = install_system_skill(&server, &admin.token).await;
    let live = create_group(&server, &admin.token, "sk-bounds-live-grp").await;
    let doomed = create_group(&server, &admin.token, "sk-bounds-doomed-grp").await;

    let del = reqwest::Client::new()
        .delete(server.api_url(&format!("/groups/{doomed}")))
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .expect("delete group");
    assert!(del.status().is_success(), "group delete should succeed");

    let resp = set_skill_groups(&server, &admin.token, &sid, &[&live, &doomed]).await;
    let status = resp.status();
    let body: Json = resp.json().await.unwrap_or(Json::Null);
    assert_eq!(status, 400, "a stale group id must not 500: {body}");
    assert_eq!(body["error_code"], "GROUP_NOT_FOUND", "{body}");

    assert!(
        assigned_groups(&server, &admin.token, &sid)
            .await
            .is_empty(),
        "the still-live group must not be assigned by a rejected request"
    );
}
