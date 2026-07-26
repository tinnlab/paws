# HUMAN_FEEDBACK — sse-slot-leak

The only human input on this feature is the original bug report + brief, plus one
mid-task course correction from the coordinator. Both are recorded verbatim
below. **No human has reviewed the running feature yet** — the items below are
the human INSTRUCTIONS I received, not a review of the result. Phase 9 is
therefore satisfied only in the sense that every instruction received is
resolved; the owner sign-off against the acceptance tests still has to happen.

- **FB-1** [status: resolved] — "Fix a PRODUCTION-BREAKING backend bug under the feature-lifecycle: per-user SSE connection slots are never reclaimed, so a user permanently locks themselves out of chat." → A real, deterministic slot leak was found and fixed on both registries (guard hoisted out of the generator + a closed-channel sweep at the cap boundary), with red-before-fix proofs on both handlers. **But the reported production 429s were NOT reproduced** — see FB-4, which is the honest qualifier on this item. [generalizable: yes — when a bug report asserts a mechanism, reproduce THAT mechanism before fixing; if it does not reproduce, say so in the deliverable's own comments, not only in the process artifacts]

- **FB-2** [status: resolved] — "Make slot release DETERMINISTIC on disconnect: the stream's cleanup must unregister the connection when the SSE body is dropped … plus a liveness/idle sweep as backstop (a keep-alive write whose failure prunes, and/or a TTL on connections that have not been seen)." → The deterministic half is done exactly as asked. The **TTL half was implemented and then deliberately REVERSED** (ITEM-7 / DEC-11 / FIX_ROUND-1): reaping a connection for being old frees the accounting slot while its stream, task and socket survive, so the cap would stop bounding real resources and a client could accumulate connections *past* it — strictly worse than the leak, which failed closed. Three independent blind auditors converged on this. The rejection and its reasoning are documented in the code so it is not re-derived. **This is a deliberate deviation from the brief and needs the owner's confirmation.** [generalizable: yes — a "reclaim the slot" backstop must reclaim the RESOURCE, not just the bookkeeping; freeing a cap's accounting while the socket lives converts a fail-closed bound into unbounded growth]

- **FB-3** [status: resolved] — "Preserve the existing caps + behavior; owner-scoping and the notify-only wire format are untouched. Backend-only — do NOT touch `src-app/ui/**`." → Caps unchanged (512/12/1024; chat 24/512/2048) and pinned by tests that would fail if reclamation became a cap raise; owner-scoping/audience routing byte-identical; zero files touched in either UI workspace; no OpenAPI/types regen.

- **FB-4** [status: resolved] — "Verify empirically against a running server: open >12 sequential connections, drop them, confirm a fresh connect returns 200 and the registry count returns to ~0. Real numbers before→after." → Measured, and the answer is not the expected one: on the UNFIXED server, 20 sequential / 100 sequential / 200 and 400 concurrent abandoned connections leaked **0** slots, because hyper always polls the response body while writing it. The never-polled leak is real and deterministic (0 → 20 at the handler level) but is not reachable through hyper's HTTP/1.1 path, so **the reported production 429s remain unexplained**. Surfaced prominently in the hand-off rather than papered over; the diagnostics the owner would need are listed there. [generalizable: yes — record the measurement that CONTRADICTS the hypothesis as prominently as the one that confirms it, and never let a test's doc comment assert a red-before-fix property that was measured false]

- **FB-5** [status: resolved] — coordinator, mid-task, verbatim: "IMPORTANT — your base is stale … `origin/feat/agent-core` has moved to `f78a23a22` … Before you finish: fetch and merge `origin/feat/agent-core` into your branch, then re-run your verification so your before→after numbers are measured against the CURRENT baseline … your sdk pointer must not regress: current tip pins sdk `ebe3ff8262`." → Merged (the sole conflict was the sdk submodule pointer; this branch's sdk HEAD IS `ebe3ff8` with the three sse-slot-leak commits rebased on top, so the pointer moves forward only). Every number in TEST_RESULTS.md is re-measured on the merged base, including the newly-landed `npm run lint:hooks` gate (0 violations). No overlap with any of the ~30 landed commits, so no landed work is re-fixed or claimed.

- **FB-6** [status: resolved] — coordinator, verbatim: "No push, no `git stash`, no broad docker/pkill/rm." → Nothing was pushed (both the sdk and superproject commits are local), no `git stash` was used at any point, and no broad `docker`/`pkill`/`rm` was run. **Land-order requirement carried into the hand-off:** the sdk commits must be pushed to `sdk/agent-core-and-perf` BEFORE the superproject pointer, or the pointer dangles.

## Process incident (self-reported, not human feedback)

Commit `7c594f791` silently captured a temporary revert of both production hunks:
a blind-audit agent's in-flight red-before-fix experiment in this SHARED worktree,
swept up by `git add -A`. Two independent round-2 auditors caught it; HEAD is
restored and re-verified. **Rule for the fleet: never `git add -A` in a worktree
shared with agents that mutate source — stage explicit paths, re-run the scoped
suite immediately after every commit, and give review agents an explicit
read-only constraint (or `isolation: "worktree"`).**
