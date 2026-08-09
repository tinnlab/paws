# FIX_ROUND-4 — re-audit of round 3's FIXES, and what it overturned

Round 3 ended by asserting `**New confirmed findings:** 10

(Round 3 recorded `0` here *without re-auditing its own fixes*, and F3 proves that
claim was false. So this round records what it actually found — 10 — and the loop
continues into round 5 to re-audit THESE fixes. Recording 0 because the fixes feel
right would be the same error one round later.)` **without re-auditing
its own fixes**. That assertion was wrong, and this round exists because I did not
accept it: the T1 estimate said ~2.4 promotable defects likely remained (and is
biased low), so a third blind angle — **gate-security + tests-quality** — was run
over the round-3 fix diff.

It found **two HIGHs, and the first one overturns round 3's central claim.**

## F3 (HIGH) — round 3's headline fix did not close the bug it named

Round 3 added "a core declared by NO copy is an error". It computed the declared
set as the **union across all copies**, so it fired only when a core was dropped
from *every* copy. Dropping it from **one** copy — which is verbatim the failure
this guard exists to catch ("the fix landed in the sdk copy and the desktop copy
was forgotten") — remained invisible. Reproduced:

```
# console-classification removed from desktop/runtime-health only
harness parity: OK — 4 live copies … carry all 5 behavioural cores   exit 0
consumer tests: pass 9, fail 0
# then classifyConsoleMessage stripped from the desktop copy entirely
checkParity violations: 0  []
```

Aggravating, and the reason no test caught it: `TEST-6b` derived its expected
violations *from the manifest*, so an under-declared manifest shrank the
expectation in lockstep and the test could never detect one.

**Fix — the mechanism is gone, not patched.** Which cores a copy must carry is now
**derived from its `role`** by `@ziee/gallery` (`CORES[].roles` +
`requiredCores(copy)`). The consumer declares only WHERE each copy is and WHAT it
is; a leftover per-copy `cores` list is itself a violation. Under-declaration is
no longer expressible. `TEST-6b`'s expectations are now role-derived too, and
duplicate `id`/`file` entries are violations (F5 — two entries could name one
file, reading a source twice while a real copy went unchecked).

## F1 (HIGH) — the strict list was dead against the React version in use

Round 3 narrowed the error-channel downgrade to a strict list. **Three of its five
patterns match nothing React 19 emits.** React 19 rewrote the DOM-nesting warning;
verified against the installed `react-dom@19.2.6` dev build:

```
In HTML, %s cannot be a child of <%s>.        ← React 19
In HTML, %s cannot be a descendant of <%s>.   ← React 19
grep -c 'cannot appear as a descendant' → 0
grep -c 'validateDOMNesting'            → 0   (in message text)
```

So the entire DOM-nesting family still classified `console-error`/HIGH — the fix
was dead against the very version its own doc comment cited. **Fix:** added the
React-19 spellings, kept the React-18 ones (a consumer may be on either major),
and added a test that reads the INSTALLED react-dom dev build and asserts every
DOM-nesting warning it emits is matched — so the next React rewrite fails a test
instead of silently re-gating.

## F6 — the strict patterns were mostly unpinned, and two masked each other

Deleting a pattern was a silent no-op for 3 of 5, because every fixture matched
two or more patterns and asserted only on the RESULT. Worse, `/unique "key" prop/i`
and `/Each child in a list/i` matched the **same** React message — redundancy
posing as coverage. Collapsed to one quote-independent pattern, and each remaining
pattern now has a fixture that matches **exactly one** pattern (asserted). Verified
by deleting each in turn:

| deleted pattern | suite |
|---|---|
| `Each child in a list should have a unique` | **4 fail** |
| `not wrapped in act(` | **2 fail** |
| `In HTML, … cannot be a (child\|descendant) of` | **1 fail** |
| `validateDOMNesting` | **2 fail** |
| `cannot appear as a descendant of` | **1 fail** |
| control | 28 pass / 0 fail |

(The first attempt at this battery produced two false "no-ops" because the
mutation script was deleting *comment* lines containing the pattern text. Recorded
because a mutation battery that silently fails to mutate is worse than none.)

## F9 — the "closed-world guard" was not closed

6 of 7 planted divergent copies walked straight past the name-based discovery:
`crawl-health.mjs`, `runtime_health.mjs`, `gallery-runtime-health.mjs`,
`runtime-health.js`, `runtime-health.cjs`, and one at the repo root (outside the
two walked roots). Symlinked directories were never descended into either
(`isDirectory()` is false for a symlink). **Fix:** discovery is now by CONTENT —
a file that imports ≥2 shared cores AND actually drives a crawl (launches or
spawns one). Re-ran the same 7 probes: **all 7 caught.** The `NOT_A_COPY`
allowlist additionally asserts an exempted file does not itself open pages, so an
exemption cannot become a hiding place.

## F4 — the gate was one config key from off, invisibly to desktop

Deleting `harnessCopies` left the guard saying "nothing to check", exit 0 — and
`src-app/desktop/ui`'s `test:gallery-scripts` did not run the consumer test, so
that workspace's entire `npm run check` passed with the parity gate switched off.
The consumer test is now wired into BOTH workspaces.

## F10 — a stray copy of the classifier, and it was mine

`src-app/ui/finding-classify.mjs`: a byte-identical, uninvoked copy. It was my
own artifact — a `cp` in the round-3 mutation battery ran with `cwd=src-app/ui`
because the restore path was relative after a `cd`. Deleted. Noted rather than
quietly removed, because "the auditor found an untracked duplicate of the very
module this branch is de-duplicating" is exactly the kind of thing that should
not be silently tidied away.

## Rejected / deferred

- **F8** (the producer/consumer role test covers one direction) — `deferred`: the
  role→callSite selection is separately mutation-verified in both directions.
- **F7 / F2** — comment/claim accuracy; fixed by correcting the claims, not the
  behaviour (the warning-channel widening is non-gating).

## Process finding — I broke tree-freeze again

The auditor reported `CLAUDE.md` and `TEST_RESULTS.md` changing under it
mid-audit, and flagged a concurrent editor. **That was me** — one round after
recording FB-8's lesson about exactly this. The audit's coverage claim is
correspondingly weakened for those two files (neither is code the audit was
scoped to, so no finding is believed lost). Recorded in HUMAN_FEEDBACK as FB-9.

**New confirmed findings:** 10

(Round 3 recorded `0` here *without re-auditing its own fixes*, and F3 proves that
claim was false. So this round records what it actually found — 10 — and the loop
continues into round 5 to re-audit THESE fixes. Recording 0 because the fixes feel
right would be the same error one round later.)
