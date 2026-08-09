# DRIFT-1 (authored during implementation)

- **DRIFT-1.1** — verdict: impl-wins — The plan was handed to me naming FB-11
  (un-awaited `cfg.loadModules()`) as the leading candidate. Implementation
  found it CANNOT be the mechanism for this spec: the harness mounts
  `<FileRagAdminPage />` directly and never calls `mountGallery`, so
  `loadModules` is not on its code path. PLAN's ITEM-2 was therefore reframed
  from "fix FB-11" to "test FB-11", and the verdict recorded as a CONCERN rather
  than silently dropped. The brief anticipated this outcome explicitly.

- **DRIFT-1.2** — verdict: impl-wins — The reported failure SIGNATURE (a React
  hook-order violation) was not observed once in 229 captured runs. The single
  reproduced failure was `Test timed out in 5000ms`. The plan's framing of the
  defect as a hook-order race was corrected to a per-test time-budget defect,
  and the correction is pinned by TEST-4's deterministic red/green rather than
  by assertion.

- **DRIFT-1.3** — verdict: none — The store-proxy hook-PATH-flip hypothesis
  (ITEM-3) was implemented as an instrumented probe with a positive control and
  run 40x. Zero flips. The hypothesis is disproved, not merely unobserved; the
  probe was reverted so it does not ship.

- **DRIFT-1.4** — verdict: resolved — The first attempt at the timing probe
  created a second `.test.tsx` carrying a duplicated `data-testid`, which the
  `testid-unique` Vite plugin correctly refused at dev-server start. Scratch
  specs were removed rather than the guard relaxed (B3: never edit shared
  harness infrastructure to route around your own problem).

**Unresolved drifts:** 0
