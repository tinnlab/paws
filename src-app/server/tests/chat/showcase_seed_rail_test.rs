//! TEST-37 [covers: ITEM-27] — the showcase seed's ACTIVITY-RAIL turns.
//!
//! `seeds/showcase/showcase.sql` is the fixture the rail's design-critic pass and
//! the `activity-rail-seeded` E2E render against. It is hand-maintained SQL with
//! fixed UUIDs, so the two ways it silently rots are (a) a re-run stops being a
//! no-op and (b) a new `tool_use` turn gets added without its paired
//! `mcp_tool_calls` row, leaving the Calls tab out of sync with the transcript.
//! This test pins both, plus the hard constraint that the gallery's guarded
//! conversation `11111111-…` survives every future edit.
//!
//! **How the seed is applied.** `seeds/showcase/load.sh` runs
//! `psql -v owner=<uuid> -f showcase.sql`. The only psql-specific constructs in
//! the file are the leading `\set ON_ERROR_STOP on` meta-command and the
//! `:'owner'` variable; `expand_psql_vars` below strips/substitutes exactly those
//! two and nothing else, so the statements this test executes are byte-identical
//! to what `load.sh` sends. (We do not shell out to `psql`: it is not a build
//! dependency of this crate, and `sqlx::raw_sql` runs the same simple-query
//! protocol psql uses, transaction blocks and `pg_temp` functions included.)
//!
//! Note that `\set ON_ERROR_STOP on` is dropped rather than emulated — `raw_sql`
//! already aborts on the first failing statement, which is the same contract.

use sqlx::{PgPool, Row};

/// The seed, baked in at compile time so a `showcase.sql` edit re-triggers this
/// test's compilation (and so a moved/renamed seed is a build error, not a
/// runtime skip).
const SHOWCASE_SQL: &str = include_str!("../../seeds/showcase/showcase.sql");

/// The gallery's guarded fixture conversation. Its presence — and the presence
/// of its existing content — is a hard constraint on every future seed edit.
const SHOWCASE_CONVERSATION_ID: &str = "11111111-1111-1111-1111-111111111111";

/// `tool_use` blocks that deliberately have NO `mcp_tool_calls` row: nothing is
/// recorded until a call returns, so an in-flight call and a call still awaiting
/// approval are correctly absent from the history. Every OTHER seeded `tool_use`
/// must be paired.
const INTENTIONALLY_UNRECORDED: &[&str] = &[
    // SECTION C — in-flight tool_use with no result block.
    "toolu_pending",
    // Scenario 1 — the original awaiting-approval fixture.
    "toolu_await_approval",
    // Scenario 5 — the rail's multi-step run that ends in an approval break-out.
    "toolu_rail_scn_await",
];

/// The rail-exercising turns added by ITEM-27. Listed explicitly so deleting one
/// from the seed fails here instead of silently emptying the rail fixtures.
const RAIL_TOOL_USE_IDS: &[&str] = &[
    // C16 — multi-tool run: five consecutive pairs in ONE assistant message.
    "toolu_rail_search",
    "toolu_rail_fetch",
    "toolu_rail_semantic",
    "toolu_rail_exec",
    "toolu_rail_cite",
    // C17 — artifact-producing run (resource_links).
    "toolu_rail_artifacts",
    // C18 — ok → failed → timeout inside one run.
    "toolu_rail_ok",
    "toolu_rail_failed",
    "toolu_rail_timeout",
    // C19 — knowledge_base (previously zero seed coverage).
    "toolu_rail_kb_list",
    "toolu_rail_kb_search",
];

/// Replace the two psql-only constructs in `showcase.sql` (see the module doc).
fn expand_psql_vars(sql: &str, owner: &str) -> String {
    let without_meta: String = sql
        .lines()
        .filter(|l| l.trim() != r"\set ON_ERROR_STOP on")
        .collect::<Vec<_>>()
        .join("\n");
    // `owner` is a UUID we produced, never user input — but assert the shape so a
    // future caller can't smuggle a quote into the generated literal.
    assert!(
        uuid::Uuid::parse_str(owner).is_ok(),
        "owner must be a UUID, got {owner:?}"
    );
    without_meta.replace(":'owner'", &format!("'{owner}'"))
}

