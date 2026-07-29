//! Atomic, cross-process-safe extraction of an embedded binary to disk.
//!
//! Every embedded-binary module (`file/utils`, `bio_mcp`, `mcp/utils`) used to
//! do `if !target.exists() { fs::write(target, bytes) }` guarded only by an
//! in-process `OnceCell`. That is safe within ONE process but NOT across
//! processes: two server processes (concurrent git-worktree test/dev runs
//! sharing `~/.ziee/bin`) both observe `!exists`, both `fs::write` the SAME final
//! path, and a reader can `exec` a half-written / torn binary.
//!
//! This helper closes that race the way `code_sandbox/embedded.rs` already does
//! for its bundle: write the bytes to a same-directory temp file, then
//! `fs::rename` it into place (POSIX rename is atomic per-file and replaces the
//! destination) — a reader ever sees either the old complete file or the new
//! complete file, never a partial. An advisory `flock` (Unix) around the whole
//! operation additionally serializes concurrent extractors of the SAME binary so
//! they don't each redundantly write; distinct binaries take distinct per-name
//! locks and still extract concurrently. On non-Unix the atomic rename alone
//! provides the torn-file guarantee (flock is best-effort serialization, not the
//! correctness mechanism).

use crate::common::AppError;
use std::path::Path;

/// True when `target` already holds the intact embedded payload (exists AND its
/// size equals the embedded byte length). A short/torn leftover fails this and
/// is re-extracted.
fn is_intact(target: &Path, expected_len: u64) -> bool {
    std::fs::metadata(target)
        .map(|m| m.is_file() && m.len() == expected_len)
        .unwrap_or(false)
}

#[cfg(unix)]
fn set_executable(target: &Path, label: &str) -> Result<(), AppError> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(target)
        .map_err(|e| AppError::internal_error(format!("Failed to stat {label}: {e}")))?
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(target, perms)
        .map_err(|e| AppError::internal_error(format!("Failed to set {label} permissions: {e}")))
}

/// A best-effort advisory exclusive lock over a per-binary lock file
/// (`<dir>/.extract-<name>.lock`). Held for the lifetime of the guard; the
/// kernel releases it on `close`/process exit, so a crash can't wedge it.
struct ExtractLock {
    #[cfg(unix)]
    file: std::fs::File,
}

impl ExtractLock {
    /// Acquire the lock for `target`'s file name under `target`'s parent dir.
    /// Non-fatal: a lock failure (e.g. an exotic FS) degrades to "no serialization"
    /// — the atomic rename still guarantees no torn file — so we log and proceed.
    fn acquire(target: &Path) -> Option<Self> {
        let parent = target.parent()?;
        let name = target.file_name()?.to_string_lossy();
        let lock_path = parent.join(format!(".extract-{name}.lock"));
        #[cfg(unix)]
        {
            use std::os::unix::io::AsRawFd;
            let file = match std::fs::OpenOptions::new()
                .create(true)
                .truncate(false)
                .write(true)
                .open(&lock_path)
            {
                Ok(f) => f,
                Err(e) => {
                    tracing::debug!("extract-lock open failed ({e}); proceeding without flock");
                    return None;
                }
            };
            // LOCK_EX blocks until the sibling extractor releases (extraction is
            // fast; a bounded wait is correct here).
            let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
            if rc != 0 {
                tracing::debug!("flock(LOCK_EX) failed; proceeding without serialization");
                return None;
            }
            Some(ExtractLock { file })
        }
        #[cfg(not(unix))]
        {
            let _ = lock_path;
            Some(ExtractLock {})
        }
    }
}

#[cfg(unix)]
impl Drop for ExtractLock {
    fn drop(&mut self) {
        use std::os::unix::io::AsRawFd;
        // Explicit unlock; the fd close on drop would release anyway.
        unsafe { libc::flock(self.file.as_raw_fd(), libc::LOCK_UN) };
    }
}

