# TESTS — perf-ux-round2

Every ITEM is covered; every `INV-N` is pinned by an `[acceptance]` test that
would FAIL if the invariant were violated (not merely if the code changed).

## Why the acceptance tests are build-driven, not source-driven

The pre-existing `LazyDatePicker.test.ts` proves the point negatively: it
regex-matches the wrapper's SOURCE for `lazy(`, `Suspense`, `forwardRef<` — and
passes today, while the dependency it exists to keep lazy sits in
`index.html`'s `modulepreload` set. A source-contract test cannot fail on
"the built output is still eager". So TEST-1 runs a **real production build** and
inspects the emitted `index.html`; flipping the invariant off (restoring the eager
barrel export) turns it red.

## Tests

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-2] [covers: ITEM-1, ITEM-2] file: `src-app/ui/scripts/check-eager-graph.test.mjs` — asserts: a REAL `vite build --mode production` into a temp outDir emits an `index.html` whose `modulepreload` set contains NO chunk carrying a dependency listed as lazy-only in `scripts/lazy-deps.json` (`react-day-picker`, `date-fns`); the same assertion run against a build with the eager barrel export restored FAILS, proving the test is not a tautology.
- **TEST-2** (tier: unit) [acceptance] [invariant: INV-1, INV-3] [covers: ITEM-1] file: `src-app/ui/scripts/check-eager-graph.test.mjs` — asserts: the critical-path total (entry + every `modulepreload` + every stylesheet, raw bytes, a metric with ZERO run-to-run variance) is at least 70,000 B smaller than the recorded pre-fix baseline of 1,276,893 B — i.e. the claim is proven by the deterministic metric named in MEASUREMENT §1, never by a timing metric whose σ exceeds the effect.
- **TEST-3** (tier: e2e) [acceptance] [invariant: INV-5] [covers: ITEM-1] file: `src-app/ui/tests/e2e/07-mcp/elicitation-date-field.spec.ts` — asserts: a real MCP elicitation form containing a date field renders the (now lazily-loaded) DatePicker, the user can open the calendar and pick a date, and the chosen ISO value is submitted — proving the `forwardRef`/`cloneElement` ref+prop injection still binds across the new lazy boundary in the running app, not just in source.
- **TEST-4** (tier: e2e) [covers: ITEM-1, ITEM-7] file: `src-app/ui/scripts/gate-ui.mjs` (`npm run gate:ui`, recorded in TEST_RESULTS.md) — asserts: the gallery runtime-health pass is 205/205 surfaces clean with zero gating HIGH findings on a quiet box, and the `RUNTIME_FINDINGS.md` committed by ITEM-7 is the artifact of that same run.
- **TEST-5** (tier: unit) [covers: ITEM-2] file: `src-app/ui/scripts/check-eager-graph.test.mjs` — asserts: the static half of the gate — given a fixture barrel that re-exports a lazy-only module as a VALUE it reports a violation, given one that re-exports it as `export type` it does not, and given no build present it skips the build-dependent half instead of failing.
- **TEST-6** (tier: unit) [covers: ITEM-2] file: `src-app/ui/scripts/check-eager-graph.test.mjs` — asserts: the gate reads its lazy-dependency list from `src-app/ui/scripts/lazy-deps.json` (a product-tree path) and passes when run against a tree with `.lifecycle/` removed — the B6 merge-strip survival requirement.
- **TEST-7** (tier: unit) [covers: ITEM-3] file: `agent-kit/lifecycle/tests/a1-base-scoped.test.mjs` — asserts: in a scratch git repo whose BASE commit already contains `.lifecycle/{alpha,beta}` and whose branch adds `.lifecycle/gamma`, A1 passes; when the branch adds `.lifecycle/{gamma,delta}` A1 fails naming only gamma+delta; when the base has no `.lifecycle/` at all and the branch has two dirs A1 fails (the safe degradation path).
- **TEST-8** (tier: unit) [covers: ITEM-3] file: `agent-kit/lifecycle/tests/a1-base-scoped.test.mjs` — asserts: running `lifecycle-check --phase 1 --base origin/feat/agent-core --dir .lifecycle/perf-ux-round2` in THIS worktree exits 0 while all 13 inherited sibling `.lifecycle/` dirs remain on disk and in `git ls-tree HEAD` — the regression test for the data-loss failure this item exists to end.
- **TEST-9** (tier: unit) [covers: ITEM-4, ITEM-5] file: `.lifecycle/perf-ux-round2/tests/proxy-sse-teardown.test.mjs` — asserts: against a stub upstream that counts open SSE connections, a proxy WITHOUT the `res.on('close')` teardown leaves the upstream connection open after the client aborts, and the patched proxy closes it — the executable form of the 12-then-429 vs 20/20 finding, with no dependency on a running ziee.
- **TEST-10** (tier: e2e) [covers: ITEM-6] file: `src-app/ui/tests/e2e/00-smoke/harness-log-honesty.spec.ts` — asserts: a spawned test server's captured harness output contains the line reporting the path actually taken (`Spawning prebuilt binary` when the prebuilt binary exists) and does NOT contain `Using cargo from PATH` while no cargo process is invoked.
- **TEST-11** (tier: unit) [covers: ITEM-7] file: `src-app/ui/scripts/check-eager-graph.test.mjs` — asserts: the committed `src/dev/gallery/RUNTIME_FINDINGS.md` reports 0 gating HIGH findings, so a stale copy claiming 917 cannot be re-committed.

## Descoped items (exempt from coverage — dispositions in DECISIONS.md)

- **ITEM-8** — `[DESCOPED]`, disposition DEC-6.
- **ITEM-9** — `[DESCOPED]`, disposition DEC-7.

## Tier rationale

- The frontend workspace is touched (`src-app/ui/**`, and `sdk/packages/kit`
  which both workspaces consume), so `tier: e2e` coverage is mandatory: TEST-3
  (the real date field in a real elicitation form) and TEST-10 (harness log
  honesty), plus the `gate:ui` canary TEST-4.
- **No permission is introduced** by any item — no `X::use`/`X::read`/`X::manage`
  is added to a `modules/*/permissions.rs` and no migration grants one — so A9
  (backend deny test) and A10 (`[negative-perm]` restricted-user e2e) do not
  apply. Recorded explicitly rather than by omission.
- No backend (`src-app/server/**`, `src-app/desktop/tauri/**`) file is touched,
  so no `cargo test` chain applies.
