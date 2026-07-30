//! R1 — the `skills` import/install write is a non-transactional
//! SELECT → DELETE → INSERT, and a concurrent duplicate escaped as
//! `500 SYSTEM_DATABASE_ERROR`.
//!
//! `dev_handlers::import_skill` (`POST /api/skills/import`) and the hub
//! install path both do:
//!
//! ```text
//! find_by_name_version_owner(name, version, owner)   // SELECT
//!   -> if Some: repository::delete(prior.id)         // DELETE
//! repository::insert(create)                         // INSERT
//! ```
//!
//! with no transaction and no `ON CONFLICT`. Two concurrent imports of the
//! same skill name both see "no prior row", both delete nothing, and both
//! INSERT; the loser trips the partial unique index
//! `uniq_skills_user_name_version_owner` / `uniq_skills_system_name_version`
//! → 23505 → `AppError::database_error` → 500.
//!
//! NOTE a transaction would NOT close this. Under READ COMMITTED both
//! transactions snapshot the table before the other's uncommitted INSERT, so
//! the unique index remains the only arbiter — the fix is to map that
//! violation onto the sweep's typed `409 RESOURCE_CONFLICT` (which the sibling
//! `workflow::repository::insert` already does), so a retry then sees the
//! winner's row through the pre-check and succeeds.
//!
//! LAYER. Two tests, deliberately at two layers:
//!
//! * `concurrent_duplicate_inserts_*` drives the REAL
//!   `skill::repository::insert` (re-exported via `ziee::test_internals`) from
//!   N tasks released by a barrier. This is the deterministic one: the DB is
//!   the only shared resource, so the collision is guaranteed, not sampled.
//! * `concurrent_http_imports_*` drives the REAL `POST /api/skills/import`.
//!   That path ALSO races on a shared on-disk extraction directory (an
//!   adjacent, separate defect — see the test's own note), so it asserts the
//!   database outcome specifically: no `SYSTEM_DATABASE_ERROR`, exactly one row.

use std::io::Cursor;
use std::sync::Arc;

use flate2::Compression;
use flate2::write::GzEncoder;
use reqwest::multipart;
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use tar::{Builder, Header};
use tokio::sync::Barrier;
use uuid::Uuid;

use crate::common::TestServer;
use crate::common::test_helpers::create_user_with_permissions;

/// How many contenders race for the same (name, version, owner). 8 is well
/// past the point where a pre-fix run leaves a single winner: every loser is a
/// unique violation, so pre-fix this yields 7 failures on every execution.
const RACERS: usize = 8;

fn create_skill(name: &str, owner: Option<Uuid>, scope: &str) -> ziee::test_internals::CreateSkill {
    ziee::test_internals::CreateSkill {
        name: name.to_string(),
        version: Some("0.0.0-dev".to_string()),
        display_name: Some("race".to_string()),
        description: None,
        when_to_use: None,
        extracted_path: format!("/tmp/ziee-race/{name}"),
        bundle_sha256: "0".repeat(64),
        bundle_size_bytes: 1,
        file_count: 1,
        entry_point: "SKILL.md".to_string(),
        frontmatter_json: serde_json::json!({}),
        tags: serde_json::Value::Array(vec![]),
        scope: scope.to_string(),
        owner_user_id: owner,
        created_by: owner,
        enabled: true,
        is_dev: true,
    }
}

