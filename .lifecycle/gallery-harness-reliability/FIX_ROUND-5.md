# FIX_ROUND-5 — re-audit of round 4's fixes, and a STRUCTURAL stop

Round 4's fixes were re-audited blind (gate-security + tests-quality) against a
frozen tree. It found **two more HIGHs, both in round 4's own fixes**, and the
first is the same class as the defect it was fixing.

## H1 — the test added AS round-4's fix never ran

The "assert the STRICT list against the INSTALLED react-dom" backstop resolved
`node_modules/react-dom/...` relative to `scripts/lib/` — where no `node_modules`
exists — so `if (!file) return` was taken on every run and reported a **green
tick while asserting nothing**. The auditor reproduced the exact rot it existed to
prevent: renaming the React-19 pattern to a wrong spelling left the suite green
while 4 of 4 real DOM-nesting strings went back to gating HIGH.

**Fix:** moved to `src-app/ui/scripts/react-warning-coverage.test.mjs` — react-dom
is the APP's dependency, so the test now lives where its subject is — resolved via
`createRequire(...).resolve('react-dom/package.json')`, and **a missing react-dom
is a FAILURE, never a skip**. A backstop that can quietly decline to run is worse
than none: it reports safety it is not providing.

## H2 — nothing pinned the CORES set itself

Round 3 was "a core can be dropped from one copy's list"; round 4 moved the
declaration into `CORES[].roles`. But nothing pinned `CORES`. Deleting
`run-validity` or `transport-mirror-classification` outright removed the check
from **all four copies** with every suite green, and the CLI printed
*"carry all 3 behavioural cores"*. The completeness assertion derived **both
sides** from `CORES`, so it could never notice a deletion — the same same-data
derivation defect as round 3, one level up. The two that survived were exactly the
two no test named by literal id.

**Fix:** a hand-written, literal pin of the core id set. Adding or removing a core
is now a deliberate edit with a stated reason.

## Also fixed

- **M1** — `run-validity`'s `why` names two behaviours but only `assessRun` was
  pinned; the whole origin-death half (`watchOrigin`/`originAlive`) could be
  dropped with everything green. Added a distinct **`origin-watchdog`** core
  (a separate core, not an alternation — an alternation lets either half satisfy
  both).
- **M3 / L1** — discovery required **≥2** core imports, making it blindest exactly
  where it matters: the copy being hunted is by definition the one MISSING cores.
  A probe importing only the classifier and launching chromium — the literal
  target defect — walked straight past. Now ≥1 core, `require()`/dynamic
  `import()`/`from` all counted, `firefox`/`webkit`/`.newPage(` counted as
  driving, `dist/` no longer skipped, `.jsx` included, and one level of **barrel
  re-export** resolved. Exemptions must now be files discovery actually produces,
  so a stale one cannot stand as cover.

Re-ran the auditor's evasion battery: **E1 (dynamic import), E2 (barrel), E3
(single-core copy), E4 (.jsx), E5 (dist/), E6 (webkit + context.newPage), E8
(require/.cjs) — all 7 now caught**, positive control still green.

## STRUCTURAL: this is guard substitution, and I am stopping the loop

Rounds 3, 4 and 5 each found fresh evasions of a guard **I** wrote, and each fix
was a new predicate. That is the pattern this repo's own lifecycle rules name as
GUARD-SUB: *a hand-written static-analysis guard standing in for a behavioural
test has an unbounded evasion space, so "0 findings" is unreachable by
construction and each round only finds another spelling.* The remedy is explicitly
"never another predicate."

The auditor's **M5** is the proof that no predicate can finish this: a copy may
keep `verifyRunManifest(...)` and hardcode `const usable = { ok: true }` — green,
and **failing open**. A call-site guard proves WIRING, never LOGIC.

**The real fix is to delete the divergence, not to detect it.** INV-6 says a fix
must not land in one copy and not the others; the durable way to satisfy that is
for `src-app/desktop/ui/scripts/{runtime-health,gate-ui}.mjs` to become thin
config-driven re-exports of the sdk implementation, leaving ONE implementation and
making parity true by construction — at which point most of this guard can be
deleted. That is a larger change than this branch's remit and belongs to the
owner, so it is **escalated, not started**. Recorded as FB-10.

What ships here is the guard in its hardened form: materially better than it was
(every evasion the three rounds found is closed, and the two silent-degradation
classes are gone), with its limit documented rather than implied.

**New confirmed findings:** 5

(aligned to the LEDGER's confirmed count for round 5 (5); the other 3 rows are recorded `deferred`, not confirmed — a round's headline number must be the ledger's, not the narrative's.)
