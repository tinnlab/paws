//! `ask-user-stringified-schema`/**TEST-24** — a STRINGIFIED `invoke_capability`
//! argument survives everything DOWNSTREAM of the decode and reaches the real
//! loopback route.
//!
//! (Test-ID note: `control_mcp/mod.rs` already carries TEST-22/23/24 markers
//! belonging to the earlier `control-describe-schema` lifecycle. The IDs here
//! are namespaced to this feature to keep a `grep TEST-24` honest.)
//!
//! # Why an integration test, when the decode is unit-tested
//!
//! The unit tests over `decode_invoke_args` prove the decode in isolation. They
//! cannot prove the decoded value survives typed `InvokeArgs` deserialization,
//! `validate_body` against the operation's request schema, `substitute_path`,
//! the URL's `query_pairs_mut()`, the loopback dispatch, and the target route's
//! own authorization and deserialization. That whole tail is where the reported
//! defect actually hurt, and each argument failed differently there:
//!
//! * **`body`** — refused before dispatch, so the model got an error blaming the
//!   wrong layer and the mutation never happened.
//! * **`query`** — the loud one is the SILENT one: a stringified `query` was
//!   DROPPED, the call ran with no query params at all, and the route answered a
//!   perfectly plausible 200 for the wrong question. No error anywhere.
//! * **`path_params`** — hard-failed serde before reaching the route.
//!
//! So the assertions below are deliberately the OBSERVABLE EFFECT — a row in the
//! real database, a filtered result set, a renamed record — reached with NO
//! mocked authz. That is the standard `invoke_create_assistant_real_roundtrip`
//! holds the well-formed-object path to, applied to the shape a language model
//! actually emits.
//!
//! # What "pre-fix" actually did (measured, not assumed)
//!
//! With `decode_invoke_args` neutered, `Assistant.create` with a stringified
//! `body` is refused PRE-DISPATCH with
//! `Invalid params: \`body\` arrived as a string, but a JSON object is required…`
//! — it never reaches the route, so there is no HTTP status to inspect. An
//! earlier draft of this file asserted `status != 422` and narrated the pre-fix
//! behaviour as a 422 from the target route; that was wrong (the 422 path
//! belongs to operations with no object `request_schema`, which these are not),
//! and because `structuredContent` is absent on the error the assertion also
//! passed vacuously. Removed rather than reworded.

use serde_json::{Value, json};
use uuid::Uuid;

use super::{call_tool, pool, structured};
use crate::common::TestServer;
use crate::common::test_helpers::create_user_with_permissions;

/// Count `assistants` rows named `name`.
///
/// Safe unqualified: `TestServer::start()` clones a fresh per-test database, so
/// no sibling test's rows are visible here.
async fn assistant_count(pool: &sqlx::PgPool, name: &str) -> i64 {
    sqlx::query_scalar!("SELECT COUNT(*) FROM assistants WHERE name = $1", name)
        .fetch_one(pool)
        .await
        .unwrap()
        .unwrap_or(0)
}

/// The total `assistants` count, once it has stopped moving.
///
/// User registration clones default template assistants on a DETACHED task, so a
/// count sampled immediately after `create_user_with_permissions` may still be
/// rising. Two equal consecutive reads is enough here: the only writer is that
/// one clone task, and it completes in a single burst.
async fn settled_assistant_total(pool: &sqlx::PgPool) -> i64 {
    let total = |p: &sqlx::PgPool| {
        let p = p.clone();
        async move {
            sqlx::query_scalar!("SELECT COUNT(*) FROM assistants")
                .fetch_one(&p)
                .await
                .unwrap()
                .unwrap_or(0)
        }
    };
    let mut last = total(pool).await;
    for _ in 0..40 {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let now = total(pool).await;
        if now == last {
            return now;
        }
        last = now;
    }
    last
}

/// Create an assistant through the ordinary (well-formed) control path.
async fn create_assistant(server: &TestServer, token: &str, name: &str) -> Value {
    call_tool(
        server,
        token,
        "invoke_capability",
        json!({ "operation_id": "Assistant.create", "body": { "name": name } }),
    )
    .await
}

// ── `body` ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn stringified_body_reaches_the_real_route_and_creates_the_entity() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_strbody", &["*"]).await;
    let pool = pool(&server).await;

    let name = format!("StrBody-{}", &Uuid::new_v4().to_string()[..8]);
    // The defect's exact shape: `body` arrives as a JSON *string*, one level too
    // encoded, not as the object the tool descriptor declares.
    let encoded = serde_json::to_string(&json!({ "name": name })).unwrap();

    let res = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({ "operation_id": "Assistant.create", "body": Value::String(encoded) }),
    )
    .await;

    // THE discriminating assertion: pre-fix this is a JSON-RPC error (measured —
    // see the module header), so a revert turns this line red.
    assert!(
        res["error"].is_null(),
        "a JSON-encoded body is a model encoding mistake to correct, not a \
         protocol error to refuse: {res}"
    );
    assert!(
        structured(&res)["ok"].as_bool().unwrap_or(false),
        "the decoded body must be accepted by the real route: {res}"
    );

    assert_eq!(
        assistant_count(&pool, &name).await,
        1,
        "assistant '{name}' must exist — the point is that the mutation actually \
         happened, not that the call returned without erroring"
    );
}

