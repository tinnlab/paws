-- Point the built-in anonymous default-model repository at the tinnlab mirror.
--
-- WHY THIS IS A SEPARATE MIGRATION AND NOT AN EDIT TO 202607210100
-- ----------------------------------------------------------------
-- The mirror swap was first shipped by EDITING `202607210100` in place. Any
-- install that had already applied that version — every machine running an
-- earlier build — then failed to boot: `sqlx::migrate!` validates each
-- migration's checksum against `_sqlx_migrations`, and the migrator is
-- configured with `set_ignore_missing(true)` only, which ignores migrations
-- present in the DB but absent from source and does NOT disable checksum
-- validation. The mismatch aborted migrations, the embedded server never
-- started, and the UI showed "Load failed" plus the first-run setup page — a
-- failure that looks like an auth problem and is not.
--
-- A FRESH install was fine, which is exactly why it shipped: every test runs
-- against a fresh database. The upgrade path — what real users take — was the
-- only broken one.
--
-- Rule this encodes: an applied migration is IMMUTABLE. Pre-release is not an
-- exception; a maintainer's test machine counts as "anywhere".
--
-- WHY tinnlab
-- -----------
-- `tinnlab/Qwen3.5-9B-GGUF` is a byte-identical mirror of
-- `unsloth/Qwen3.5-9B-GGUF`, published by Tin Nguyen Lab so a shipped first-run
-- flow does not depend on a third-party repository that can be deleted, renamed
-- or rewritten. Nothing pins a revision at install time — the LFS client asks
-- for `refs/heads/main` and takes what is there. It is a REDISTRIBUTION, not our
-- own build: the weights are Qwen's (`Qwen/Qwen3.5-9B`, Apache-2.0) and the GGUF
-- quantization is unsloth's; both are credited in the mirror's README and NOTICE.
--
-- Verified against the live hosts on 2026-08-24: anonymous `git ls-remote`
-- returns `refs/heads/main` at d6a7d0fa527ef18d9b2a7bcf63e7d645bc1dad06, and the
-- blob HEAD returns `x-linked-size: 5680522464` with
-- `x-linked-etag: 03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8`
-- — the SAME oid and size upstream returns for its copy. That sha256 is pinned
-- app-side at `defaultModel.ts::DEFAULT_MODEL_FILE_SHA256`.
--
-- SCOPE OF THE UPDATE
-- -------------------
-- Guarded on the OLD url, so it is:
--   * idempotent — re-running changes nothing;
--   * a no-op on a fresh database, where 202607210100 has just inserted the row
--     with values this statement would not match... except that on a fresh DB
--     202607210100 inserts the UNSLOTH url (it is the previously-shipped file,
--     restored byte-for-byte), so this statement is what moves it. Both orders
--     therefore converge on the same final state.
--   * silent on a row somebody has since pointed elsewhere — we only rewrite the
--     exact value we shipped, never whatever an operator chose. `built_in` rows
--     are edit-denied in the UI, so a divergent value means a deliberate manual
--     change; overwriting it would be the migration reversing a human decision.
--
-- `updated_at` is bumped so the change is visible in the row's own history.

UPDATE public.llm_repositories
SET
    name = 'Hugging Face (tinnlab, anonymous)',
    url = 'https://huggingface.co/tinnlab',
    updated_at = '2026-07-21 02:00:00+00'
WHERE id = 'b3f1c5d2-7a48-4e91-9c26-5d0e8f3a1b74'
  AND url = 'https://huggingface.co/unsloth';
