# FIX_ROUND-5 — ABORT and re-scope

One angle, deliberately narrow: the ~40 lines of the loud-fail mechanism,
audited exhaustively (full state space, sequenced reachability, per-test mutation
analysis) rather than broadly. That target was chosen and **the decision rule was
written down in `FIX_ROUND-4.md` before the result came back**: converged, or the
loud-fail leaves this branch.

## What it found

Not more instances of the same bug — a **wrong root**:

- **F2 (high)** — the mechanism watches subscription-PUT *outcomes*, never
  delivery or liveness. So the likeliest real failure is invisible to it: an SSE
  drop mid-turn (server restart, proxy idle, token `exp`, backpressure eviction)
  loses the `complete` frame, no PUT is ever attempted because
  `setActiveConversation(sameId)` early-returns, the failure counter never
  advances — and the user gets an infinite spinner with **no banner at all**. The
  exact symptom this branch exists to remove, reachable through a door the
  mechanism does not watch.
- **F1 (high)** — the banner is raised and then wiped on the dominant path.
  Actions dispatch lazily, so the report's `set({error})` lands one microtask
  after `setActiveConversation`, and `loadConversation`'s cache-miss path then
  sets `error: null`. Opening a conversation on a broken stream shows no banner
  *and* pushes the next visible report out by another interval.
- **F3/F4 (medium-high)** — recovery is an edge trigger tested against a level
  guard, so a banner can outlive its condition permanently; and the null-PUT
  asymmetry can leave a stale banner on a healthy conversation that the mechanism
  can never take down.
- **Test survivors** — deleting `lastReportedAtFailure = -1` (re-introducing the
  round-4 regression), deleting `connectionId = null`, deleting two thirds of the
  clear guard, and **rewording the banner to claim a turn is in flight** all
  stayed green. The last one is the same "one word changed and the guard went
  green" failure the file's own comment condemns, one round after it was written.

And its §5: every piece of bookkeeping in the mechanism —
`lastReportedAtFailure`, `SUBSCRIPTION_REREPORT_EVERY`, the delta, the per-turn
re-arm, the `null` exclusion, the string-equality clear — exists only because the
banner lives in the shared `error` slot six other actions overwrite. The right
primitive is a dedicated store flag plus a **time-based deadline**, which would
cover the PUT failure, the dropped stream and the hung PUT uniformly.

That deadline is the product decision the owner descoped in DEC-9.

## The decision

The skill's ABORT rule fires here: round ≥5 with a flat profile ⇒ **re-scope, do
not run another round**. The cause is legible rather than mysterious:

| round | angles | confirmed | HIGHs | HIGHs introduced by the previous round |
|---|---|---|---|---|
| 1 | correctness · design-conformance · security | 19 | 2 | 2 |
| 2 | state-management · design-conformance/test-reality | 19 | 2 | 2 |
| 3 | correctness · api-contract | 16 | 3 | 2 |
| 4 | regression · whole-feature | 17 | 2 | 2 |
| 5 | focused state-space | 8 | 2 | 2 |

**Across five rounds and ten blind angles, every HIGH finding was in the
loud-fail — and none was in the CORS chain that is this branch's subject.** The
security angle cleared the CORS union explicitly with its work shown; the
whole-feature angle re-verified the causal chain for both reported symptoms and
found one wrong sentence in a doc, not in the code.

**Resolution (DEC-17, owner-approved):** ITEM-5 and ITEM-6 are DESCOPED and
removed. `ChatStreamClient.ts` and `stores/chat/index.ts` are byte-identical to
`origin/main` again; the two actions, two unit specs and one e2e spec are
deleted. INV-4 is withdrawn from the branch's invariants and retained in the
design doc under *Deferred — required, but NOT delivered by this branch*, with
the evidence, so the follow-up starts from the right primitive instead of the
fifth patch of the wrong one.

What ships is what has been clean in every round: the CORS union + the desktop
config extraction + the config examples, the download-consumer payload fix, and
the download-stream keep-alive.

## One gate this legitimately cannot pass, stated rather than worked around

`--phase 3` now fails **A5** — "TESTS.md dropped 3 previously-enumerated tests
(TEST-6, TEST-7, TEST-11)". That guard exists to stop tests being deleted to make
a gate green, and it cannot distinguish that from tests withdrawn because the
OWNER approved removing the feature they covered.

Both parsers key on the same line shape, so the only ways to clear it are to give
the withdrawn IDs full test lines (which phase 8 then requires to PASS — they no
longer exist) or to re-point them at other tests (recycling IDs across features,
which A11 exists to prevent). Both are the false certification this branch's whole
audit history is about, so neither was done. The failure is recorded here, in
`TEST_RESULTS.md`, in the STATUS file and in the PR body, and **no 9/9 is
claimed**.

**New confirmed findings:** 0
