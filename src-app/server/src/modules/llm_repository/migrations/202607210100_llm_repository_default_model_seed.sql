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
-- WHY THE URL IS ORG-SCOPED (`…/unsloth`, not `https://huggingface.co`)
-- ---------------------------------------------------------------------
-- `llm_repositories` carries `UNIQUE (url)` and the credentialed
-- `Hugging Face Hub` row already holds the bare origin, so a second row there
-- is impossible. An org-scoped Hugging Face base is a supported, documented
-- shape rather than a workaround: `llm_repository/utils.rs::is_usable_repository_base`
-- states outright that "a row at `https://huggingface.co/<org>` plus a
-- repository_path of `<model>` builds `huggingface.co/<org>/<model>`, which is
-- a real model URL", and `GitService::build_repository_url` composes it that
-- way. The model's `repository_path` is therefore `Qwen3.5-9B-GGUF`, NOT
-- `unsloth/Qwen3.5-9B-GGUF`.
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
    'Hugging Face (unsloth, anonymous)',
    'https://huggingface.co/unsloth',
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
