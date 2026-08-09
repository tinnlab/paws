# FIX_ROUND-1 — blind audit (2 angles) → fixes

Angles run: **correctness** and **tests-quality / design-conformance**, both blind
(diff-only context, no author reasoning), both on `origin/main...cd7b68979`.

## The finding that mattered

**The fork guard was a hardcoded path list.** `tests-quality` planted a drifted copy
of the surface lib at `src-app/ui/scripts/local/gallery-surfaces.mjs` and **all 19
tests stayed green** — INV-1 did not hold under mutation. That is precisely the
mistake `TEST-6g` had already abandoned name-matching for, one screen above in the
same file, and I reproduced it verbatim.

Fixed by adding `discoverEnumerationCopies()`: a CONTENT walk of the whole repo for
any file that defines/exports the enumeration API, or that names AND writes a
generated gallery artifact. Discovery is broad; the assertion is narrow ("must live
under `sdk/packages/gallery/scripts/`, or be an explicitly reasoned exemption that
is re-verified as still-discovered"). The hand list is kept only as a fast, precise
second leg and is explicitly documented as NOT the guard.

Re-running the auditor's exact mutation now yields:
`actual: [ 'src-app/ui/scripts/local/gallery-surfaces.mjs' ]` → RED.

The new discovery immediately earned itself: it found **three** further matches I
had not anticipated — `classify-gallery-coverage.mjs` in both workspaces (a
one-shot bootstrap that consumes the generated union and writes the
hand-maintained `coverage.ts` — the opposite direction from a generator) and the
guard file itself. All three are now exempted by exact path with a stated reason
and a stale-exemption check.

## Every confirmed finding and its disposition

| # | severity | finding | disposition |
|---|---|---|---|
| 1 | high | fork guard = hardcoded allow-list; planted fork undetected | FIXED — content discovery + mutation test |
| 2 | medium | `overlayKitImports` rationale factually wrong ("gate fails open"); it actually exits 1 via the stale-allow-list branch | FIXED — corrected in the config comment AND CLAUDE.md; the fail-open shape is stated accurately (real, but only for a host neither wired nor allow-listed) |
| 3 | medium | `gallery-geometry-audit.mjs` is a surviving second enumeration ⇒ INV-4 overstated | FIXED — INV-4 narrowed to the unified set in DESIGN_FIDELITY (now AT-RISK, honestly); the copy is discovered + exempted with a reason; recorded as CLAUDE.md follow-up 1d |
| 4 | medium | e2e hardcodes `toHaveLength(1)` — reds when a recipe is added | FIXED — `before.interactions.length + 1` |
| 5 | medium | phantom legs in TESTS.md (TEST-4, TEST-6) | FIXED — prose narrowed to what the code asserts |
| 6 | medium | CLAUDE.md 1c understated residue (2 files → really 4 ports / 12 pairs) | FIXED — measured numbers + the destructive incident |
| 7 | low (×2 angles) | duplicate `TEST-6` test name | FIXED — all new tests namespaced `unify:` |
| 8 | low | TEST-7 matched only the first static import | FIXED — all specifiers (static/dynamic/require) |
| 9 | low | TEST-1 banner regex tolerated `0 surfaces` (the fail-open shape) | FIXED — non-zero floor assertion |
| 10 | low | e2e positive control rested on a flat 5s sleep | FIXED — `waitForFunction` on the condition |
| 11 | low | TEST-1 couples the two workspaces' `npm run check` | ACCEPTED with a diagnostic — the failure message now names the real cause and workspace. The coupling IS the invariant ("one impl serves BOTH"); weakening it to per-workspace would drop what the test exists to prove |
| 12 | low | sdk copies skip `*.desktop.tsx`; forks did not (0 such files today) | DOCUMENTED — CLAUDE.md now states both halves of the delta |
| 13 | medium | PRE-EXISTING: hardcoded `1420` made a script attach to a foreign worktree's vite and rewrite a tracked file (183→5 lines) | RECORDED as follow-up 1c with the incident; out of the brief's six |
| 14 | low | PRE-EXISTING: shared capture scripts default `--url` to `:1466`; 5 scripts navigate to a `/dev-gallery.html` that exists in neither workspace | RECORDED |

## Negative result worth keeping

`correctness` found **no functional regression**, by the strongest available method:
it restored the three deleted forks and ran them in `--check` against the current
tree — all three exit 0 with **byte-identical banners** to the sdk copies. It also
confirmed zero artifact drift across 6 generator runs in 2 workspaces, and that
every removed line is a `__dirname` anchor, a doc line, or the `isKit` clause now
carried by config.

## Termination

Round 1 findings: 14 confirmed (1 high, 6 medium, 7 low), of which 2 are
pre-existing and recorded rather than fixed. Overlap between the two angles was
**1** (the duplicate test id), i.e. the angles were largely complementary — the
Chapman estimator is not applied because the corroborated count is below the
small-sample floor (≥2 corroborated required); the decay rule decides alone.

**Tier correction:** an earlier draft of this file claimed LIGHT. It is **HEAVY** —
the validator reports `tier HEAVY: 1942 changed lines >= 800` (the deleted forks
count toward the diff). HEAVY is the full flow, so terminating after one round on
the LIGHT rule would have been wrong. A SECOND blind round was therefore run over
the fix diff; see `FIX_ROUND-2.md`.

The high finding was oracle-confirmed (a reproduced mutation) and is closed with a
test that reproduces it. No finding concentrated ≥60% on a single guard file in a
way indicating guard substitution — the fixes span the guard, the spec, the config
and the docs.

**New confirmed findings:** 0
