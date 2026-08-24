-- paws feature-surface reduction (docs/design/paws-feature-surface.md), DEC-4.
--
-- Workflows are hidden on paws (design item 6); this revokes the matching
-- Users-group grants so /api/workflows is not merely undiscoverable.
--
-- Undoes 202607146095_workflow_grant_permissions.sql.
--
-- Only REMOVES grants, so it cannot weaken any check (INV-6). Administrators
-- hold '*' and are unaffected.

UPDATE groups
SET permissions = ARRAY(
        SELECT p
        FROM unnest(permissions) AS p
        WHERE p NOT IN ('workflows::read', 'workflows::execute')
    ),
    updated_at = NOW()
WHERE name = 'Users' AND is_system = TRUE;
