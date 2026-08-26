//! paws: skills belonging to features paws hides must not reach the model.
//!
//! Realizes `docs/design/paws-ui-polish.md` INV-3 and INV-4, which extend
//! `docs/design/paws-feature-surface.md` into the skill surface.
//!
//! TEST-8  [acceptance] [invariant: INV-3] — the UPGRADED-install case.
//! TEST-10 [acceptance] [invariant: INV-4] — no shipping skill routes the user
//!                                           to a hidden feature.

use serde_json::Value as Json;
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

use super::{admin_and_refresh, server_with_skill_catalog};

/// The three built-ins removed because their SUBJECT is a paws-hidden feature.
const REMOVED: [&str; 3] = [
    "io.github.ziee/create-workflow",
    "io.github.ziee/troubleshoot-workflow-run",
    "io.github.ziee/hub-installation",
];

/// The REAL migration, read at compile time from the file that ships.
///
/// `include_str!` rather than a copy of the SQL: if someone weakens the
/// migration — narrows the name list, drops the `scope` predicate, deletes the
/// file — this test exercises the weakened version and fails, instead of
/// passing against a duplicate that no longer matches what runs on an upgrade.
const PRUNE_MIGRATION: &str = include_str!(
    "../../src/modules/skill/migrations/202607220100_paws_prune_hidden_feature_skills.sql"
);

/// The model-facing listing, through the real endpoint the chat extension's
/// data comes from.
async fn available_skill_names(
    server: &crate::common::TestServer,
    token: &str,
    conversation_id: &str,
) -> Vec<String> {
    let resp = reqwest::Client::new()
        .get(server.api_url(&format!(
            "/skills/available?conversation_id={conversation_id}"
        )))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .expect("available skills");
    let status = resp.status();
    let body: Json = resp.json().await.expect("parse available");
    assert_eq!(status, 200, "available should 200; got {status}: {body}");
    body["skills"]
        .as_array()
        .expect("skills array")
        .iter()
        .filter_map(|s| s["name"].as_str().map(str::to_owned))
        .collect()
}

