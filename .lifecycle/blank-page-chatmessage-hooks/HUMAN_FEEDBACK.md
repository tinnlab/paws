# HUMAN_FEEDBACK — blank-page-chatmessage-hooks

No human feedback received yet — the feature has not been reviewed by the owner.

The branch is worktree-only and unpushed, as instructed, so review has not been
possible. When it happens, each item goes here VERBATIM as an `FB-N` with a
status, and this file gates the merge.

## What to review against (the invariants, not a gate tally)

- **INV-1** — no hook is called after a conditional return.
  Proof: `src-app/ui/src/modules/chat/components/ChatMessage.hooks.test.tsx`
  (TEST-1, verified RED 4/4 with the exact production error
  `Rendered fewer hooks than expected`, GREEN after), plus the now-enforced
  `correctness/useHookAtTopLevel` gate.
- **INV-2** — no render throw anywhere in the tree may show a blank page.
  Proof: `src-app/ui/src/modules/shell/AppShellErrorContainment.test.tsx` (TEST-3,
  RED 4/4 against the previous `fallback={() => null}`) + the e2e
  `tests/e2e/00-shell/error-containment.spec.ts`, whose measured limit is stated
  in TESTS.md rather than glossed.
- **INV-3** — a caught module crash isolates and the rest keeps working.
  Proof: TEST-3's sibling-module assertion; TEST-4/4b/4c for the latch clearing.

## Two things worth the owner's explicit attention

1. **A crash in a normally-invisible module is now VISIBLE.** `() => null` was
   wrong for the router, but "render a panel for every module" is the other
   extreme: a portal-only or listener-only module that crashes will now inject an
   in-flow error card. Recorded in the ledger as deferred — a per-module policy is
   a design decision, not a bugfix.
2. **The new rule does not cover the SDK itself**, and `sdk/packages/framework`
   has 5 diagnostics under it today (the store-proxy `get` traps, which already
   carry a rules-of-hooks suppression). Reported rather than silently ignored;
   wiring lint into a package with no scripts is separate work.
