//! Integration tests for the built-in control MCP server (`control.ziee.internal`).
//!
//! Tier 2 (DB): boot registration, migration-126 grant.
//! Tier 3 (HTTP/JSON-RPC over the REAL routes): tools surface, the `control::use`
//! gate, the per-user permission VISIBILITY filter (admin sees `User.create`, a
//! limited user does not), and the real loopback round-trip (`invoke_capability`
//! actually creates/does not create a row, with NO mocked authz). Denylist,
//! schema validation, path-param, and kill-switch paths.

mod real_llm_test;
mod stringified_args_test;

use serde_json::{Value, json};
use uuid::Uuid;

use crate::common::TestServer;
use crate::common::TestServerOptions;
use crate::common::test_helpers::{
    create_user_with_no_permissions, create_user_with_only_permissions,
    create_user_with_permissions,
};

/// POST a JSON-RPC request to the control MCP endpoint with a bearer token.
fn jsonrpc(
    server: &TestServer,
    token: &str,
    method: &str,
    params: Value,
) -> reqwest::RequestBuilder {
    reqwest::Client::new()
        .post(server.api_url("/control/mcp"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }))
}

fn control_mcp_server_id() -> Uuid {
    Uuid::new_v5(&Uuid::NAMESPACE_URL, b"control.ziee.internal")
}

async fn pool(server: &TestServer) -> sqlx::PgPool {
    sqlx::PgPool::connect(&server.database_url).await.unwrap()
}

// ── Tier 2: DB ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn builtin_row_registered() {
    let server = TestServer::start().await;
    let pool = pool(&server).await;

    let row = sqlx::query!(
        r#"SELECT name, is_system, is_built_in, enabled, transport_type, url
           FROM mcp_servers WHERE id = $1"#,
        control_mcp_server_id()
    )
    .fetch_optional(&pool)
    .await
    .unwrap()
    .expect("control built-in row must exist after boot");

    assert_eq!(row.name, "control");
    assert!(row.is_system);
    assert!(row.is_built_in);
    assert!(row.enabled);
    assert_eq!(row.transport_type, "http");
    assert!(row.url.unwrap().ends_with("/api/control/mcp"));
}

#[tokio::test]
async fn appears_on_system_mcp_page_and_admin_can_toggle_enabled() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_sysadmin", &["*"]).await;
    let client = reqwest::Client::new();
    let control_id = control_mcp_server_id().to_string();

    // 1. Control appears in the System MCP listing (it's a visible, editable
    //    built-in like bio_mcp — NOT hidden).
    let list: Value = client
        .get(server.api_url("/mcp/system-servers?per_page=100"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let ids: Vec<String> = list["servers"]
        .as_array()
        .expect("servers array")
        .iter()
        .map(|s| s["id"].as_str().unwrap().to_string())
        .collect();
    assert!(
        ids.contains(&control_id),
        "control must be listed on the System MCP page: {ids:?}"
    );

    // 2. Admin toggles it OFF (no longer immutable) → 200.
    let res = client
        .put(server.api_url(&format!("/mcp/system-servers/{control_id}")))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&json!({ "enabled": false }))
        .send()
        .await
        .unwrap();
    assert!(
        res.status().is_success(),
        "admin must be able to toggle control enabled: {}",
        res.status()
    );

    // 3. The row reflects enabled=false (the runtime auto-attach honors this).
    let pool = pool(&server).await;
    let enabled = sqlx::query_scalar!(
        "SELECT enabled FROM mcp_servers WHERE id = $1",
        control_mcp_server_id()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!enabled, "control row must be disabled after the admin toggle");

    // 4. Re-enable round-trips too.
    let res = client
        .put(server.api_url(&format!("/mcp/system-servers/{control_id}")))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&json!({ "enabled": true }))
        .send()
        .await
        .unwrap();
    assert!(res.status().is_success());
}

#[tokio::test]
async fn migration_grants_control_use_to_default_users_group() {
    let server = TestServer::start().await;
    let pool = pool(&server).await;
    let perms = sqlx::query_scalar!(
        r#"SELECT permissions FROM groups
           WHERE name = 'Users' AND is_system = true AND is_default = true"#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        perms.iter().any(|p| p == "control::use"),
        "default Users group must carry control::use (migration 126): {perms:?}"
    );
}

// ── Tier 3: HTTP / JSON-RPC ──────────────────────────────────────────────────

