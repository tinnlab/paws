-- paws feature-surface reduction (docs/design/paws-feature-surface.md), DEC-4.
--
-- Knowledge bases are hidden on paws (design item 9). Hiding is not a security
-- control, so the Users-group grants go too — otherwise /api/knowledge-bases
-- still answers to anyone who knows the URL.
--
-- Undoes 202607146045_knowledge_base_grant_permissions.sql.
--
-- Only REMOVES a grant, so it cannot weaken any check (INV-6). Administrators
-- hold '*' and are unaffected.

UPDATE groups
SET permissions = ARRAY(
        SELECT p
        FROM unnest(permissions) AS p
        WHERE p NOT IN ('knowledge_base::use', 'knowledge_base::manage')
    ),
    updated_at = NOW()
WHERE name = 'Users' AND is_system = TRUE;
