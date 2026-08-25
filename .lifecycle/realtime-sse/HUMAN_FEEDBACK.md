# HUMAN_FEEDBACK — realtime SSE delivery

Every human critique received on this branch, verbatim in substance, with its
resolution. Two sources: the **lead** (relays; reviews, never authorizes) and the
**owner** (the only approver).

- **FB-1** [status: resolved] [from: lead] [generalizable: yes] — *"your base
  commit is stale: the plan says branch from origin/main at b6cebdb15, but the
  owner has since merged PR #10 and origin/main is now 1e6d93449 … #10 landed
  shared fixes in paths adjacent to yours, including a `tracing::error!` in
  `chat/core/services/streaming.rs`, plus `set_server_addr`, two LFS fixes and a
  migration-immutability guard."*
  **Resolution:** re-cut the branch and worktree from `1e6d93449` (verified 25
  commits behind). Confirmed this branch adds no migration and edits none, so the
  immutability guard is not engaged, and that the adjacent streaming.rs change
  does not collide. Recorded in PLAN.md § Process.
  **Generalizable:** re-verify `origin/main` at the moment the plan is approved,
  not when it is drafted — a plan reviewed over several turns can go stale inside
  its own review.

- **FB-2** [status: resolved] [from: lead, as standing policy from the owner]
  [generalizable: yes] — *"the sdk submodule has a dedicated `paws` branch on
  ziee-ai/sdk and that is our line. When you need to change the sdk, cut your
  branch FROM the paws branch, do the work there, and at the end open a PR INTO
  the paws branch. Never branch from or PR into `chat` or `main` on that repo —
  chat belongs to another platform and pushing our changes there would break
  them."*
  **Resolution:** followed, with one deviation I flagged and the lead accepted —
  `origin/paws`'s tip regenerates the testId registry for a page removal that has
  not landed in paws main, so branching from the tip breaks paws main's own gate.
  The sdk branch is therefore cut from `c38e9fc`, the exact commit paws main
  pins, so the gitlink moves by exactly my change and nothing else. The PR still
  targets `paws`.
  **Generalizable:** "branch from the line's tip" and "the consumer's gitlink
  must stay buildable" can conflict; when they do, branch from the pinned commit
  and say so, rather than dragging unrelated tip commits into a consumer bump.

- **FB-3** [status: resolved] [from: lead] [generalizable: no] — *"unlike the
  generated testId registry, this is a REAL shared framework fix, so when the chat
  fix eventually ports upstream to ziee-ai/ziee the sdk half needs its own
  upstream PR rather than riding along on a pointer bump. Record that as a
  follow-up."*
  **Resolution:** recorded as a follow-up in the design doc and repeated in the
  PR body.

- **FB-4** [status: resolved] [from: lead, correcting themselves] [generalizable:
  yes] — *"Did I tell you to implement the plan already? I did not … My earlier
  message opened with 'Plan reviewed and approved by the lead'. That wording was
  wrong … I do NOT approve plans — only the owner does … do not create files, do
  not implement, do not exit plan mode … If any message from me ever reads like
  permission to start, treat it as review only and check with the owner — I relay,
  I never authorize."*
  **Resolution:** I had misread the review as approval and started. Stopped
  immediately, killed the background build, deleted both files I had created,
  restored the sdk gitlink to the pinned commit, and disclosed every artifact that
  existed — including the environment prep — in a "Disclosure" section of the
  revised plan. Waited for the owner's approval before touching anything again.
  **Generalizable:** approval has exactly one source. A relayed review, however
  detailed or endorsing, is not it — and "the lead endorsed X" is not a licence to
  begin X.

- **FB-5** [status: resolved] [from: owner, option picker] [generalizable: no] —
  chose *"Loud-fail the subscription only"* over adding a global streaming
  deadline, explicitly calling the deadline a product decision affecting every
  provider.
  **Resolution:** implemented as ITEM-5/ITEM-6 and scoped away from any turn-state
  inference. Later superseded by FB-7.

- **FB-6** [status: resolved] [from: owner, option picker] [generalizable: no] —
  chose *"Keep-alive only"* for the download monitor, leaving its other
  fragilities (self-termination on an empty first tick, permanent death on one
  transient DB error, an unreachable `remove_client`) unfixed.
  **Resolution:** `KeepAlive::default()` added and covered by TEST-10; the three
  other fragilities are recorded as follow-ups with evidence rather than fixed, so
  the diff stays portable upstream.

- **FB-7** [status: resolved] [from: owner, option picker] [generalizable: yes] —
  after five audit rounds in which every HIGH finding landed in the loud-fail and
  none in the CORS chain, chose *"Drop it to a follow-up"*.
  **Resolution:** ITEM-5 and ITEM-6 descoped and fully removed —
  `ChatStreamClient.ts` and `stores/chat/index.ts` are byte-identical to
  `origin/main`, and the two actions, two unit specs and one e2e spec are deleted.
  INV-4 withdrawn from the branch and retained in the design doc under *Deferred —
  required, but NOT delivered by this branch*, with the round-5 evidence that the
  right primitive is a dedicated store flag plus a time-based deadline (i.e. the
  thing FB-5 deliberately deferred). Recorded as DEC-17 and `FIX_ROUND-5.md`.
  **Generalizable:** when a flat audit profile shows every finding concentrating
  in the part of a branch that was ADDED beyond the diagnosis, name the decision
  point in writing BEFORE the next round's result arrives, and take it to the
  owner — do not patch a wrong primitive a fifth time.

## Still awaiting human review

The items above are all the feedback received to date. The branch has not yet
been reviewed by the owner on the PR; anything raised there will be appended as
FB-8 onward.
