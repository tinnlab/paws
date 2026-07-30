//! CRUD round-trips on projects.

use reqwest::StatusCode;
use serde_json::json;

use super::helpers;

#[tokio::test]
async fn create_get_list_update_delete() {
    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "user",
        helpers::full_project_permissions(),
    )
    .await;

    // Create. MCP defaults no longer ship inline on the Project payload
    // (migration 78 moved them to the unified mcp_settings table); clients
    // hit GET /projects/{id}/mcp-settings for the defaults.
    let project = helpers::create_project(&server, &user, "My Project").await;
    let id = project["id"].as_str().unwrap();
    assert_eq!(project["name"], "My Project");
    assert_eq!(project["user_id"], user.user_id);

    // Get.
    let (status, body) = helpers::get_project(&server, &user, id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.unwrap()["id"], project["id"]);

    // List.
    let list_resp = reqwest::Client::new()
        .get(server.api_url("/projects"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .unwrap();
    assert_eq!(list_resp.status(), StatusCode::OK);
    let list_body: serde_json::Value = list_resp.json().await.unwrap();
    assert_eq!(list_body["total"], 1);
    assert_eq!(list_body["projects"].as_array().unwrap().len(), 1);

    // Update.
    let update_resp = reqwest::Client::new()
        .put(server.api_url(&format!("/projects/{}", id)))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&json!({
            "name": "Renamed",
            "description": "An updated description",
            "instructions": "Speak in haiku.",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(update_resp.status(), StatusCode::OK);
    let updated: serde_json::Value = update_resp.json().await.unwrap();
    assert_eq!(updated["name"], "Renamed");
    assert_eq!(updated["description"], "An updated description");
    assert_eq!(updated["instructions"], "Speak in haiku.");

    // Delete.
    assert_eq!(
        helpers::delete_project(&server, &user, id).await,
        StatusCode::NO_CONTENT
    );

    // 404 after delete.
    let (status, _) = helpers::get_project(&server, &user, id).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn name_unique_per_user_but_allowed_across_users() {
    let server = crate::common::TestServer::start().await;
    let user_a = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "alice",
        helpers::full_project_permissions(),
    )
    .await;
    let user_b = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "bob",
        helpers::full_project_permissions(),
    )
    .await;

    helpers::create_project(&server, &user_a, "Shared Name").await;

    // Different user — same name is fine.
    helpers::create_project(&server, &user_b, "Shared Name").await;

    // Same user — duplicate name is rejected by `projects_user_name_unique`
    // and must surface as a 409 RESOURCE_CONFLICT.
    //
    // This assertion used to accept `is_client_error() || is_server_error()`,
    // with a comment claiming the unique violation became a `bad_request`. It
    // did not: the bare INSERT flattened the 23505 into a
    // `500 SYSTEM_DATABASE_ERROR`, and the `is_server_error()` arm made this
    // test PASS on exactly the defect it was supposed to catch. Pin the real
    // contract so the 500 cannot come back.
    let dup_resp = reqwest::Client::new()
        .post(server.api_url("/projects"))
        .header("Authorization", format!("Bearer {}", user_a.token))
        .json(&json!({ "name": "Shared Name" }))
        .send()
        .await
        .unwrap();
    let dup_status = dup_resp.status();
    let dup_body: serde_json::Value = dup_resp.json().await.unwrap_or(serde_json::Value::Null);
    assert_eq!(
        dup_status,
        StatusCode::CONFLICT,
        "duplicate name within one user must be a 409 (body: {dup_body})"
    );
    assert_eq!(
        dup_body.get("error_code").and_then(|v| v.as_str()),
        Some("RESOURCE_CONFLICT"),
        "duplicate name must carry the shared conflict code (body: {dup_body})"
    );
}

#[tokio::test]
async fn ownership_user_a_cannot_read_user_b() {
    let server = crate::common::TestServer::start().await;
    let user_a = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "alice",
        helpers::full_project_permissions(),
    )
    .await;
    let user_b = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "bob",
        helpers::full_project_permissions(),
    )
    .await;

    let p = helpers::create_project(&server, &user_a, "Alice's").await;
    let id = p["id"].as_str().unwrap();

    let (status, _) = helpers::get_project(&server, &user_b, id).await;
    // 404 not 403 — we intentionally hide existence to avoid leaking
    // foreign project IDs.
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn instructions_cap_64k_rejects_overage() {
    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "user",
        helpers::full_project_permissions(),
    )
    .await;

    let oversized = "x".repeat(65_537);
    let resp = reqwest::Client::new()
        .post(server.api_url("/projects"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&json!({ "name": "Overflow", "instructions": oversized }))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "64KiB+1 instructions must be rejected ({})",
        resp.status()
    );
}

#[tokio::test]
async fn description_cap_4k_rejects_overage() {
    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "user",
        helpers::full_project_permissions(),
    )
    .await;

    let oversized = "y".repeat(4_097);
    let resp = reqwest::Client::new()
        .post(server.api_url("/projects"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&json!({ "name": "Overflow", "description": oversized }))
        .send()
        .await
        .unwrap();
    assert!(
        resp.status().is_client_error(),
        "4KiB+1 description must be rejected ({})",
        resp.status()
    );
}

#[tokio::test]
async fn name_required_and_non_empty() {
    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "user",
        helpers::full_project_permissions(),
    )
    .await;

    // Whitespace-only name is rejected.
    let resp = reqwest::Client::new()
        .post(server.api_url("/projects"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&json!({ "name": "   " }))
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_client_error());
}
