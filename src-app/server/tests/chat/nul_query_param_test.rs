//! TEST-9 / TEST-19 — the two chat free-text search parameters
//! (`/conversations?search` and `/conversations/{id}/messages/search?q`) refuse
//! a NUL with a typed 400 instead of a 500.

use reqwest::StatusCode;
use serde_json::{Value, json};

use crate::common::TestServer;
use crate::common::nul_query_param::{assert_nul_is_rejected, get};
use crate::common::test_helpers::{TestUser, create_user_with_permissions};

/// Returns `(conversation_id, active_branch_id)`.
async fn create_conversation(server: &TestServer, user: &TestUser, title: &str) -> (String, Value) {
    let resp = reqwest::Client::new()
        .post(server.api_url("/conversations"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&json!({ "title": title }))
        .send()
        .await
        .expect("create conversation");
    assert_eq!(resp.status(), StatusCode::CREATED, "create conversation");
    let body: Value = resp.json().await.expect("conversation json");
    let id = body["id"].as_str().expect("conversation id").to_string();
    let branch = body["active_branch_id"].clone();
    (id, branch)
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
/// NOTE on leg (b): an earlier draft billed `?search=%5C%00` as proof that the
/// guard runs BEFORE `escape_like`. It is not. `escape_like` only rewrites
/// `\` `%` `_`; it neither removes nor introduces U+0000, so BOTH orderings
/// reject the same input set and no query string can distinguish them. The
/// claim was withdrawn rather than left as a test that cannot fail for its
/// stated reason. The case is kept only as an extra input shape (a NUL
/// alongside a LIKE metacharacter).
#[tokio::test]
async fn conversations_search_rejects_nul_before_like_escaping() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "conv_nul", chat_permissions()).await;
    create_conversation(&server, &user, "Quarterly Roadmap review").await;
    // A SECOND, non-matching conversation, so the happy-path leg proves the
    // filter SELECTS rather than merely that the list is non-empty.
    create_conversation(&server, &user, "Unrelated kitten thread").await;

    // (c) HAPPY-PATH COUNTERPART — selects one of two.
    let (status, body) = get(&server, &user.token, "/conversations?search=Roadmap").await;
    assert_eq!(status, StatusCode::OK, "happy path: {body}");
    assert_eq!(
        body["total"], 1,
        "search must select exactly the matching conversation of the two: {body}"
    );

    // (a) The defect.
    assert_nul_is_rejected(
        &server,
        &user.token,
        "/conversations?page=1&limit=10&search=%00",
    )
    .await;

    // (b) Extra input shape: a NUL next to a LIKE metacharacter. NOT an
    // ordering proof (see the note above) — just another rejected input.
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
    let (cid, branch) = create_conversation(&server, &user, "message search conversation").await;
    let branch_id = super::helpers::parse_uuid(&branch);

    // Seed TWO messages, only one matching, so the happy-path leg proves the
    // `q` term actually SELECTS. Without real messages the leg degenerates to
    // "an empty page is well-formed", which an endpoint ignoring `q` satisfies
    // just as well — and then the paired rejection assertion proves nothing.
    super::helpers::seed_text_message(
        &server.database_url,
        branch_id,
        "user",
        "please review the roadmap for Q3",
    )
    .await;
    super::helpers::seed_text_message(
        &server.database_url,
        branch_id,
        "assistant",
        "unrelated filler about kittens",
    )
    .await;

    // (b) HAPPY-PATH COUNTERPART — selects the one hit, excludes the other.
    let (status, body) = get(
        &server,
        &user.token,
        &format!("/conversations/{cid}/messages/search?q=roadmap"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "happy path: {body}");
    assert_eq!(body["total"], 1, "`q` must select exactly the hit: {body}");
    assert!(
        body["matches"][0]["snippet"]
            .as_str()
            .is_some_and(|s| s.contains("roadmap")),
        "the snippet carries the hit: {body}"
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
