//! Integration tests for the paws feature-surface reduction
//! (`docs/design/paws-feature-surface.md`).
//!
//! Two acceptance tests (INV-3 and INV-6) plus the migration's observable
//! effects. The UI half of the reduction is proven by the e2e specs in
//! `ui/tests/e2e/17-paws-surface/`; this file covers the server half.

use serde_json::Value;

use crate::common::test_helpers::create_user_with_permissions;
use crate::common::{TestServer, TestServerOptions};

/// Name fragments of the built-in MCP servers the disabled capabilities own. A
/// capability that is genuinely OFF never upserts its row, so the row's ABSENCE
/// from the system-server list is the observable form of "its MCP server is not
/// registered".
const WEB_SEARCH_ROW: &str = "web_search";
const LIT_SEARCH_ROW: &str = "lit_search";
const RUN_JS_ROW: &str = "run_js";

/// The `mcp_servers.name`s of the built-in servers currently registered.
///
/// Read from the DATABASE rather than `/api/mcp/system-servers`: built-in rows
/// are deliberately hidden from that endpoint (they are not operator-editable),
/// so the REST list is empty of them whether the capability is on or off. The
/// first draft of this test asserted against that endpoint and its positive
/// control caught it — the "absent" assertions were passing vacuously.
async fn registered_builtin_names(server: &TestServer) -> Vec<String> {
    let pool = sqlx::PgPool::connect(&server.database_url)
        .await
        .expect("connect to the test database");
    let names: Vec<String> =
        sqlx::query_scalar("SELECT name FROM mcp_servers WHERE is_built_in = true")
            .fetch_all(&pool)
            .await
            .expect("query built-in mcp_servers");
    pool.close().await;
    names
}

// ── TEST-4 [acceptance] [invariant: INV-3] ──────────────────────────────────

/// A disabled capability is genuinely off server-side: its MCP server is not
/// registered, so there is no tool for the model to call.
///
/// The POSITIVE CONTROL is what makes this mean anything. "The row is absent"
/// passes vacuously if the endpoint returned an empty list, the server failed to
/// boot, or the ids simply changed name. So the same assertions run against two
/// servers — one with the capabilities off, one with them on — and the on-server
/// must SHOW the rows the off-server hides.
#[tokio::test]
async fn test_disabled_capabilities_register_no_mcp_server() {
    // ── disabled (the paws shipping posture) ──
    let off = TestServer::start_with_options(TestServerOptions {
        web_search_enabled: Some(false),
        lit_search_enabled: Some(false),
        js_tool_enabled: Some(false),
        voice_enabled: Some(false),
        ..Default::default()
    })
    .await;
    let off_admin = create_user_with_permissions(&off, "paws_off_admin", &["*"]).await;
    let off_names = registered_builtin_names(&off).await;

    for name in [WEB_SEARCH_ROW, LIT_SEARCH_ROW, RUN_JS_ROW] {
        assert!(
            !off_names.iter().any(|n| n == name),
            "{name}: a disabled capability must not register its built-in MCP \
             server, but the row exists. Registered: {off_names:?}"
        );
    }
    // Not an empty table — other built-ins (memory, files, …) are still there,
    // so "absent" means absent, not "nothing was ever registered".
    assert!(
        !off_names.is_empty(),
        "other built-in MCP servers must still register; an empty table would \
         make the assertions above meaningless"
    );

    // voice guards `register_routes` too, so its surface is unmounted entirely
    // rather than merely unregistered.
    let resp = reqwest::Client::new()
        .get(off.api_url("/voice/capability"))
        .header("Authorization", format!("Bearer {}", off_admin.token))
        .send()
        .await
        .expect("voice capability probe");
    assert_eq!(
        resp.status(),
        404,
        "voice disabled must unmount its routes (404), not merely gate them"
    );

    drop(off);

    // ── enabled (the positive control) ──
    let on = TestServer::start_with_options(TestServerOptions {
        web_search_enabled: Some(true),
        lit_search_enabled: Some(true),
        js_tool_enabled: Some(true),
        voice_enabled: Some(true),
        ..Default::default()
    })
    .await;
    let on_admin = create_user_with_permissions(&on, "paws_on_admin", &["*"]).await;
    let on_names = registered_builtin_names(&on).await;

    for name in [WEB_SEARCH_ROW, LIT_SEARCH_ROW, RUN_JS_ROW] {
        assert!(
            on_names.iter().any(|n| n == name),
            "{name}: the positive control must SHOW this built-in when the \
             capability is enabled — otherwise the disabled assertions above \
             prove nothing about the kill switch. Registered: {on_names:?}"
        );
    }

    let resp = reqwest::Client::new()
        .get(on.api_url("/voice/capability"))
        .header("Authorization", format!("Bearer {}", on_admin.token))
        .send()
        .await
        .expect("voice capability probe (enabled)");
    assert_ne!(
        resp.status(),
        404,
        "the positive control must reach a MOUNTED voice route"
    );
}

// ── TEST-6 [acceptance] [invariant: INV-6] ──────────────────────────────────