#[tokio::test]
async fn double_stringified_body_still_reaches_the_real_route() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_strbody2", &["*"]).await;
    let pool = pool(&server).await;

    let name = format!("StrBody2-{}", &Uuid::new_v4().to_string()[..8]);
    // Two layers — the occasional double-stringify, and exactly the bound
    // `MAX_STRING_UNWRAPS = 2` admits.
    let once = serde_json::to_string(&json!({ "name": name })).unwrap();
    let twice = serde_json::to_string(&once).unwrap();

    let res = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({ "operation_id": "Assistant.create", "body": Value::String(twice) }),
    )
    .await;

    assert!(res["error"].is_null(), "double-encoded body must decode: {res}");
    assert!(
        structured(&res)["ok"].as_bool().unwrap_or(false),
        "double-encoded body must reach the route: {res}"
    );
    assert_eq!(assistant_count(&pool, &name).await, 1);
}

#[tokio::test]
async fn triple_stringified_body_is_refused_at_the_bound() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_strbody3", &["*"]).await;
    let pool = pool(&server).await;

    let name = format!("StrBody3-{}", &Uuid::new_v4().to_string()[..8]);
    // One layer past `MAX_STRING_UNWRAPS`. The EXCLUSIVE side of the bound: the
    // test above proves 2 is accepted end-to-end, this proves 3 is not, so
    // "unwrap until it stops being a string" cannot pass both.
    let mut encoded = serde_json::to_string(&json!({ "name": name })).unwrap();
    for _ in 0..2 {
        encoded = serde_json::to_string(&encoded).unwrap();
    }

    let res = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({ "operation_id": "Assistant.create", "body": Value::String(encoded) }),
    )
    .await;

    assert!(
        res["error"].is_object(),
        "a body encoded past the unwrap bound must be refused: {res}"
    );
    // Pin WHICH refusal this is. `validate_body`'s widened scalar-reject also
    // refuses a string body, and it fires even with the decode fully reverted —
    // so a bare "an error happened" assertion would stay green against exactly
    // the partial revert this file exists to catch. Only `coerce_value`'s
    // bound-exhausted arm names the unwrap limit.
    // The exact text of `coerce_value`'s bound-exhausted arm ("`<arg>` arrived
    // JSON-encoded more than 2 times (a string inside a string)"). No other
    // refusal says this.
    let msg = res["error"]["message"].as_str().unwrap_or_default();
    assert!(
        msg.contains("JSON-encoded more than"),
        "the refusal must come from the UNWRAP BOUND, naming the limit, not from \
         the generic scalar-reject that fires even with the decode reverted: {msg}"
    );
    assert_eq!(
        assistant_count(&pool, &name).await,
        0,
        "a refused body must not have dispatched anything"
    );
}

// ── `query` — the SILENT failure, and the strongest case for this file ────────

#[tokio::test]
async fn stringified_query_actually_filters_instead_of_being_dropped() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_strquery", &["*"]).await;

    // Three assistants, so "the query was applied" and "the query was dropped"
    // produce visibly different result sets. (A fresh user already owns one
    // cloned template assistant, so the total is >= 3 either way.)
    for i in 0..3 {
        let name = format!("Q{i}-{}", &Uuid::new_v4().to_string()[..8]);
        let created = create_assistant(&server, &admin.token, &name).await;
        assert!(
            structured(&created)["ok"].as_bool().unwrap_or(false),
            "setup create must succeed: {created}"
        );
    }

    // A STRINGIFIED query. Pre-fix this was silently dropped: `args.query` did
    // not match `Some(Value::Object(_))`, no pairs were appended, and the route
    // returned its DEFAULT page — a plausible 200 for the wrong question, with
    // no error for anyone to notice.
    let res = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({
            "operation_id": "Assistant.list",
            "query": Value::String(r#"{"page":1,"limit":1}"#.to_string()),
        }),
    )
    .await;

    assert!(res["error"].is_null(), "a stringified query must decode: {res}");
    let sc = structured(&res);
    assert!(sc["ok"].as_bool().unwrap_or(false), "list must succeed: {res}");

    let assistants = sc["response"]["assistants"]
        .as_array()
        .unwrap_or_else(|| panic!("list response must carry an assistants array: {res}"));
    let total = sc["response"]["total"].as_i64().unwrap_or(0);

    // The discriminating pair. `limit=1` must be HONOURED (exactly one row back)
    // while the unfiltered total proves there was genuinely more to return — so
    // a dropped query, which returns them all, cannot satisfy this.
    assert!(
        total > 1,
        "the fixture must have more rows than the limit, or 'limit was applied' \
         is unfalsifiable: total={total}, {res}"
    );
    assert_eq!(
        assistants.len(),
        1,
        "limit=1 from the DECODED query must be applied — returning {} rows is \
         the pre-fix 'query silently dropped' behaviour: {res}",
        assistants.len()
    );
}