#[tokio::test]
async fn initialize_and_tools_list() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "ctl_init", &["control::use"]).await;

    let init: Value = jsonrpc(&server, &user.token, "initialize", json!({}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(init["result"]["serverInfo"]["name"], "control");

    let list: Value = jsonrpc(&server, &user.token, "tools/list", json!({}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let names: Vec<&str> = list["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert_eq!(names.len(), 3);
    assert!(names.contains(&"list_capabilities"));
    assert!(names.contains(&"describe_capability"));
    assert!(names.contains(&"invoke_capability"));
}

#[tokio::test]
async fn use_permission_gate_returns_403() {
    let server = TestServer::start().await;
    let user = create_user_with_no_permissions(&server, "ctl_noperm").await;
    let res = jsonrpc(&server, &user.token, "tools/list", json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 403);
}

async fn call_tool(server: &TestServer, token: &str, name: &str, args: Value) -> Value {
    jsonrpc(
        server,
        token,
        "tools/call",
        json!({ "name": name, "arguments": args }),
    )
    .send()
    .await
    .unwrap()
    .json()
    .await
    .unwrap()
}

fn structured(result: &Value) -> &Value {
    &result["result"]["structuredContent"]
}

#[tokio::test]
async fn list_capabilities_filters_by_permission() {
    let server = TestServer::start().await;
    // Admin-capable: wildcard grants every op including users::create.
    let admin = create_user_with_permissions(&server, "ctl_admin", &["*"]).await;
    // Limited: ONLY control::use (no default group) → no users::create.
    let limited =
        create_user_with_only_permissions(&server, "ctl_limited", &["control::use"]).await;

    // Scope by query (the realistic path — a broad no-query list is capped).
    let admin_res =
        call_tool(&server, &admin.token, "list_capabilities", json!({ "query": "user" })).await;
    let admin_ops: Vec<String> = structured(&admin_res)["operations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["operation_id"].as_str().unwrap().to_string())
        .collect();
    // User.delete is permission-gated (users::delete) and has no secret body, so
    // it survives the denylist — an admin sees it, a control::use-only user does not.
    assert!(
        admin_ops.iter().any(|o| o == "User.delete"),
        "admin must see User.delete: {admin_ops:?}"
    );

    let limited_res =
        call_tool(&server, &limited.token, "list_capabilities", json!({ "query": "user" })).await;
    let limited_ops: Vec<String> = structured(&limited_res)["operations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["operation_id"].as_str().unwrap().to_string())
        .collect();
    assert!(
        !limited_ops.iter().any(|o| o == "User.delete"),
        "limited user must NOT see User.delete: {limited_ops:?}"
    );
}

#[tokio::test]
async fn secret_bearing_write_is_denied() {
    let server = TestServer::start().await;
    // Even an all-powerful admin cannot drive a secret-bearing write — a password
    // in the body would be persisted into the conversation's tool-call args.
    let admin = create_user_with_permissions(&server, "ctl_secret", &["*"]).await;
    let pool = pool(&server).await;
    let before = sqlx::query_scalar!("SELECT COUNT(*) FROM users")
        .fetch_one(&pool).await.unwrap().unwrap_or(0);
    let res = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({
            "operation_id": "User.create",
            "body": { "username": "x", "email": "x@y.com", "password": "password123" }
        }),
    )
    .await;
    assert!(res["error"].is_object(), "secret-bearing User.create must be denied: {res}");
    let after = sqlx::query_scalar!("SELECT COUNT(*) FROM users")
        .fetch_one(&pool).await.unwrap().unwrap_or(0);
    assert_eq!(before, after, "no user created");
}

#[tokio::test]
async fn describe_refuses_unpermitted_without_leaking_schema() {
    let server = TestServer::start().await;
    let limited =
        create_user_with_only_permissions(&server, "ctl_desc", &["control::use"]).await;
    let res = call_tool(
        &server,
        &limited.token,
        "describe_capability",
        json!({ "operation_id": "User.create" }),
    )
    .await;
    assert!(
        res["error"].is_object(),
        "expected in-band not-permitted error, got {res}"
    );
    assert!(res["result"].is_null());
}

#[tokio::test]
async fn invoke_create_assistant_real_roundtrip() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_mk", &["*"]).await;
    let name = format!("ControlMade-{}", &Uuid::new_v4().to_string()[..8]);

    let res = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({
            "operation_id": "Assistant.create",
            "body": { "name": name }
        }),
    )
    .await;

    let sc = structured(&res);
    assert!(
        sc["ok"].as_bool().unwrap_or(false),
        "invoke should succeed, got {res}"
    );

    // Assert via the REAL DB that the assistant exists (no mocked authz).
    let pool = pool(&server).await;
    let count = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM assistants WHERE name = $1",
        name
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .unwrap_or(0);
    assert_eq!(count, 1, "assistant '{name}' must exist after invoke");
}

#[tokio::test]
async fn invoke_privileged_write_denied_for_limited_user_no_row() {
    let server = TestServer::start().await;
    let limited =
        create_user_with_only_permissions(&server, "ctl_deny", &["control::use"]).await;
    let pool = pool(&server).await;
    let before = sqlx::query_scalar!("SELECT COUNT(*) FROM groups")
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap_or(0);

    // A control::use-only user lacks groups::create → pre-dispatch permission
    // refusal, and the row is never created.
    let res = call_tool(
        &server,
        &limited.token,
        "invoke_capability",
        json!({
            "operation_id": "UserGroup.create",
            "body": { "name": "sneaky", "permissions": ["*"] }
        }),
    )
    .await;
    assert!(res["error"].is_object(), "expected not-permitted error, got {res}");

    let after = sqlx::query_scalar!("SELECT COUNT(*) FROM groups")
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap_or(0);
    assert_eq!(before, after, "no group may be created by an unpermitted invoke");
}

#[tokio::test]
async fn invoke_denied_operation_is_refused() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_denyop", &["*"]).await;
    // A denylisted op (control recursion) must never dispatch, even for admin.
    let res = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({ "operation_id": "Auth.login", "body": {} }),
    )
    .await;
    assert!(
        res["error"].is_object(),
        "denylisted/unknown op must be refused, got {res}"
    );
}

#[tokio::test]
async fn invoke_unknown_operation_is_refused() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_unknown", &["*"]).await;
    let res = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({ "operation_id": "Definitely.NotReal" }),
    )
    .await;
    assert!(res["error"].is_object());
}

