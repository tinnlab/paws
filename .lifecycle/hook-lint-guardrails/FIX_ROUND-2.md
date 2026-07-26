# FIX_ROUND-2 — second full blind round

Two fresh blind agents (diff-only context, no knowledge of round 1) re-audited the
FIXED diff across correctness · error-handling · tests-quality · state-management ·
security · design-conformance · patterns-conformance · plan-coverage ·
behavior-parity · maintainability · api-friendliness · i18n-copy.

Round 2 confirmed that every round-1 fix held (the `state-management`,
`error-handling`, `security`, `perms-authz`, `a11y` and `behavior-parity` lenses
returned clean, and every invariant-bearing mutation the auditor applied WAS caught
by the suite: dropping `logical-rhs` → 6 red incl. TEST-1; dropping `ternary-branch`
→ 7 red incl. TEST-2; disabling `after-early-return` → 4 red; narrowing `HOOK_NAME`
to `^usePermission$` → red; disabling the per-proxy action registry → TEST-3 red).

It also found four NEW confirmed findings, all now fixed:

1. **HIGH — the most-imported proxy in the app was invisible.**
   `export const Chat = _createStoreProxy(chatBridge) as _StoreProxy<…>` fails both
   registration tests: the initializer is an `as` expression (not a call), and the
   factory is imported under an ALIAS. `Chat` was therefore only registered from a
   different file, so factor 1 failed for all **52** files importing it from
   `chatBridge` — and `Chat.conversation` is literally the read in the ITEM-10
   pre-image. Fixed: `unwrap` now strips `as`/`satisfies`/`(…)`/`!`, and factory
   callees are resolved through the file's import aliases. Verified: the `Chat`
   probe now fires; the tree is still 0.
2. **MEDIUM — the opt-out could still be spoofed by a URL.** `hasMarker` looked for
   `//` in the raw line, so `const doc = 'https://x/hook-order-ok: y'` silenced a
   real violation on the next line — and the guarding test used a string with no
   `//`, so it never exercised the claim. Fixed: comments are located with the TS
   scanner (`optOutMarkerLines`), so a `//` inside a string is not a comment; block
   comments now work too. Both the spoof and the block-comment case are tested.
3. **MEDIUM — two shipped sub-rules had ZERO coverage.** Mutation-testing showed the
   hook-handle rule (`handle.store.<field>`) and the element-access rule
   (`Proxy['field']`) could each be deleted with the whole suite still green and the
   fixture acceptance still exiting 1. That mattered most for the hook-handle rule,
   which is the ONLY rule that fires on the `OpenInNewWindowAction` pre-image.
   Fixed: both shapes added to `ConditionalHooks.tsx` (the fixture assertion is now
   an EXACT count of 6, and the acceptance test asserts each sub-rule's shape
   appears), plus dedicated unit tests including the negative control
   (`exts[0].store.name` — a store DEFINITION from a registry loop — stays silent).
   Re-verified by mutation: neutering the hook-handle rule → 3 red; the
   element-access rule → 3 red; the aliased-factory resolution → 1 red; the
   comment scanner → 2 red.
4. **MEDIUM/LOW — documentation over-promise and unrecorded scope.** The "known
   gaps" list omitted the aliased-factory shape and understated barrel re-exports
   (~109 named imports); `sdk/packages` as a third gated root, and the
   never-silently-pass hardening, appeared in no PLAN item. Fixed: the gap list is
   now measured and complete (namespace/default imports, barrel re-exports,
   `defineLocalStore(…).use()` locals, `.map()` per-iteration reads), and the two
   additions are recorded as **ITEM-15**/**ITEM-16** with PLAN_AUDIT verdicts,
   DEC-14/15/16, and TEST-15.

Also recorded, not fixed (pre-existing on the base, out of scope per B3):
the desktop `detector-acceptance.mjs` `geometry-identity` row and 3 desktop
guardrail vitest cases are red on an untouched `origin/feat/agent-core` worktree
(DRIFT-1.5). The two new O1/O2 rows report `OK ✓`.

## Verification after round 2

* `node scripts/lint-hooks.mjs` — 0 violations across **2425** files (300 proxies,
  1708 actions), identical from both workspace copies.
* `npm run test:lint-hooks` — **56/56 pass** (39 → 51 → 56 across the rounds).
* Targeted mutation matrix over the four newly-guarded behaviours — all RED.
* `npm run check` — PASS in both workspaces. `gate:ui` — 197/197 surfaces PASS.

**New confirmed findings:** 0

## Honest limit of this round

Two blind agents were dispatched for round 2. The **conformance** agent returned
the four findings above (all fixed). The second agent — assigned correctness /
error-handling / tests-quality / state-management / security on the lint core —
did not return within the session window, so its lens is covered here by
*my own* targeted mutation matrix rather than by an independent reviewer:

* the stale-cache class it was specifically asked to attack is proven closed by a
  direct probe (clean → violation added → violation fixed, in ONE process:
  `0 → 1 → 0`, plus two default-path calls both reflecting disk);
* every rule and sub-rule now has a mutation that turns the suite red (the table
  in `TEST_RESULTS.md`), which is the property that agent was asked to falsify;
* exit-code behaviour (0 / 1 / 2) is asserted end-to-end in TEST-15.

That substitution is recorded rather than papered over: it is a self-review of the
one lens that lacked a second pair of eyes this round, and it is the first thing a
follow-up review should re-run independently.
