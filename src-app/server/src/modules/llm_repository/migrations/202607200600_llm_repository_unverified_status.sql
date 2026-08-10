-- ITEM-12 / DEC-12 — add the third health outcome `unverified`.
--
-- "Reachable, but model-serving capability not confirmed for this URL
-- shape." The probe used to report `healthy` for any host that answered
-- HTTP 200, which meant a Vite dev server's SPA fallback passed. Making
-- the probe strict needed a third outcome: folding "we could not classify
-- this host" into `unhealthy` would auto-disable working self-hosted
-- deployments (`connection_health::record_test_outcome` disables an
-- enabled row whose probe fails), and folding it into `healthy` would
-- keep the lie. Only a genuine `unhealthy` may auto-disable (INV-4).
--
-- Widening a CHECK constraint is safe here: every existing row carries
-- one of 'untested' | 'healthy' | 'unhealthy', all of which stay legal.

ALTER TABLE public.llm_repositories
    DROP CONSTRAINT IF EXISTS llm_repositories_last_health_check_status_check;

ALTER TABLE public.llm_repositories
    ADD CONSTRAINT llm_repositories_last_health_check_status_check
    CHECK ((last_health_check_status = ANY (ARRAY['untested'::text, 'healthy'::text, 'unverified'::text, 'unhealthy'::text])));
