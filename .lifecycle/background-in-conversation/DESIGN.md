# DESIGN — background runs are disjointly scoped

Owner-approved design, transcribed verbatim from the approval that preceded the
original implementation. This is the upstream document `PLAN.md` derives from;
its §1–§3 are lifted into `PLAN.md`'s `## Invariants` as INV-1..INV-3.

## §1 Scoping

> Background sub-agent runs are **disjointly scoped**: a CONVERSATION's sub-agents
> appear IN that conversation (a right-panel "Tasks" tab + an end-of-conversation
> footer affordance that opens it), and a SCHEDULED TASK's runs appear under
> Scheduled Tasks (which already has its own run history).

## §2 Surfaces

> There is **no global "Background tasks" page and no "Background results" sidebar
> entry** — results surface via the central notification bell, whose click navigates
> to the conversation.

## §3 Backend filter semantics

> Backend: `GET /api/background/runs` supports `conversation_id` filtering with
> disjoint semantics (no `conversation_id` ⇒ only conversation-less runs; with one
> ⇒ only that conversation's).

## Rationale (as given with the approval)

A background run belongs to exactly one owner, and that owner should surface it.
A conversation-spawned sub-agent belongs to its conversation; a scheduled task's
run belongs to its schedule, whose run history already exists. A standalone global
"Background tasks" page therefore only duplicates the scheduler's run history while
pulling the user OUT of the conversation they were reading — which is the opposite
of what they want when checking on an agent they just launched.

## Provenance

The first implementation of this design was written but never committed; it lived
as uncommitted changes in the scratch worktree `/data/pbya/ziee/tmp/fp-ac-merge`
(branch `integration/main-agentcore`, HEAD `51164e4cd`). Those changes were copied
out to `/data/pbya/ziee/tmp/RESCUE-bg-inconv-20260726-182552/` before any work
began, and are reconciled onto current `origin/feat/agent-core` by this lifecycle.
See `RESCUE.md` for the what-was-found-vs-what-was-ported ledger.