#[tokio::test]
async fn invoke_upstream_error_relayed() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_upstream", &["*"]).await;
    // GET a user by a bogus (but well-formed) UUID → the real route returns 404,
    // which must be relayed to the model as a structured error (not a panic, not
    // a 200). The dot in a UUID is fine — hyphens/alnum only, passes path safety.
    let res = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({
            "operation_id": "User.get",
            "path_params": { "user_id": Uuid::new_v4().to_string() }
        }),
    )
    .await;
    assert!(res["error"].is_null(), "op must resolve + dispatch, not refuse: {res}");
    let sc = structured(&res);
    assert_eq!(sc["ok"], json!(false), "a bogus id lookup must not be ok: {res}");
    assert_eq!(sc["status"], json!(404), "the upstream 404 must be relayed: {res}");
}

#[tokio::test]
async fn unauthenticated_returns_401() {
    let server = TestServer::start().await;
    // No Authorization header at all → the RequirePermissions gate rejects 401.
    let res = reqwest::Client::new()
        .post(server.api_url("/control/mcp"))
        .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 401);
}

#[tokio::test]
async fn describe_permitted_returns_schema_and_approval_flag() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_desc_ok", &["*"]).await;
    let res = call_tool(
        &server,
        &admin.token,
        "describe_capability",
        json!({ "operation_id": "Assistant.create" }),
    )
    .await;
    let sc = structured(&res);
    assert_eq!(sc["operation_id"], "Assistant.create");
    assert_eq!(sc["method"], "POST");
    // A mutating op must advertise that it needs approval.
    assert_eq!(sc["requires_approval"], json!(true));
    assert!(sc["request_schema"].is_object(), "schema must be returned: {res}");
}

#[tokio::test]
async fn invoke_invalid_body_rejected_before_dispatch() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_badbody", &["*"]).await;
    let pool = pool(&server).await;
    let before = sqlx::query_scalar!("SELECT COUNT(*) FROM groups")
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap_or(0);
    // UserGroup.create requires `name` — omit it → INVALID_BODY, no dispatch.
    let res = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({
            "operation_id": "UserGroup.create",
            "body": { "permissions": [] }
        }),
    )
    .await;
    assert!(res["error"].is_object(), "expected INVALID_BODY error, got {res}");
    let after = sqlx::query_scalar!("SELECT COUNT(*) FROM groups")
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap_or(0);
    assert_eq!(before, after, "invalid body must not create a group");
}