/// The built-in `mcp_servers` rows the seed's `mcp_tool_calls.server_id` FK
/// points at. `showcase.sql`'s README lists "the server has booted at least once
/// against this DB" as a prerequisite; a test server boots with several built-ins
/// disabled (code_sandbox, for one), so make the prerequisite explicit rather
/// than depending on which modules happened to register. Idempotent — a row the
/// real module already inserted wins.
async fn ensure_builtin_server_rows(pool: &PgPool) {
    // (deterministic uuid_v5(NAMESPACE_URL, "<name>.ziee.internal"), name)
    let builtins: &[(&str, &str)] = &[
        ("b4d4e17b-55eb-56ce-9bc5-cbc03fd597fd", "code_sandbox"),
        ("d1a783dc-631e-570b-aba6-fee5497728b2", "web_search"),
        ("5bf27612-ac1b-5141-985b-e2e8ac36ca2d", "lit_search"),
        ("16e2eeb0-46ed-5588-af8a-e973349f99a1", "memory"),
        ("ca77f284-c0c3-51e0-ae83-8e34daa081f6", "files"),
        ("011e52cb-2d06-5e6b-8f4c-41076519f167", "citations"),
        ("d878787e-aa48-5f16-a31f-673052083f34", "control"),
        ("62c47165-bcf4-5daf-b778-8eff985ac943", "tool_result"),
        ("70577fd2-afe1-52c7-a629-9464c01fb1e5", "knowledge_base"),
    ];
    for (id, name) in builtins {
        sqlx::query(
            r#"
            INSERT INTO mcp_servers
              (id, user_id, name, display_name, is_built_in, is_system, transport_type, url)
            VALUES ($1::uuid, NULL, $2, $2, true, true, 'http', 'http://127.0.0.1:1/mcp')
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(id)
        .bind(name)
        .execute(pool)
        .await
        .expect("seed built-in mcp_servers row");
    }
}

async fn load_seed(pool: &PgPool, owner: &str) {
    let sql = expand_psql_vars(SHOWCASE_SQL, owner);
    // One connection for the whole script: it opens/closes explicit transactions
    // and defines `pg_temp` helper functions that must outlive each COMMIT.
    let mut conn = pool.acquire().await.expect("acquire connection");
    sqlx::raw_sql(&sql)
        .execute(&mut *conn)
        .await
        .expect("showcase.sql should apply cleanly");
}

/// A whole-seed fingerprint: the counts plus a content digest over every seeded
/// block and history row, so "idempotent" means *nothing changed*, not merely
/// "no error and the same number of rows".
async fn seed_fingerprint(pool: &PgPool) -> (i64, i64, i64, i64, String) {
    let row = sqlx::query(
        r#"
        SELECT
          (SELECT count(*) FROM conversations)                       AS conversations,
          (SELECT count(*) FROM messages)                            AS messages,
          (SELECT count(*) FROM message_contents)                    AS contents,
          (SELECT count(*) FROM mcp_tool_calls)                      AS tool_calls,
          (SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
              SELECT mc.message_id::text || '#' || mc.sequence_order || '#'
                     || mc.content_type || '#' || md5(mc.content::text) AS x
              FROM message_contents mc
            UNION ALL
              SELECT 'call#' || c.id::text || '#' || c.tool_use_id
                     || '#' || c.status || '#' || c.source AS x
              FROM mcp_tool_calls c
          ) s)                                                       AS digest
        "#,
    )
    .fetch_one(pool)
    .await
    .expect("fingerprint query");

    (
        row.get::<i64, _>("conversations"),
        row.get::<i64, _>("messages"),
        row.get::<i64, _>("contents"),
        row.get::<i64, _>("tool_calls"),
        row.get::<Option<String>, _>("digest").unwrap_or_default(),
    )
}

