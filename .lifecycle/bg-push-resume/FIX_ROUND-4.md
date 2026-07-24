# FIX_ROUND-4 — iteration round (kill switch) blind re-audit + fix

Ran a fresh blind audit on the iteration delta (deploy kill switch + DEC-1
BLOCKED). One low finding, fixed; the rest confirmed correct.

## Confirmed finding + fix

- **tests-quality (low)** — TEST-8's `resume_enabled_from_config()` assertion
  coupled to the process-global `BACKGROUND_MCP_CONFIG` OnceCell (reliable today —
  only `mod.rs::init` sets it, never a lib unit test — but a latent shared-global
  coupling) → FIXED: dropped the global-coupled assertion; TEST-8 now asserts only
  the pure `should_resume(false, …)==false` + `should_resume(true, …)==true`
  (deterministic). The default-ON behavior of `resume_enabled_from_config()` when
  `background_mcp` config is absent is already proven end-to-end by TEST-5/6 (they
  run with the cell SET and no `background_mcp` YAML section → resume ON).

## Confirmed-correct (audit "none"/info)

- serde defaults of `BackgroundMcpConfig` mirror `BioMcpConfig`/`LitSearchConfig`
  exactly: absent section → `None`; absent key → `true`; `Default` → `true`.
- `resume_enabled_from_config()` returns true when the OnceCell is unset AND when
  the section is `None` (default-ON invariant holds).
- `should_resume(false, …)` short-circuits false; the `.expect("should_resume
  guarantees Some")` call site stays sound (should_resume still requires
  `conversation_id.is_some()`).
- No new panic/unwrap on runtime values; the flag read is infallible and cannot
  fail the run.
- No OpenAPI/REST contract change — `Config`/`BackgroundMcpConfig` derive only
  `Debug+Deserialize+Clone` (no `Serialize`/`JsonSchema`); not emitted into
  `openapi.json`.

**New confirmed findings:** 1
