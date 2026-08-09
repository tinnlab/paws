//! TEST-7 — `GET /projects?search=%00` is a typed 400, not a 500.

use reqwest::StatusCode;

use super::helpers;
use crate::common::TestServer;
use crate::common::nul_query_param::{assert_nul_is_rejected, get};
use crate::common::test_helpers::create_user_with_permissions;

/// TEST-7 — rejection, its happy-path counterpart, and the ownership control,
/// all in one test so the 400 cannot be a symptom of a broken endpoint.
#[tokio::test]
async fn projects_search_rejects_nul_and_still_searches() {
    let server = TestServer::start().await;
    let user =
        create_user_with_permissions(&server, "proj_nul", helpers::full_project_permissions())
            .await;
    helpers::create_project(&server, &user, "Roadmap").await;

    // (b) HAPPY-PATH COUNTERPART — the endpoint genuinely works.
    let (status, body) = get(&server, &user.token, "/projects?search=Roadmap").await;
    assert_eq!(status, StatusCode::OK, "happy path: {body}");
    assert_eq!(body["total"], 1, "the seeded project must match: {body}");
    assert_eq!(body["projects"][0]["name"], "Roadmap", "{body}");

    // (a) The defect: a NUL used to reach the ILIKE bind and 500.
    assert_nul_is_rejected(
        &server,
        &user.token,
        "/projects?page=1&per_page=10&search=%00",
    )
    .await;

    // (c) OWNERSHIP CONTROL — a second user searching the same term sees
    // nothing, so the 200 above is owner-scoped and not a global list.
    let other =
        create_user_with_permissions(&server, "proj_nul2", helpers::full_project_permissions())
            .await;
    let (status, body) = get(&server, &other.token, "/projects?search=Roadmap").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["total"], 0,
        "another user must not see the owner's project: {body}"
    );
}
