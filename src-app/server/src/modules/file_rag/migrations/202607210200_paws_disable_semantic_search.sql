-- paws feature-surface reduction, design item 3 (docs/design/paws-feature-surface.md).
--
-- Semantic search is the one item on the list with no config kill switch: it is
-- an admin settings flag, `file_rag_admin_settings.semantic_enabled`. So this
-- migration changes its DEFAULT rather than adding a new switch.
--
-- Two statements, both needed:
--   * the column default, for any singleton row created in future;
--   * the existing singleton row, which migration 202607145010 seeded `true`.
-- Changing only the default would leave every already-migrated deployment with
-- semantic search still on.
--
-- Effect at runtime: `file_rag::retrieval` collapses "semantic disabled" into
-- "no embedding model" and plans the FTS-only arm, and `file_rag::ingest` stops
-- embedding new chunks. Nothing is deleted — existing `file_chunks` embeddings
-- are left alone, so flipping this back on restores prior behaviour without a
-- re-index of anything already embedded.
--
-- Reversal is an ordinary admin settings write (PUT /api/file-rag/admin-settings
-- with `semantic_enabled: true`). NOTE the file-rag ADMIN UI module is hidden on
-- paws (design item 10), so that reversal is an API/DB action rather than a
-- click — a deliberate consequence of hiding the module, recorded in DEC-11.

ALTER TABLE public.file_rag_admin_settings
    ALTER COLUMN semantic_enabled SET DEFAULT false;

UPDATE public.file_rag_admin_settings
SET semantic_enabled = false,
    updated_at = NOW()
WHERE id = 1;