/// Extract `bytes` to `target` atomically and (on Unix) mark it executable.
///
/// Idempotent + cross-process-safe:
///   * fast-returns when `target` already holds the intact payload;
///   * serializes concurrent same-binary extractors with an advisory flock;
///   * writes a `<dir>/.<name>.<pid>.tmp` staging file on the SAME filesystem
///     then `fs::rename`s it into place, so a reader never observes a partial.
///
/// `target`'s parent directory must already exist (callers create `bin/`).
pub fn extract_atomic(label: &str, bytes: &[u8], target: &Path) -> Result<(), AppError> {
    let expected_len = bytes.len() as u64;

    // Fast path: intact file already present, no lock needed.
    if is_intact(target, expected_len) {
        tracing::debug!("{label} already extracted at {target:?}");
        return Ok(());
    }

    let parent = target.parent().ok_or_else(|| {
        AppError::internal_error(format!("extract target {target:?} has no parent dir"))
    })?;

    // Serialize concurrent extractors of THIS binary (best-effort).
    let _lock = ExtractLock::acquire(target);

    // Re-check under the lock: a sibling extractor may have completed while we
    // waited, in which case we must NOT re-write.
    if is_intact(target, expected_len) {
        tracing::debug!("{label} extracted by a concurrent process; skipping");
        return Ok(());
    }

    tracing::info!("Extracting embedded {label} to {target:?}");

    // Same-directory temp so the rename is intra-filesystem (atomic). The pid
    // suffix keeps two processes' temp files distinct even without the lock.
    let file_name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "binary".to_string());
    let tmp = parent.join(format!(".{file_name}.{}.tmp", std::process::id()));

    // Write + fsync the temp file, then set perms BEFORE the rename so the file
    // is executable the instant it appears at the final path.
    {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp).map_err(|e| {
            AppError::internal_error(format!("Failed to create temp for {label}: {e}"))
        })?;
        f.write_all(bytes).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            AppError::internal_error(format!("Failed to write {label}: {e}"))
        })?;
        f.sync_all().map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            AppError::internal_error(format!("Failed to fsync {label}: {e}"))
        })?;
    }

    #[cfg(unix)]
    if let Err(e) = set_executable(&tmp, label) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }

    std::fs::rename(&tmp, target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        AppError::internal_error(format!("Failed to install {label} (rename): {e}"))
    })?;

    tracing::info!("Successfully extracted {label} ({} bytes)", bytes.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::sync::{Arc, Barrier};

    fn sha(bytes: &[u8]) -> String {
        let mut h = Sha256::new();
        h.update(bytes);
        hex::encode(h.finalize())
    }

    /// (a) extract writes the exact bytes atomically; no torn final.
    #[test]
    fn extract_writes_exact_bytes_via_rename() {
        let dir = std::env::temp_dir().join(format!("ziee-extract-a-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("payload.bin");
        let payload: Vec<u8> = (0..64_000u32).map(|i| (i % 251) as u8).collect();

        extract_atomic("payload", &payload, &target).unwrap();

        let on_disk = std::fs::read(&target).unwrap();
        assert_eq!(sha(&on_disk), sha(&payload), "on-disk bytes match source");
        // No leftover temp files.
        let tmps: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp"))
            .collect();
        assert!(tmps.is_empty(), "no temp files left behind");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// (b) N CONCURRENT extractors under the flock produce a byte-/sha256-intact
    /// final file identical to the source — never a partial.
    #[test]
    fn concurrent_extract_never_torn() {
        let dir = std::env::temp_dir().join(format!("ziee-extract-b-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("concurrent.bin");
        // A large payload widens the torn-write window a naive fs::write would hit.
        let payload: Arc<Vec<u8>> = Arc::new((0..512_000u32).map(|i| (i % 253) as u8).collect());
        let want = sha(&payload);

        let n = 8;
        let barrier = Arc::new(Barrier::new(n));
        let mut handles = Vec::new();
        for _ in 0..n {
            let b = barrier.clone();
            let p = payload.clone();
            let t = target.clone();
            handles.push(std::thread::spawn(move || {
                b.wait();
                extract_atomic("concurrent", &p, &t).unwrap();
                // Every observer that returns must see the COMPLETE file.
                let got = std::fs::read(&t).unwrap();
                sha(&got)
            }));
        }
        for h in handles {
            assert_eq!(h.join().unwrap(), want, "every reader saw the intact file");
        }
        assert_eq!(sha(&std::fs::read(&target).unwrap()), want);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// (c) an already-present intact file is NOT re-written (mtime unchanged).
    #[test]
    fn intact_file_is_not_rewritten() {
        let dir = std::env::temp_dir().join(format!("ziee-extract-c-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("stable.bin");
        let payload = vec![7u8; 4096];

        extract_atomic("stable", &payload, &target).unwrap();
        let mtime1 = std::fs::metadata(&target).unwrap().modified().unwrap();

        // Second call with identical bytes must be a no-op (fast intact path).
        std::thread::sleep(std::time::Duration::from_millis(20));
        extract_atomic("stable", &payload, &target).unwrap();
        let mtime2 = std::fs::metadata(&target).unwrap().modified().unwrap();

        assert_eq!(mtime1, mtime2, "intact file must not be re-written");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A short/torn leftover at the target IS replaced (size mismatch → re-extract).
    #[test]
    fn torn_leftover_is_replaced() {
        let dir = std::env::temp_dir().join(format!("ziee-extract-d-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("torn.bin");
        std::fs::write(&target, b"partial").unwrap(); // shorter than payload

        let payload = vec![3u8; 10_000];
        extract_atomic("torn", &payload, &target).unwrap();
        assert_eq!(std::fs::read(&target).unwrap().len(), payload.len());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
