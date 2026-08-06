//! `GET /api/mcp/servers` — out-of-range pagination.
//!
//! `ListAccessibleServersQuery` documents itself as extending the shared
//! `common::PaginationQuery`, but it re-declared `page`/`per_page` as plain
//! `u32` fields and so dropped that type's clamp. The two cases the shared
//! type exists to prevent both reached the server:
//!
//!   * `page=0` → `(page - 1) * per_page` = a negative `OFFSET`
//!     (`2201X OFFSET must not be negative`) → 500.
//!   * `per_page=0` → `(total + per_page - 1) / per_page` → an integer
//!     divide-by-zero PANIC inside the handler, which killed the connection
//!     mid-response (the client sees a truncated message, not even a 500).
//!
//! Clamping (not a 4xx) is the repo-wide contract for pagination — see the
//! `PaginationQuery` doc comment — so `GET /api/users?page=0` and every other
//! list endpoint answer 200 with a clamped page. These assert the mcp list now
//! agrees, and that a normal query is unaffected.

use reqwest::StatusCode;
use serde_json::Value;

use crate::common::TestServer;
use crate::common::test_helpers::create_user_with_permissions;

async fn list(server: &TestServer, token: &str, query: &str) -> (StatusCode, Value) {
    let resp = reqwest::Client::new()
        .get(server.api_url(&format!("/mcp/servers?{query}")))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .expect("list accessible mcp servers");
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    (status, body)
}

#[tokio::test]
async fn list_accessible_servers_clamps_out_of_range_pagination() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "mcp_paging", &["mcp_servers::read"]).await;

    // page=0 — used to produce a negative OFFSET.
    let (status, body) = list(&server, &user.token, "page=0").await;
    assert_eq!(status, StatusCode::OK, "page=0 must not 500: {body}");
    assert_eq!(body["page"], 1, "page below 1 is clamped to 1: {body}");

    // per_page=0 — used to panic the handler on integer division.
    let (status, body) = list(&server, &user.token, "per_page=0").await;
    assert_eq!(status, StatusCode::OK, "per_page=0 must not 500: {body}");
    assert_eq!(
        body["per_page"], 1,
        "per_page below 1 is clamped to 1: {body}"
    );
    assert!(
        body["total_pages"].is_number(),
        "total_pages must be computed, not a division panic: {body}"
    );

    // Both at once (the shape the paginator produced when it under-counted).
    let (status, body) = list(&server, &user.token, "page=0&per_page=0").await;
    assert_eq!(
        status,
        StatusCode::OK,
        "page=0&per_page=0 must not 500: {body}"
    );

    // Over-large per_page is capped rather than materializing an unbounded page.
    let (status, body) = list(&server, &user.token, "per_page=100000").await;
    assert_eq!(
        status,
        StatusCode::OK,
        "over-large per_page must not 500: {body}"
    );
    assert_eq!(
        body["per_page"], 100,
        "per_page is capped at PAGINATION_MAX_PER_PAGE: {body}"
    );
}

#[tokio::test]
async fn list_accessible_servers_honours_in_range_pagination() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "mcp_paging_ok", &["mcp_servers::read"]).await;

    // Positive control: a legal page/per_page is passed through untouched, so
    // the clamp cannot be satisfied by pinning every request to page 1.
    let (status, body) = list(&server, &user.token, "page=2&per_page=7").await;
    assert_eq!(
        status,
        StatusCode::OK,
        "in-range pagination must succeed: {body}"
    );
    assert_eq!(body["page"], 2, "an in-range page is not clamped: {body}");
    assert_eq!(
        body["per_page"], 7,
        "an in-range per_page is not clamped: {body}"
    );
}
