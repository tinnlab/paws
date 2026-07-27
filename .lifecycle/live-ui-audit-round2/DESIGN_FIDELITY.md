# DESIGN_FIDELITY — live-ui-audit round 2

One verdict per invariant in `PLAN.md` `## Invariants`, checked against the plan
as written (not against the code, which does not exist yet at phase 2).

- **INV-1** — fidelity: UPHELD — ITEM-9 is the item that carries the invariant:
  a branch-local rig (backend `:29511`, static `:1560`, a `pg_dump` clone of the
  24/7 rig's database) is already standing, the BEFORE run is already recorded at
  `/data/pbya/ziee/tmp/liveaudit-rig/before/`, and the AFTER run is specified to
  use the SAME unmodified `agent-kit` audit script, the same backend process and
  the same data — so every claimed fix is scored by the rig that found it, not by
  a reading of the diff. TEST-9 pins it.
- **INV-2** — fidelity: UPHELD — the two items that DELETE a fetch each name the
  surviving freshness mechanism, and the plan audit verified both ends of it:
  ITEM-4's `Memories` store subscribes to `sync:memory` + `sync:reconnect` in its
  `init` and the server publishes `SyncEntity::Memory` from
  `memory/engine/extractor.rs`; ITEM-5 keeps `retainConversationScope` so the
  `sync:workflow_run` refresh still covers the scope, and only skips the probe
  for a conversation this tab created (which provably has no pre-existing runs).
  ITEM-1 does not delete a fetch at all — it moves the trigger onto the server's
  own write point. TEST-4 and TEST-6 are the executable anchors.
- **INV-3** — fidelity: UPHELD — the plan's first draft VIOLATED this invariant
  (it proposed deriving `isAuthenticated` from the persisted token). Reading
  `.lifecycle/net-hygiene/DECISIONS.md` DEC-15 at phase 2 caught it: that exact
  change was implemented, blind-audited by three angles, measured to give zero
  benefit, and CUT, with a committed guard test. ITEM-3 was rewritten to
  diagnosis + classification with NO change to `loadContext.ts` / `loader.ts`,
  and TEST-7 re-runs the inherited guard test as this round's acceptance proof.
  This is the invariant doing its job rather than being decorative.
- **INV-4** — fidelity: UPHELD — every finding in scope has a disposition path,
  not a silence path: ITEM-7 and ITEM-8 are explicitly "root-cause and dispose",
  each required to RUN the surface before classifying, and each pinned by a test
  (TEST-8, TEST-10) that records the measured outcome. The three LOW families are
  descoped through DECISIONS.md dispositions with measured reasons, not dropped.
  The plan also forbids editing the audit script, which is the only way a finding
  could be "silenced" here.
- **INV-5** — fidelity: UPHELD — no item introduces a color. The only item that
  COULD (ITEM-8, if the contrast finding reproduces) is bound by the plan to fix
  it "with semantic tokens", and `npm run check`'s `lint:colors` gate is part of
  the phase-8 chain, so a raw hue or arbitrary value cannot land regardless.
