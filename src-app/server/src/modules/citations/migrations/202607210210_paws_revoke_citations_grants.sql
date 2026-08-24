-- paws feature-surface reduction (docs/design/paws-feature-surface.md), DEC-4.
--
-- The citations UI is hidden on paws (design item 8), but hiding a module is NOT
-- a security control — its REST endpoints still answer to anyone holding the
-- permission. The design records that limitation explicitly and asks whether the
-- hidden-but-not-disabled items should also have their grants revoked so the API
-- is not merely undiscoverable. This does that for citations.
--
-- Undoes 202607146015_citations_grant_permissions.sql. Restoring the feature
-- means restoring that grant alongside removing 'citations' from
-- PAWS_HIDDEN_MODULE_NAMES.
--
-- Administrators are unaffected: they hold '*' and never carried these entries.
-- This only REMOVES a grant, so it cannot weaken any check (INV-6).

UPDATE groups
SET permissions = ARRAY(
        SELECT p
        FROM unnest(permissions) AS p
        WHERE p NOT IN ('citations::use', 'citations::manage')
    ),
    updated_at = NOW()
WHERE name = 'Users' AND is_system = TRUE;
