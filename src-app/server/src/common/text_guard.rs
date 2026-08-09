//! The single guard for user-supplied text that reaches Postgres as a `text`
//! bind parameter.
//!
//! # The rule
//!
//! Postgres cannot hold `U+0000` in a `text` value at all — the wire protocol
//! rejects it with `22021 invalid byte sequence for encoding "UTF8"` (and, on a
//! `jsonb` path, `22P05 unsupported Unicode escape sequence`).
//! [`AppError::database_error`] correctly refuses to leak the SQL error to the
//! client and therefore flattens it into a generic **500**
//! `SYSTEM_DATABASE_ERROR`. That is the wrong answer: the caller sent a value
//! the storage layer physically cannot hold, which is a **client** error.
//!
//! **Every user-supplied string that reaches a SQL text bind — in a request
//! BODY *or* in a QUERY PARAMETER — goes through this module.** Do not add a
//! fourth private copy; that is the mistake this module exists to end.
//!
//! # Two entry points, and the difference matters
//!
//! [`reject_nul`] guards a value and returns it to you UNCHANGED. Use it
//! whenever the existing code binds the raw value — an exact-match filter
//! (`WHERE col = $1`) or a body field.
//!
//! [`normalize_text_filter`] additionally trims and maps blank to `None`. Use
//! it ONLY where the call site already did that. Reaching for it at a site that
//! did not is a **behaviour change, not a cleanup**: it turns `?p=` from
//! "match the empty string" (a filter that selects nothing) into "no filter"
//! (which selects EVERYTHING). Four call sites in this codebase bind the raw
//! value for exactly that reason — see `background_mcp::runs`,
//! `mcp::tool_calls::handlers`, and `llm_local_runtime::runtime_version`.
//!
//! # Why it lives here
//!
//! This guard previously existed as three independent private copies
//! (`project::handlers::reject_nul`, `user::handlers::groups::reject_nul`,
//! `chat::core::handlers::validation::reject_nul_in_content`), each added by a
//! separate past fix and each wired into ONE module's write path. The read path
//! — the free-text `search` / `kind` / `source` / `q` / `status` / `engine` /
//! `tool_use_id` query parameters on the list endpoints — had its own separate
//! copy-pasted normalization (`.map(str::trim).filter(|s| !s.is_empty())`) that
//! omitted the guard entirely, and so answered 500 on a NUL across twelve
//! parameters. Those three copies now delegate here, so there is exactly one
//! behaviour and one message in the process.
//!
//! # Why it is narrow (NUL only)
//!
//! The codebase has two deliberately different gates. A stored, rendered
//! *display name* (`validate_assistant_name`, `validate_group_name`) rejects
//! all control + bidi characters, because such a name can spoof adjacent text
//! wherever it is displayed. Free-form *prose* and transient *filter terms*
//! reject only the one byte the storage layer cannot hold: `\n` and `\t` are
//! legitimate inside a description, an instruction block, or a chat message,
//! and inside a search term a control character simply matches nothing — a
//! `200` with an empty page, which is the correct answer, not a `4xx`.

use crate::common::AppError;

/// Reject a user-supplied string that Postgres cannot store.
///
/// `field` names the offending input in the message, so the caller learns
/// *which* parameter to fix: `"search cannot contain NUL characters"`.
///
/// Returns `400 VALIDATION_ERROR` — the status and error code every
/// pre-existing copy of this guard already emitted.
pub fn reject_nul(value: &str, field: &str) -> Result<(), AppError> {
    if value.contains('\0') {
        return Err(AppError::bad_request(
            "VALIDATION_ERROR",
            format!("{field} cannot contain NUL characters"),
        ));
    }
    Ok(())
}

/// Guard an optional free-text query parameter and return it **unchanged**.
///
/// The counterpart to [`normalize_text_filter`] for call sites that bind the
/// RAW value — exact-match filters (`WHERE col = $1`) and anything else where
/// the pre-existing code did not trim. It adds the NUL rejection and nothing
/// else, so it cannot change which rows a valid filter selects.
pub fn guard_raw<'a>(raw: Option<&'a str>, field: &str) -> Result<Option<&'a str>, AppError> {
    if let Some(value) = raw {
        reject_nul(value, field)?;
    }
    Ok(raw)
}

