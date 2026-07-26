# HUMAN_FEEDBACK — background-in-conversation

**No human feedback on the RUNNING feature has been received yet.** The feature has
not been demonstrated to the owner in this session; phase 9 is therefore PENDING a
review pass, not clean-by-absence.

What the owner HAS supplied, and how it was honoured, is recorded below. These are
inputs that shaped the work, not post-implementation critique.

- **FB-1** [status: resolved] — "Background sub-agent runs are **disjointly scoped**: a CONVERSATION's sub-agents appear IN that conversation (a right-panel 'Tasks' tab + an end-of-conversation footer affordance that opens it), and a SCHEDULED TASK's runs appear under Scheduled Tasks (which already has its own run history). There is **no global 'Background tasks' page and no 'Background results' sidebar entry** — results surface via the central notification bell, whose click navigates to the conversation. Backend: `GET /api/background/runs` supports `conversation_id` filtering with disjoint semantics (no `conversation_id` ⇒ only conversation-less runs; with one ⇒ only that conversation's)." → transcribed verbatim as `DESIGN.md` §1–§3 and lifted into PLAN's INV-1/2/3; each pinned by an `[acceptance]` test (TEST-11 / TEST-12 / TEST-3). [generalizable: no — this is the feature's own design]
- **FB-2** [status: resolved] — "Do NOT `git checkout`/`reset`/`stash` anything in `/data/pbya/ziee/tmp/fp-ac-merge` — that tree holds the only copy until you've safely copied it out." → the source worktree was never mutated; everything was copied out FIRST to `/data/pbya/ziee/tmp/RESCUE-bg-inconv-20260726-182552/` (full `git diff` + a tarball of the untracked files) before any other command ran. See `RESCUE.md`. [generalizable: yes — when rescuing uncommitted work, snapshot the whole `git diff` + untracked files to a scratch path BEFORE any other action, and never run a state-changing git command in the source tree]
- **FB-3** [status: resolved] — "Capture everything belonging to this feature; leave anything unrelated behind." → the source tree also carried unrelated work (rAF stream-coalescing in `chat/core/stores/chat`, an `openai.rs` change, a `TextInput` register-race fix, a `registry.tsx` `console.log` cleanup). Each was inspected and deliberately left behind; the disposition of every changed file is tabled in `RESCUE.md`. [generalizable: no]
- **FB-4** [status: resolved] — "No push (I'll land it)." → nothing is pushed. The superproject branch `feat/background-in-conversation` and the `sdk` submodule branch `bg-in-conversation-testids` are both local. [generalizable: no]

## Open items for the owner's review pass

Not defects — decisions the owner may want to overrule when they see it running:

- The global `/background-tasks` route + page are DELETED, not merely un-navigated
  (DEC-1). This follows the design's "no global page" literally, and is
  independently forced by the disjoint filter (a conversation-bound run would no
  longer appear there anyway). If the owner wants a nav-less deep-link page for
  detached/scheduled runs, that is a small additive change.
- `/notifications/background` (the bell's target) is KEPT (DEC-2); only its
  sidebar entry is removed.
