// Request-field validators shared by the message-write handlers.
//
// Both live here rather than inline so they are Tier-1 unit-testable without
// the HTTP layer (same shape as `assistant::handlers::validate_assistant_name`
// and `project::handlers::reject_nul`).

use crate::common::AppError;

/// The values `branches.fork_level` accepts, enforced in the schema by
/// `branches_fork_level_check`.
const FORK_LEVELS: [&str; 2] = ["user", "assistant"];

/// Reject a message body containing U+0000.
///
/// User message text is persisted into `message_contents.content`, a `jsonb`
/// column, so the byte arrives as the JSON escape ` ` — which Postgres
/// cannot convert to text (`22P05 unsupported Unicode escape sequence`).
/// `AppError::database_error` flattened that into a generic 500
/// `SYSTEM_DATABASE_ERROR` on the core chat send path.
///
/// Deliberately narrower than the assistant-name gate: `\n`/`\t` and every
/// other control character are legitimate inside a chat message, so only the
/// one byte the storage layer physically cannot hold is rejected.
pub(crate) fn reject_nul_in_content(content: &str) -> Result<(), AppError> {
    if content.contains('\0') {
        return Err(AppError::bad_request(
            "VALIDATION_ERROR",
            "Message content cannot contain NUL characters",
        ));
    }
    Ok(())
}

/// Reject a `fork_level` outside the CHECK-constrained vocabulary.
///
/// The field is a free-form `String` on the wire, so any other value reached
/// the `branches` INSERT and tripped `branches_fork_level_check` (`23514`) as
/// a generic 500 instead of telling the caller which values are legal.
pub(crate) fn validate_fork_level(fork_level: &str) -> Result<(), AppError> {
    if !FORK_LEVELS.contains(&fork_level) {
        return Err(AppError::bad_request(
            "INVALID_FORK_LEVEL",
            format!(
                "fork_level must be one of {} (got '{fork_level}')",
                FORK_LEVELS.join(" / ")
            ),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_without_nul_is_accepted() {
        for c in [
            "",
            "hello",
            "line one\nline two\ttabbed",
            "🧬 astral + emoji 𝕏",
            "' OR '1'='1; DROP TABLE users;--",
            &"A".repeat(100_000),
        ] {
            assert!(reject_nul_in_content(c).is_ok(), "input {c:?}");
        }
    }

    #[test]
    fn content_with_nul_is_rejected_as_a_validation_error() {
        let err = reject_nul_in_content("hello\0world").expect_err("expected rejection");
        assert_eq!(err.status_code(), 400);
        assert_eq!(err.error_code(), "VALIDATION_ERROR");
    }

    #[test]
    fn fork_level_accepts_exactly_the_check_constraint_vocabulary() {
        assert!(validate_fork_level("user").is_ok());
        assert!(validate_fork_level("assistant").is_ok());
    }

    #[test]
    fn fork_level_rejects_anything_else() {
        for bad in ["", "User", "system", "bogus-level", "user\0"] {
            let err = validate_fork_level(bad).expect_err("expected rejection");
            assert_eq!(err.status_code(), 400, "input {bad:?}");
            assert_eq!(err.error_code(), "INVALID_FORK_LEVEL", "input {bad:?}");
        }
    }
}