/// Normalize a free-text list-filter query parameter.
///
/// This is the single definition of the shape that the list endpoints
/// previously copy-pasted. In order:
///
/// 1. **Reject** a NUL in the RAW value (before trimming — `\0` is not
///    whitespace, so trimming would not remove it anyway, and validating the
///    raw input is what the caller actually sent).
/// 2. **Trim** surrounding whitespace.
/// 3. Map a blank / whitespace-only term to `None` ("no filter"), so an empty
///    search box does not run `ILIKE '%%'` across every row.
///
/// Steps 2 and 3 reproduce the replaced code exactly, so every valid input
/// normalizes to the same value it did before this guard existed.
pub fn normalize_text_filter<'a>(
    raw: Option<&'a str>,
    field: &str,
) -> Result<Option<&'a str>, AppError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    reject_nul(raw, field)?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// TEST-1 — the guard accepts every legitimate value and rejects a
    /// NUL-bearing one with exactly 400 / `VALIDATION_ERROR`, naming the field.
    #[test]
    fn reject_nul_accepts_legitimate_text_and_rejects_nul() {
        for ok in [
            "",
            "hello",
            "line one\nline two\ttabbed",
            "🧬 astral + emoji 𝕏",
            "' OR '1'='1; DROP TABLE users;--",
            "100%_wildcards",
            &"A".repeat(100_000),
        ] {
            assert!(reject_nul(ok, "search").is_ok(), "input {ok:?}");
        }

        let err = reject_nul("bad\0value", "search").expect_err("expected rejection");
        assert_eq!(err.status_code(), 400);
        assert_eq!(err.error_code(), "VALIDATION_ERROR");
        // TEST-18 — the documented message contract, asserted verbatim so the
        // module doc and the code cannot drift apart.
        let rendered = serde_json::to_string(&err).expect("serialize");
        assert!(
            rendered.contains("search cannot contain NUL characters"),
            "message must name the field: {rendered}"
        );
    }

    /// TEST-2 — the happy path is byte-for-byte what the five replaced
    /// copy-pasted sites produced: trim, and blank/whitespace-only → None.
    #[test]
    fn normalize_text_filter_reproduces_the_replaced_normalization() {
        assert_eq!(normalize_text_filter(None, "search").unwrap(), None);
        assert_eq!(normalize_text_filter(Some(""), "search").unwrap(), None);
        assert_eq!(normalize_text_filter(Some("   "), "search").unwrap(), None);
        assert_eq!(normalize_text_filter(Some("\t\n"), "search").unwrap(), None);
        assert_eq!(
            normalize_text_filter(Some("  foo "), "search").unwrap(),
            Some("foo")
        );
        assert_eq!(
            normalize_text_filter(Some("roadmap"), "search").unwrap(),
            Some("roadmap")
        );
    }

    /// TEST-3 [acceptance][INV-1] — a NUL-bearing filter is a CLIENT error.
    /// Asserted on the status directly, so this fails if the guard is ever
    /// changed to return (or fall through to) any 5xx.
    #[test]
    fn nul_in_a_filter_is_a_400_not_a_500() {
        let err = normalize_text_filter(Some("\0"), "search").expect_err("expected rejection");
        assert_eq!(
            err.status_code(),
            400,
            "a client-supplied unusable value must be a 4xx, not a 5xx"
        );
        assert_eq!(err.error_code(), "VALIDATION_ERROR");
    }

    /// TEST-4 [acceptance][INV-2] — REJECT, never strip.
    ///
    /// Written as a `match` on the Ok branch rather than `assert!(is_err())`
    /// followed by `assert_ne!`: once `is_err()` has been asserted, `ok()` is
    /// necessarily `None` and any subsequent `assert_ne!` against it is
    /// unfalsifiable. Failing explicitly on ANY `Ok` — and naming the stripped
    /// form when that is what came back — is what actually distinguishes
    /// "rejected" from "silently rewritten".
    #[test]
    fn nul_is_rejected_never_silently_stripped() {
        for (input, stripped) in [("a\0b", "ab"), ("\0lead", "lead"), ("trail\0", "trail")] {
            match normalize_text_filter(Some(input), "search") {
                Err(e) => assert_eq!(e.status_code(), 400, "input {input:?}"),
                Ok(Some(v)) if v == stripped => panic!(
                    "input {input:?} was silently rewritten to {stripped:?} — that \
                     returns hits the caller did not ask for"
                ),
                Ok(other) => panic!("input {input:?} must be refused, got Ok({other:?})"),
            }
            // Same for the raw-preserving entry point.
            match guard_raw(Some(input), "search") {
                Err(e) => assert_eq!(e.status_code(), 400, "input {input:?}"),
                Ok(other) => panic!("guard_raw({input:?}) must be refused, got Ok({other:?})"),
            }
        }
    }

    /// TEST-5 [acceptance][INV-4] — the guard is NARROW. Every non-NUL control
    /// character is storable and stays accepted; broadening this to
    /// `char::is_control()` would turn today's correct `200 + empty page` into
    /// a 4xx and would fail here.
    #[test]
    fn non_nul_control_characters_are_still_accepted() {
        for c in [
            '\n', '\t', '\r', '\u{1b}', '\u{7}', '\u{7f}', '\u{200b}', '\u{202e}',
        ] {
            let term = format!("a{c}b");
            let out = normalize_text_filter(Some(&term), "search")
                .unwrap_or_else(|e| panic!("{c:?} must be accepted, got {e:?}"));
            assert!(
                out.is_some(),
                "{c:?} must normalize to a live filter term, got None"
            );
        }
    }

    /// TEST-6 [acceptance][INV-3] — the guard is defined ONCE, asserted on the
    /// thing that actually distinguishes delegation from a re-fork.
    ///
    /// Status and error code are NOT that thing: `400` + `VALIDATION_ERROR` is
    /// what every hand-rolled `AppError::bad_request("VALIDATION_ERROR", …)`
    /// produces, including the three private copies that existed BEFORE this
    /// module — a test comparing only those two would have passed against the
    /// duplication it is supposed to forbid. The MESSAGE is what a re-fork
    /// changes, so the message format is the assertion: any wrapper must render
    /// exactly `"{field} cannot contain NUL characters"`.
    ///
    /// Living here (rather than importing three feature modules into `common/`,
    /// which would invert the module DAG) as a message-format contract; each
    /// module's own test file asserts that ITS wrapper produces this format.
    #[test]
    fn the_rejection_message_format_is_the_single_contract() {
        for (field, expected) in [
            ("search", "search cannot contain NUL characters"),
            ("Project name", "Project name cannot contain NUL characters"),
            (
                "Group description",
                "Group description cannot contain NUL characters",
            ),
            (
                "Message content",
                "Message content cannot contain NUL characters",
            ),
        ] {
            let err = reject_nul("x\0y", field).expect_err("rejects");
            assert_eq!(err.status_code(), 400, "field {field}");
            assert_eq!(err.error_code(), "VALIDATION_ERROR", "field {field}");
            let rendered = serde_json::to_string(&err).expect("serialize");
            assert!(
                rendered.contains(expected),
                "field {field}: expected message {expected:?}, got {rendered}"
            );
        }
    }

    /// `guard_raw` adds the rejection and NOTHING else — the property that
    /// makes it safe at the four exact-match call sites whose pre-existing code
    /// bound the value untouched. Trimming or blank→None there would widen
    /// `?p=` from "match the empty string" to "no filter at all".
    #[test]
    fn guard_raw_returns_valid_input_byte_for_byte_unchanged() {
        for raw in [None, Some(""), Some("   "), Some("  padded  "), Some("v")] {
            assert_eq!(
                guard_raw(raw, "status").unwrap(),
                raw,
                "guard_raw must not rewrite {raw:?}"
            );
        }
        let err = guard_raw(Some("a\0b"), "status").expect_err("rejects NUL");
        assert_eq!(err.status_code(), 400);
        assert_eq!(err.error_code(), "VALIDATION_ERROR");
    }

    /// The two entry points differ EXACTLY where it matters: on a blank value
    /// `normalize_text_filter` says "no filter" and `guard_raw` preserves the
    /// caller's empty term. Picking the wrong one is the regression this pins.
    #[test]
    fn the_two_entry_points_differ_on_blank_and_that_is_the_point() {
        assert_eq!(normalize_text_filter(Some(""), "p").unwrap(), None);
        assert_eq!(guard_raw(Some(""), "p").unwrap(), Some(""));
        assert_eq!(normalize_text_filter(Some(" x "), "p").unwrap(), Some("x"));
        assert_eq!(guard_raw(Some(" x "), "p").unwrap(), Some(" x "));
    }
}
