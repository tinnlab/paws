# FIX_ROUND-1

Blind audit ran TWO angles of different kind — `correctness` and `tests-quality` —
over `git diff origin/main...HEAD` in BOTH the parent repo and the `sdk` submodule,
with the diff only and no author reasoning. The auditor verified findings by
reverting each fix and re-running, rather than by reading.

The `tests-quality` angle carried this round: it found that three of the specs
written for this branch did not prove what they claimed. That is the finding class
this repo has paid for repeatedly, and it was worth more than the correctness pass,
which returned a clean negative result on the actual code changes.

## Fixed this round

- **e2e was hollow (high).** `error-containment.spec.ts` used `page.goto()` — a full
  document reboot that structurally cannot reproduce a re-render-driven crash —
  never rendered a `/chat/<id>`, and asserted only `body.innerText.length > 0`,
  which a crashing router now satisfies because the fallback renders text. Rewritten
  to drive GENUINE client-side navigation (in-app link clicks), to fail on any
  `[AppErrorBoundary …]` / React #300 / #310, and to carry a positive control that
  the app rendered at all. Then MEASURED against a reverted `ChatMessage`: it still
  passes, because a fresh test DB has no answerless assistant turn. Rather than
  leave the inflated claim, that limit is now stated in the spec header, at the
  assertion, and in TESTS.md — the spec is a general render-crash guard, and TEST-1
  (verified RED 4/4) is the regression test.
- **biome known-positive control was vacuous (medium).** It asserted only a non-zero
  exit and a loose `/useHookAtTopLevel/` match. Reproduced the failure mode it named:
  renaming the rule key makes biome exit 1 with a config error whose `Known keys:`
  list contains the literal string `useHookAtTopLevel`, so both assertions passed
  while the rule ran on nothing. Tightened to require a real
  `lint/correctness/useHookAtTopLevel` diagnostic AT `Bad.tsx:4` and to reject
  `Known keys:` output. Re-verified with a rename harness: old assertions `true`,
  new assertions `false`.
- **TEST-4c was vacuous (medium).** With `resetKeys` removed nothing re-renders, so
  the fallback was trivially still on screen and the console delta was 0 — the test
  stayed green. Now counts module RENDER ATTEMPTS and requires the reset to have
  actually re-run the module, bounded. Verified: removing `resetKeys` turns TEST-4b
  and TEST-4c RED (2 failed / 2 passed).
- **Loose alias regex (low).** `/Aliased\.items|Aliased/` → `/Aliased\.items/`.
- **Committed debug scripts (medium).** Four ad-hoc `repro-*.mjs` with hardcoded
  credentials, machine-local ports and author-specific UUIDs had been committed into
  the UI workspace root. Removed from the tree (kept outside the repo as scratch).
- **Overclaiming doc-block (medium).** `resetKeys` was documented as costing nothing
  on the happy path. True of the prop, false of the mechanism: `useHistoryEpoch`
  re-renders `AppShellBody` on every navigation. The doc now says exactly that and
  attributes the cost to the caller.
- **Dead code (low).** `__resetHistoryEpochForTests` (which could not actually reset,
  since it left `installed === true`) plus two unused re-exports — removed, per §15
  "dead code = unfinished work". Also corrected the header's "install-once" claim to
  be per module instance.
- **Dead config (low).** The base-config `useHookAtTopLevel: off` override for
  `__detector_fixtures__` could never fire once `files.includes` excluded those files
  from biome entirely. Removed the redundant one.

## Accepted, not fixed — with reasons

- **The hoists add a subscription on the previously-early-returning path.** Required
  by the rules of hooks; the cost is extra re-renders of components that render
  `null`. Accepted by design.
- **A crash in a portal-only module now renders a visible in-flow panel.** `() => null`
  was wrong for the router, and "always visible" is the other extreme; a per-module
  policy is a larger design change than this bugfix should carry. Recorded.
- **The new rule does not cover the SDK itself**, and `sdk/packages/framework` has 5
  diagnostics under it today (`stores.ts`, `store-kit.ts`) — all in the store-proxy
  `get` traps, i.e. the framework's own deliberate hook machinery, which already
  carries a `rules-of-hooks` suppression. Wiring lint into a package that has no
  scripts, and adjudicating those 5, is a separate piece of work. Reported, not
  silently ignored.

**New confirmed findings:** 0