#[tokio::test]
async fn invoke_path_param_roundtrip_and_traversal_reject() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_pp", &["*"]).await;
    let pool = pool(&server).await;

    // Create an assistant, capture its id.
    let orig = format!("PP-{}", &Uuid::new_v4().to_string()[..8]);
    let created = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({ "operation_id": "Assistant.create", "body": { "name": orig } }),
    )
    .await;
    let id = structured(&created)["response"]["id"]
        .as_str()
        .expect("created assistant id")
        .to_string();

    // Rename via a path-param op (PUT /api/assistants/{id}).
    let renamed = format!("PP2-{}", &Uuid::new_v4().to_string()[..8]);
    let upd = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({
            "operation_id": "Assistant.update",
            "path_params": { "id": id },
            "body": { "name": renamed }
        }),
    )
    .await;
    assert!(structured(&upd)["ok"].as_bool().unwrap_or(false), "update should succeed: {upd}");
    let db_name = sqlx::query_scalar!(
        "SELECT name FROM assistants WHERE id = $1::uuid",
        Uuid::parse_str(&id).unwrap()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(db_name, renamed, "path-param update must rename the row");

    // A dot-segment path param must be rejected BEFORE dispatch (H1).
    let bad = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({ "operation_id": "Assistant.get", "path_params": { "id": ".." } }),
    )
    .await;
    assert!(bad["error"].is_object(), "traversal path param must be refused: {bad}");
}

#[tokio::test]
async fn denylist_vs_allow_contrast() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_contrast", &["*"]).await;
    // Denylisted (auth token flow) → refused even for an all-powerful admin.
    let denied = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({ "operation_id": "Auth.login", "body": {} }),
    )
    .await;
    assert!(denied["error"].is_object(), "Auth.login must be denylisted: {denied}");
    // A structurally-similar, non-denied op IS reachable for the same admin —
    // proving the refusal above is the denylist, not a blanket block.
    let allowed = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({ "operation_id": "Assistant.create", "body": { "name": format!("OK-{}", &Uuid::new_v4().to_string()[..8]) } }),
    )
    .await;
    assert!(allowed["error"].is_null(), "Assistant.create must be allowed: {allowed}");
    assert!(structured(&allowed)["ok"].as_bool().unwrap_or(false));
}

#[tokio::test]
async fn migration_grant_not_duplicated() {
    let server = TestServer::start().await;
    let pool = pool(&server).await;
    let perms = sqlx::query_scalar!(
        r#"SELECT permissions FROM groups
           WHERE name = 'Users' AND is_system = true AND is_default = true"#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let n = perms.iter().filter(|p| *p == "control::use").count();
    assert_eq!(n, 1, "control::use must appear exactly once (idempotent grant)");
}

#[tokio::test]
async fn list_reports_total_and_truncation() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_trunc", &["*"]).await;
    // No query → the full permitted set, which exceeds the 200 cap for an admin.
    let res = call_tool(&server, &admin.token, "list_capabilities", json!({})).await;
    let sc = structured(&res);
    let returned = sc["returned"].as_u64().unwrap();
    let total = sc["total"].as_u64().unwrap();
    assert!(returned <= 200, "returned must be capped at 200, got {returned}");
    assert!(total > 200, "an admin sees >200 ops, got {total}");
    assert_eq!(sc["truncated"], json!(true));
}

#[tokio::test]
async fn kill_switch_removes_surface() {
    let server = TestServer::start_with_options(TestServerOptions {
        control_mcp_enabled: Some(false),
        ..Default::default()
    })
    .await;
    let pool = pool(&server).await;
    // Row not upserted when disabled.
    let exists = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM mcp_servers WHERE id = $1",
        control_mcp_server_id()
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .unwrap_or(0);
    assert_eq!(exists, 0, "control row must be absent when kill-switch is off");

    // Route not registered → 404 (a user with control::use still can't reach it).
    let user = create_user_with_permissions(&server, "ctl_off", &["control::use"]).await;
    let res = jsonrpc(&server, &user.token, "tools/list", json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 404);
}

