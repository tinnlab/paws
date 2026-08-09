# HUMAN_FEEDBACK

- **FB-1** [status: resolved] — "Reproduce first, and quantify. Run the failing
  test at least 20 times and record the failure rate. A defect whose defining
  property is intermittency cannot be called fixed on one green run — that
  mistake has already been made twice in this work, once by me." -> Baseline
  measured over 110 runs BEFORE any edit (TEST-1); post-fix over another 110
  under identical conditions (TEST-5). No fix was written until the baseline
  existed. [generalizable: yes — an intermittency claim sourced from a <10-run
  sample should be re-measured before it is used to pick a mechanism; a 5-run
  sample cannot separate 20% from 1%, and here the small sample also mis-labelled
  the failure SIGNATURE, which is what sent the hypothesis at the wrong subsystem]

- **FB-2** [status: resolved] — "verify it actually is the mechanism before
  assuming. If awaiting introduces a regression … say so and propose the
  alternative rather than shipping a trade you didn't disclose." -> FB-11 was
  tested, not assumed, and refuted two ways: structurally (the harness never
  calls `mountGallery`) and empirically (20 scoped gallery crawls, 0 findings).
  Nothing was shipped to `mount.tsx`; the type-level finding that makes awaiting
  possible is handed off in DEC-2. [generalizable: yes — when a nominated cause
  lives on a code path the failing test does not execute, that is disqualifying
  evidence available before any measurement, and it should be checked first]

- **FB-3** [status: resolved] — "If the residue turns out to have a different
  cause than FB-11, that is a valuable result — say so and name it." -> Named:
  the first test in the file performs the admin page's entire Vite module-graph
  transform (~3.5s) INSIDE Vitest's 5000ms default per-test budget. Recorded in
  the spec's own comment so the next reader does not have to re-derive it.
