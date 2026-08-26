//! Built-in capability skills: ziee's embedded self-documentation, synced
//! into the `skills` table as `scope='built_in'` rows on server boot. They
//! are always available to every user and NOT uninstallable.

use serde_json::Value as Json;

use crate::common::test_helpers::create_user_with_permissions;
use super::server_with_skill_catalog;

const A_BUILTIN: &str = "io.github.ziee/configure-llm-providers";

/// Poll GET /skills until the boot-synced built-ins show up (the sync is a
/// spawned task on server init), then return the parsed list.
pub async fn wait_for_builtins(server: &crate::common::TestServer, token: &str) -> Vec<Json> {
    for _ in 0..40 {
        let list: Json = reqwest::Client::new()
            .get(server.api_url("/skills"))
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .expect("list")
            .json()
            .await
            .expect("parse");
        let skills = list["skills"].as_array().cloned().unwrap_or_default();
        if skills.iter().any(|s| s["scope"] == "built_in") {
            return skills;
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    panic!("built-in skills never appeared in GET /skills within ~10s");
}

#[tokio::test]
async fn builtin_skills_are_synced_listed_and_not_deletable() {
    let (server, _mock) = server_with_skill_catalog().await;
    let user = create_user_with_permissions(
        &server,
        "builtin_user",
        &["skills::read", "skills::install", "skills::manage"],
    )
    .await;

    let skills = wait_for_builtins(&server, &user.token).await;

    // The capability skill is present as a built_in-scope row.
    let builtin = skills
        .iter()
        .find(|s| s["name"] == A_BUILTIN)
        .unwrap_or_else(|| panic!("built-in {A_BUILTIN} not in list: {skills:?}"));
    assert_eq!(builtin["scope"], "built_in", "scope is built_in: {builtin}");
    assert!(
        builtin["display_name"].as_str().is_some(),
        "built-in has a display_name: {builtin}"
    );
    assert!(
        builtin["description"]
            .as_str()
            .unwrap_or("")
            .to_lowercase()
            .contains("provider"),
        "built-in description carries its frontmatter: {builtin}"
    );

    // TEST-9 — the shipped built-in set, by NAME.
    //
    // This used to be `assert_eq!(builtin_count, 13)`. A bare count fails with
    // an arithmetic mismatch that says nothing about WHICH skill appeared or
    // vanished, and it cannot distinguish "we removed one on purpose" from "one
    // silently failed to sync" — `sync_builtin_skills` warns and continues on a
    // per-skill error, so a broken SKILL.md subtracts from the count exactly
    // like a deliberate removal does.
    //
    // The three names asserted ABSENT below are the paws removals (design items
    // 6 = workflow, 11 = hub). Their absence here is the fresh-install half of
    // INV-3; the upgraded-install half is TEST-8 in `paws_hidden_skills_test.rs`,
    // because on a DB that already synced them this assertion passes while the
    // rows are still live.
    let mut synced: Vec<&str> = skills
        .iter()
        .filter(|s| s["scope"] == "built_in")
        .filter_map(|s| s["name"].as_str())
        .collect();
    synced.sort_unstable();

    let expected = [
        "io.github.ziee/configure-code-sandbox",
        "io.github.ziee/configure-llm-providers",
        "io.github.ziee/configure-mcp-servers",
        "io.github.ziee/create-skill",
        "io.github.ziee/install-samtools-bcftools",
        "io.github.ziee/manage-projects",
        "io.github.ziee/rnaseq-toolkit",
        "io.github.ziee/set-up-memory",
        "io.github.ziee/setup-datascience-env",
        "io.github.ziee/use-assistants",
    ];
    assert_eq!(
        synced, expected,
        "the synced built-in set must be exactly the shipped one"
    );

    for removed in [
        "io.github.ziee/create-workflow",
        "io.github.ziee/troubleshoot-workflow-run",
        "io.github.ziee/hub-installation",
    ] {
        assert!(
            !synced.contains(&removed),
            "{removed} documents a paws-hidden feature and must not ship"
        );
    }

    // Not uninstallable: DELETE /skills/{id} is rejected (not user-scope / owner).
    let id = builtin["id"].as_str().expect("id");
    let status = reqwest::Client::new()
        .delete(server.api_url(&format!("/skills/{id}")))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .expect("delete")
        .status();
    assert!(
        status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::NOT_FOUND,
        "built-in skill must not be user-deletable; got {status}"
    );
}