/// TEST-4 — the live-session regression, through the REAL JSON-RPC surface
/// against the REAL catalog (300+ operations built from the finished OpenAPI
/// document), not a fixture.
///
/// A user asked "create a new project please"; the model sent
/// `list_capabilities{query:"create project"}` and the shipped whole-phrase
/// matcher returned **0 operations**, after which it flailed. The multi-word
/// query must match, and the operation the phrase names must come FIRST.
#[tokio::test]
async fn multi_word_query_finds_and_ranks_the_named_operation() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_search", &["*"]).await;

    let ops_for = |res: &Value| -> Vec<String> {
        structured(res)["operations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o["operation_id"].as_str().unwrap().to_string())
            .collect()
    };

    let res =
        call_tool(&server, &admin.token, "list_capabilities", json!({ "query": "create project" }))
            .await;
    let total = structured(&res)["total"].as_u64().unwrap();
    let ops = ops_for(&res);
    assert!(total > 0, "'create project' must match at least one operation (got {total})");
    assert_eq!(
        ops.first().map(String::as_str),
        Some("Project.create"),
        "'create project' must rank Project.create first; got {ops:?}"
    );

    // The same phrasing a model reaches for, for a different entity.
    let res = call_tool(
        &server,
        &admin.token,
        "list_capabilities",
        json!({ "query": "create assistant" }),
    )
    .await;
    let ops = ops_for(&res);
    assert_eq!(
        ops.first().map(String::as_str),
        Some("Assistant.create"),
        "'create assistant' must rank Assistant.create first; got {ops:?}"
    );

    // Single-term behavior is unchanged (the counts the live session saw).
    for term in ["project", "create"] {
        let res =
            call_tool(&server, &admin.token, "list_capabilities", json!({ "query": term })).await;
        assert!(
            structured(&res)["total"].as_u64().unwrap() > 0,
            "single-term '{term}' must still match"
        );
    }

    // A query in which NOTHING is known still returns nothing — dropping
    // vocabulary-absent terms must never degenerate into "list the catalog".
    for q in ["zzzznotathing", "zzzznotathing qqqnope"] {
        let res =
            call_tool(&server, &admin.token, "list_capabilities", json!({ "query": q })).await;
        assert_eq!(
            structured(&res)["total"].as_u64().unwrap(),
            0,
            "a query with no known terms must return nothing, got {q:?}"
        );
    }

    // …but a filler noun the catalog has never heard of must not VETO a query
    // that otherwise names its operation exactly (the e2e prompts say
    // 'called "Foo"' / 'named "Bar"').
    for q in ["create a new project called Foo", "create a project named Zaphod"] {
        let res =
            call_tool(&server, &admin.token, "list_capabilities", json!({ "query": q })).await;
        let ops = ops_for(&res);
        assert_eq!(
            ops.first().map(String::as_str),
            Some("Project.create"),
            "query {q:?} must still rank Project.create first; got {ops:?}"
        );
    }

    // The operation the phrase NAMES must beat an alphabetically-luckier
    // near-miss: a pure operation_id tie-break put LitSearch.deleteUserKey above
    // User.delete for "delete user", offering the model a destructive near-miss.
    let res =
        call_tool(&server, &admin.token, "list_capabilities", json!({ "query": "delete user" }))
            .await;
    let ops = ops_for(&res);
    assert_eq!(
        ops.first().map(String::as_str),
        Some("User.delete"),
        "'delete user' must rank User.delete first; got {ops:?}"
    );

    // …and the model is TOLD why, so a retry is informed rather than random.
    let res = call_tool(
        &server,
        &admin.token,
        "list_capabilities",
        json!({ "query": "zzzznotathing" }),
    )
    .await;
    let text = res["result"]["content"][0]["text"].as_str().unwrap_or_default();
    assert!(
        text.contains("EVERY search term must match"),
        "a zero-result list must explain the all-terms rule, got: {text}"
    );

    // A natural SENTENCE still finds the operation: punctuation and closed-class
    // words are stripped query-side, so "please"/"a"/"for me" cannot empty it.
    for q in ["please create a new project for me", "can you create a project?"] {
        let res =
            call_tool(&server, &admin.token, "list_capabilities", json!({ "query": q })).await;
        let ops = ops_for(&res);
        assert_eq!(
            ops.first().map(String::as_str),
            Some("Project.create"),
            "query {q:?} must rank Project.create first; got {ops:?}"
        );
    }

    // The regression the round-2 audit found on the REAL catalog: a filler word
    // used to substring-match an unrelated id, so "delete a project" strictly
    // matched exactly ONE operation — `Citations.delete` — and the model was
    // handed a confident, wrong, DESTRUCTIVE candidate. Stopword filtering plus
    // the minimum substring length must put the named operation first.
    for (q, expected) in [
        ("delete a project", "Project.delete"),
        ("delete the project", "Project.delete"),
        ("update a project", "Project.update"),
    ] {
        let res =
            call_tool(&server, &admin.token, "list_capabilities", json!({ "query": q })).await;
        let ops = ops_for(&res);
        assert_eq!(
            ops.first().map(String::as_str),
            Some(expected),
            "query {q:?} must rank {expected} first; got {ops:?}"
        );
    }

    // A hyphenated term must be split like the corpus, not kept whole.
    let res = call_tool(
        &server,
        &admin.token,
        "list_capabilities",
        json!({ "query": "update mcp-settings" }),
    )
    .await;
    let ops = ops_for(&res);
    assert!(
        !ops.is_empty() && ops.iter().any(|id| id.ends_with("updateMcpSettings")),
        "a hyphenated term must be split like the corpus; got {ops:?}"
    );

    // A multi-term query must be NARROWER than its broadest single term.
    let strict = call_tool(
        &server,
        &admin.token,
        "list_capabilities",
        json!({ "query": "create project" }),
    )
    .await;
    let broad =
        call_tool(&server, &admin.token, "list_capabilities", json!({ "query": "project" })).await;
    assert!(
        structured(&strict)["total"].as_u64().unwrap()
            < structured(&broad)["total"].as_u64().unwrap(),
        "a multi-term query must narrow, not widen"
    );
}