/// The showcase branch must be STRICTLY ORDERED in time.
///
/// `pg_temp.msg`'s ordinal becomes `(n || ' seconds')::interval`, i.e. a DECIMAL
/// — not a dotted version. That makes `25.10` twenty-five point one seconds: it
/// sorts BEFORE `25.7` and lands byte-for-byte on the pre-existing `25.1` turn.
/// Every transcript read orders by `branch_messages.created_at`, so a collision
/// renders the conversation scrambled — an assistant answer appearing before its
/// own question — and the "populated rail" design review would be done against a
/// nonsense transcript. This shipped exactly once and the blind audit caught it;
/// this test is why it cannot ship twice.
#[tokio::test]
async fn showcase_seed_message_ordering_is_strict_and_collision_free() {
    let server = crate::common::TestServer::start().await;
    let owner = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "showcase_order_owner",
        &["profile::read"],
    )
    .await;
    let pool = PgPool::connect(&server.database_url)
        .await
        .expect("connect to the test database");
    ensure_builtin_server_rows(&pool).await;
    load_seed(&pool, &owner.user_id).await;

    let rows: Vec<(uuid::Uuid, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT bm.message_id, bm.created_at
           FROM branch_messages bm
           JOIN branches b ON b.id = bm.branch_id
          WHERE b.conversation_id = $1::uuid
          ORDER BY bm.created_at ASC, bm.message_id ASC",
    )
    .bind(SHOWCASE_CONVERSATION_ID)
    .fetch_all(&pool)
    .await
    .expect("read showcase branch messages");

    assert!(
        rows.len() >= 8,
        "expected the showcase conversation to carry its turns, got {}",
        rows.len()
    );

    let mut seen: std::collections::HashMap<chrono::DateTime<chrono::Utc>, uuid::Uuid> =
        std::collections::HashMap::new();
    for (id, at) in &rows {
        if let Some(other) = seen.insert(*at, *id) {
            panic!(
                "two showcase messages share created_at {at}: {other} and {id}. \
                 The ordinal passed to pg_temp.msg is a DECIMAL — `25.10` is 25.1 \
                 seconds, not 'after 25.9'. Renumber with a fixed number of \
                 decimal places and a value that is not already taken."
            );
        }
    }
}

