# mobile-approval-clipped — DRIFT round 1

Implementation reconciled against PLAN.md and against the design's invariants,
written DURING phase 5 as each item landed.

- **DRIFT-1.1** — verdict: impl-wins — PLAN did not contain the header-starvation
  defect (ITEM-6). It was found by LOOKING at the fixed 390px render (the
  screenshot showed "(Acme Weather) — needs approval" with no tool name) and then
  measured: the name renders at `width=0` against a `scrollWidth` of 98, while the
  two `whitespace-nowrap` secondary labels take 205px of the 238px row; at 1280px
  the same name renders at 98px. Same taxonomy class as the footer (B2
  failure-to-wrap), same card, one row up. PLAN.md amended with ITEM-6 and INV-4,
  DECISIONS with DEC-9, PLAN_AUDIT with an ITEM-6 verdict, TESTS with TEST-8;
  gates 1–4 re-run green. Fixed in all three approval headers, which carry the
  pattern verbatim.

- **DRIFT-1.2** — verdict: plan-wins — the first cut of the reachability helper
  treated ANY ancestor with non-`visible` overflow as a clip. That contradicts
  INV-1's meaning of "reachable" (a user can scroll), and it is factually wrong
  here: the approval card lives inside a list with `overflow-y: auto`, so every
  below-the-fold control would have been reported unreachable. Re-implemented to
  the design's predicate — an axis clips only when `overflow` is `hidden`/`clip`
  AND the ancestor has nothing to scroll to (`scrollExtent <= clientExtent`) —
  which is exactly the rig's wording ("cut to 0 by a NON-scrollable overflow
  ancestor", "no horizontal scroll to reveal it") and the taxonomy A11 predicate.

- **DRIFT-1.3** — verdict: plan-wins — TESTS.md specified the pressability check as
  a one-shot `document.elementFromPoint` hit-test. In practice that races the
  message list's mount-time auto-scroll and produced a non-deterministic result
  (TEST-6 failed at `--workers=1` and passed at `--workers=2` on identical code).
  Re-implemented as Playwright's own actionability check (`click({ trial: true })`),
  which performs the same hit-test but scrolls first, waits for a stable box and
  retries — a STRICTER statement of "a user can press this", and still not
  satisfied by DOM presence. Verified by the negative control: it fails pre-fix
  with `element is outside of the viewport`. TESTS.md TEST-1 prose left as written
  (it describes the property, and the implementation proves it more strongly).

- **DRIFT-1.4** — verdict: none — the ITEM-4 nested-group CONCERN raised in
  PLAN_AUDIT was real and is handled as planned: the wizard's inner navigation
  group is its own flex container, so the primitive's rules do not reach its
  buttons; it carries its own `flex-wrap`, and TEST-6 asserts that directly rather
  than assuming it.

- **DRIFT-1.5** — verdict: resolved — an environmental (not code) obstacle surfaced
  during verification and is recorded here so it is not mistaken for a product
  defect: the gallery's dynamic module import fails intermittently on this host
  (`EMFILE: too many open files, watch …`; `[loader] failed to load module "mcp"`),
  because the kernel's `fs.inotify.max_user_instances` (128) is exhausted by the
  file watchers of ~30 concurrent worktree Vite servers. Measured failure rate ~2
  in 15 loads, and REPRODUCED ON THE UNTOUCHED BASE COMMIT (2 bad loads in 32), so
  it is independent of this diff. Handled by a bounded re-navigation in the spec's
  own navigation helper (documented in-file, no assertion relaxed) and by running
  with `CHOKIDAR_USEPOLLING=1`, which keeps Vite off inotify entirely. Three
  consecutive full runs of the spec then passed 17/17.

**Unresolved drifts:** 0
