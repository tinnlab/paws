//! Shared "operate on a workflow the model authored in its per-conversation
//! sandbox workspace" helpers.
//!
//! The single source of truth for confining a model-/client-supplied `dir` to
//! the CALLER's conversation workspace (`<workspace_root>/<conversation_id>/…`).
//! Used by the `workflow_mcp` `run_from_workspace` / `validate_from_workspace`
//! / `save_workflow` verbs and by the `workspace-save` / `workspace-export`
//! REST endpoints, so the traversal / absolute / symlink-escape guard can
//! never drift between the two surfaces.

use std::path::{Component, Path, PathBuf};

use uuid::Uuid;

use crate::common::AppError;

use super::runner;

/// Reject unless `conversation_id` is owned by `user_id`. The workspace verbs +
/// REST endpoints take a client-supplied `conversation_id`; without this a
/// caller could name ANOTHER user's conversation and read / pack / run that
/// conversation's sandbox-workspace files (cross-tenant IDOR). `get_conversation`
/// is owner-scoped (returns `None` for a non-owned or missing id) → 404, which
/// also avoids leaking whether the conversation exists.
pub async fn require_conversation_owner(
    conversation_id: Option<Uuid>,
    user_id: Uuid,
) -> Result<Uuid, AppError> {
    let conv_id = conversation_id.ok_or_else(|| {
        AppError::bad_request(
            "WORKFLOW_NO_CONVERSATION",
            "this operation requires an active conversation (x-conversation-id)",
        )
    })?;
    crate::core::Repos
        .chat
        .core
        .get_conversation(conv_id, user_id)
        .await?
        .ok_or_else(|| AppError::not_found("conversation"))?;
    Ok(conv_id)
}

