//! Database repository for whisper runtime versions (`voice_runtime_versions`).
//!
//! Single-engine analog of `llm_local_runtime::runtime_version::repository`
//! (no `engine` column). Plain async fns over the pool; queries are
//! compile-time-checked against the build DB (migration 151 creates the table).

use crate::modules::voice::runtime_version::models::RuntimeVersion;
use chrono::DateTime;
use sqlx::PgPool;
use uuid::Uuid;

/// Create a new runtime version record.
pub async fn create(
    pool: &PgPool,
    version: &str,
    platform: &str,
    arch: &str,
    backend: &str,
    binary_path: &str,
) -> Result<RuntimeVersion, sqlx::Error> {
    let record = sqlx::query!(
        r#"INSERT INTO voice_runtime_versions
           (version, platform, arch, backend, binary_path, is_system_default)
           VALUES ($1, $2, $3, $4, $5, false)
           RETURNING id, version, platform, arch, backend, binary_path,
                     is_system_default, created_at"#,
        version,
        platform,
        arch,
        backend,
        binary_path
    )
    .fetch_one(pool)
    .await?;

    Ok(RuntimeVersion {
        id: record.id,
        version: record.version,
        platform: record.platform,
        arch: record.arch,
        backend: record.backend,
        binary_path: record.binary_path,
        is_system_default: record.is_system_default,
        created_at: DateTime::from_timestamp(record.created_at.unix_timestamp(), 0)
            .unwrap_or_default(),
    })
}

/// Get a runtime version by id.
pub async fn get_by_id(pool: &PgPool, id: Uuid) -> Result<Option<RuntimeVersion>, sqlx::Error> {
    let record = sqlx::query!(
        r#"SELECT id, version, platform, arch, backend, binary_path,
                  is_system_default, created_at
           FROM voice_runtime_versions
           WHERE id = $1"#,
        id
    )
    .fetch_optional(pool)
    .await?;

    Ok(record.map(|r| RuntimeVersion {
        id: r.id,
        version: r.version,
        platform: r.platform,
        arch: r.arch,
        backend: r.backend,
        binary_path: r.binary_path,
        is_system_default: r.is_system_default,
        created_at: DateTime::from_timestamp(r.created_at.unix_timestamp(), 0).unwrap_or_default(),
    }))
}

/// Get a runtime version by its (version, platform, arch, backend) identity —
/// the dedup lookup the download+register path uses before inserting.
pub async fn get_by_identity(
    pool: &PgPool,
    version: &str,
    platform: &str,
    arch: &str,
    backend: &str,
) -> Result<Option<RuntimeVersion>, sqlx::Error> {
    let record = sqlx::query!(
        r#"SELECT id, version, platform, arch, backend, binary_path,
                  is_system_default, created_at
           FROM voice_runtime_versions
           WHERE version = $1 AND platform = $2 AND arch = $3 AND backend = $4"#,
        version,
        platform,
        arch,
        backend
    )
    .fetch_optional(pool)
    .await?;

    Ok(record.map(|r| RuntimeVersion {
        id: r.id,
        version: r.version,
        platform: r.platform,
        arch: r.arch,
        backend: r.backend,
        binary_path: r.binary_path,
        is_system_default: r.is_system_default,
        created_at: DateTime::from_timestamp(r.created_at.unix_timestamp(), 0).unwrap_or_default(),
    }))
}

/// Maximum page size — acts as a safety cap.
const MAX_PAGE_SIZE: i64 = 500;

/// List all runtime versions (paginated, newest first).
pub async fn list_all(
    pool: &PgPool,
    page: i64,
    per_page: i64,
) -> Result<Vec<RuntimeVersion>, sqlx::Error> {
    let limit = per_page.clamp(1, MAX_PAGE_SIZE);
    let offset = (page.max(1) - 1) * limit;
    let records = sqlx::query!(
        r#"SELECT id, version, platform, arch, backend, binary_path,
                  is_system_default, created_at
           FROM voice_runtime_versions
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2"#,
        limit,
        offset
    )
    .fetch_all(pool)
    .await?;

    Ok(records
        .into_iter()
        .map(|r| RuntimeVersion {
            id: r.id,
            version: r.version,
            platform: r.platform,
            arch: r.arch,
            backend: r.backend,
            binary_path: r.binary_path,
            is_system_default: r.is_system_default,
            created_at: DateTime::from_timestamp(r.created_at.unix_timestamp(), 0)
                .unwrap_or_default(),
        })
        .collect())
}

/// Get the latest runtime version (by `created_at`).
pub async fn get_latest_version(pool: &PgPool) -> Result<Option<RuntimeVersion>, sqlx::Error> {
    let record = sqlx::query!(
        r#"SELECT id, version, platform, arch, backend, binary_path,
                  is_system_default, created_at
           FROM voice_runtime_versions
           ORDER BY created_at DESC
           LIMIT 1"#,
    )
    .fetch_optional(pool)
    .await?;

    Ok(record.map(|r| RuntimeVersion {
        id: r.id,
        version: r.version,
        platform: r.platform,
        arch: r.arch,
        backend: r.backend,
        binary_path: r.binary_path,
        is_system_default: r.is_system_default,
        created_at: DateTime::from_timestamp(r.created_at.unix_timestamp(), 0).unwrap_or_default(),
    }))
}

