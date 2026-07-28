//! TEST-16 (ITEM-13): the `tool_use_id` / `message_id` filters on
//! `GET /api/mcp/tool-calls`.
//!
//! These are what let the activity rail join a chat message's `tool_use` blocks
//! to their recorded invocations (duration / source / result size are otherwise
//! unreachable from a message). The load-bearing property is that a filter can
//! only ever NARROW the caller's own rows — the `user_id` predicate is
//! unconditional — so every case here is paired with a cross-user negative.
//!
//! Rows are inserted directly (rather than driven through a live tool call)
//! because the two columns under test are stamped only on the chat path, whose
//! `tool_use_id` is chosen by the model and therefore not addressable from a
//! test. The filters themselves are pure SQL, and this exercises the real
//! handler → repository → SQL path over the real HTTP surface.

use serde_json::json;
use uuid::Uuid;

async fn pool(server: &crate::common::TestServer) -> sqlx::PgPool {
    sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&server.database_url)
        .await
        .unwrap()
}

/// Insert one owner-scoped `mcp_tool_calls` row with the chat-path columns set.
#[allow(clippy::too_many_arguments)]
async fn insert_call(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    tool_name: &str,
    message_id: Option<Uuid>,
    tool_use_id: Option<&str>,
) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO mcp_tool_calls \
         (id, user_id, server_name, tool_name, message_id, tool_use_id, status, source) \
         VALUES ($1, $2, 'srv', $3, $4, $5, 'completed', 'chat')",
    )
    .bind(id)
    .bind(user_id)
    .bind(tool_name)
    .bind(message_id)
    .bind(tool_use_id)
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn get_json(
    server: &crate::common::TestServer,
    token: &str,
    path: &str,
) -> (reqwest::StatusCode, serde_json::Value) {
    let res = reqwest::Client::new()
        .get(server.api_url(path))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap();
    let status = res.status();
    let body: serde_json::Value = res.json().await.unwrap_or(json!(null));
    (status, body)
}

fn tool_names(body: &serde_json::Value) -> Vec<String> {
    body["calls"]
        .as_array()
        .expect("calls array")
        .iter()
        .map(|c| c["tool_name"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn tool_use_id_and_message_id_filters_select_the_matching_rows() {
    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "tcl_filters",
        &["mcp_servers::read"],
    )
    .await;
    let uid = Uuid::parse_str(&user.user_id).unwrap();

    let pool = pool(&server).await;
    let msg_a = Uuid::new_v4();
    let msg_b = Uuid::new_v4();
    // Two calls under message A (one rail), one under message B.
    insert_call(&pool, uid, "search", Some(msg_a), Some("toolu_a1")).await;
    insert_call(&pool, uid, "read_file", Some(msg_a), Some("toolu_a2")).await;
    insert_call(&pool, uid, "run_query", Some(msg_b), Some("toolu_b1")).await;
    // A REST-sourced row with neither column set — must never be selected by
    // either filter (the partial-index predicate excludes it too).
    insert_call(&pool, uid, "rest_call", None, None).await;
    pool.close().await;

    // `?tool_use_id=` → exactly the one step.
    let (status, body) = get_json(&server, &user.token, "/mcp/tool-calls?tool_use_id=toolu_a2").await;
    assert_eq!(status, 200);
    assert_eq!(body["total"], json!(1), "one row for one tool_use_id: {body}");
    assert_eq!(tool_names(&body), vec!["read_file".to_string()]);

    // `?message_id=` → the whole rail for that assistant turn, and nothing else.
    let (status, body) =
        get_json(&server, &user.token, &format!("/mcp/tool-calls?message_id={msg_a}")).await;
    assert_eq!(status, 200);
    assert_eq!(body["total"], json!(2), "both of message A's calls: {body}");
    let mut names = tool_names(&body);
    names.sort();
    assert_eq!(names, vec!["read_file".to_string(), "search".to_string()]);

    // The two filters compose (AND, not OR): a tool_use_id from message A paired
    // with message B's id yields nothing.
    let (_, body) = get_json(
        &server,
        &user.token,
        &format!("/mcp/tool-calls?message_id={msg_b}&tool_use_id=toolu_a1"),
    )
    .await;
    assert_eq!(body["total"], json!(0), "filters must AND-compose: {body}");

    // An unknown id is simply empty (no error, no leak).
    let (status, body) =
        get_json(&server, &user.token, "/mcp/tool-calls?tool_use_id=toolu_nope").await;
    assert_eq!(status, 200);
    assert_eq!(body["total"], json!(0));

    // Omitting the filters still returns everything the user owns (the filters
    // are optional narrowings, not a required predicate).
    let (_, body) = get_json(&server, &user.token, "/mcp/tool-calls").await;
    assert_eq!(body["total"], json!(4));
}

#[tokio::test]
async fn lookup_filters_are_owner_scoped() {
    let server = crate::common::TestServer::start().await;
    let owner = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "tcl_owner",
        &["mcp_servers::read"],
    )
    .await;
    let other = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "tcl_other",
        &["mcp_servers::read"],
    )
    .await;
    let owner_uid = Uuid::parse_str(&owner.user_id).unwrap();

    let pool = pool(&server).await;
    let msg = Uuid::new_v4();
    insert_call(&pool, owner_uid, "secret_tool", Some(msg), Some("toolu_secret")).await;
    pool.close().await;

    // Positive control: the owner finds it by both filters.
    let (_, body) =
        get_json(&server, &owner.token, "/mcp/tool-calls?tool_use_id=toolu_secret").await;
    assert_eq!(body["total"], json!(1), "owner sees their own row");

    // The SAME ids, as another user → empty. A filter must never widen past the
    // unconditional `user_id` predicate.
    let (status, body) =
        get_json(&server, &other.token, "/mcp/tool-calls?tool_use_id=toolu_secret").await;
    assert_eq!(status, 200);
    assert_eq!(body["total"], json!(0), "cross-user tool_use_id must not match");
    assert!(body["calls"].as_array().unwrap().is_empty());

    let (status, body) =
        get_json(&server, &other.token, &format!("/mcp/tool-calls?message_id={msg}")).await;
    assert_eq!(status, 200);
    assert_eq!(body["total"], json!(0), "cross-user message_id must not match");

    // And the tool name never appears in the other user's body at all.
    assert!(
        !serde_json::to_string(&body).unwrap().contains("secret_tool"),
        "no cross-user row content may leak: {body}"
    );
}