// ── describe_capability: a self-contained contract (INV-1) + the real
//    required_permission (INV-4) ────────────────────────────────────────────
//
// The live defect: `describe_capability` for `Project.create` returned
//   { "request_schema": { "$ref": "#/components/schemas/CreateProjectRequest" },
//     "required_permission": null, … }
// The model cannot dereference `#/components/…` (that document is in-process),
// so it could not see a single field name; and the permission was silently lost
// because a hand-written `.description()` overwrote the one `with_permission`
// had put in the operation description.

/// The whole tool result (text + structuredContent) as one string — the payload
/// the model actually receives.
fn result_text(res: &Value) -> String {
    res["result"]["content"][0]["text"]
        .as_str()
        .unwrap_or_default()
        .to_string()
}

/// TEST-20 — the reported defect, fixed: the real fields of
/// `CreateProjectRequest` are visible and no `$ref` survives anywhere.
#[tokio::test]
async fn describe_inlines_the_request_schema_no_ref_survives() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_inline", &["*"]).await;
    let res = call_tool(
        &server,
        &admin.token,
        "describe_capability",
        json!({ "operation_id": "Project.create" }),
    )
    .await;

    let sc = structured(&res);
    let schema = &sc["request_schema"];
    assert!(schema.is_object(), "a schema must be returned: {res}");

    // The REAL field of CreateProjectRequest — this is what the model needs and
    // what a bare `$ref` withheld.
    assert!(
        schema["properties"].get("name").is_some(),
        "the inlined schema must expose the real `name` field: {schema}"
    );
    assert_eq!(schema["properties"]["name"]["type"], "string");

    // Nothing anywhere in the payload may still point at the components
    // document, and for this (acyclic, small) operation nothing needs `$defs`
    // either — so the string `$ref` must not occur at all.
    let whole = serde_json::to_string(&res).unwrap();
    assert!(
        !whole.contains("#/components/"),
        "no component pointer may reach the model: {whole}"
    );
    assert!(
        !whole.contains("\"$ref\""),
        "Project.create is acyclic and small — it must inline completely: {whole}"
    );

    // The text channel is a readable digest, not a JSON dump of the structure.
    let text = result_text(&res);
    assert!(text.contains("Request body fields:"), "digest expected: {text}");
    // `CreateProjectRequest` declares no JSON-Schema `required` array (serde
    // supplies the default) but constrains `name` with `minLength: 1` — so the
    // digest must surface the CONSTRAINT, or the model reads `default=""` and
    // concludes the field is optional.
    assert!(
        text.contains("- name (string) len 1..255"),
        "the digest must carry `name` with its length constraint: {text}"
    );
    assert!(
        text.contains("JSON Schema (exact"),
        "the exact schema must accompany the digest: {text}"
    );
}

/// TEST-21 (acceptance, INV-1) — the invariant across a broad slice of the LIVE
/// catalog, not one hand-picked operation: no described payload may carry a
/// `#/components/` pointer, and the slice really does contain many operations
/// with a request body (so this cannot pass vacuously).
#[tokio::test]
async fn describe_is_self_contained_across_the_catalog() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_sweep", &["*"]).await;

    // Union an unfiltered page with several topic queries to reach well past the
    // single-call cap.
    let mut ids: std::collections::BTreeSet<String> = Default::default();
    let mut queries: Vec<Value> = vec![json!({})];
    for q in [
        "create", "update", "delete", "settings", "project", "assistant", "mcp", "model",
        "workflow", "user", "file", "memory", "conversation", "provider",
    ] {
        queries.push(json!({ "query": q }));
    }
    for args in queries {
        let res = call_tool(&server, &admin.token, "list_capabilities", args).await;
        for op in structured(&res)["operations"].as_array().unwrap_or(&vec![]) {
            if let Some(id) = op["operation_id"].as_str() {
                ids.insert(id.to_string());
            }
        }
    }
    assert!(
        ids.len() >= 250,
        "the sweep must cover a broad slice of the catalog, got {}",
        ids.len()
    );

    let mut with_body = 0usize;
    for id in &ids {
        let res = call_tool(
            &server,
            &admin.token,
            "describe_capability",
            json!({ "operation_id": id }),
        )
        .await;
        let sc = structured(&res);
        if sc["request_schema"].is_object() {
            with_body += 1;
        }
        let whole = serde_json::to_string(&res).unwrap();
        assert!(
            !whole.contains("#/components/"),
            "{id}: a component pointer reached the model: {whole}"
        );
    }
    assert!(
        with_body >= 40,
        "the sweep must include many body-carrying operations or it proves \
         nothing, got {with_body} of {}",
        ids.len()
    );
}

