//! The seeded ANONYMOUS repository row the default local model installs from.
//!
//! Covers TEST-1 (acceptance, INV-5) and TEST-2 of the
//! `default-model-onboarding` feature.

use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

use crate::common::TestServer;

/// Deterministic id from `202607210100_llm_repository_default_model_seed.sql`.
const DEFAULT_MODEL_REPOSITORY_ID: &str = "b3f1c5d2-7a48-4e91-9c26-5d0e8f3a1b74";
/// ORG-SCOPED — the bare origin is taken by the credentialed built-in row, which
/// `UNIQUE (url)` makes unshareable.
const DEFAULT_MODEL_REPOSITORY_URL: &str = "https://huggingface.co/unsloth";

async fn connect(server: &TestServer) -> sqlx::PgPool {
    PgPoolOptions::new()
        .max_connections(2)
        .connect(&server.database_url)
        .await
        .expect("connect to the spawned server's DB")
}

/// TEST-1 (acceptance, INV-5) — "The default-model repository row is built-in
/// and enabled by default, so a fresh install has it with no admin action."
///
/// Asserted on a REAL freshly-migrated database after a real boot, with no
/// admin action of any kind in between, because that is exactly what the
/// invariant claims. Every clause is checked separately so a failure names
/// which promise broke.
#[tokio::test]
async fn test_1_default_model_repository_is_seeded_built_in_enabled_and_anonymous() {
    let server = TestServer::start().await;
    let pool = connect(&server).await;

    let id = Uuid::parse_str(DEFAULT_MODEL_REPOSITORY_ID).expect("valid fixture uuid");
    let row = sqlx::query!(
        "SELECT name, url, auth_type, auth_config, enabled, built_in \
         FROM llm_repositories WHERE id = $1",
        id
    )
    .fetch_optional(&pool)
    .await
    .expect("query the seeded repository")
    .expect("the default-model repository row exists on a fresh install");

    assert!(
        row.built_in,
        "INV-5: the default-model repository must be built_in"
    );
    assert!(
        row.enabled,
        "INV-5: the default-model repository must be ENABLED by default — a row an \
         admin has to switch on is not 'no admin action'"
    );
    assert_eq!(
        row.auth_type, "none",
        "INV-1: installing must need no credential, so the row's auth_type is 'none'"
    );
    assert_eq!(
        row.url, DEFAULT_MODEL_REPOSITORY_URL,
        "the seeded URL is the org-scoped base the model's repository_path is joined onto"
    );

    // "No credential" must be true of the STORED CONFIG too, not just the type:
    // a row carrying a token would still be a credentialed row.
    let auth_config = row.auth_config.unwrap_or_else(|| serde_json::json!({}));
    for secret in ["api_key", "token", "username", "password"] {
        let held = auth_config.get(secret).and_then(|v| v.as_str());
        assert!(
            held.is_none_or(str::is_empty),
            "INV-1: the seeded auth_config must hold no {secret}; got {held:?}"
        );
    }

    // Nothing is encrypted either — anonymous means no secret is stored at all.
    let encrypted: Option<Vec<u8>> = sqlx::query_scalar!(
        "SELECT auth_config_encrypted FROM llm_repositories WHERE id = $1",
        id
    )
    .fetch_one(&pool)
    .await
    .expect("read auth_config_encrypted");
    assert!(
        encrypted.is_none(),
        "INV-1: an anonymous repository stores no encrypted credential blob"
    );
}

/// TEST-2 — the migration is purely ADDITIVE.
///
/// `llm_repositories` carries `UNIQUE (name)` and `UNIQUE (url)`, and the
/// credentialed `Hugging Face Hub` row already holds the bare origin. This
/// asserts the new row coexists with both pre-existing built-ins rather than
/// displacing, disabling or re-typing either of them.
#[tokio::test]
async fn test_2_default_model_seed_is_additive_and_leaves_existing_rows_intact() {
    let server = TestServer::start().await;
    let pool = connect(&server).await;

    let hf = sqlx::query!(
        "SELECT auth_type, url, enabled, built_in FROM llm_repositories WHERE name = 'Hugging Face Hub'"
    )
    .fetch_one(&pool)
    .await
    .expect("the pre-existing Hugging Face Hub row still exists");
    assert_eq!(
        hf.auth_type, "api_key",
        "the credentialed Hugging Face row must keep its auth_type — operators store an HF token there"
    );
    assert_eq!(hf.url, "https://huggingface.co", "its URL is unchanged");
    assert!(hf.enabled && hf.built_in, "it stays enabled + built_in");

    let gh = sqlx::query!(
        "SELECT auth_type, url FROM llm_repositories WHERE name = 'GitHub'"
    )
    .fetch_one(&pool)
    .await
    .expect("the pre-existing GitHub row still exists");
    assert_eq!(gh.auth_type, "bearer_token");
    assert_eq!(gh.url, "https://github.com");

    // Exactly one row at the new URL — proving the org-scoped URL genuinely
    // satisfies UNIQUE(url) rather than the migration having silently no-opped
    // through its ON CONFLICT clause on a fresh database.
    let at_new_url: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM llm_repositories WHERE url = $1",
        DEFAULT_MODEL_REPOSITORY_URL
    )
    .fetch_one(&pool)
    .await
    .expect("count rows at the seeded URL")
    .unwrap_or(0);
    assert_eq!(
        at_new_url, 1,
        "exactly one repository row carries the org-scoped anonymous URL"
    );

    let anonymous_builtins: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM llm_repositories WHERE built_in = true AND auth_type = 'none'"
    )
    .fetch_one(&pool)
    .await
    .expect("count anonymous built-ins")
    .unwrap_or(0);
    assert_eq!(
        anonymous_builtins, 1,
        "the anonymous built-in is the one this feature adds — no duplicates"
    );
}
