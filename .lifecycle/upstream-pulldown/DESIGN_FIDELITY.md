# DESIGN_FIDELITY — upstream-pulldown

Each invariant is lifted verbatim from the upstream commit that authored it, so
"fidelity" here asks a narrower question than for a greenfield feature: **does the
port carry the invariant across intact, or does dropping/adapting a hunk weaken it?**

- **INV-1** — fidelity: UPHELD — ITEM-1 takes `mcp/client/http.rs` whole; paws' copy is
  base-identical, so the strict-JSON-parse-first ordering that makes the property
  structural arrives unmodified. Nothing about the pick adapts the predicate.
- **INV-2** — fidelity: UPHELD — ITEM-2 takes `mcp/chat_extension/mcp.rs` whole. The
  per-message tool map it consults is the same structure paws builds; paws hides only
  the `hub-mcp` marketplace UI, never the dispatch path.
- **INV-3** — fidelity: UPHELD — ITEM-3 takes `mcp/client/manager.rs` whole, including
  the clear-on-success arm. The cooldown constants come across unchanged, so the
  "recovered server serves on the next call" half is not silently dropped.
- **INV-4** — fidelity: UPHELD — ITEM-4 replays the full three-commit chain in order.
  Taking only `2154200f0` would leave the round-1/round-2 hardening off and weaken the
  refusal path, so the chain is not truncated.
- **INV-5** — fidelity: UPHELD — the canonical allow-list lands in
  `code_sandbox/mod.rs` and is applied at both model-facing entry points
  (`background_mcp/tools.rs` and `code_sandbox/handlers.rs`); both files are in the
  pick, so "applied at both" survives. paws ships code_sandbox **enabled** on desktop,
  so this is a live path here, not dead code.
- **INV-6** — fidelity: UPHELD — ITEM-5 squashes `ee48f1a77`+`abc8d2429`, which changes
  the COMMIT SHAPE but not one line of the resulting tree: the squash is exactly the
  two patches applied in order. The migration, `TaskStatus::Abandoned`, and all three
  terminal writers (mark_status, cancel_cas, boot sweep) arrive together.
- **INV-7** — fidelity: UPHELD — ITEM-6 takes `llm_repository/{handlers,utils}.rs`
  whole; paws is base-identical in both (its default-model work was purely additive —
  a new `connection_health.rs`, new migrations, new `models.rs` content, new tests).
  The `cfg!(debug_assertions)` policy change is carried, not adapted.
- **INV-8** — fidelity: UPHELD, with the one paws-specific consequence measured rather
  than assumed. The `author=<org>` filter is carried unchanged. paws seeds a row at
  `https://huggingface.co/tinnlab`, so the probe becomes
  `…/api/models?limit=1&author=tinnlab`; queried live this session it returns a
  non-empty listing, so that row still earns `healthy`. The invariant's own escape
  hatch ("record-only, not auto-disabled") is the backstop if the org ever empties.