/// TEST-22 — the transformation is reported, not hidden. On the shipped spec
/// every operation inlines completely, which is exactly why the degradation
/// paths are provable only by the unit fixtures.
#[tokio::test]
async fn describe_reports_schema_form_and_truncation() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_form", &["*"]).await;

    for id in ["Project.create", "Assistant.create", "LlmModel.create"] {
        let res = call_tool(
            &server,
            &admin.token,
            "describe_capability",
            json!({ "operation_id": id }),
        )
        .await;
        let sc = structured(&res);
        assert_eq!(sc["schema_form"], json!("inline"), "{id}: {res}");
        assert_eq!(sc["schema_truncated"], json!(false), "{id}: {res}");
    }

    // An operation with no JSON body reports null for both rather than lying.
    let res = call_tool(
        &server,
        &admin.token,
        "describe_capability",
        json!({ "operation_id": "Project.list" }),
    )
    .await;
    let sc = structured(&res);
    assert!(sc["request_schema"].is_null(), "{res}");
    assert!(sc["schema_form"].is_null(), "{res}");
}

/// TEST-23 (acceptance, INV-4) — `Project.create` reported
/// `required_permission: null` to the model even though it is gated on
/// `projects::create`. It is non-null only if the permission is read from a
/// source a hand-written `.description()` cannot overwrite.
#[tokio::test]
async fn describe_reports_the_real_required_permission() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_perm", &["*"]).await;
    let res = call_tool(
        &server,
        &admin.token,
        "describe_capability",
        json!({ "operation_id": "Project.create" }),
    )
    .await;
    let sc = structured(&res);
    assert_eq!(
        sc["required_permission"], json!("projects::create"),
        "Project.create must advertise the permission its route enforces: {res}"
    );
    assert!(
        result_text(&res).contains("Required permission: projects::create"),
        "the digest must state it too: {}",
        result_text(&res)
    );

    // Not a one-off: another operation whose description was likewise replaced.
    let res2 = call_tool(
        &server,
        &admin.token,
        "describe_capability",
        json!({ "operation_id": "Project.update" }),
    )
    .await;
    assert_eq!(
        structured(&res2)["required_permission"], json!("projects::edit"),
        "{res2}"
    );
}

/// TEST-24 — and the restored permission actually GATES. Without this, TEST-23
/// only proves a string reached the payload: a user holding nothing but
/// `control::use` must neither see nor be able to describe `Project.create`,
/// while an admin can do both.
#[tokio::test]
async fn restored_permission_actually_filters_a_limited_user() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_gate_admin", &["*"]).await;
    let limited =
        create_user_with_only_permissions(&server, "ctl_gate_ltd", &["control::use"]).await;

    async fn project_ops(server: &TestServer, token: &str) -> Vec<String> {
        let res = call_tool(server, token, "list_capabilities", json!({ "query": "project" })).await;
        structured(&res)["operations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| o["operation_id"].as_str().unwrap().to_string())
            .collect()
    }

    let admin_ops = project_ops(&server, &admin.token).await;
    assert!(
        admin_ops.iter().any(|o| o == "Project.create"),
        "admin must see Project.create: {admin_ops:?}"
    );

    let limited_ops = project_ops(&server, &limited.token).await;
    assert!(
        !limited_ops.iter().any(|o| o == "Project.create"),
        "a control::use-only user must NOT see Project.create — before the fix its \
         permission was null, so the filter let it through: {limited_ops:?}"
    );

    let res = call_tool(
        &server,
        &limited.token,
        "describe_capability",
        json!({ "operation_id": "Project.create" }),
    )
    .await;
    assert!(
        res["error"].is_object(),
        "describing an unpermitted operation must be refused: {res}"
    );
}

