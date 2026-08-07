-- `hub_entities.created_by` must CASCADE with the user, not SET NULL.
--
-- `created_by IS NULL` is this table's marker for a SYSTEM-WIDE install, and
-- two PARTIAL UNIQUE indexes are predicated on exactly that:
--
--   uniq_hub_template_install   UNIQUE (hub_id) WHERE entity_type = 'assistant'  AND created_by IS NULL
--   uniq_hub_system_mcp_install UNIQUE (hub_id) WHERE entity_type = 'mcp_server' AND created_by IS NULL
--
-- So `ON DELETE SET NULL` did not merely blank a column — it MOVED the row
-- INTO those indexes' predicate, with two consequences:
--
--   1. If the same `hub_id` was ALSO installed system-wide, the cascade
--      produced a duplicate inside the partial index and the ENTIRE
--      `DELETE FROM users` failed with `23505 unique_violation` — surfacing
--      as `500 An internal database error occurred` on
--      `DELETE /api/users/{id}`. A live audit hit this 69 times over three
--      days against the only two non-admin users holding a hub_entities row.
--
--   2. With no system counterpart there was no index to trip, so the cascade
--      SILENTLY PROMOTED the deleted user's personal install to a
--      system-wide one — pointing at an `assistants` / `mcp_servers` row the
--      same cascade had just deleted. `/hub/installed` and the catalog's
--      `created_system_ids` / `created_template_ids` would then report a
--      phantom system install and disable the install button for everyone.
--
-- CASCADE is the correct semantic: a `hub_entities` row only TRACKS an
-- entity, and every user-scoped entity it can track (`assistants.created_by`,
-- `mcp_servers.user_id`, `skills.owner_user_id`, `workflows.owner_user_id`) is
-- itself `ON DELETE CASCADE`. Genuine system installs are unaffected — they
-- already carry `created_by IS NULL` and reference no user row.

ALTER TABLE public.hub_entities
    DROP CONSTRAINT IF EXISTS hub_entities_created_by_fkey;

ALTER TABLE public.hub_entities
    ADD CONSTRAINT hub_entities_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;
