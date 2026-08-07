//! Shared group-existence guard for the entity → groups assignment endpoints.
//!
//! Four modules expose the same "replace this entity's group set" shape, each
//! writing a join table whose `group_id` is an FK to `groups(id)`:
//!
//! | endpoint | join table |
//! |---|---|
//! | `POST /api/skills/system/{id}/groups` | `group_skills` |
//! | `POST /api/mcp/system-servers/{id}/groups` | `user_group_mcp_servers` |
//! | `POST /api/workflows/system/{id}/groups` | `group_workflows` |
//! | `POST /api/llm-providers/{id}/groups` | `user_group_llm_providers` |
//!
//! None of them validated the incoming ids. The admin pages load the group
//! list once and save later, so a group deleted in between arrives as a
//! dangling id, the INSERT raises `23503`, and `AppError::database_error`
//! flattens it into a generic 500 the admin cannot act on.
//!
//! The four handlers were copy-paste, not a shared abstraction — this IS that
//! abstraction, so one contract covers all of them and the next `*/groups`
//! endpoint inherits it instead of re-deriving the omission.

use sqlx::PgPool;
use uuid::Uuid;

use crate::common::AppError;

/// 400 `GROUP_NOT_FOUND` when any of `ids` is not a row in `groups`.
///
/// Call BEFORE writing the join table. An empty slice is trivially fine
/// (clearing an entity's group set must stay a valid, cheap no-op).
pub async fn reject_unknown_group_ids(pool: &PgPool, ids: &[Uuid]) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    let missing: Vec<Uuid> = sqlx::query_scalar!(
        r#"
        SELECT candidate as "candidate!"
        FROM UNNEST($1::uuid[]) AS candidate
        WHERE NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = candidate)
        "#,
        ids,
    )
    .fetch_all(pool)
    .await
    .map_err(AppError::database_error)?;

    if missing.is_empty() {
        return Ok(());
    }
    let named = missing
        .iter()
        .map(Uuid::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    Err(AppError::bad_request(
        "GROUP_NOT_FOUND",
        format!(
            "these groups no longer exist: {named} — reload the page and pick from the current groups"
        ),
    ))
}