/// Get the system default runtime version, if one is set.
pub async fn get_system_default(pool: &PgPool) -> Result<Option<RuntimeVersion>, sqlx::Error> {
    let record = sqlx::query!(
        r#"SELECT id, version, platform, arch, backend, binary_path,
                  is_system_default, created_at
           FROM voice_runtime_versions
           WHERE is_system_default = true"#,
    )
    .fetch_optional(pool)
    .await?;

    Ok(record.map(|r| RuntimeVersion {
        id: r.id,
        version: r.version,
        platform: r.platform,
        arch: r.arch,
        backend: r.backend,
        binary_path: r.binary_path,
        is_system_default: r.is_system_default,
        created_at: DateTime::from_timestamp(r.created_at.unix_timestamp(), 0).unwrap_or_default(),
    }))
}

/// Advisory-lock key serializing every "promote this version to system
/// default" operation across the whole cluster (so it also holds between two
/// server processes sharing one database, which a per-process mutex would not).
/// Arbitrary but stable; the only requirement is that no other subsystem picks
/// the same number.
const PROMOTE_DEFAULT_LOCK_KEY: i64 = 0x7601_0001_0000_0001;

/// Promote `version_id` to THE system default: clear whatever holds the flag
/// and set it on this row, atomically and serialized.
///
/// Returns `false` (with the transaction rolled back, so nothing is cleared)
/// when `version_id` does not exist — the caller turns that into a 404.
///
/// WHY A TRANSACTION IS NECESSARY BUT NOT SUFFICIENT
///
/// The previous shape ran `clear_system_default` and then `set_system_default`
/// as two autocommitted statements on a bare pool. `voice_runtime_versions_one_default`
/// is `UNIQUE (is_system_default) WHERE is_system_default = true`, so two
/// concurrent promotions interleaving as
/// `clear(A) · clear(B) · set(A) · set(B)` made the last statement trip 23505,
/// which `AppError::database_error` flattened into `500 SYSTEM_DATABASE_ERROR`
/// — and the caller was left believing it had set a default it had not.
///
/// Wrapping the pair in a transaction alone does NOT fix it. Under READ
/// COMMITTED the second transaction's `clear` runs against a snapshot taken
/// before the first transaction committed, so it never sees (and therefore
/// never clears) the row the winner just set; its `set` then collides exactly
/// as before. Serializing the whole read-modify-write is the actual
/// requirement, so the transaction opens by taking a transaction-scoped
/// advisory lock: the loser waits, then re-reads fresh (each statement in READ
/// COMMITTED takes a new snapshot), clears the winner's row, and sets its own.
/// Both callers succeed and exactly one default survives.
pub async fn promote_to_system_default(
    pool: &PgPool,
    version_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;

    // Serialize against every other promotion. Released automatically when the
    // transaction commits or rolls back (including on a dropped connection).
    sqlx::query!("SELECT pg_advisory_xact_lock($1)", PROMOTE_DEFAULT_LOCK_KEY)
        .execute(&mut *tx)
        .await?;

    sqlx::query!(
        r#"UPDATE voice_runtime_versions
           SET is_system_default = false
           WHERE is_system_default = true AND id <> $1"#,
        version_id,
    )
    .execute(&mut *tx)
    .await?;

    let promoted = sqlx::query_scalar!(
        r#"UPDATE voice_runtime_versions
           SET is_system_default = true
           WHERE id = $1
           RETURNING id"#,
        version_id,
    )
    .fetch_optional(&mut *tx)
    .await?
    .is_some();

    if !promoted {
        // Unknown id: roll back so a bad request cannot leave the deployment
        // with NO default (the old code's pre-check kept that safe only
        // because it ran before the clear).
        tx.rollback().await?;
        return Ok(false);
    }

    tx.commit().await?;
    Ok(true)
}

/// Delete a runtime version row.
pub async fn delete(pool: &PgPool, version_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"DELETE FROM voice_runtime_versions WHERE id = $1"#,
        version_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// FK dependents of a whisper runtime version. The singleton
/// `voice_runtime_instance.runtime_version_id` is `ON DELETE SET NULL`, so the
/// DB would silently null the instance out rather than erroring — the delete
/// guard counts it here and refuses instead.
pub struct VersionUsage {
    /// The singleton instance currently `running` on this version (0 or 1).
    pub running_instances: i64,
    /// The singleton instance referencing this version regardless of run state.
    pub referencing_instances: i64,
}

/// Count instance dependents of `version_id`.
pub async fn usage(pool: &PgPool, version_id: Uuid) -> Result<VersionUsage, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT
          (SELECT COUNT(*) FROM voice_runtime_instance
             WHERE runtime_version_id = $1 AND status = 'running') AS "running_instances!",
          (SELECT COUNT(*) FROM voice_runtime_instance
             WHERE runtime_version_id = $1) AS "referencing_instances!"
        "#,
        version_id,
    )
    .fetch_one(pool)
    .await?;

    Ok(VersionUsage {
        running_instances: row.running_instances,
        referencing_instances: row.referencing_instances,
    })
}
