-- Clear the health verdicts the boot sweep produced for sandboxed servers.
--
-- Until this release `run_startup_health_check` had no `run_in_sandbox` guard,
-- so it probed sandboxed rows on the HOST, false-failed any guest-only command
-- against the host allowlist, recorded `unhealthy`, and flipped the row to
-- `enabled = false`. The recorded reason then told the admin to
--
--     "Enable run-in-sandbox to use any command."
--
-- on a row that already had `run_in_sandbox = true`.
--
-- The code fix alone does not reach those rows. The sweep lists
-- `WHERE enabled = true`, and the bug's own action left them disabled — so an
-- affected server keeps its red badge and its impossible advice indefinitely
-- after upgrading, and the only remedy (toggle Enabled, or Test Connection) is
-- one no operator would associate with "clear a stale badge".
--
-- This clears the verdict rather than inventing one: the correct state for a
-- sandboxed row is NO verdict, which is what every probe path now records for
-- it. `enabled` is deliberately NOT restored — this migration undoes a bogus
-- health record, and silently re-enabling servers on upgrade would be a second
-- unattended change to an admin's configuration, which is the very thing the
-- accompanying fix exists to stop. The admin re-enables, and now that works.
UPDATE mcp_servers
SET last_health_check_status = 'untested',
    last_health_check_reason = NULL,
    last_health_check_at     = NULL
WHERE run_in_sandbox = true
  AND last_health_check_status = 'unhealthy';
