# FIX_ROUND-1 — upstream-pulldown

Round 1 of the blind audit ran two angles that differ in kind — **correctness** and
**security** — each given ONLY `git diff origin/main...HEAD` (lifecycle excluded) and
none of my reasoning. They returned 11 confirmed findings between them.

## The headline result: two of them are ORACLE-CONFIRMED, and upstream is red

Two findings claimed a specific test FAILS. Rather than reason about them I ran them,
and both were right:

```
test result: FAILED. 69 passed; 2 failed
  modules::background_mcp::tools::argument_contract_tests::every_spawn_refusal_is_actionable
  modules::llm_repository::utils::tests::capability_url_targets_the_kinds_listing_surface
```

I then ran the SAME two tests in the upstream-port worktree, which is
`ziee-ai/ziee` `main` plus this session's push-up changes — none of which touch either
file — and they fail there too:

```
left:  Some("http://127.0.0.1:1520/models/api/models?limit=1")
right: Some("http://127.0.0.1:1520/api/models?limit=1")
```

So **`ziee-ai/ziee` `main` is RED on these two unit tests today**, and the pull-down
inherited them faithfully. Upstream has no PR CI, which is how they survived. Both are
fixed on this branch, and both are reported upstream.

### Fix 1 — `llm_repository/utils.rs`: a stale test, not stale code
`beae7c7fb` deliberately changed the `Unknown` branch to probe the row's OWN path
(`<row-url>/api/models`) instead of collapsing to the origin — that IS the fix, and its
commit message says so. The test was left asserting the collapsed URL, and its comment
still claimed "the probe URL is the same for `https://huggingface.co/custom`, because
it is derived from the KIND, not the row", which the same commit made false. Corrected
the expectation, rewrote the false comment, and added the two cases the rewrite
introduced but nothing covered: an HF row WITH a path segment now filters by
`author=<seg>`, and an Unknown row with NO path still gets the bare-origin probe.

### Fix 2 — `background_mcp/tools.rs`: the comment described a fix that was never applied
The missing-`spec` refusal carried a comment stating the requirement precisely — "The
example here must be a full ARGUMENTS object, not a `spec`-level one: the mistake being
corrected is a MISSING `spec` key, so an example without that key is one a model can
copy verbatim and hit the identical error again" — and then passed
`BACKGROUND_SPEC_EXAMPLE`, which is exactly the spec-level object the comment forbids.
Changed to `default_example()`. Both suites now report **71 passed, 0 failed**.

## The other nine: confirmed, and deliberately NOT fixed here

Nine findings are real and I am not patching them on this branch. Every one is a
property of **upstream's own design or a pre-existing defect**, faithfully carried by
the port — and this task exists specifically to stop paws forking from upstream on
judgement calls. Each is recorded in `LEDGER.jsonl` with `resolution_state: wontfix`
and a rationale, and each is escalated to the owner rather than silently dropped.

Two deserve naming here:

- **`mcp.rs:442` (high, the only finding BOTH angles landed on).** A correctly-composed
  `<server_uuid>__<tool>` is refused whenever two attached servers advertise the same
  bare tool name, because the per-turn map collapses ambiguity to `None`. Verified by
  re-reading `mcp.rs:427-443`. This is upstream's stated refuse-over-misroute tradeoff
  (`SECURITY (B-OWN)`, `mcp.rs:430-438`), and it fails CLOSED — a clear refusal, never
  a misroute. Fixing it properly means changing the map to retain which servers
  advertise a name, i.e. altering shared security-sensitive routing. Upstream's call.
- **`handlers.rs:585` (high, security).** A request to `test-connection` overriding only
  `url` keeps the persisted decrypted credential and sends it to the caller-chosen host.
  **Pre-existing in BOTH repos** — the same shape sits at `handlers.rs:564` on paws
  `origin/main` — and in a function this branch does not touch (its only change to that
  file is +20 lines in the *other* handler). Not introduced or worsened here; escalated
  as its own item because it deserves its own branch and regression test.

## Termination input

Round 1: correctness reported 8, security reported 3, overlap 1. That is **below the
estimator's floor of ≥2 corroborated findings**, so the Chapman T1 estimate declines
rather than guessing and the decay rule decides alone. Round 2 therefore runs, scoped
to THIS round's diff (the two fixes) per the phase-7 rule.

**New confirmed findings:** 2
