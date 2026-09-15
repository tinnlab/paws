-- Remove the built-in capability skills whose SUBJECT is a feature paws hides.
--
-- Realizes `docs/design/paws-ui-polish.md` INV-3, which extends
-- `docs/design/paws-feature-surface.md` (design items 6 = workflow, 11 = hub)
-- into the skill surface. paws hides the workflow and hub UI modules; a skill
-- that exists only to explain how to use them is documentation for a feature
-- the user does not have.
--
-- WHY A MIGRATION IS REQUIRED, and not just deleting the source directory
-- ---------------------------------------------------------------------
-- Deleting `resources/builtin-skills/<leaf>/` is only the FRESH-INSTALL half.
-- `skill::builtin::sync_builtin_skills` walks the embedded directory and calls
-- `repository::upsert_builtin` per entry, whose only write is
--
--     INSERT INTO skills (...) VALUES (..., 'built_in', ...)
--     ON CONFLICT (name) WHERE scope = 'built_in'
--     DO UPDATE SET ..., enabled = TRUE, updated_at = NOW()
--
-- There is no prune, no reconciliation and no delete anywhere in that path. So
-- on every ALREADY-MIGRATED install the previously-synced row survives the
-- directory's removal, with `enabled = TRUE`, forever.
--
-- And a surviving built-in row still reaches the model. The gating query
-- (`skill::repository::list_available_for_conversation`) admits
-- `s.scope = 'built_in'` UNCONDITIONALLY — no group check, no permission check,
-- no per-user opt-out — and the skill chat extension injects that listing as
-- the first system message of every tool-capable chat. The row is not
-- user-deletable either: the REST delete path refuses a built-in.
--
-- This is the same "hiding is not disabling" distinction the feature-surface
-- design drew, one layer down: removing the source is the HIDE, this DELETE is
-- the DISABLE. Both are needed for INV-3 to be true on an upgraded install.
--
-- SCOPE
-- -----
-- Deliberately an explicit NAME LIST, not a prefix match and not a
-- "delete anything no longer embedded" reconciliation. A data migration that
-- deletes should name what it deletes, so the diff is the audit — and a general
-- reconciliation would delete a built-in the moment a build shipped without it,
-- including a broken build. That larger change is recorded as a follow-up.
--
-- `scope = 'built_in'` is part of the predicate on purpose: a USER-authored or
-- system-scope skill that happens to share one of these names is somebody's own
-- content and is not ours to remove.

DELETE FROM skills
WHERE scope = 'built_in'
  AND name IN (
    -- design item 6 (workflow): authoring workflow YAML
    'io.github.ziee/create-workflow',
    -- design item 6 (workflow): diagnosing failed workflow runs
    'io.github.ziee/troubleshoot-workflow-run',
    -- design item 11 (hub): browsing + installing from the hub
    'io.github.ziee/hub-installation'
  );