/// TEST-26 — the catalog-wide invariant behind INV-4, which the per-operation
/// tests above cannot express: **no operation the spec declares a permission for
/// may report `required_permission: null`.**
///
/// This is the test that would have caught the residual class. The first fix
/// read the permission out of the 403 example, which closed the
/// `.description("…")` clobber — but a handler that attaches its OWN
/// `.response_with::<403, …>` replaces that response wholesale and takes the
/// example with it, leaving 18 genuinely-gated operations (Skill.delete,
/// Workflow.update, McpServerToolApprovals.set, …) still reporting null, and
/// `user_may_run` reads null as "anyone may run it". Every per-operation test
/// stayed green throughout. This one does not.
#[tokio::test]
async fn every_permission_gated_operation_reports_its_permission() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_permsweep", &["*"]).await;

    // Sweep broadly (the same union the schema sweep uses — `list_capabilities`
    // caps a single call well below the catalog size).
    let mut ids: std::collections::BTreeSet<String> = Default::default();
    let mut queries: Vec<Value> = vec![json!({})];
    for q in [
        "create", "update", "delete", "settings", "project", "assistant", "mcp", "model",
        "workflow", "user", "file", "memory", "conversation", "provider", "skill", "hub",
    ] {
        queries.push(json!({ "query": q }));
    }
    for args in queries {
        let res = call_tool(&server, &admin.token, "list_capabilities", args).await;
        for op in structured(&res)["operations"].as_array().unwrap_or(&vec![]) {
            if let Some(id) = op["operation_id"].as_str() {
                ids.insert(id.to_string());
            }
        }
    }
    assert!(ids.len() >= 250, "sweep too narrow: {}", ids.len());

    // The routes that genuinely require NO permission: unauthenticated auth /
    // first-run setup / health / liveness, plus the local-LLM proxy and the
    // token-bearing download, which carry their own credential rather than a
    // permission. Anything NOT on this list that reports null is a regression —
    // either a route lost its declaration or a new unauthenticated route was
    // added without being considered here.
    const GENUINELY_PUBLIC: &[&str] = &[
        "Auth.register",
        "Auth.login",
        "Auth.refresh",
        "Auth.logout",
        "Auth.me",
        "Auth.listProviders",
        "Auth.linkAccount",
        "App.getSetupStatus",
        "App.setupAdmin",
        "Health.check",
        "Onboarding.getProgress",
        "Hub.getInstalled",
        "File.downloadWithToken",
        "LocalLlmProxy.chatCompletions",
        "LocalLlmProxy.embeddings",
        "LocalLlmProxy.rerank",
        "LocalLlmProxy.listModels",
    ];

    let mut unexplained = Vec::new();
    for id in &ids {
        let res = call_tool(
            &server,
            &admin.token,
            "describe_capability",
            json!({ "operation_id": id }),
        )
        .await;
        let sc = structured(&res);
        if sc["required_permission"].is_null() && !GENUINELY_PUBLIC.contains(&id.as_str()) {
            unexplained.push(id.clone());
        }
    }
    assert!(
        unexplained.is_empty(),
        "these operations report no required permission, so the per-user filter \
         offers them to EVERY user: {unexplained:?}"
    );
}

/// TEST-27 — an ALL-of operation advertises EVERY permission it requires, and
/// the filter demands all of them. Reporting only the first under-gates: a user
/// holding one of the pair is offered an operation the real route refuses, and
/// is shown a contract that is incomplete.
#[tokio::test]
async fn multi_permission_operation_reports_and_requires_all() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_multi", &["*"]).await;
    let res = call_tool(
        &server,
        &admin.token,
        "describe_capability",
        // Declares BOTH projects::create and projects::read.
        json!({ "operation_id": "Project.duplicate" }),
    )
    .await;
    let sc = structured(&res);
    let perms: Vec<String> = sc["required_permissions"]
        .as_array()
        .expect("required_permissions array")
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    assert!(
        perms.len() >= 2 && perms.contains(&"projects::create".to_string())
            && perms.contains(&"projects::read".to_string()),
        "Project.duplicate must advertise BOTH permissions, got {perms:?}"
    );

    // Holding only ONE of them is not enough to be offered the operation.
    let partial = create_user_with_only_permissions(
        &server,
        "ctl_multi_partial",
        &["control::use", "projects::read"],
    )
    .await;
    let res = call_tool(
        &server,
        &partial.token,
        "describe_capability",
        json!({ "operation_id": "Project.duplicate" }),
    )
    .await;
    assert!(
        res["error"].is_object(),
        "holding one permission of an ALL-of pair must not unlock the operation: {res}"
    );
    assert!(res["result"].is_null(), "and nothing may leak alongside the error: {res}");
}
