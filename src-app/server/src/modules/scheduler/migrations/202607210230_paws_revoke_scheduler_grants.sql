-- paws feature-surface reduction (docs/design/paws-feature-surface.md), DEC-4.
--
-- The scheduler UI is hidden on paws (design item 7); this revokes the matching
-- Users-group grant so /api/scheduled-tasks is not merely undiscoverable.
--
-- ⚠ REVOKES `scheduler::use` ONLY — NOT `notifications::read`.
--
-- 202607146080_scheduler_grant_permissions.sql grants BOTH in a single
-- `ARRAY['scheduler::use','notifications::read']`, because the scheduler
-- surfaces run results through notifications. But `notifications` is a
-- SURVIVING module on paws: it keeps its sidebar bell, its panel and its own
-- REST surface. Reversing that grant migration wholesale — the obvious reading
-- of "undo the scheduler grant" — would have taken the notification list away
-- from every non-admin user on the instance, an INV-2 break dressed up as a
-- permission cleanup. Do not "simplify" this into a two-element NOT IN.
--
-- Only REMOVES a grant, so it cannot weaken any check (INV-6).

UPDATE groups
SET permissions = ARRAY(
        SELECT p
        FROM unnest(permissions) AS p
        WHERE p <> 'scheduler::use'
    ),
    updated_at = NOW()
WHERE name = 'Users' AND is_system = TRUE;
