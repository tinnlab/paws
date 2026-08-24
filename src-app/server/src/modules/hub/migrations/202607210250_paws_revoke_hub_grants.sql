-- paws feature-surface reduction (docs/design/paws-feature-surface.md), DEC-4.
--
-- The hub UI is hidden on paws (design item 11), including its six
-- location-scoped sub-modules; this revokes the matching Users-group grants so
-- /api/hub/* is not merely undiscoverable.
--
-- Undoes the Users half of the hub grant migration. Note the hub's own catalog
-- refresh and the seeded hub data are untouched — this is an authorization
-- change only, so restoring the feature is restoring the grant plus removing the
-- 'hub*' entries from PAWS_HIDDEN_MODULE_NAMES; no data has to be re-fetched.
--
-- Only REMOVES grants, so it cannot weaken any check (INV-6). Administrators
-- hold '*' and are unaffected.

UPDATE groups
SET permissions = ARRAY(
        SELECT p
        FROM unnest(permissions) AS p
        WHERE p NOT IN (
            'hub::assistants::read',
            'hub::assistants::read_version',
            'hub::assistants::create',
            'hub::mcp_servers::read',
            'hub::mcp_servers::read_version',
            'hub::mcp_servers::create'
        )
    ),
    updated_at = NOW()
WHERE name = 'Users' AND is_system = TRUE;
