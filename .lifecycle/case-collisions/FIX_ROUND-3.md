# FIX_ROUND-3.md — case-collisions

Round 3: a blind re-audit of round 2's diff only (`correctness` + `tests-quality`).
**22 findings, 21 confirmed, 1 rejected.**

## Termination: this round ends the loop. GUARD-SUB, in substance.

The phase-7 tripwire is "≥60% of a round's confirmed findings target ONE test/guard
file (round ≥2)". By the letter this round does not trip it — the largest single file is
the guard at ~7 of 21 (33%). But the rule exists to detect a specific failure, and the
distribution here is unambiguous:

| where round 3's findings landed | count |
|---|---|
| `lint-case-collisions.mjs` (the guard) | 7 |
| `lint-case-collisions.test.mjs` | 6 |
| `store-case-collision.spec.ts` | 4 |
| `lint-case-collisions.provenance.test.mjs` | 2 |
| `lint-case-collisions.tsc.test.mjs` | 1 |
| **the product fix** (the moves, the 100 import sites, the helper rename) | **1** (a pre-existing Tier-1 coverage limit, zero occupants) |

**~95% of this round's findings are on the apparatus I built to check the fix, not on
the fix.** And the profile across rounds is **20 → 20 → 21 — flat, not decaying.** The
skill is explicit that a flat profile falsifies the decreasing-detection model the loop
rests on, rather than meaning "converging slowly".

Meanwhile the product has been verified three independent ways: a case-insensitive
resolution simulator over 10,331 real specifiers (0 divergent), a from-scratch detector
over 1,245 directories (0 findings), and a real desktop `vite build` (8,856 modules).

So this round applies the remedy GUARD-SUB actually prescribes — *"The remedy is never
another predicate. Replace the syntactic guard with a test that asserts the BEHAVIOUR it
was standing in for"* — and then stops.

## What that meant concretely

**1. Added the behavioural anchor.** `lint-case-collisions.resolution.test.mjs` takes
every real import specifier in both workspaces and resolves it **twice** — once against
the real case-sensitive filesystem, once through a case-INSENSITIVE sibling lookup in
TypeScript's probe order — then diffs the outcomes. It detects the bug by RESULT, so
unlike the shape-matcher it is not blind to shapes nobody thought of, including the
cross-tree Tier-1 probe (round 3's only product-side finding) that no sibling rule can
express. It has an anti-vacuity floor and a control proving it reproduces both real bug
shapes. **Verified end to end: reintroducing the exact 25th collision turns it RED**
with `linux=AgentStepForm.tsx` / `macos=agentStepForm.ts`.

**2. Simplified instead of hardening.** Two round-3 defects came from machinery added in
round 2 to keep a feature honest that had no real caller: repeatable `--root=` had grown
realpath dedup and a nested-root drop, which then let a mandatory root be silently
reclassified as advisory (fail-OPEN) and let a root be dropped and scanned by nobody.
`--root=` now takes exactly one directory. Both defects are gone by construction rather
than by a third predicate guarding the second. The unreachable `scanned 0 directories`
check went too — a fail-closed guard that cannot fire reads as safety it does not
provide. The Tier-1 limit is now **stated in the header** rather than patched with a
fourth rule.

**3. Fixed what was genuinely material.**

- **The recount measured the wrong thing.** TEST-1 compared *directories traversed*, so
  a mutation that recurses into `components/` but performs no analysis there kept every
  count byte-identical and stayed green while a planted collision — in the exact subtree
  the 24 real ones lived in — went undetected. The guard now reports **entries
  ANALYSED**, counted at the point of analysis. Re-applied the mutation: TEST-1 RED.
- **The default-root path had no RED test at all.** Every fixture used `--root=`, a
  different code path aimed at a flat temp dir. A mutation decoupling "blocking" from the
  advisory *label* let a planted collision in `src-app/ui/src` exit 0 with the suite
  green. TEST-15 now builds a synthetic repo with the real script at the real relative
  path and runs it **with no arguments** across four cases. Re-applied that mutation:
  TEST-15 RED.
- **The tsc oracle carried a one-time claim into a permanent gate** — `MUST_COMPILE`
  hardcoded this branch's filenames, in a file round 2 had just chained into `check`. The
  same defect ITEM-13 fixed for the provenance suite, reintroduced two files over. Now
  derived from the tree.
- **The provenance fallback was a disguised skip**: its residual assertion was
  `existsSync(<UI>/src)`, unfalsifiable in any tree where the file exists, so on a
  shallow clone both tests reported `ok` having certified INV-4/INV-7 against nothing.
  It now hard-fails with an explanation. Verified by deleting `refs/remotes/origin/main`:
  0 pass / 2 fail, then restored.
- **The green line lied after an advisory report** — `OK - no sibling names differ only
  by case` printed directly beneath a list of sdk collisions.
- **The marker-exclusivity test never touched the DOM**, so two drawers rendering the
  same testid — the realistic regression, since two markers come from one shared
  component — would pass. Replaced by a DOM cross-check over all 144 marker/drawer
  combinations. Three markers that depended on seeded data or `canManage` were swapped
  for titles.
- **TEST-12's ratio was satisfiable with the convention fully violated** (moving all 24
  stores back out leaves 95-vs-36, still `> 2x`), and its per-store loop was a tautology.
  A population statistic cannot express a per-store claim, so the statistic is gone; the
  placement claim lives in TEST-7 where it belongs. The replacement immediately caught a
  real false positive of its own (`llmModelDrawers/index.ts` is a barrel, not a store).
- TEST-3's separation check was a literal string match bypassable two ways; it now
  expands the `check` chain transitively. Plus the symlink fixture's missing half, an
  unguarded `readdirSync`, a regex escaping only the first dot, and TEST-6/TEST-7
  disagreeing under a low `diff.renameLimit`.

**Rejected (1):** Turkish dotted-I / eszett folding. APFS and NTFS do not equate those
either, so matching their folding is correct rather than a gap — the auditor agreed.

## Why I am not running round 4

Not because nothing would be found — something would; that is the point. Three rounds of
evidence say the remaining findings are in the checking apparatus, that the apparatus is
now anchored by a behavioural oracle rather than a growing rule set, and that the product
change is independently verified. Another round would buy more polish on a lint script
for a 25-collision path-rename, and the lifecycle explicitly calls that unsound rather
than merely slow.

**This is an escalation point, and it is recorded as one** in `HUMAN_FEEDBACK.md` and the
PR body: the human should know the loop was stopped deliberately, on which rule, and with
what still open (the Tier-1 cross-tree limit, documented with zero occupants; and the
three out-of-scope items from round 1).

## Verification of this round

- durable suite — **7/7** (incl. the new TEST-15)
- provenance suite — **2/2**; under `diff.renameLimit=1` — **2/2**; with `origin/main`
  deleted — **0/2, refusing loudly** (the point), ref restored
- resolution oracle — **2/2**, and **RED** on a reintroduced real collision
- tsc oracle — **2/2** with derived paths
- gallery spec — **14/14**, incl. the 144-combination DOM cross-check
- guard on the real trees — 0 findings, 15 roots, **4,283 entries analysed**
- both previously-surviving mutations re-applied — **both now RED**

**New confirmed findings:** 21
