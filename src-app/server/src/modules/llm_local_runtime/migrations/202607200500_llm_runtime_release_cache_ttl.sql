-- Engine release-catalogue cache TTL (admin-configurable).
--
-- Version discovery reads the engine forks' GitHub release list. Before this
-- column that read was uncached, costing one GitHub API request per discovery
-- call; the unauthenticated budget is 60 requests/hour/IP, so a long-running
-- deployment exhausted it continuously and the discovery surface then showed
-- nothing to install.
--
-- Default 3600s (1 hour): engine releases are cut rarely, so an hour of
-- staleness costs nothing while capping discovery traffic at ~24 upstream
-- requests/day/engine — two orders of magnitude inside the anonymous budget
-- even with no GITHUB_TOKEN set.
--
-- Bounds mirror the sibling tunables on this row (idle_unload_secs etc.):
-- a CHECK constraint so an admin cannot set a value that either hammers
-- upstream (<60s) or pins a catalogue for more than a day (>86400s).

ALTER TABLE public.llm_runtime_settings
    ADD COLUMN engine_release_cache_ttl_secs integer DEFAULT 3600 NOT NULL;

ALTER TABLE public.llm_runtime_settings
    ADD CONSTRAINT llm_runtime_settings_engine_release_cache_ttl_secs_check
    CHECK ((engine_release_cache_ttl_secs >= 60) AND (engine_release_cache_ttl_secs <= 86400));
