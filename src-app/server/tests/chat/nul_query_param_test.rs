//! TEST-9 / TEST-19 — the two chat free-text search parameters
//! (`/conversations?search` and `/conversations/{id}/messages/search?q`) refuse
//! a NUL with a typed 400 instead of a 500.

use reqwest::StatusCode;
use serde_json::{Value, json};

use crate::common::TestServer;
use crate::common::nul_query_param::{assert_nul_is_rejected, get};
use crate::common::test_helpers::{TestUser, create_user_with_permissions};

async fn create_conversation(server: &TestServer, user: &TestUser, title: &str) -> String {
    let resp = reqwest::Client::new()
        .post(server.api_url("/conversations"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&json!({ "title": title }))
        .send()
        .await
        .expect("create conversation");
    assert_eq!(resp.status(), StatusCode::CREATED, "create conversation");
    let body: Value = resp.json().await.expect("conversation json");
    body["id"].as_str().expect("conversation id").to_string()
}

fn chat_permissions() -> &'static [&'static str] {
    &[
        "conversations::create",
        "conversations::read",
        "conversations::edit",
        "messages::read",
        "messages::create",
    ]
}

/// TEST-9 — `/conversations?search`.
///
/// Leg (b) is the ordering proof: `escape_like` runs on the term before it is
/// bound, and escaping does NOT remove a NUL, so a guard placed after it would
/// still bind U+0000. A backslash+NUL term (which `escape_like` rewrites to
/// `\\` + `\0`) must therefore ALSO be a 400.
#[tokio::test]
async fn conversations_search_rejects_nul_before_like_escaping() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "conv_nul", chat_permissions()).await;
    create_conversation(&server, &user, "Quarterly Roadmap review").await;

    // (c) HAPPY-PATH COUNTERPART.
    let (status, body) = get(&server, &user.token, "/conversations?search=Roadmap").await;
    assert_eq!(status, StatusCode::OK, "happy path: {body}");
    assert_eq!(
        body["total"], 1,
        "the seeded conversation must match: {body}"
    );

    // (a) The defect.
    assert_nul_is_rejected(
        &server,
        &user.token,
        "/conversations?page=1&limit=10&search=%00",
    )
    .await;

    // (b) The guard must precede `escape_like`.
    assert_nul_is_rejected(&server, &user.token, "/conversations?search=%5C%00").await;

    // (d) OWNERSHIP CONTROL.
    let other = create_user_with_permissions(&server, "conv_nul2", chat_permissions()).await;
    let (status, body) = get(&server, &other.token, "/conversations?search=Roadmap").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["total"], 0,
        "another user must not see the owner's conversation: {body}"
    );
}

/// TEST-19 — `/conversations/{id}/messages/search?q`, a sixth free-text ILIKE
/// search that was NOT in the reported defect and carried it identically.
#[tokio::test]
async fn message_search_q_rejects_nul() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "msg_nul", chat_permissions()).await;
    let cid = create_conversation(&server, &user, "message search conversation").await;

    // (b) HAPPY-PATH COUNTERPART — a real term returns a well-formed page.
    // (No message is seeded, so `total` is 0; what this proves is that the
    // endpoint parses, authorizes, and reaches the search path — the leg the
    // rejection assertion needs in order to mean anything.)
    let (status, body) = get(
        &server,
        &user.token,
        &format!("/conversations/{cid}/messages/search?q=roadmap"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "happy path: {body}");
    assert!(
        body["total"].is_number() && body["matches"].is_array(),
        "a well-formed search page: {body}"
    );

    // (a) The defect.
    assert_nul_is_rejected(
        &server,
        &user.token,
        &format!("/conversations/{cid}/messages/search?q=%00"),
    )
    .await;

    // (c) OWNERSHIP CONTROL — another user cannot search this conversation.
    let other = create_user_with_permissions(&server, "msg_nul2", chat_permissions()).await;
    let (status, _) = get(
        &server,
        &other.token,
        &format!("/conversations/{cid}/messages/search?q=roadmap"),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "a foreign conversation must 404, not leak"
    );
}
