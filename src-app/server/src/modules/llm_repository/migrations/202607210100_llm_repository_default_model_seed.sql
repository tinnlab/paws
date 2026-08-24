-- ITEM-1 / INV-1 / INV-5 — seed the ANONYMOUS repository the default local
-- model is installed from.
--
-- Realizes `docs/design/default-model-onboarding.md`: a new user must be able
-- to finish Onboarding with a working model WITHOUT bringing an API key. Both
-- rows seeded by `202607145040_llm_repository_seed.sql` are credentialed
-- (`api_key` / `bearer_token`), so first-run value was conditional on the user
-- already having an account somewhere.
--
-- `auth_type = 'none'` is first-class: `RepositoryAuthConfig::has_credential_for`
-- returns true for it unconditionally, and the download path maps it to
-- `(None, None)` — no username, no token ever reaches git or the LFS client
-- (`llm_model/handlers/uploads.rs`, the `"none" | _` arm). Hugging Face public
-- repos clone anonymously, so this needs no hosting, no LFS store and no
-- credential of any kind (INV-1).
--
-- WHY THE URL IS ORG-SCOPED (`…/tinnlab`, not `https://huggingface.co`)
-- ---------------------------------------------------------------------
-- `llm_repositories` carries `UNIQUE (url)` and the credentialed
-- `Hugging Face Hub` row already holds the bare origin, so a second row there
-- is impossible. An org-scoped Hugging Face base is a supported, documented
-- shape rather than a workaround: `llm_repository/utils.rs::is_usable_repository_base`
-- states outright that "a row at `https://huggingface.co/<org>` plus a
-- repository_path of `<model>` builds `huggingface.co/<org>/<model>`, which is
-- a real model URL", and `GitService::build_repository_url` composes it that
-- way. The model's `repository_path` is therefore `Qwen3.5-9B-GGUF`, NOT
-- `tinnlab/Qwen3.5-9B-GGUF`.
--
-- The row is `built_in` + `enabled` so a fresh install has it with no admin
-- action (INV-5); `built_in` also makes its name / URL / auth_type immutable
-- through the API, which is the existing protection against an operator
-- re-pointing a seeded repository at an attacker-controlled host.
--
-- Columns are named explicitly rather than positionally. The sibling seed is a
-- squashed pg_dump baseline where positional `VALUES` was mechanical output;
-- for a hand-written migration, naming the columns is what keeps this file
-- correct if the table gains one later.
--
-- `ON CONFLICT DO NOTHING` covers the upgrade case where an operator had
-- already added this exact URL by hand — their row wins and the migration is a
-- no-op rather than a failed upgrade. On a fresh database the insert always
-- applies, which is the case INV-5 is about.
--
-- WHY `tinnlab` AND NOT `unsloth`
-- ------------------------------
-- `tinnlab/Qwen3.5-9B-GGUF` is a byte-identical mirror of
-- `unsloth/Qwen3.5-9B-GGUF`, published by Tin Nguyen Lab so that a shipped
-- first-run flow does not depend on a third-party repository that can be
-- deleted, renamed or rewritten. It is a REDISTRIBUTION, not our own build:
-- the weights are Qwen's (`Qwen/Qwen3.5-9B`, Apache-2.0) and the GGUF
-- quantization is unsloth's. Both are credited in the mirror's README and
-- NOTICE.
--
-- Mirrored from `unsloth/Qwen3.5-9B-GGUF` at upstream commit
-- 3885219b6810b007914f3a7950a8d1b469d598a5. The mirrored `Qwen3.5-9B-Q4_K_M.gguf`
-- has sha256 03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8
-- (5680522464 bytes) — identical to the Git-LFS oid upstream publishes for
-- the same file at that commit. That sha256 is pinned app-side at
-- `defaultModel.ts::DEFAULT_MODEL_FILE_SHA256`; see the note there for why
-- the pin lives in the descriptor rather than in this row.

INSERT INTO public.llm_repositories (
    id,
    name,
    url,
    auth_type,
    auth_config,
    enabled,
    built_in,
    created_at,
    updated_at,
    auth_config_encrypted,
    last_health_check_at,
    last_health_check_status,
    last_health_check_reason
) VALUES (
    'b3f1c5d2-7a48-4e91-9c26-5d0e8f3a1b74',
    'Hugging Face (tinnlab, anonymous)',
    'https://huggingface.co/tinnlab',
    'none',
    '{}'::jsonb,
    true,
    true,
    '2026-07-21 01:00:00+00',
    '2026-07-21 01:00:00+00',
    NULL,
    NULL,
    'untested',
    NULL
)
ON CONFLICT DO NOTHING;