/// Resolve `dir` to an absolute, existing directory under the caller's
/// per-conversation sandbox workspace. `dir` is always relative to the
/// caller's OWN conversation — there is no way to name another conversation's
/// or user's workspace. Rejects absolute paths and `..`.
///
/// The RESOLVED root is then required to be a DIRECT CHILD of the conversation
/// workspace root. That — not the shape of the `dir` string — is the guarantee
/// this function provides, and the guarantee
/// [`super::validate::read_prompt_file`]'s anchor open depends on.
pub fn resolve_conversation_workspace_dir(
    conversation_id: Option<Uuid>,
    dir: &str,
) -> Result<PathBuf, AppError> {
    let conv = conversation_id.ok_or_else(|| {
        AppError::bad_request(
            "WORKFLOW_NO_CONVERSATION",
            "this operation requires an active conversation (x-conversation-id)",
        )
    })?;
    if dir.is_empty() {
        return Err(AppError::bad_request(
            "WORKFLOW_DIR_REQUIRED",
            "'dir' (a workspace subdir) is required",
        ));
    }
    let rel = Path::new(dir);
    if rel.is_absolute() {
        return Err(AppError::bad_request(
            "WORKFLOW_WORKSPACE_BAD_DIR",
            "'dir' must be a relative path inside the conversation workspace",
        ));
    }
    // Only Normal components — no `..`, no root/prefix. `./` is tolerated.
    //
    // And exactly ONE of them. This is a cheap early reject with an error the
    // author can act on — it is NOT what establishes the confinement, because a
    // string with one component can still RESOLVE elsewhere (see the
    // canonical-root check below), which is why that check is the authority.
    let mut normals = 0usize;
    for c in rel.components() {
        match c {
            Component::Normal(_) => {
                normals += 1;
            }
            Component::CurDir => {}
            _ => {
                return Err(AppError::bad_request(
                    "WORKFLOW_WORKSPACE_BAD_DIR",
                    "'dir' must not contain '..' or absolute segments",
                ));
            }
        }
    }
    if normals != 1 {
        return Err(AppError::bad_request(
            "WORKFLOW_WORKSPACE_BAD_DIR",
            "'dir' must name a single directory directly inside the conversation \
             workspace — not a nested path, and not the workspace root itself",
        ));
    }
    let base = runner::workflow_workspace_root().join(conv.to_string());
    let candidate = base.join(rel);
    // canonicalize resolves symlinks — the real escape guard. Requires the dir
    // to exist (the model must write the files first).
    let canon = candidate.canonicalize().map_err(|_| {
        AppError::bad_request(
            "WORKFLOW_WORKSPACE_MISSING",
            format!("workspace dir '{dir}' does not exist — write the files first"),
        )
    })?;
    let base_canon = base.canonicalize().unwrap_or(base);
    if !canon.starts_with(&base_canon) {
        return Err(AppError::bad_request(
            "WORKFLOW_WORKSPACE_ESCAPE",
            "'dir' resolves outside the conversation workspace",
        ));
    }
    // THE rule, stated where it is decidable: on the value that is RETURNED.
    //
    // The string check above cannot express it, because `canonicalize` EXPANDS
    // symlinks — `dir = "proj"` with `proj -> a/etc` has exactly one component
    // and still resolves to `<base>/a/etc`, a root with a model-controlled
    // INTERMEDIATE component. That matters because this workspace is
    // bind-mounted READ-WRITE into the code sandbox: a sandbox step can then run
    // `mv a a.bak && ln -s / a` and every later resolution of that root —
    // including `read_prompt_file`'s kernel-confined one — is anchored wherever
    // `a` now points, while the root's path STRING never changes. No race is
    // needed: an earlier step of the same run does the swap, a later step reads.
    //
    // So: the canonical root must be a DIRECT CHILD of the conversation
    // workspace root. The final component is then the only one left under model
    // control, and that is exactly the one `read_prompt_file`'s `O_NOFOLLOW`
    // anchor open refuses to follow. The two rules are one mechanism.
    //
    // STRICT child — the workspace root ITSELF is refused, and not only because
    // `normals == 1` already rejects the `dir: "."` spelling: a symlink
    // `proj -> .` canonicalizes to the root, so the string rule alone would not
    // stop it. Returning the root would make the ephemeral row's
    // `extracted_path` the whole conversation workspace, and
    // `handlers::delete_user_workflow` `remove_dir_all`s that path on uninstall
    // — deleting one throwaway workflow would `rm -rf` every file the user
    // authored in the conversation, plus every prior run's outputs. Refusing it
    // here is what keeps that blast radius scoped to the workflow's own dir.
    //
    // The intermediate components are out of the model's reach because of the
    // sandbox's mount topology, NOT because of anything decidable here:
    // `sdk/crates/ziee-sandbox/src/sandbox.rs` binds `<workspace_root>/<conv>`
    // AT `/home/sandboxuser`, so the guest never sees `<workspace_root>` and
    // cannot rename the conversation dir (that needs write access to a parent
    // it has no path to). Stated as the dependency it is: this rule inherits
    // whatever that bind gives it. A guest that could create its own mounts, or
    // reach the host tree some other way, would be a failure of sandbox
    // confinement — a different boundary from this one, and not one this
    // function can or should try to re-establish.
    if canon.parent() != Some(base_canon.as_path()) {
        return Err(AppError::bad_request(
            "WORKFLOW_WORKSPACE_ESCAPE",
            "'dir' must resolve to a directory directly inside the conversation \
             workspace — not to a nested path, and not to the workspace root \
             itself (symlinks are followed before this is decided)",
        ));
    }
    if !canon.is_dir() {
        return Err(AppError::bad_request(
            "WORKFLOW_WORKSPACE_NOT_DIR",
            format!("workspace path '{dir}' is not a directory"),
        ));
    }
    Ok(canon)
}

