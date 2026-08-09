# DRIFT-1 — implementation vs plan

- **DRIFT-1.1** — verdict: impl-wins — PLAN ITEM-1 proposed `observation` blocks as
  the replacement card subject. Rejected during implementation on evidence:
  `observation` blocks ride a **user-role** message on the wire
  (`server/.../text/types.rs:33-38`, and `ChatMessage.tsx:131` renders an
  observation message full-width only when EVERY block is an observation). Putting
  one inside an interleaved assistant turn would have been a shape the product
  cannot produce — a museum piece built to satisfy a test, which the plan itself
  argued against. Switched to `elicitation_request`, which is a rail BREAKOUT and
  therefore renders the extension's real kit `<Card>` inline in an assistant turn.
  PLAN amended in place.

- **DRIFT-1.2** — verdict: plan-wins — the rebuilt fixture initially failed TEST-2's
  `min(topRelClamp) <= 4` (measured 10). Rather than reshape production spacing to
  suit the test, the bound was raised to the MEASURED position (2px clamp inset +
  8px `my-2` on the elicitation wrapper) with an explicit note that the top edge is
  no longer the load-bearing half of the pin, and that the left/right edges still
  are — measured at exactly 2px of room, i.e. the inset and nothing else. Recorded
  as a real, named reduction in coverage rather than a silently loosened number.

- **DRIFT-1.3** — verdict: resolved — the plan said "no `sdk` change is expected".
  Held: the whole diff is in `src-app/ui`. `sdk` stays at `0ba62538`.

- **DRIFT-1.4** — verdict: impl-wins — **the repair uncovered a second, unrelated
  live defect, and fixing it became necessary.** `ContentRenderer` reads a MUTABLE
  extension registry and is `memo`'d on `{content, isUser}`, so a block rendered
  before its extension registered fell through to the `Unknown content type: …`
  branch and stayed there for the life of the message — nothing would re-render it.
  Measured on the gallery's elicitation surfaces at ~1 load in 10 (`1/14` bad,
  reproducing the literal string `Unknown content type: elicitation_request`). In
  the product this means a BLOCKING request for user input can render as debug text
  instead of its form. The registry already publishes the exact signal for this
  (`subscribeToExtensions` / `getExtensionsVersion`, used by `useChatExtensionList`);
  `ContentRenderer` simply never subscribed. Fixed with that idiom. 0/14 bad after.
  This is outside PLAN's item list; it is in scope because it is a live unowned
  defect and it made the gate non-deterministic.

- **DRIFT-1.5** — verdict: impl-wins — the SAME defect one level up. `ChatMessage`
  calls `chatExtensionRegistry.resolveRailStep` during render, also unsubscribed and
  also `memo`'d, so a message segmented before the rail contributions registered
  recognised no rail steps and rendered raw tool CARDS instead of the activity rail
  — permanently. Reproduced under 16-way concurrent load (16/16 showed a
  `mcp-tooluse-card-…` where a `rail-step` belonged). Same one-line fix. Verified it
  does NOT double-render: `deep-chat-tool-running` still shows 1 rail step / 0 cards
  after the change.

- **DRIFT-1.6** — verdict: impl-wins — PLAN did not anticipate that the spec's own
  positioning recipe (`scrollIntoView` + `waitForTimeout(350)`) was a latent race:
  `isEdgePainted` measures, then screenshots, and a scroll landing between those two
  steps samples bare background at stale coordinates and reports
  `LEFT border is not painted … (issue #183)` for a ring that is present. A taller
  turn made it likely enough to see. Fixed structurally — wait for the turn's
  position to stop changing, position once with a bounded retry, and RE-MEASURE the
  card immediately before screenshotting it. One intermediate attempt (a poll that
  mutated the scroller inside its own predicate) is recorded in the spec's comments
  as a thing not to do; it never converged and turned four passing tests into 60s
  timeouts.

**Unresolved drifts:** 0
