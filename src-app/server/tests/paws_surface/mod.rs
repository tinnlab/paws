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

/// The `mcp_servers.name`s of the built-in servers currently registered, waiting
/// for `await_names` to all appear.
///
/// Read from the DATABASE rather than `/api/mcp/system-servers`: built-in rows
/// are deliberately hidden from that endpoint (they are not operator-editable),
/// so the REST list is empty of them whether the capability is on or off. The
/// first draft of this test asserted against that endpoint and its positive
/// control caught it — the "absent" assertions were passing vacuously.
///
/// Each upsert is an independent fire-and-forget `tokio::spawn` inside its
/// module's `init()`, so querying right after the server reports healthy can lose
/// the race. Waiting for "any row" is NOT enough: `memory`/`files` landing first
/// satisfies that while the rows the caller actually asserts on are still in
/// flight. So the enabled side waits for the SPECIFIC names it is about to check.
///
/// The disabled side passes an empty slice, which waits for ANY row — there are
/// no specific names to wait for there, and it separately asserts the table is
/// non-empty so "absent" cannot mean "nothing registered yet".
async fn registered_builtin_names(server: &TestServer, await_names: &[&str]) -> Vec<String> {
    let pool = sqlx::PgPool::connect(&server.database_url)
        .await
        .expect("connect to the test database");

    let mut names: Vec<String> = Vec::new();
    for _ in 0..50 {
        names = sqlx::query_scalar("SELECT name FROM mcp_servers WHERE is_built_in = true")
            .fetch_all(&pool)
            .await
            .expect("query built-in mcp_servers");
        let settled = if await_names.is_empty() {
            !names.is_empty()
        } else {
            await_names.iter().all(|w| names.iter().any(|n| n == w))
        };
        if settled {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

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
    // Other built-ins (memory, files, …) still register, so wait for the table
    // to populate before concluding these four are absent — otherwise a fast
    // query could "prove" absence simply by arriving first.
    let off_names = registered_builtin_names(&off, &[]).await;

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

    // The MCP JSON-RPC endpoints must be UNMOUNTED, not merely unadvertised.
    //
    // Skipping the `mcp_servers` upsert only stops the model being OFFERED the
    // tools. Each endpoint is gated on a `*::use` permission the Users group
    // HOLDS, and the runtime settings rows default enabled — so while the routes
    // stayed mounted, an ordinary user could still drive live web searches,
    // scholarly queries and arbitrary JS with the deploy switch off. That made
    // "disabled" mean "unadvertised", and falsified the design's own definition
    // ("the server does not register the MCP server / does not serve the route").
    let client = reqwest::Client::new();
    for path in ["/web-search/mcp", "/lit-search/mcp", "/run-js/mcp"] {
        let resp = client
            .post(off.api_url(path))
            .header("Authorization", format!("Bearer {}", off_admin.token))
            .json(&serde_json::json!({
                "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}
            }))
            .send()
            .await
            .unwrap_or_else(|e| panic!("{path} probe: {e}"));
        assert_eq!(
            resp.status(),
            404,
            "{path} must be UNMOUNTED when the capability is disabled (404), not \
             merely gated — a 401/403 would mean the route is still there"
        );
    }

    // voice guards `register_routes` too, so its surface is unmounted entirely
    // rather than merely unregistered.
    let resp = client
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

    // The settings/admin REST for web_search + lit_search STAYS mounted: both
    // are disable-only rows whose admin UI the design keeps visible, so 404ing
    // these would break a page the reduction deliberately leaves in place.
    for path in ["/web-search/settings", "/lit-search/settings"] {
        let resp = client
            .get(off.api_url(path))
            .header("Authorization", format!("Bearer {}", off_admin.token))
            .send()
            .await
            .unwrap_or_else(|e| panic!("{path} probe: {e}"));
        assert_ne!(
            resp.status(),
            404,
            "{path} must remain mounted — its admin page is not hidden"
        );
    }

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
    let on_names = registered_builtin_names(&on, &[WEB_SEARCH_ROW, LIT_SEARCH_ROW, RUN_JS_ROW]).await;

    for name in [WEB_SEARCH_ROW, LIT_SEARCH_ROW, RUN_JS_ROW] {
        assert!(
            on_names.iter().any(|n| n == name),
            "{name}: the positive control must SHOW this built-in when the \
             capability is enabled — otherwise the disabled assertions above \
             prove nothing about the kill switch. Registered: {on_names:?}"
        );
    }

    // POSITIVE CONTROL for the route half: every endpoint the disabled server
    // 404s must be REACHABLE here. Without this, the 404s above would be
    // satisfied by a typo in the path.
    let client = reqwest::Client::new();
    for path in ["/web-search/mcp", "/lit-search/mcp", "/run-js/mcp"] {
        let resp = client
            .post(on.api_url(path))
            .header("Authorization", format!("Bearer {}", on_admin.token))
            .json(&serde_json::json!({
                "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}
            }))
            .send()
            .await
            .unwrap_or_else(|e| panic!("{path} probe (enabled): {e}"));
        assert_ne!(
            resp.status(),
            404,
            "{path} must be MOUNTED when the capability is enabled — otherwise \
             the 404 assertions on the disabled server prove only that the path \
             is wrong"
        );
    }

    let resp = client
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
/// The reduction changes NO grant at all (the revokes it originally carried were
/// withdrawn — see `test_hidden_features_keep_their_grants`), so the checks must
/// behave exactly as before: a user holding a permission still succeeds, and an
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

/// Hidden features keep their Users-group grants — deliberately (DEC-4).
///
/// The design records that hiding is UI-only and "the API remains reachable";
/// revoking those grants was explored and REJECTED because it breaks a surviving
/// surface. The citations built-in attaches its tools to EVERY tool-capable chat
/// with no permission check (`citations/chat_extension/citations.rs`), so
/// removing `citations::use` would leave every ordinary user with a chat that
/// advertises citation tools in a system nudge and 403s on use — an INV-2 break
/// introduced by a "cleanup". Fixing that properly means a server-side kill
/// switch for a UI-only item, which the design puts out of scope.
///
/// This test pins the decision so a future round does not silently re-attempt it.
#[tokio::test]
async fn test_hidden_features_keep_their_grants() {
    let server = TestServer::start_with_options(TestServerOptions::default()).await;
    let admin = create_user_with_permissions(&server, "paws_grants_admin", &["*"]).await;

    let resp = reqwest::Client::new()
        .get(server.api_url("/groups"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .expect("list groups");
    assert!(resp.status().is_success(), "admin must be able to list groups");
    let body: Value = resp.json().await.expect("groups json");

    // EXACT membership of the parsed permission arrays, not a substring search
    // of the raw body. `blob.contains("hub::assistants::read")` is satisfied by
    // `hub::assistants::read_version` — which the SAME migration grants — so a
    // future `array_remove(permissions, 'hub::assistants::read')` would leave
    // this green while the grant it claims to pin was gone.
    let granted: Vec<String> = body["groups"]
        .as_array()
        .expect("groups array")
        .iter()
        .flat_map(|g| {
            g["permissions"]
                .as_array()
                .map(|p| {
                    p.iter()
                        .filter_map(|v| v.as_str().map(str::to_owned))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        })
        .collect();
    assert!(
        !granted.is_empty(),
        "no permissions parsed — the assertions below would be vacuous"
    );

    // EVERY grant the five withdrawn migrations would have removed, not just the
    // two that motivated the withdrawal. A narrower pin would stay green if a
    // later round re-revoked, say, only the hub grants.
    //
    // `citations::use` is the load-bearing one — its backend chat extension
    // attaches unconditionally, so revoking it degrades chat for every non-admin.
    // `notifications::read` rides in the SCHEDULER's grant migration and belongs
    // to a surviving module, so it must survive any future revoke attempt too.
    for kept in [
        "citations::use",
        "citations::manage",
        "knowledge_base::use",
        "knowledge_base::manage",
        "scheduler::use",
        "workflows::read",
        "workflows::execute",
        "hub::assistants::read",
        "hub::mcp_servers::read",
        "notifications::read",
    ] {
        assert!(
            granted.iter().any(|p| p == kept),
            "{kept} must remain granted — hiding a module's UI must not strip a \
             grant its still-running backend depends on"
        );
    }
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
