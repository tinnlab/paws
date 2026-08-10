# DESIGN_FIDELITY — blank-page-chatmessage-hooks

One verdict per invariant declared in PLAN.md's `## Invariants`.

- **INV-1** — fidelity: UPHELD — ITEM-1 moves the offending
  `useSyncExternalStore` above `ChatMessage`'s `return null`, and ITEM-5 does the
  same for the three sibling sites, so no hook in either workspace is called after
  a conditional return. ITEM-4 makes the invariant MACHINE-ENFORCED
  (`correctness/useHookAtTopLevel` in `npm run check`) rather than attested, which
  is what stops it regressing — the previous guard explicitly excluded this case.

- **INV-2** — fidelity: UPHELD — ITEM-2 replaces `fallback={() => null}` on the
  per-module boundary with a visible error surface, so a render throw anywhere
  under a module (including the router, which is the whole routed app) can no
  longer produce a blank page. The invariant's own words are "prevents a render
  throw ANYWHERE in the tree from showing a blank page"; today the router boundary
  intercepts before the app-entry boundary can honour that, and renders nothing.
  ITEM-2 restores the promise at the layer that actually catches.

- **INV-3** — fidelity: UPHELD — ITEM-2 keeps the fallback PER-MODULE (rendered in
  place of just that module's subtree, siblings untouched), so the isolation half
  of the invariant is preserved: a non-router module crash still leaves the shell
  and every other module working, and now additionally tells the user what
  happened. ITEM-3 adds the missing "keep working" half over TIME — today a caught
  crash latches forever and no subsequent navigation recovers, which is not
  "continue to work" in any reading.

No invariant is DROPPED or AT-RISK.