/// Nothing in this change weakens a permission or auth check.
///
/// The reduction only ever REVOKES grants, so the checks themselves must behave
/// exactly as before: a user holding a permission still succeeds, and an
/// unauthenticated request is still refused.
#[tokio::test]
async fn test_permission_checks_still_behave() {
    let server = TestServer::start_with_options(TestServerOptions::default()).await;
    let client = reqwest::Client::new();

    // POSITIVE CONTROL — a user holding a permission the reduction never touched
    // still succeeds. Without it the negative assertion below would also pass on
    // a server that refused everything.
    let user = create_user_with_permissions(&server, "paws_perm_user", &["*"]).await;
    let resp = client
        .get(server.api_url("/auth/me"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .expect("auth/me");
    assert!(
        resp.status().is_success(),
        "a permitted user must still reach a permitted endpoint"
    );

    // The gate is intact, not merely un-reached.
    let resp = client
        .get(server.api_url("/mcp/system-servers"))
        .send()
        .await
        .expect("unauthenticated system servers");
    assert_eq!(
        resp.status(),
        401,
        "an unauthenticated request must still be refused"
    );
}

// ── TEST-12: the migration's observable effects ─────────────────────────────

/// `file_rag_admin_settings.semantic_enabled` is FALSE on a freshly-migrated
/// database (design item 3).
#[tokio::test]
async fn test_semantic_search_disabled_after_migration() {
    let server = TestServer::start_with_options(TestServerOptions::default()).await;
    let admin = create_user_with_permissions(&server, "paws_rag_admin", &["*"]).await;

    let resp = reqwest::Client::new()
        .get(server.api_url("/file-rag/admin-settings"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .expect("file-rag admin settings");
    assert!(resp.status().is_success(), "admin settings must be readable");

    let body: Value = resp.json().await.expect("settings json");
    assert_eq!(
        body["semantic_enabled"].as_bool(),
        Some(false),
        "semantic search must ship disabled on paws (design item 3)"
    );
    // A default change, not a teardown — the rest of the row is intact.
    assert_eq!(
        body["fts_enabled"].as_bool(),
        Some(true),
        "full-text search must be UNAFFECTED; only the semantic arm is disabled"
    );
}

/// The DEC-4 revokes landed — and took nothing extra with them.
#[tokio::test]
async fn test_hidden_features_grants_revoked_but_notifications_kept() {
    let server = TestServer::start_with_options(TestServerOptions::default()).await;
    let admin = create_user_with_permissions(&server, "paws_grants_admin", &["*"]).await;

    let resp = reqwest::Client::new()
        .get(server.api_url("/groups"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .expect("list groups");
    assert!(resp.status().is_success(), "admin must be able to list groups");
    let blob = resp.text().await.expect("groups body");

    for revoked in [
        "citations::use",
        "citations::manage",
        "knowledge_base::use",
        "knowledge_base::manage",
        "scheduler::use",
        "workflows::read",
        "workflows::execute",
        "hub::assistants::read",
        "hub::mcp_servers::read",
    ] {
        assert!(
            !blob.contains(revoked),
            "{revoked} must be revoked from the default groups (DEC-4)"
        );
    }

    // THE TRAP. `notifications::read` is granted by the SCHEDULER's grant
    // migration, in the same ARRAY[...] as `scheduler::use`. Reversing that
    // migration wholesale — the obvious reading of "undo the scheduler grant" —
    // would take the notification list away from every non-admin user: an INV-2
    // break disguised as a permission cleanup. `notifications` is a SURVIVING
    // module.
    assert!(
        blob.contains("notifications::read"),
        "notifications::read must SURVIVE — it rides in the scheduler grant \
         migration but belongs to a module that is not hidden"
    );
}

// ── TEST-13: the templates mechanism outlives its admin UI ──────────────────

/// Design item 12 removes the assistant-templates admin SURFACE only. The
/// backend concept — the seeded template row and clone-on-signup — is untouched,
/// so a newly created user still receives an assistant.
///
/// Without this, "remove assistant templates" could quietly ship every new user
/// an empty assistant list, which is the failure DEC-2 exists to prevent.
#[tokio::test]
async fn test_clone_on_signup_still_gives_a_new_user_an_assistant() {
    let server = TestServer::start_with_options(TestServerOptions::default()).await;

    // A brand-new user — creation is what triggers the clone handler.
    let user = create_user_with_permissions(&server, "paws_clone_user", &["*"]).await;

    let resp = reqwest::Client::new()
        .get(server.api_url("/assistants"))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .expect("list assistants");
    assert!(
        resp.status().is_success(),
        "a user must be able to list assistants"
    );

    let body: Value = resp.json().await.expect("assistants json");
    let items = body["assistants"]
        .as_array()
        .expect("assistants list shape: expected an `assistants` array");

    assert!(
        !items.is_empty(),
        "a new user must still receive a cloned assistant — the templates ADMIN \
         page was removed, the template MECHANISM was not"
    );
}
