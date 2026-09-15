-- Raise `auto_start_timeout_secs` from 30s to 180s.
--
-- WHY: 30 seconds is shorter than a real model load, so the SHIPPED default
-- makes the first chat after selecting a local model time out on ordinary
-- hardware. Measured on the development box: llama.cpp takes **70-90 seconds**
-- to answer `/health` for a 296 MB Q2_K GGUF. The product's own default model
-- is 5.68 GB, which is slower still.
--
-- The failure it produced is not a warning — it is a dead end:
--
--     Request timeout: Engine for model '…' did not become healthy in time
--
-- with `POST /messages` having returned 200 and the assistant message left
-- empty. Indistinguishable, to a user, from "sending my message did nothing".
--
-- WHY 180 AND NOT MORE: the setting also bounds how long a user waits on an
-- engine that will never come up. 180s covers a first load of a multi-GB model
-- with headroom while still failing a genuinely broken engine in three minutes
-- rather than ten. The column's CHECK allows 1..600, so an operator with slower
-- storage can raise it further; this only moves the default.
--
-- TWO SEPARATE CHANGES, deliberately:
--
--   1. `ALTER COLUMN … SET DEFAULT` fixes FRESH installs.
--   2. The UPDATE fixes EXISTING installs — but ONLY where the value is still
--      the old default. An operator who deliberately chose 30 (or any other
--      value) keeps it. Same reasoning as the mirror migration's
--      `AND url = <the exact shipped value>` guard: a data migration must never
--      overwrite a human's explicit choice, and "equal to the value we shipped"
--      is the only safe way to tell the two apart.

ALTER TABLE public.llm_runtime_settings
    ALTER COLUMN auto_start_timeout_secs SET DEFAULT 180;

UPDATE public.llm_runtime_settings
SET auto_start_timeout_secs = 180,
    updated_at = NOW()
WHERE auto_start_timeout_secs = 30;
