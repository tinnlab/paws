# HUMAN_FEEDBACK — chat-send-resilience

**No human feedback received.** This branch was dispatched by the orchestrator as
a self-contained defect fix and has not yet been reviewed by the owner running
the feature. Absence is recorded deliberately, not assumed.

One mid-task ORCHESTRATOR correction was received and is logged here because it
changed how the work was executed:

- **FB-1** [status: resolved] — "I told you to 'run the enumerated tests.' That phrasing has been causing agents on this campaign to re-run entire suites after every fix iteration. […] during iteration, run ONLY the tests covering the files you actually touched, plus a typecheck. Run the full enumerated set exactly ONCE, at the end, before declaring READY." → Adopted immediately. Every iteration after that point ran only the scoped unit specs for the files just edited (typically <1s under `node --test`, ~1s under vitest) plus `tsc --noEmit`; the e2e was re-run only when the change was in its causal path (the fault-injection pattern, the preventDefault fix, the negative control) and only ever `-g`-scoped to the single affected test. The full enumerated set — all unit specs, all four e2e tests, `npm run check` in both workspaces, and `gate:ui` — was run once at the end, and that run is what `TEST_RESULTS.md` records. [generalizable: yes — a lifecycle phase-8 result line has no staleness rule: a prior observed PASS stays valid when unrelated code changes. Iterate with a scoped run + typecheck; run the full enumerated set exactly once, at the end, as the phase-8 record. Widen only from a red scoped run.]

Two things the owner should be shown at sign-off, because a gate tally cannot
convey them:

1. **INV-2 is AT-RISK, not upheld** (`DESIGN_FIDELITY.md`). Both mechanisms the
   design names are implemented and the dispatcher no longer memoizes a transient
   failure — but the literal "for the session" clause is not fully deliverable in
   a browser, because the HTML module map records a failed specifier fetch for the
   life of the document. Measured, not inferred: 9 import attempts produced 2
   network requests in this branch's own e2e. The delivered recovery is that the
   user is told to reload and that reloading demonstrably works. Closing the gap
   properly needs a bundler-level cache-busted re-import — a separate design
   change, and the owner's call.
2. **Fail-closed makes a nominally-optional contributor able to block a send**
   (DEC-1). Accepted deliberately: the alternative for the `mcp` contributor is
   silently dropping a user's tool approval and letting the turn proceed as if it
   had never been given. The tradeoff is now pinned by a test so it can never
   become accidental — but it IS a product judgement, and the owner may want the
   opposite tradeoff for a specific contributor.
