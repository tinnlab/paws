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

    /// TEST-4 [acceptance][INV-2] — REJECT, never strip. A pure "returns Err"
    /// assertion would still pass against a stripping implementation that
    /// errored for some other reason, so this asserts the result is never an
    /// `Ok` carrying the NUL-stripped term.
    #[test]
    fn nul_is_rejected_never_silently_stripped() {
        for (input, stripped) in [("a\0b", "ab"), ("\0lead", "lead"), ("trail\0", "trail")] {
            let out = normalize_text_filter(Some(input), "search");
            assert!(
                out.is_err(),
                "input {input:?} must be refused, not normalized"
            );
            assert_ne!(
                out.ok().flatten(),
                Some(stripped),
                "input {input:?} must NEVER be silently rewritten to {stripped:?} — \
                 that would return hits the caller did not ask for"
            );
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

    /// TEST-6 [acceptance][INV-3] — the guard is defined ONCE. Each of the
    /// three pre-existing per-module wrappers must produce the same status and
    /// error code as the shared definition; this fails the moment one drifts.
    #[test]
    fn the_three_per_module_wrappers_agree_with_the_shared_definition() {
        let shared = reject_nul("x\0y", "field").expect_err("shared rejects");

        let wrappers: [(&str, AppError); 3] = [
            (
                "project::handlers::reject_nul",
                crate::modules::project::handlers::reject_nul("x\0y", "Project name")
                    .expect_err("project wrapper rejects"),
            ),
            (
                "user::handlers::groups::reject_nul",
                crate::modules::user::handlers::groups::reject_nul("x\0y", "Group description")
                    .expect_err("groups wrapper rejects"),
            ),
            (
                "chat::…::validation::reject_nul_in_content",
                crate::modules::chat::core::handlers::validation::reject_nul_in_content("x\0y")
                    .expect_err("chat wrapper rejects"),
            ),
        ];

        for (name, err) in wrappers {
            assert_eq!(
                err.status_code(),
                shared.status_code(),
                "{name} drifted from the shared guard's status"
            );
            assert_eq!(
                err.error_code(),
                shared.error_code(),
                "{name} drifted from the shared guard's error code"
            );
        }
    }
}