/// REPOSITORY LAYER. N concurrent `skill::repository::insert` calls for the
/// same (name, version, owner_user_id), released together by a barrier.
///
/// Pre-fix: 1 × Ok + 7 × `500 SYSTEM_DATABASE_ERROR`.
/// Post-fix: 1 × Ok + 7 × `409 RESOURCE_CONFLICT`, and exactly one row.
#[tokio::test]
async fn concurrent_duplicate_inserts_are_409_not_500() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "skill_race", &["skills::install"]).await;
    let owner = Uuid::parse_str(&user.user_id).expect("user id is a uuid");

    let pool = PgPoolOptions::new()
        .max_connections(RACERS as u32)
        .connect(&server.database_url)
        .await
        .expect("connect test db");

    let name = format!(
        "local.dev.{owner}/race-{}",
        &Uuid::new_v4().to_string()[..8]
    );
    let barrier = Arc::new(Barrier::new(RACERS));

    let mut tasks = Vec::with_capacity(RACERS);
    for _ in 0..RACERS {
        let pool = pool.clone();
        let barrier = Arc::clone(&barrier);
        let create = create_skill(&name, Some(owner), "user");
        tasks.push(tokio::spawn(async move {
            barrier.wait().await;
            ziee::test_internals::skill_repository_insert(&pool, create).await
        }));
    }

    let mut ok = 0usize;
    let mut conflicts = 0usize;
    let mut other: Vec<(u16, String)> = Vec::new();
    for t in tasks {
        match t.await.expect("insert task panicked") {
            Ok(_) => ok += 1,
            Err(e) if e.status_code() == 409 && e.error_code() == "RESOURCE_CONFLICT" => {
                conflicts += 1
            }
            Err(e) => other.push((e.status_code(), e.error_code().to_string())),
        }
    }

    assert!(
        other.is_empty(),
        "every loser of the insert race must be a typed 409 RESOURCE_CONFLICT; \
         got these instead: {other:?} (a 500/SYSTEM_DATABASE_ERROR here is the \
         unique violation escaping unmapped — the defect this test pins)"
    );
    assert_eq!(ok, 1, "exactly one of {RACERS} concurrent inserts may win");
    assert_eq!(conflicts, RACERS - 1, "every other racer is a 409");

    // END STATE: exactly one row, not zero and not N.
    let rows: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "c!" FROM skills WHERE name = $1"#,
        name
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rows, 1, "the race must leave exactly one skills row");
    pool.close().await;
}

/// Same race on the SYSTEM-scope partial index (`uniq_skills_system_name_version`,
/// which has no owner column), reached by the system-scope import.
#[tokio::test]
async fn concurrent_duplicate_system_inserts_are_409_not_500() {
    let server = TestServer::start().await;
    let pool = PgPoolOptions::new()
        .max_connections(RACERS as u32)
        .connect(&server.database_url)
        .await
        .expect("connect test db");

    let name = format!("local.dev.system/race-{}", &Uuid::new_v4().to_string()[..8]);
    let barrier = Arc::new(Barrier::new(RACERS));

    let mut tasks = Vec::with_capacity(RACERS);
    for _ in 0..RACERS {
        let pool = pool.clone();
        let barrier = Arc::clone(&barrier);
        let create = create_skill(&name, None, "system");
        tasks.push(tokio::spawn(async move {
            barrier.wait().await;
            ziee::test_internals::skill_repository_insert(&pool, create).await
        }));
    }

    let mut ok = 0usize;
    let mut bad: Vec<(u16, String)> = Vec::new();
    for t in tasks {
        match t.await.expect("insert task panicked") {
            Ok(_) => ok += 1,
            Err(e) if e.status_code() == 409 => {}
            Err(e) => bad.push((e.status_code(), e.error_code().to_string())),
        }
    }
    assert!(
        bad.is_empty(),
        "system-scope losers must also be 409: {bad:?}"
    );
    assert_eq!(ok, 1, "exactly one system-scope insert may win");

    let rows: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "c!" FROM skills WHERE name = $1"#,
        name
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rows, 1, "exactly one system skills row");
    pool.close().await;
}

// ───────────────────────── HTTP layer ─────────────────────────

const RACE_SKILL_MD: &str = "---\n\
name: race-skill\n\
description: A skill used to race the import endpoint.\n\
---\n\n\
# Race\n";