#[tokio::test]
async fn showcase_seed_is_idempotent_and_every_tool_use_is_paired() {
    let server = crate::common::TestServer::start().await;

    // An owner for the seeded conversations/files/project. Baseline perms only —
    // this test drives SQL, not the REST surface.
    let owner = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "showcase_seed_owner",
        &["profile::read"],
    )
    .await;

    let pool = PgPool::connect(&server.database_url)
        .await
        .expect("connect to the test database");
    ensure_builtin_server_rows(&pool).await;

    // ── Load #1 ────────────────────────────────────────────────────────────
    load_seed(&pool, &owner.user_id).await;
    let after_first = seed_fingerprint(&pool).await;

    // The gallery's guarded fixture conversation exists (hard constraint).
    let showcase_title: Option<String> = sqlx::query_scalar(
        "SELECT title FROM conversations WHERE id = $1::uuid",
    )
    .bind(SHOWCASE_CONVERSATION_ID)
    .fetch_optional(&pool)
    .await
    .expect("query showcase conversation")
    .flatten();
    assert_eq!(
        showcase_title.as_deref(),
        Some("Rendering Showcase — every block type"),
        "conversation {SHOWCASE_CONVERSATION_ID} is the gallery's guarded fixture and must stay present",
    );

    // Every seeded `tool_use` has a paired `mcp_tool_calls` row, except the three
    // documented not-yet-returned ones.
    let unpaired: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT mc.content->>'id'
        FROM message_contents mc
        WHERE mc.content_type = 'tool_use'
          AND NOT EXISTS (
              SELECT 1 FROM mcp_tool_calls c
              WHERE c.tool_use_id = mc.content->>'id'
          )
        ORDER BY 1
        "#,
    )
    .fetch_all(&pool)
    .await
    .expect("query unpaired tool_use blocks");

    let mut expected_unpaired: Vec<String> =
        INTENTIONALLY_UNRECORDED.iter().map(|s| s.to_string()).collect();
    expected_unpaired.sort();
    assert_eq!(
        unpaired, expected_unpaired,
        "every seeded tool_use needs a paired mcp_tool_calls row; only the \
         in-flight / awaiting-approval ones may be unrecorded",
    );

    // The rail-exercising turns are all present, each with its history row.
    for tool_use_id in RAIL_TOOL_USE_IDS {
        let blocks: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM message_contents \
             WHERE content_type = 'tool_use' AND content->>'id' = $1",
        )
        .bind(tool_use_id)
        .fetch_one(&pool)
        .await
        .expect("count tool_use blocks");
        assert_eq!(blocks, 1, "expected exactly one `{tool_use_id}` tool_use block");

        let calls: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM mcp_tool_calls WHERE tool_use_id = $1",
        )
        .bind(tool_use_id)
        .fetch_one(&pool)
        .await
        .expect("count mcp_tool_calls rows");
        assert_eq!(calls, 1, "expected exactly one mcp_tool_calls row for `{tool_use_id}`");
    }

    // The multi-tool run is one MESSAGE carrying five tool_use blocks — that is
    // what makes the rail render as a rail rather than a single quiet line.
    let multi_tool_steps: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM message_contents \
         WHERE message_id = '30000000-0000-0000-0000-00000000004c'::uuid \
           AND content_type = 'tool_use'",
    )
    .fetch_one(&pool)
    .await
    .expect("count multi-tool steps");
    assert!(
        multi_tool_steps >= 4,
        "the multi-tool rail turn must carry at least 4 tool_use blocks, found {multi_tool_steps}",
    );

    // The failure + timeout statuses reach the Calls tab as DISTINCT statuses
    // (a timeout must not be recorded as a plain failure).
    for (tool_use_id, expected_status) in
        [("toolu_rail_failed", "failed"), ("toolu_rail_timeout", "timeout")]
    {
        let status: String = sqlx::query_scalar(
            "SELECT status FROM mcp_tool_calls WHERE tool_use_id = $1",
        )
        .bind(tool_use_id)
        .fetch_one(&pool)
        .await
        .expect("fetch status");
        assert_eq!(status, expected_status, "status for `{tool_use_id}`");
    }

    // The artifact-producing run really carries resource_links.
    // `jsonb_array_length` returns INT4; cast so the decode matches the binding.
    let artifact_links: i64 = sqlx::query_scalar(
        "SELECT jsonb_array_length(content->'resource_links')::bigint FROM message_contents \
         WHERE content_type = 'tool_result' AND content->>'tool_use_id' = 'toolu_rail_artifacts'",
    )
    .fetch_one(&pool)
    .await
    .expect("count artifact resource_links");
    assert!(
        artifact_links >= 2,
        "the artifact rail turn should carry several resource_links, found {artifact_links}",
    );

    // The approval break-out is re-hydratable: a pending `tool_use_approvals` row
    // paired with the result-less tool_use.
    let pending_approvals: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM tool_use_approvals \
         WHERE tool_use_id = 'toolu_rail_scn_await' AND status = 'pending'",
    )
    .fetch_one(&pool)
    .await
    .expect("count pending approvals");
    assert_eq!(pending_approvals, 1, "the rail scenario's pending approval row");

    // knowledge_base coverage — it had none before ITEM-27.
    let kb_calls: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM mcp_tool_calls \
         WHERE server_id = '70577fd2-afe1-52c7-a629-9464c01fb1e5'::uuid",
    )
    .fetch_one(&pool)
    .await
    .expect("count knowledge_base calls");
    assert_eq!(kb_calls, 2, "knowledge_base should have seeded search + list calls");

    // ── Load #2: a re-run must be a pure no-op ─────────────────────────────
    load_seed(&pool, &owner.user_id).await;
    let after_second = seed_fingerprint(&pool).await;
    assert_eq!(
        after_first, after_second,
        "re-running showcase.sql must be idempotent (fixed UUIDs + ON CONFLICT DO NOTHING)",
    );

    pool.close().await;
}
