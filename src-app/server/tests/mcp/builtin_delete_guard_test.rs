//! Built-in DELETE-guard: route-level coverage.
//!
//! `delete_system_mcp_server_in_tx` (`mcp/repository.rs`) refuses any row with
//! `is_built_in = true`, returning 400 / `BUILT_IN_SERVER`. The handler
//! (`handlers/system.rs::delete_system_server`) checks only the
//! `mcp_servers_admin::delete` permission and calls the repository
//! unconditionally, so the repository IS the entire write boundary — and it had
//! no test exercising it through the route.
//!
//! What existed before was paper coverage:
//!   * `mod.rs::test_update_zero_config_builtin_is_immutable` pins the UPDATE
//!     guard, which is a DIFFERENT guard — it keys on a hardcoded zero-config id
//!     list, not on the `is_built_in` column, and deliberately leaves the
//!     admin-configurable built-ins (control, bio, code_sandbox) editable.
//!   * `code_sandbox/tier2_built_in_protection.rs::deleting_built_in_via_repo_returns_built_in_server_error`
//!     asserts only that `DELETE ... WHERE is_built_in = false` matches zero
//!     rows — a SQL tautology that never reaches the handler — while its own
//!     comment defers the real assertion to "the mcp module's own tests".
//!
//! These are those tests.

use crate::common::test_helpers;
use serde_json::json;

use super::{files_mcp_server_id, wait_for_system_server};

/// Deleting a genuine built-in is refused AND deleting a genuine user-made
/// system server still succeeds. Both legs live in one test on purpose: a guard
/// that refused *everything* would satisfy the rejection leg alone, so the 204
/// leg is what proves the guard discriminates rather than merely blocking.
#[tokio::test]
async fn test_delete_builtin_refused_but_user_made_system_server_still_deletes() {
    let server = crate::common::TestServer::start().await;
    let admin = test_helpers::create_user_with_permissions(
        &server,
        "admin",
        &[
            "mcp_servers_admin::read",
            "mcp_servers_admin::create",
            "mcp_servers_admin::delete",
        ],
    )
    .await;
    let client = reqwest::Client::new();

    // ---- Leg 1: the built-in is refused ------------------------------------
    // `files` is registered unconditionally by the boot upsert, so it is the
    // built-in reliably present in a stock test server.
    let files_id = files_mcp_server_id();
    let before = wait_for_system_server(&server, &admin.token, files_id).await;
    assert_eq!(
        before["is_built_in"], true,
        "precondition: the files row must carry is_built_in; got: {before}"
    );

    let delete_url = server.api_url(&format!("/mcp/system-servers/{}", files_id));
    let response = client
        .delete(&delete_url)
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .expect("Request failed");
    // Read the STATUS before the body. If the guard regresses, the route
    // answers 204 with an EMPTY body, and a `.json()` here would panic with
    // "EOF while parsing a value" — a parse error that says nothing about the
    // actual regression. Asserting the status against the raw text first makes
    // the failure read "expected 400, got 204", which names the defect.
    let status = response.status();
    let raw = response.text().await.expect("Failed to read body");
    assert_eq!(
        status, 400,
        "deleting a built-in must be refused with 400/BUILT_IN_SERVER; got {status} body: {raw:?}"
    );
    let body: serde_json::Value =
        serde_json::from_str(&raw).unwrap_or_else(|e| panic!("body was not JSON ({e}): {raw:?}"));
    assert_eq!(
        body["error_code"], "BUILT_IN_SERVER",
        "built-in delete rejection must carry BUILT_IN_SERVER; got: {body}"
    );

    // The row must SURVIVE. A 400 that still deleted would be worse than no
    // guard at all, because the error message would hide the breakage.
    let get_response = client
        .get(&server.api_url(&format!("/mcp/system-servers/{}", files_id)))
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .expect("Request failed");
    assert_eq!(
        get_response.status(),
        200,
        "the built-in row must still exist after the refused delete"
    );

    // ---- Leg 2: a user-made system server still deletes (204) --------------
    let payload = json!({
        "name": "guard_counterpart_system_server",
        "display_name": "Guard Counterpart",
        "transport_type": "stdio",
        "command": "node",
        "args": ["temp.js"]
    });
    let created: serde_json::Value = client
        .post(&server.api_url("/mcp/system-servers"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&payload)
        .send()
        .await
        .expect("Request failed")
        .json()
        .await
        .expect("Failed to parse JSON");
    let made_id = created["id"].as_str().expect("Should have server ID");
    assert_eq!(
        created["is_built_in"], false,
        "precondition: an admin-created system server is NOT built-in; got: {created}"
    );

    let response = client
        .delete(&server.api_url(&format!("/mcp/system-servers/{}", made_id)))
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .expect("Request failed");
    assert_eq!(
        response.status(),
        204,
        "a genuine user-made system server must still delete"
    );

    let get_response = client
        .get(&server.api_url(&format!("/mcp/system-servers/{}", made_id)))
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .expect("Request failed");
    assert_eq!(
        get_response.status(),
        404,
        "the deleted user-made server must be gone"
    );
}

/// The delete route's permission gate: 401 without a token, 403 with a token
/// lacking `mcp_servers_admin::delete`. Asserted against a USER-MADE row so a
/// pass cannot be manufactured by the built-in guard firing first — against a
/// built-in, a 403 and a 400 are both "refused" and the permission gate would
/// go untested while the test stayed green.
#[tokio::test]
async fn test_delete_system_server_auth_and_permission_gates() {
    let server = crate::common::TestServer::start().await;
    let admin = test_helpers::create_user_with_permissions(
        &server,
        "admin",
        &[
            "mcp_servers_admin::read",
            "mcp_servers_admin::create",
            "mcp_servers_admin::delete",
        ],
    )
    .await;
    // Deliberately WITHOUT `mcp_servers_admin::delete`.
    let reader =
        test_helpers::create_user_with_permissions(&server, "reader", &["mcp_servers_admin::read"])
            .await;
    let client = reqwest::Client::new();

    let payload = json!({
        "name": "perm_gate_system_server",
        "display_name": "Perm Gate",
        "transport_type": "stdio",
        "command": "node",
        "args": ["temp.js"]
    });
    let created: serde_json::Value = client
        .post(&server.api_url("/mcp/system-servers"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&payload)
        .send()
        .await
        .expect("Request failed")
        .json()
        .await
        .expect("Failed to parse JSON");
    let made_id = created["id"].as_str().expect("Should have server ID");
    let delete_url = server.api_url(&format!("/mcp/system-servers/{}", made_id));

    // 401 — no credentials at all.
    let response = client
        .delete(&delete_url)
        .send()
        .await
        .expect("Request failed");
    assert_eq!(
        response.status(),
        401,
        "an unauthenticated delete must be refused with 401"
    );

    // 403 — authenticated but lacking mcp_servers_admin::delete.
    let response = client
        .delete(&delete_url)
        .header("Authorization", format!("Bearer {}", reader.token))
        .send()
        .await
        .expect("Request failed");
    assert_eq!(
        response.status(),
        403,
        "a delete without mcp_servers_admin::delete must be refused with 403"
    );

    // Positive control: the row survived both refusals and the PERMITTED admin
    // can still delete it — so the 401/403 above mean "gated", not "the row was
    // already gone" (which would pass with the permission extractor removed).
    let response = client
        .delete(&delete_url)
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .expect("Request failed");
    assert_eq!(
        response.status(),
        204,
        "the permitted admin must still be able to delete the surviving row"
    );
}