fn valid_skill_targz() -> Vec<u8> {
    let cur = Cursor::new(Vec::<u8>::new());
    let enc = GzEncoder::new(cur, Compression::default());
    let mut builder = Builder::new(enc);
    let mut header = Header::new_gnu();
    header.set_size(RACE_SKILL_MD.len() as u64);
    header.set_mode(0o644);
    header.set_entry_type(tar::EntryType::Regular);
    builder
        .append_data(&mut header, "SKILL.md", RACE_SKILL_MD.as_bytes())
        .expect("append SKILL.md");
    let enc = builder.into_inner().expect("into_inner");
    enc.finish().expect("gz finish").into_inner()
}

/// HTTP LAYER — `POST /api/skills/import`, N concurrent imports of the SAME
/// `name`, released together.
///
/// This is the production entry point, so it is worth pinning; but it is NOT
/// the deterministic reproduction. `import_skill` also extracts every bundle
/// into ONE shared directory (`<app_data>/skills/<owner>/<name>/<version>`) via
/// `bundle::extract_tarball_bytes`, whose `exists → remove_dir_all → rename`
/// sequence is its own (separate, filesystem-level) race; a loser there can
/// fail with a 500 `SYSTEM_INTERNAL_ERROR` *before* ever reaching the INSERT.
/// That defect is out of this fix's scope and is reported rather than patched,
/// so the assertion is scoped to the DATABASE outcome:
///
///   * no response may carry `SYSTEM_DATABASE_ERROR` (the unique violation
///     escaping, i.e. the defect under test), and
///   * the race must leave exactly ONE skills row.
#[tokio::test]
async fn concurrent_http_imports_never_leak_a_database_error() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "skill_http_race", &["skills::install"]).await;

    let slug = format!("race-{}", &Uuid::new_v4().to_string()[..8]);
    let barrier = Arc::new(Barrier::new(RACERS));
    let bundle = valid_skill_targz();

    let mut tasks = Vec::with_capacity(RACERS);
    for _ in 0..RACERS {
        let barrier = Arc::clone(&barrier);
        let url = server.api_url("/skills/import");
        let token = user.token.clone();
        let slug = slug.clone();
        let bundle = bundle.clone();
        tasks.push(tokio::spawn(async move {
            let form = multipart::Form::new().text("name", slug).part(
                "bundle",
                multipart::Part::bytes(bundle)
                    .file_name("bundle.tar.gz")
                    .mime_str("application/gzip")
                    .unwrap(),
            );
            barrier.wait().await;
            let res = reqwest::Client::new()
                .post(url)
                .header("Authorization", format!("Bearer {token}"))
                .multipart(form)
                .send()
                .await
                .expect("import request failed");
            let status = res.status().as_u16();
            let body: Value = res.json().await.unwrap_or(Value::Null);
            (status, body)
        }));
    }

    let mut outcomes = Vec::with_capacity(RACERS);
    for t in tasks {
        outcomes.push(t.await.expect("import task panicked"));
    }

    let db_errors: Vec<&(u16, Value)> = outcomes
        .iter()
        .filter(|(_, b)| {
            b.get("error_code").and_then(Value::as_str) == Some("SYSTEM_DATABASE_ERROR")
        })
        .collect();
    assert!(
        db_errors.is_empty(),
        "a concurrent duplicate import must never surface the raw unique \
         violation as SYSTEM_DATABASE_ERROR; got {db_errors:?} \
         (all outcomes: {outcomes:?})"
    );
    assert!(
        outcomes.iter().any(|(s, _)| *s == 201),
        "at least one import must succeed: {outcomes:?}"
    );

    // END STATE: exactly one row for this name, whatever the losers answered.
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&server.database_url)
        .await
        .expect("connect test db");
    let like = format!("%/{slug}");
    let rows: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "c!" FROM skills WHERE name LIKE $1"#,
        like
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    pool.close().await;
    assert_eq!(
        rows, 1,
        "the import race must leave exactly one skills row (outcomes: {outcomes:?})"
    );
}