/// TEST-8 [acceptance] [invariant: INV-3] — an install that ALREADY synced the
/// removed skills stops offering them to the model.
///
/// ## Why this test exists at all, and why the fresh-install assertion is not
/// enough
///
/// `sync_builtin_skills` is insert-or-update ONLY — its single write is an
/// `INSERT … ON CONFLICT (name) … DO UPDATE SET … enabled = TRUE`. There is no
/// prune anywhere in that path. So deleting `resources/builtin-skills/<leaf>/`
/// removes a skill from a FRESH database and changes nothing at all on an
/// upgraded one: the row survives, `enabled = TRUE`, and the gating query
/// admits `scope = 'built_in'` unconditionally — no group, no permission, no
/// per-user opt-out — so it keeps being injected into every tool-capable chat's
/// system prompt forever.
///
/// TEST-9 (in `builtin.rs`) asserts the fresh-install half and WOULD PASS with
/// the migration deleted. This is the half that would not.
///
/// ## How the upgrade state is reached
///
/// The harness hands us a database with every migration already applied, so the
/// pre-migration state has to be reconstructed: insert the three rows as an old
/// build would have left them, then replay the real migration. That is exactly
/// the sequence an upgrading install performs.
#[tokio::test]
async fn removed_builtin_skills_do_not_reach_the_model_after_upgrade() {
    let (server, _mock) = server_with_skill_catalog().await;
    let admin = admin_and_refresh(&server).await;

    // Wait for the boot-time `sync_builtin_skills` task before touching the
    // table. It is a spawned background task, so without this the surviving-
    // built-in assertion at the end races it and fails spuriously on a loaded
    // box — blaming the migration for a scheduling artefact.
    let _ = super::builtin::wait_for_builtins(&server, &admin.token).await;

    let (_stub, model) = crate::chat::helpers::create_stub_model(&server, &admin.user_id).await;
    let conv = crate::chat::helpers::create_conversation(
        &server,
        &admin.token,
        Some(Uuid::parse_str(model["id"].as_str().unwrap()).unwrap()),
        Some("paws hidden skills conv"),
    )
    .await;
    let conv_id = conv["id"].as_str().unwrap().to_string();

    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&server.database_url)
        .await
        .expect("connect to test database");

    // ── Reconstruct the pre-migration state ────────────────────────────────
    // Rows shaped as `upsert_builtin` leaves them. `entry_point` + the NOT NULL
    // columns are filled minimally; the gating query only cares about `scope`,
    // `enabled` and `name`.
    for name in REMOVED {
        // `ON CONFLICT (name)` alone raises 42P10 here: `skills` has NO plain
        // unique index on `name` — only the PARTIAL
        // `uniq_skills_builtin_name … WHERE scope = 'built_in'`
        // (202607140210_skill_schema.sql:72). Postgres cannot infer a partial
        // index without a matching predicate, so the arbiter has to name it.
        sqlx::query(
            "INSERT INTO skills (id, name, display_name, description, version, scope,
                                 owner_user_id, extracted_path, entry_point,
                                 bundle_sha256, bundle_size_bytes, file_count,
                                 enabled, is_dev)
             VALUES ($1, $2, $3, $4, '1.0.0', 'built_in', NULL, $5, 'SKILL.md',
                     'seeded-by-test', 0, 1, TRUE, FALSE)
             ON CONFLICT (name) WHERE scope = 'built_in' DO NOTHING",
        )
        .bind(Uuid::new_v4())
        .bind(name)
        .bind(name.rsplit('/').next().unwrap())
        .bind("a skill for a feature paws hides")
        .bind(format!("/tmp/ziee-test-skills/{}", name.replace('/', "_")))
        .execute(&pool)
        .await
        .unwrap_or_else(|e| panic!("seed pre-migration row {name}: {e}"));
    }

    // Control that makes the assertion below mean something: with the rows
    // present, the model DOES see them. Without this, "absent afterwards" is
    // indistinguishable from "the insert silently failed".
    let before = available_skill_names(&server, &admin.token, &conv_id).await;
    for name in REMOVED {
        assert!(
            before.iter().any(|n| n == name),
            "positive control: a lingering built_in row must reach the model \
             before the migration runs — {name} not in {before:?}"
        );
    }

    // ── Replay the real migration, as an upgrading install does ────────────
    sqlx::raw_sql(PRUNE_MIGRATION)
        .execute(&pool)
        .await
        .expect("run the prune migration");

    let after = available_skill_names(&server, &admin.token, &conv_id).await;
    for name in REMOVED {
        assert!(
            !after.iter().any(|n| n == name),
            "{name} documents a paws-hidden feature and must not reach the \
             model after the upgrade; still listed in {after:?}"
        );
    }

    // The migration must not be a blunt instrument: a surviving built-in is
    // untouched. (`configure-llm-providers` is synced by the same path.)
    assert!(
        after.iter().any(|n| n == "io.github.ziee/configure-llm-providers"),
        "the prune must not remove skills outside its name list: {after:?}"
    );
}

/// TEST-8's companion negative control: the migration is scoped to
/// `scope = 'built_in'`, so a USER-authored skill that happens to carry one of
/// those names is somebody's own content and survives.
///
/// Without this, the migration could be broadened to `WHERE name IN (…)` and
/// every test above would still pass while it silently deleted user data.
#[tokio::test]
async fn the_prune_does_not_touch_user_scope_skills() {
    let (server, _mock) = server_with_skill_catalog().await;
    let admin = admin_and_refresh(&server).await;

    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&server.database_url)
        .await
        .expect("connect to test database");

    let victim = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO skills (id, name, display_name, description, version, scope,
                             owner_user_id, extracted_path, entry_point,
                             bundle_sha256, bundle_size_bytes, file_count,
                             enabled, is_dev)
         VALUES ($1, $2, 'Mine', 'user-authored', '1.0.0', 'user', $3, '/tmp/x', 'SKILL.md',
                 'seeded-by-test', 0, 1, TRUE, FALSE)",
    )
    .bind(victim)
    // A user-scope skill carrying the EXACT name of a pruned built-in.
    //
    // This has to be the exact string, not a `…-user-copy` variant: the
    // migration matches with `name IN (…)`, i.e. exact equality, so a variant
    // name is unmatched whether or not the `scope = 'built_in'` predicate is
    // there — the test would pass against a migration broadened to
    // `WHERE name IN (…)` and would protect nothing. The exact name is legal
    // for a user-scope row because the built-in uniqueness index is PARTIAL
    // (`WHERE scope = 'built_in'`), so the two rows coexist.
    .bind("io.github.ziee/create-workflow")
    // `owner_user_id` is uuid; `admin.user_id` is a String, so bind it parsed.
    .bind(Uuid::parse_str(&admin.user_id).expect("admin user id is a uuid"))
    .execute(&pool)
    .await
    .expect("seed user-scope skill");

    sqlx::raw_sql(PRUNE_MIGRATION)
        .execute(&pool)
        .await
        .expect("run the prune migration");

    let survived: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM skills WHERE id = $1")
            .bind(victim)
            .fetch_one(&pool)
            .await
            .expect("count");
    assert_eq!(
        survived, 1,
        "a user-scope skill must survive the built_in prune"
    );
}

