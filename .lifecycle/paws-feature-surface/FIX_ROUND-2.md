# FIX_ROUND-2

Angles: **correctness** + **design-conformance** (required), both blind, over
**round 1's diff only** (`41d78625f..HEAD`) — not the whole branch.

## What the round found

19 rows. The useful shape again: each angle found things the other missed, and
they agreed on the round's worst spec.

**A merge-gate landmine neither I nor round 1 saw.** Config-gating
`register_routes` made the emitted OpenAPI **config-dependent** — the generators
call `init()` with the real config. With paws' defaults, `just openapi-regen`
DELETES `/api/voice/*` and `/api/js-tool/settings` from both workspaces'
`openapi.json` and their generated `types.ts`. It is invisible locally, because
the `types_ts_parity` golden test regenerates from the **committed** spec and
stays green; it would have surfaced only at the merge-gate's regen-parity check.
Fixed at the right layer: `openapi-gen.yaml` now forces every deploy switch ON,
because the spec describes the API surface the codebase can serve, not the subset
one deployment enables.

**The same hole I had just fixed, in a file I had just edited.** `bio_mcp`
has the identical unguarded-route shape — boot enabled once, disable, and the
stale `mcp_servers` row plus a still-mounted route gated on a permission the
Users group holds means the sidecar still spawns and query terms still egress.
I had touched that file to swap in the new accessor and not noticed. Guarded.

**My round-1 fix was incomplete in its own file.** Both angles caught that I
gated the "Install from Hub" section and list while leaving the sentence two
lines above it telling the admin to install from the Hub. The hub fetch was also
left ungated inside a `Promise.all` — not merely wasteful: a rejection there sets
`serversError` and shows an error alert on the whole MCP onboarding step. Both
fixed, plus the same hub advertisement in `MemorySetupStep`.

**The spec covering that headline fix was hollow, and would have passed on
`main`.** `loginAsAdmin` completes onboarding, so `/onboarding` opens on step 0
(Welcome) and the MCP step never mounts; the only control was `app-root`
visibility, satisfied by any authenticated page. It now clicks through and
asserts the step is visible first. The correctness angle added that even on the
step, the heading sits behind `hubServers.length > 0`, so an empty e2e catalog
makes that assertion vacuous — so I added a prose assertion that does not depend
on catalog contents. **The mutation probe confirmed exactly that prediction: with
the gate removed, the PROSE assertion fired and the heading assertion did not.**

**A spec stranded by my own round-1 harness change.** Server-enabling `js_tool`
for e2e does not un-hide its UI, and the js-tool chat extension is the sole
registrant of every testid `run-js-inner-approval.spec.ts` waits on. It could not
pass. Deleted, as its settings sibling already was.

**Ten of fourteen chunk assertions could not fail.** They ran as a
`[]`-permission user, and those modules' original predicates required
Hub/Voice/JsTool/FileRag permissions — so their chunks would never have been
requested with or without the reduction. I had switched the *sibling* label test
to admin for exactly this reason and failed to carry the reasoning to the file's
own primary assertion. Now admin, and visits `/hub` so the location-scoped
sub-modules would load if unhidden.

## Deliberately not fixed (recorded, not silently dropped)

- **Inert "Enable web search" / literature admin toggles.** Honest disclosure
  needs the UI to learn the deploy-switch state — a new capability endpoint, i.e.
  new surface area on DISABLE-only rows the design leaves untouched. Stated as a
  limitation in the PR body rather than quietly growing scope.
- **`control_mcp` still hand-rolls the switch and defaults `enabled: true`.**
  Harmless today and not a paws item; widening the diff into an unrelated module
  for a latent-only issue is worse than recording it. I narrowed the overclaiming
  comment in `config.rs` instead.
- **Stale `mcp_servers` rows on disable.** Shared by every built-in MCP module;
  reconciling it is a change to the built-in registration contract, not this
  feature's business — and with the route unmounted the row is inert.
- **The `registered_builtin_names` poll** breaks on any row rather than the three
  it asserts. Left open: not observed flaky across four runs, and churning it now
  would be motion.

## Verification after the round

- `cargo check -p ziee --tests` clean; `tsc --noEmit` clean.
- `paws_surface` integration **5/5**; `17-paws-surface` e2e **11/11**.
- Onboarding spec **verified RED under mutation**.

## Termination assessment

- **T1**: n1 (design-conformance) = 15, n2 (correctness) = 10, m = 5 ⇒
  N̂ = (16 × 11)/6 − 1 ≈ **28**; observed 25 ⇒ ~3 remaining. Promoted fraction
  this round ≈ 8/25 ≈ 0.32 ⇒ **~1.06 — marginally above 1.** T1 does not quite
  fire.
- **Profile**: 26 → 25. **Essentially FLAT, not decaying.** The decay rule does
  not terminate either, and a flat profile is the model saying its own estimate
  is not evidence.
- **GUARD-SUB**: not triggered (top file 6/25 = 24%), but **~40% of this round's
  findings landed on my own test code**, up from 19%. That is the trend the brief
  names as the tripwire's early warning.

⇒ **One more round (3), then stop regardless.** The rules permit continuing; the
proportionality rule says a round that lands mostly on my own test apparatus is
the signal to stop rather than harden. Round 3 decides which of those it is.

**New confirmed findings:** 19