// ── `path_params` ────────────────────────────────────────────────────────────

#[tokio::test]
async fn stringified_path_params_reach_the_real_route() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_strpath", &["*"]).await;
    let pool = pool(&server).await;

    let orig = format!("PathA-{}", &Uuid::new_v4().to_string()[..8]);
    let created = create_assistant(&server, &admin.token, &orig).await;
    let id = structured(&created)["response"]["id"]
        .as_str()
        .unwrap_or_else(|| panic!("created assistant id: {created}"))
        .to_string();

    // Pre-fix a stringified `path_params` hard-failed serde on `InvokeArgs`
    // (the whole args blob was named as the offender), so the rename never
    // happened.
    let renamed = format!("PathB-{}", &Uuid::new_v4().to_string()[..8]);
    let res = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({
            "operation_id": "Assistant.update",
            "path_params": Value::String(format!(r#"{{"id":"{id}"}}"#)),
            "body": { "name": renamed }
        }),
    )
    .await;

    assert!(
        res["error"].is_null(),
        "stringified path_params must decode: {res}"
    );
    assert!(
        structured(&res)["ok"].as_bool().unwrap_or(false),
        "the update must reach the route: {res}"
    );

    // The observable effect: the row the decoded path param NAMED is the one
    // that changed.
    let db_name = sqlx::query_scalar!(
        "SELECT name FROM assistants WHERE id = $1::uuid",
        Uuid::parse_str(&id).unwrap()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        db_name, renamed,
        "the decoded path param must address the right row"
    );
}

// ── the refusal must stay actionable ─────────────────────────────────────────

#[tokio::test]
async fn undecodable_body_is_refused_actionably_and_creates_nothing() {
    let server = TestServer::start().await;
    let admin = create_user_with_permissions(&server, "ctl_strbody_bad", &["*"]).await;
    let pool = pool(&server).await;

    // SETTLE before sampling. `create_user_with_permissions` registers via the
    // real /auth/register, whose UserCreated event fires a DETACHED handler that
    // clones the default template assistant. If that clone lands between the two
    // samples below, a strict equality assertion fails spuriously — a flake that
    // has nothing to do with the behaviour under test. Poll until the total stops
    // moving, then sample.
    let before = settled_assistant_total(&pool).await;

    // A string that is not JSON at all. The tolerance must NOT extend to
    // inventing a body (INV-2): without this, "decode everything, somehow" would
    // satisfy every test above.
    let res = call_tool(
        &server,
        &admin.token,
        "invoke_capability",
        json!({ "operation_id": "Assistant.create", "body": "not json at all" }),
    )
    .await;

    // A refusal is a JSON-RPC error here (400 -> `invalid_params`), not an
    // `ok:false` tool result. Asserted narrowly on purpose: an earlier draft
    // accepted either shape, but the message assertions below can only read the
    // error channel, so the alternative branch was unreachable-by-design and
    // only misled the reader.
    assert!(
        res["error"].is_object(),
        "an undecodable body must be refused, never defaulted: {res}"
    );

    // The refusal must be USEFUL to its consumer — a model that cannot see what
    // it got wrong cannot correct itself (INV-5). Assert the message, not merely
    // that an error occurred.
    let msg = res["error"]["message"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let lower = msg.to_lowercase();
    assert!(
        lower.contains("body"),
        "the refusal must name the offending argument: {msg}"
    );
    assert!(
        lower.contains("object"),
        "the refusal must state the expected shape: {msg}"
    );
    assert!(
        msg.contains('{') && msg.contains('}'),
        "the refusal must carry a literal-JSON example the model can copy: {msg}"
    );
    // Pins WHICH layer refused. `validate_body`'s widened scalar-reject also
    // emits a message containing body/object/{}, so without this the test would
    // stay green against a revert of `decode_invoke_args` alone — only the
    // decode's from_str-failure arm says the text was not valid JSON.
    assert!(
        lower.contains("not valid json"),
        "the refusal must come from the DECODE layer and say the text was not \
         valid JSON, otherwise this passes on a partial revert: {msg}"
    );

    assert_eq!(
        sqlx::query_scalar!("SELECT COUNT(*) FROM assistants")
            .fetch_one(&pool)
            .await
            .unwrap()
            .unwrap_or(0),
        before,
        "a refused body must not have dispatched anything"
    );
}
