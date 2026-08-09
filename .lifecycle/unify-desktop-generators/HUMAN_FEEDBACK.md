# HUMAN_FEEDBACK — unify-desktop-generators

No human feedback received. The feature has not yet been reviewed by the owner;
this file records that absence deliberately rather than by omission.

The owner should sign off against the invariants and their acceptance tests, not
against the gate tally:

- **INV-1** (one implementation, parity by construction) → `TEST-3` (two legs: the
  content-discovery walk + the named-fork/npm-script leg). Demonstrable live:
  plant any file exporting `enumerateSurfaces` anywhere outside
  `sdk/packages/gallery/scripts/` and the suite goes RED.
- **INV-2** (add a config key, never a fork) → `TEST-5`, plus `TEST-2`'s negative
  control showing the key is what carries desktop's behaviour.
- **INV-3** (assert behaviour, never source text) → `TEST-6` (both legs are
  mutations that plant a real fork and observe RED) and `TEST-1` (spawns the real
  generators and reads their exit code + stdout).
- **INV-4** (the workspace cannot disagree with itself about what a surface is) →
  `TEST-4` (unit, both enumeration paths) and `TEST-9` (e2e, real desktop gallery
  in a browser). **Scoped honestly to the unified set** — see DESIGN_FIDELITY:
  `gallery-geometry-audit.mjs` still holds a second enumeration and is recorded as
  CLAUDE.md follow-up 1d rather than claimed as done.

Two judgement calls the owner may want to overrule:

1. **The web workspace's overlay gate is blind to 58 surfaces** and this branch did
   NOT fix it (DEC-2). Fixing it means surfacing ~58 hosts that must each be wired
   open or allow-listed, or `src-app/ui`'s `npm run check` fails. Recorded as
   CLAUDE.md follow-up 1a with a test (`TEST-8`) that fails if the entry ever goes
   stale.
2. **`gallery-geometry-audit.mjs`'s second enumeration was declared, not unified**
   (follow-up 1d) — folding it in changes its settle policy under a 1,700-line
   audit that would need revalidating.