/// Re-assert [`resolve_conversation_workspace_dir`]'s rule on a bundle root
/// that was resolved EARLIER and persisted, at the point it is USED.
///
/// `workflow_mcp`'s ephemeral row stores the resolved root in
/// `workflows.extracted_path`, and `spawn_run` / `resume_run` / `run_for_test`
/// read it back from the DB — so the creation-time check alone leaves the rule
/// unenforced for any row written before it existed, or by any future writer
/// that skips the resolver.
///
/// It is a SHAPE check on `extracted_path`'s depth below the workspace root,
/// deliberately NOT a re-resolution: re-canonicalizing the model-controlled tail
/// would be TOCTOU (it can pass and the swap can follow). It engages ONLY for
/// paths under `workspace_root`; an installed or hub bundle's `extracted_path`
/// lives under the app data dir and is not this rule's business.
///
/// SCOPE — what this shape does and does not buy, stated exactly. It restores
/// the precondition `read_prompt_file`'s anchor open needs (one model-controlled
/// component), so the CONFINED reads of `prompt_file:` are sound. It is NOT a
/// claim that every run-time use of the root is confined: `runner::preflight`'s
/// `scripts`/`prompts`/`references` staging copy and the two
/// `read_to_string(extracted_path.join(entry_point))` sites resolve the root
/// with ordinary, symlink-following lookups and are not guarded by anything
/// here. That gap is pre-existing and is recorded in `FIX_ROUND-8.md`, not
/// closed by this function — do not read this check as covering it.
///
/// It is keyed on the workspace ROOT, deliberately not on a conversation id.
/// `preflight`'s `conversation_id.unwrap_or(run_id)` is NOT the conversation
/// that owns the persisted path — `spawn_run` takes an optional client-supplied
/// `conversation_id` and the scheduler always passes `None` — so keying on it
/// would make this check silently inert for exactly the rows it exists to
/// refuse. Ownership is enforced separately (`require_conversation_owner` at
/// resolve time, and the row's own `conversation_id`); this is only the shape.
pub fn check_persisted_workspace_root(
    extracted_path: &Path,
    workspace_root: &Path,
) -> Result<(), AppError> {
    // Normalize the SERVER-CONTROLLED side only. `extracted_path` was stored
    // post-`canonicalize`, while `workspace_root` is rebuilt raw from config on
    // every call — so on a host where the root contains a symlink (macOS's
    // `/var` → `/private/var`, and `std::env::temp_dir()` is under `/var` there)
    // the two are spelled differently, `strip_prefix` matches nothing, and the
    // guard passes by being INERT, which is the worst failure mode a guard has.
    // Canonicalizing the root is normalization, not a security decision: the
    // root is not reachable from inside the sandbox, so nothing can race it.
    let canon_root;
    let root = match workspace_root.canonicalize() {
        Ok(c) => {
            canon_root = c;
            canon_root.as_path()
        }
        Err(_) => workspace_root,
    };
    let Ok(rest) = extracted_path.strip_prefix(root) else {
        return Ok(());
    };
    let depth = rest
        .components()
        .filter(|c| matches!(c, Component::Normal(_)))
        .count();
    // Exactly `<root>/<conversation_id>/<dir>`. Deeper is the nested root this
    // rule exists to refuse; shallower is the conversation workspace root (or
    // the workspace root), neither of which is a bundle — and a row holding the
    // conversation root is the `delete_user_workflow` `rm -rf` hazard that
    // `resolve_conversation_workspace_dir` refuses to mint.
    if depth != 2 {
        return Err(AppError::bad_request(
            "WORKFLOW_WORKSPACE_ESCAPE",
            "this workflow's workspace directory is nested inside the conversation \
             workspace; re-create it directly under the workspace root",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // The helper resolves against `runner::workflow_workspace_root()`, which in
    // tests falls back to a temp dir; to exercise confinement deterministically
    // we assert the pure component-level rejections that don't depend on the
    // root (absolute / traversal / empty / no-conversation), and cover the
    // existence + escape paths in the integration tier where the real root is
    // configured.

    #[test]
    fn t1_confine_requires_conversation_id() {
        let err = resolve_conversation_workspace_dir(None, "flow").unwrap_err();
        assert_eq!(err.error_code(), "WORKFLOW_NO_CONVERSATION");
    }

    #[test]
    fn t1_confine_rejects_absolute() {
        let err = resolve_conversation_workspace_dir(Some(Uuid::new_v4()), "/etc").unwrap_err();
        assert_eq!(err.error_code(), "WORKFLOW_WORKSPACE_BAD_DIR");
    }

    #[test]
    fn t1_confine_rejects_parent_traversal() {
        for bad in ["../../etc", "a/../../b", "..", "a/../../.."] {
            let err = resolve_conversation_workspace_dir(Some(Uuid::new_v4()), bad).unwrap_err();
            assert_eq!(
                err.error_code(),
                "WORKFLOW_WORKSPACE_BAD_DIR",
                "expected traversal rejection for {bad:?}"
            );
        }
    }

    #[test]
    fn t1_confine_rejects_empty() {
        let err = resolve_conversation_workspace_dir(Some(Uuid::new_v4()), "").unwrap_err();
        assert_eq!(err.error_code(), "WORKFLOW_DIR_REQUIRED");
    }

    #[test]
    fn t1_confine_rejects_missing_dir() {
        // A well-formed relative dir that doesn't exist under the (temp) root.
        let err = resolve_conversation_workspace_dir(Some(Uuid::new_v4()), "nope").unwrap_err();
        assert_eq!(err.error_code(), "WORKFLOW_WORKSPACE_MISSING");
    }

    #[test]
    fn t1_confine_accepts_a_single_safe_dir() {
        // Build a real dir under the actual workspace root so canonicalize +
        // confinement succeed end-to-end.
        let conv = Uuid::new_v4();
        let base = runner::workflow_workspace_root().join(conv.to_string());
        let dir = base.join("proj");
        fs::create_dir_all(&dir).unwrap();
        let out = resolve_conversation_workspace_dir(Some(conv), "proj").unwrap();
        assert!(out.ends_with("proj"));
        let _ = fs::remove_dir_all(&base);
    }

    /// A NESTED `dir` is refused: it would put an intermediate directory of the
    /// returned root under the model's control, and that root is bind-mounted
    /// read-write into the code sandbox. `read_prompt_file`'s anchor guard can
    /// only refuse a swapped FINAL component, so the final component has to be
    /// the only one the model can swap.
    #[test]
    fn t1_confine_rejects_nested_dir() {
        let conv = Uuid::new_v4();
        let base = runner::workflow_workspace_root().join(conv.to_string());
        fs::create_dir_all(base.join("proj/flow")).unwrap();
        let out = resolve_conversation_workspace_dir(Some(conv), "proj/flow");
        let _ = fs::remove_dir_all(&base);
        assert_eq!(out.unwrap_err().error_code(), "WORKFLOW_WORKSPACE_BAD_DIR");
    }

    /// **TEST-24** — the rule is a property of the RETURNED ROOT, not of the
    /// `dir` STRING.
    ///
    /// `canonicalize()` EXPANDS symlinks, so a `dir` that passes the
    /// single-component string check can still RESOLVE to a nested root: with
    /// `proj -> a/etc` the returned root is `<base>/a/etc`, whose intermediate
    /// component `a` is model-controlled and lives inside the read-write
    /// bind-mounted workspace. `open_confined`'s anchor open can only refuse a
    /// swapped FINAL component, so a later `mv a a.bak && ln -s / a` re-anchors
    /// every resolution of that root — no race required.
    ///
    /// On failure this test performs the swap and reports what was actually
    /// read, so the escape is evidence rather than an assertion about it.
    #[cfg(unix)]
    #[test]
    fn t1_confine_rejects_a_symlinked_dir_that_resolves_to_a_nested_root() {
        let conv = Uuid::new_v4();
        let base = runner::workflow_workspace_root().join(conv.to_string());
        fs::create_dir_all(base.join("a/etc")).unwrap();
        fs::write(base.join("a/etc/passwd"), "PLANTED-DECOY").unwrap();
        std::os::unix::fs::symlink("a/etc", base.join("proj")).unwrap();

        let resolved = resolve_conversation_workspace_dir(Some(conv), "proj");

        // If it was accepted, prove concretely that the acceptance is an escape.
        let escaped = match &resolved {
            Ok(root) => {
                let decoy = base.join("decoy");
                fs::create_dir_all(decoy.join("etc")).unwrap();
                fs::write(decoy.join("etc/passwd"), "HOST SECRET").unwrap();
                fs::rename(base.join("a"), base.join("a.bak")).unwrap();
                std::os::unix::fs::symlink(&decoy, base.join("a")).unwrap();
                Some((
                    root.clone(),
                    crate::modules::workflow::validate::read_prompt_file(root, "passwd"),
                ))
            }
            Err(_) => None,
        };
        let _ = fs::remove_dir_all(&base);

        if let Some((root, read)) = escaped {
            panic!(
                "'proj' (one component) resolved to {root:?}, a NESTED root; \
                 after swapping the intermediate the confined read returned {read:?}"
            );
        }
        assert_eq!(
            resolved.unwrap_err().error_code(),
            "WORKFLOW_WORKSPACE_ESCAPE",
            "a dir that RESOLVES outside the conversation root's direct children must be refused"
        );
    }

    /// The counterpart to TEST-24: a symlink whose target is still a DIRECT
    /// child of the conversation root is fine — the returned root then has
    /// exactly one model-controlled component, which is the invariant.
    #[cfg(unix)]
    #[test]
    fn t1_confine_accepts_a_symlink_to_a_direct_child() {
        let conv = Uuid::new_v4();
        let base = runner::workflow_workspace_root().join(conv.to_string());
        fs::create_dir_all(base.join("real")).unwrap();
        std::os::unix::fs::symlink("real", base.join("proj")).unwrap();
        let out = resolve_conversation_workspace_dir(Some(conv), "proj");
        let _ = fs::remove_dir_all(&base);
        assert!(out.unwrap().ends_with("real"));
    }

    /// **TEST-27** — the same rule, re-asserted at USE time on the persisted
    /// `extracted_path`. A depth check on the workspace root, so it is decidable
    /// without re-resolving the model-controlled tail.
    ///
    /// The `Uuid::new_v4()` rows are the regression that matters: an earlier
    /// draft keyed this on `preflight`'s `conversation_id.unwrap_or(run_id)`,
    /// which is NOT the conversation that owns the stored path (`spawn_run`
    /// takes an optional client-supplied id and the scheduler passes `None`), so
    /// a nested root under a DIFFERENT conversation's dir sailed through. Keying
    /// on the root makes the conversation id irrelevant to the shape.
    #[test]
    fn t1_persisted_workspace_root_shape_is_rechecked() {
        let root = Path::new("/ws");
        let conv_root = root.join(Uuid::new_v4().to_string());
        // Accepted: exactly `<root>/<conv>/<dir>`.
        let ok = conv_root.join("proj");
        assert!(
            check_persisted_workspace_root(&ok, root).is_ok(),
            "{ok:?} must be accepted"
        );
        // Refused: deeper than a direct child (the shape a pre-rule row holds),
        // under ANY conversation dir; the conversation root itself (the
        // `delete_user_workflow` rm -rf hazard); and the bare workspace root.
        for bad in [
            conv_root.join("a/etc"),
            conv_root.join("a/b/c"),
            root.join(Uuid::new_v4().to_string()).join("a/etc"),
            conv_root.clone(),
            root.to_path_buf(),
        ] {
            assert_eq!(
                check_persisted_workspace_root(&bad, root)
                    .unwrap_err()
                    .error_code(),
                "WORKFLOW_WORKSPACE_ESCAPE",
                "{bad:?} must be refused"
            );
        }
        // Untouched: an installed / hub bundle root lives outside the workspace
        // entirely and must not be constrained by this rule.
        assert!(
            check_persisted_workspace_root(Path::new("/data/workflows/abc/def"), root).is_ok(),
            "an installed bundle root is not this rule's business"
        );
    }

    /// The normal-form leg of TEST-27: `extracted_path` is stored canonicalized
    /// while `workspace_root` is rebuilt raw, so a root reached through a
    /// symlink must still match. If it does not, `strip_prefix` matches nothing
    /// and the guard passes by being INERT — a silent no-op, not a refusal.
    #[cfg(unix)]
    #[test]
    fn t1_persisted_check_survives_a_symlinked_workspace_root() {
        let tmp = tempfile::tempdir().unwrap();
        let real = tmp.path().join("real-root");
        fs::create_dir_all(&real).unwrap();
        let via_link = tmp.path().join("link-root");
        std::os::unix::fs::symlink(&real, &via_link).unwrap();
        // Stored path is canonical (under `real`); the root is spelled via the
        // symlink, exactly as `workflow_workspace_root()` would rebuild it.
        let stored = real
            .canonicalize()
            .unwrap()
            .join(Uuid::new_v4().to_string())
            .join("a/etc");
        assert_eq!(
            check_persisted_workspace_root(&stored, &via_link)
                .unwrap_err()
                .error_code(),
            "WORKFLOW_WORKSPACE_ESCAPE",
            "a symlinked workspace root must not make the check inert"
        );
    }

    /// **TEST-25** — the resolved root is never the conversation workspace ROOT
    /// itself, by either spelling.
    ///
    /// `dir: "."` is the obvious one and the string rule catches it. The one
    /// that matters is `proj -> .`: a single-component `dir` whose symlink
    /// canonicalizes back to the root, which the string rule cannot see. Both
    /// must be refused, because a root returned here becomes the ephemeral row's
    /// `extracted_path`, and `delete_user_workflow` `remove_dir_all`s that path
    /// — the whole conversation workspace, not one workflow's dir.
    #[test]
    fn t1_confine_refuses_the_workspace_root_itself() {
        let conv = Uuid::new_v4();
        let base = runner::workflow_workspace_root().join(conv.to_string());
        fs::create_dir_all(&base).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(".", base.join("proj")).unwrap();
        let dot = resolve_conversation_workspace_dir(Some(conv), ".");
        let dotslash = resolve_conversation_workspace_dir(Some(conv), "./");
        #[cfg(unix)]
        let via_link = resolve_conversation_workspace_dir(Some(conv), "proj");
        let _ = fs::remove_dir_all(&base);

        assert_eq!(
            dot.unwrap_err().error_code(),
            "WORKFLOW_WORKSPACE_BAD_DIR",
            "'.' must not resolve to the conversation workspace root"
        );
        assert_eq!(
            dotslash.unwrap_err().error_code(),
            "WORKFLOW_WORKSPACE_BAD_DIR"
        );
        #[cfg(unix)]
        assert_eq!(
            via_link.unwrap_err().error_code(),
            "WORKFLOW_WORKSPACE_ESCAPE",
            "a symlink resolving BACK to the workspace root must be refused too — \
             the string rule cannot see this one"
        );
    }
}