/// TEST-10 [acceptance] [invariant: INV-4] — no skill that ships on paws tells
/// the user to go and use a feature paws hides.
///
/// This asserts on the CONTENT the model is actually given, not on the file
/// list, because INV-4 is a claim about content: a skill can be perfectly valid
/// and still be useless-or-worse if its instructions send the reader to a page
/// that does not exist on this instance.
///
/// Deliberately reads the extracted bodies rather than `resources/` so it
/// covers what `read_skill_file` would serve.
#[tokio::test]
async fn shipping_skills_never_route_the_user_to_a_hidden_feature() {
    let (server, _mock) = server_with_skill_catalog().await;
    let admin = admin_and_refresh(&server).await;

    // Wait for the boot sync, then read each built-in's body through the same
    // endpoint the model's `read_skill_file` goes through.
    let skills = super::builtin::wait_for_builtins(&server, &admin.token).await;
    let builtins: Vec<&Json> = skills.iter().filter(|s| s["scope"] == "built_in").collect();
    assert!(!builtins.is_empty(), "no built-in skills synced");

    // Navigation phrases that route the reader at a hidden surface.
    //
    // Matching on NAVIGATION, not on the bare feature word: "team workflows"
    // and "testing workflows" are ordinary English and must not trip this,
    // whereas "Hub -> MCP Servers" is an instruction to visit a page paws does
    // not have.
    //
    // The list deliberately spans ALL THIRTEEN hidden features, not just the
    // ones this change happened to edit. An earlier version covered only hub +
    // assistant templates — which meant the workflow and web-search content
    // removed by this very change could be re-added and the acceptance test
    // would stay green, i.e. INV-4 narrowed to what was built. Each entry is
    // one row of `docs/design/paws-feature-surface.md`'s item table.
    const FORBIDDEN: &[&str] = &[
        // item 11 — hub
        "hub ->",
        "hub →",
        "publish to hub",
        "install from hub",
        "from the hub",
        // item 12 — assistant templates
        "template assistants",
        // item 6 — workflow
        "workflow_mcp",
        "kind: workflow",
        "-> workflows",
        "→ workflows",
        "/workflows",
        "workflow run",
        "workflow yaml",
        // item 7 — scheduler
        "-> scheduled",
        "→ scheduled",
        "scheduled tasks",
        // item 1 — web search
        "web search",
        "web_search",
        // item 2 — literature
        "lit_search",
        "literature search",
        // item 8 — citations
        "-> citations",
        "→ citations",
        // item 9 — knowledge base
        "knowledge base",
        "knowledge_base",
        // item 10 — document RAG
        "file_rag",
        "document rag",
        // item 4 — voice
        "voice dictation",
        // item 5 — programmatic tools
        "run_js",
        "js_tool",
        // item 3 — semantic search
        "semantic search",
    ];

    for skill in builtins {
        let name = skill["name"].as_str().unwrap_or("<unnamed>");
        let id = skill["id"].as_str().expect("id");
        let resp = reqwest::Client::new()
            .get(server.api_url(&format!("/skills/{id}/body")))
            .header("Authorization", format!("Bearer {}", admin.token))
            .send()
            .await
            .expect("read skill body");
        if !resp.status().is_success() {
            // The body endpoint's own behaviour is covered by skill_mcp_load; a
            // non-200 here is not this test's subject, but it must not silently
            // pass either — an unreadable body would make the loop vacuous.
            panic!("could not read {name}'s SKILL.md body: {}", resp.status());
        }
        let payload: Json = resp.json().await.expect("parse body");
        let body = payload["body"]
            .as_str()
            .unwrap_or_else(|| panic!("{name} body response has no `body`: {payload}"))
            .to_lowercase();
        for phrase in FORBIDDEN {
            assert!(
                !body.contains(phrase),
                "{name} routes the user to a paws-hidden feature (matched {phrase:?})"
            );
        }
    }
}