#[tokio::test]
async fn per_page_is_clamped_and_the_filters_still_apply() {
    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "tcl_clamp",
        &["mcp_servers::read"],
    )
    .await;
    let uid = Uuid::parse_str(&user.user_id).unwrap();

    let pool = pool(&server).await;
    let msg = Uuid::new_v4();
    for i in 0..3 {
        insert_call(
            &pool,
            uid,
            &format!("tool_{i}"),
            Some(msg),
            Some(&format!("toolu_{i}")),
        )
        .await;
    }
    pool.close().await;

    // An over-large `per_page` is CLAMPED to the 200 cap (not rejected, and not
    // honoured) — the coding-guidelines §4 bound on an unbounded list.
    let (status, body) = get_json(
        &server,
        &user.token,
        &format!("/mcp/tool-calls?message_id={msg}&per_page=100000"),
    )
    .await;
    assert_eq!(status, 200, "an over-large per_page is clamped, not an error");
    assert_eq!(
        body["per_page"], json!(200),
        "per_page must be clamped to the 200 cap: {body}"
    );
    assert_eq!(body["total"], json!(3), "the filter still applies after clamping");
    assert_eq!(body["calls"].as_array().unwrap().len(), 3);

    // A zero/negative per_page clamps UP to 1 rather than dividing by zero when
    // total_pages is derived.
    let (status, body) = get_json(
        &server,
        &user.token,
        &format!("/mcp/tool-calls?message_id={msg}&per_page=0"),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["per_page"], json!(1));
    assert_eq!(body["total_pages"], json!(3));
    assert_eq!(body["calls"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn lookup_filters_require_mcp_servers_read() {
    let server = crate::common::TestServer::start().await;
    let nobody = crate::common::test_helpers::create_user_with_only_permissions(
        &server,
        "tcl_no_read",
        &["profile::read"],
    )
    .await;

    let (status, body) = get_json(
        &server,
        &nobody.token,
        "/mcp/tool-calls?tool_use_id=toolu_x",
    )
    .await;
    assert_eq!(status, 403, "the filters add no unauthenticated back door");
    assert_eq!(body["error_code"], json!("INSUFFICIENT_PERMISSIONS"));

    // Unauthenticated → 401.
    let res = reqwest::Client::new()
        .get(server.api_url("/mcp/tool-calls?tool_use_id=toolu_x"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 401);
}
