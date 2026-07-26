# FIX_ROUND-1 — remediation of the blind multi-angle audit

Five blind agents (diff-only context) covered 19 angles: correctness ·
error-handling · tests-quality · security · perf · concurrency · state-management ·
design-conformance · patterns-conformance · api-contract · modularity ·
extensibility · maintainability · api-friendliness · i18n-copy · perms-authz ·
a11y · plan-coverage · behavior-parity. 35 findings landed in `LEDGER.jsonl`
(33 confirmed, 2 rejected with rationale in the ledger).

Nothing was dismissed by assertion: every "no change" verdict is an explicit
`status: rejected — <reason>` row.

## HIGH — the gate could have been wrong or silently blind

1. **Stale AST cache (a regression introduced mid-round).** The process-lifetime
   `rootAstCache` served cached ASTs for files being REPORTED on, so a second
   `analyze()` in one process could report an already-fixed violation or miss a new
   one. Fixed: only files that are NOT targets may come from the cache; every target
   is re-read and re-parsed. The default whole-tree scan therefore never uses the
   cache, and the CLI always sees disk.
2. **Global action registry.** One shared name set exempted `error`, `open`,
   `progress`, `refresh`, `update`, `reset`, `close`, `init`, `load` on EVERY store —
   and `store.error` is a field CODING_GUIDELINES §13 mandates rendering, so the O2
   class was permanently blind on it. Fixed: actions are attributed PER PROXY (by the
   store directory that defines it, plus properties observed called on THAT proxy).
3. **Factor-1 path-shape heuristic hid ~44 real proxies.** `AppLayout` (18
   importers), `Hardware`, `ModelPicker`, `AssistantDrawer` and most drawer stores
   live outside a `stores/` path, so H2 could not see them — the drawer-store class
   is exactly BUG-B's own. Fixed: factor 1 is now real module RESOLUTION (does the
   specifier resolve to a file that DEFINES the proxy?), with the path-shape test
   kept only for un-resolvable specifiers. Verified: still 0 findings tree-wide.
4. **Silent degradation on an SDK change.** Renaming one `PROXY_FACTORY`
   alternative dropped the registry 298 → 148 and H2 findings to 0 while the CLI
   printed "OK" and exited 0. Fixed: `registryHealthError()` (exported + unit-tested)
   fails with exit 2 below a proxy floor or on a zero-file scan, and the healthy run
   now PRINTS its registry sizes.
5. **The byte-identity drift guard never blocked.** It lived only in
   `test:unit` / `test:lint-hooks`, neither of which is in a `check` chain or CI,
   while the header claimed it was enforced. Fixed: `siblingDriftError()` runs inside
   `main()`, so the gate itself refuses to run on diverged copies (exit 2).

## MEDIUM

6. **INV-1 was not general.** H1 required an identifier callee, so `React.useX()`
   was invisible — 8 such live sites. Fixed: both call forms match.
7. **The other half of the ITEM-10 defect was invisible.** `pane.store.conversation`
   (a per-instance store from a hook handle) was not covered, so re-introducing just
   that branch would have passed. Fixed: `handle.store.<field>` is covered when the
   handle is bound from a `use*()` call — precise enough to ignore
   `extension.store.name` (a store DEFINITION from a registry loop).
8. **`--root` could make the gate silently pass.** A non-existent dir, a file, or an
   unknown flag printed "OK — 0 violations" and exited 0; only the FIRST `--root=`
   was honoured and the space form was ignored, both diverging from every sibling
   lint. Fixed: repeatable `--root=`/`--root <dir>`, validated, unknown args rejected,
   all operator errors exit 2 (DEC-15).
9. **The escape hatch was unenforced.** A bare `// hook-order-ok` — or the literal
   appearing in a string — suppressed a real violation, while four documents claimed
   a reason was required. Fixed: the marker is honoured only inside a `//` comment
   and only with `hook-order-ok: <reason>`.
10. **The O2 acceptance row was hollow.** O1 and O2 invoke the same script and
    `runLint` keyed only on exit status, so O2 "fired" on O1's finding — with both H2
    branches deleted it still passed. Fixed: each row carries an `expect` regex
    (`/H1 /`, `/H2 /`) which `runLint` honours, in BOTH harnesses.
11. **Shared SDK React source was out of scope** (136 .tsx that render in both
    apps). Fixed: `sdk/packages` is a scanned root (DEC-14) — +251 files, 0 findings.
12. **`McpServerDetailsDrawer` hoist added a side effect.** Reading the LAZY hub
    store above the `!server` guard triggered its `init` (2 API calls) on a render
    that shows nothing — visible in the gallery cell, which renders it prop-less.
    Fixed with the component-per-case idiom used for the other two splits.
13. **Four tautological tests.** The function-boundary and type-only-import tests
    would both pass on a fully broken rule (mutation-verified by the auditor); the
    action-CALL test never exercised the action registry; the H1/H2 early-return test
    asserted only one half. All four rewritten to fail on the mutation they claim to
    guard, plus new cases for do-while, non-`if` guards, and the marker's negatives.
14. **Inaccurate prose.** "~20 pre-existing sites" (actual: 5 calls in 3
    components), "paths 1-3 are never flagged" (path 3 is not excluded), "callbacks
    are out of scope" (never true of the code), the stale "C11, J8" harness headers,
    `DETECTOR_ACCEPTANCE.md` "24/24", and the fixture-store's self-containment claim.
    All corrected in the script header, DESIGN, DECISIONS and the taxonomy rows.

## LOW

15. A raw **NUL byte** (`roots.join('\0')` written literally) made the script
    binary to `grep`/`rg`/`diff` — pinned into both workspaces by the identity guard.
16. `do { … } while (…)` was classified `loop-body` (its body always runs) — a
    genuine false positive; removed.
17. `after-early-return` only saw top-level `if` guards — a `switch` arm that
    returns and a guard nested in a block were missed; broadened.
18. Element access `Store['field']` was invisible; covered.
19. `analyze(null)` threw a raw `TypeError`; unguarded I/O and crashes exited 1,
    the same code as "violations found". Both fixed (exit 2 + `opts ?? {}`).
20. `gitShow` in the acceptance tests died with a raw git error on a shallow clone;
    now raises a diagnosable message naming `git fetch --unshallow`.

## Verification after the fixes

* `node scripts/lint-hooks.mjs` — **0 violations across 2425 files** (registry: 300
  proxies, 1703 actions), identical from both workspace copies.
* A 15-case behaviour probe over the newly-covered shapes: all match (each new
  coverage FIRES; each intended exemption stays silent).
* `npm run test:lint-hooks` — **51/51 pass** (was 39).
* Desktop `detector-acceptance.mjs` — C11, J8, O1, O2 all `OK ✓` with the
  discriminating expectations.

**New confirmed findings:** 0
