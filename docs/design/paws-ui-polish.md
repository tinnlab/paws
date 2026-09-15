# Design — five owner-reported issues from using the paws build

**Status:** draft for review · **Scope:** paws UI (`src-app/ui`, shared with
desktop) + `src-app/server` (skills, local-runtime validation)

## Problem

The owner ran the shipped paws desktop build and hit five issues. Four are
surface defects with contained causes. The fifth — a freshly downloaded model
that cannot be chatted with until the page is reloaded — is the one that makes
the product's headline flow ("finish onboarding, have a model, talk to it") fail
at the last step, and it is not contained: nothing in the reported symptom says
which end is at fault.

Three of the five are the same *kind* of defect the repo has already paid for
once each, which is why this document names the precedent rather than
re-deriving it:

| this issue | the precedent it repeats |
|---|---|
| download panel overflows its box | the notification bell popover, fixed with a documented pattern |
| a skill for a hidden feature still ships | `paws-feature-surface`: hiding a UI entry is not disabling the capability |
| a downloaded model is unusable until reload | PR #12's two "server is right, the client never hears" defects |

## Invariants

These are the non-negotiables. Each is pinned downstream by an executable
acceptance test that would fail if the invariant were violated.

- **INV-1**: Every control in the Downloads panel — the progress bar and the
  percentage included — renders **inside the panel's own box**, at narrow and
  wide viewports alike, and the document never scrolls horizontally because of it.
- **INV-2**: The notification and download icons occupy **one row, side by side**,
  in **both** the web and the desktop layout; the row is still correct when only
  one of the two is present.
- **INV-3**: A skill whose **subject** is a feature paws hides does **not reach
  the model** — neither on a fresh install, nor on an install that already synced
  it. Removing the source directory alone does not satisfy this.
- **INV-4**: A skill that ships on paws never **directs the user to a feature paws
  hides**.
- **INV-5**: After a local model's download completes, the user can **send it a
  message and get a response without reloading the page**.

## Item 1 — the Downloads panel overflows its box

The widget wraps its content in a fixed `style={{ width: 320, maxHeight: 440 }}`
while the kit popover popup is `w-72` (288px) with `p-2.5`, leaving 268px of
usable width. 52px of every row therefore paints outside the popover's
background, and the height bound is not viewport-relative.

**This is byte-for-byte the notification bell's old bug**, and its fix is already
written down in that component
(`sdk/packages/notification-ui/src/NotificationBellWidget.tsx:54-73`): the
**panel**, not a child of it, owns the size, and that size is viewport-bounded.
The kit `Popover` forwards `className` onto the popup, where tailwind-merge
resolves `w-[…]` over the primitive's `w-72`, so the shared kit primitive needs no
edit. The list then scrolls via `min-h-0` + `flex-1` rather than a hardcoded
"reserve N rem for the header" subtraction, which silently breaks whenever the
header changes height.

Inside the row there is a second, independent overflow: the name/percentage flex
row has no `min-w-0`, so the name can push the percentage out even once the panel
is bounded, and the name is truncated by **JS character count**
(`substring(0, 30)`) rather than by CSS, so it does not respond to the panel's
actual width.

**Why the gallery did not catch it.** The widget's only gallery state is *empty* —
the state matrix's `:open` cell is explicitly skipped. A popover that is never
rendered open, with data in it, cannot show an overflow. That gap is part of the
fix, not incidental to it.

**Why visibility assertions do not catch it either.** Every control was
"visible" — just drawn on top of the chat composer instead of inside the panel.
The assertions have to be **geometric**, which is exactly what the bell's
regression spec already does.

## Item 2 — the notification and download icons sit on two rows

The sidebar renders each `sidebarBottom` widget in a bare block `<div>`, so the
two registered widgets stack.

The owner's choice, made explicitly after the constraint below was surfaced, is
**one row inside the existing bottom slot**. The alternative — moving both icons
onto the user widget — was rejected because the user widget is **web-only**: the
desktop loader blocklists the `user-profile` module, so desktop has no such row
and that route would have meant designing, screenshotting and regression-testing
two different layouts for one request.

Two things the row has to survive, both real today:

- **One child, not two.** The download widget self-hides when nothing is
  downloading, which is its normal state.
- **The row must not be a child of the Tools section.** It currently is, so an
  empty Tools section would take the notification bell and the download icon with
  it. Only three modules register `sidebarTools` and one of them (`hub`) is
  paws-hidden, so the margin is a single module.

## Item 3 — skills for features paws hides

`paws-feature-surface` hid 13 features from the UI and disabled five of them
server-side. It did not touch **skills**, which are a separate channel into the
model: the skill chat extension injects the available-skill listing as the first
system message of every tool-capable chat.

Of the 13 built-in capability skills, exactly **three** have a hidden feature as
their subject (workflow authoring, workflow-run troubleshooting, hub
installation). Three more are legitimate skills whose *instructions* route the
user through the Hub, which paws does not have — a content problem, not a removal
one (INV-4). The single seeded hub skill is reachable only through the Hub UI and
so ships as dead weight.

**The load-bearing finding is that deleting a directory is not enough** (INV-3).
The built-in sync is insert-or-update only: its single write is an
`INSERT … ON CONFLICT (name) DO UPDATE SET … enabled = TRUE`, with no prune, no
reconciliation and no delete. On a fresh database, removing the directory works.
On every **upgraded** install the already-synced row survives with
`enabled = TRUE` — and a built-in row is admitted by the gating query
**unconditionally**: no group check, no permission check, no per-user opt-out, and
no user-facing delete (the API refuses to delete a built-in). So an "removed"
skill would keep appearing in every chat's system prompt forever.

This is the same distinction `paws-feature-surface` drew between *hiding* and
*disabling*, arriving one layer down: **removing the source is the hide; the
migration is the disable.** Both are required, and the honest statement of the
limit belongs in the PR.

## Item 4 — hide the tinnlab repository — withdrawn

Raised in the brief, then **withdrawn by the owner** during planning ("let's just
keep it for now"). Recorded here so the absence is a decision with a name on it
rather than a gap. Nothing is built. The row stays visible.

## Item 5 — a downloaded model cannot be chatted with until reload

**The cause is not yet established, and this design does not pretend otherwise.**
What the read-only trace rules IN and OUT is worth recording, because it inverts
the brief's leading assumption.

**Ruled out: picker staleness.** The composer's rendered model and the send
path's `model_id` are read from the *same* per-conversation map in the *same*
store, and there is no client-side capability or readiness gate anywhere in the
send path. So "the model is visibly selected AND the send fails" cannot be
produced by the picker being stale. Download completion also already publishes
both the admin and the user-facing sync entities with **no origin**, so even the
tab that started the download receives them — and the equivalent no-reload
delivery is already proven end-to-end by an existing spec.

**Confirmed by reproduction: a server-side teardown race, not a client one.**
Driven on a live instance — enable the local provider, install a runtime,
download a real 296 MB GGUF, send the moment it completed — the send returned
200 with an empty assistant message and the server logged:

```
ERROR chat: provider stream failed to start …:
      Provider error: missing per-instance bearer token
```

`LocalDeployment::stop` removes the model's entry from the process-global
per-instance-bearer map **first**, then kills the process, and only then does
the `llm_runtime_instances` row leave `status='running'`. The chat proxy reads
those two in the **opposite** order — the DB row, then the bearer — so there is
a window in which it resolves a live engine URL and a missing token, and
returns `502 engine_start_failed`.

Tier-2 validation is also enqueued **twice** per repository download, and each
pass is a full spawn → 90-second health probe → teardown. That does **not create**
the window; it doubles how long it stays open (two passes ran across ~55 s in the
reproduction). Both are fixed: the duplicate is removed, and the proxy now treats
a missing bearer as positive evidence that the instance is gone and
re-establishes one rather than failing the request.

The validator already carried a hand-written warning about this hazard ("a later
chat would see already_running=true and forward to a dead port"), and the repo
ships a debug seam to keep the validator out of E2E's way *because the race was
hit once before* — the failure simply lands one step earlier than the comment
predicted, on the token rather than on the socket.

So "reloading makes it work" means **"it started working a couple of minutes
later, and the reload was incidental"**. No amount of sync plumbing fixes it, and
this document does not pretend otherwise.

**Two real defects found on the way, worth fixing on their own terms**: the
validator publishes only the admin entity and never its paired user-facing one,
unlike every other model mutation; and the admin provider store's load still
short-circuits on an in-flight load even when the caller passed `force`.

### The acceptance gate must be deterministic

If the race is the cause, the tempting test — send a message *inside* the
validation window — is timing-dependent. That is the classic spec that is green
on the developer's machine and red in CI at 3am, and it is a weak test even when
it passes, because it samples one instant of a window rather than proving a
property.

So the invariant is proven by **putting the system into the states the window
consists of**, rather than racing to catch it in one:

- exactly **one** validation pass follows a completed download, asserted on an
  observable consequence (the `processing` transitions it writes), not on a
  mocked call count;
- for **each state a validation pass transits** — the draining flag, and a
  `running` instance row pointing at a dead port — a send must not fail.

The end-to-end "download completes → send → response, no reload" browser spec
still runs, as **corroboration**, and is labelled as not proving the window is
closed. If a deterministic assertion cannot capture the user-visible symptom,
that gets stated plainly, with what the racing test does and does not prove —
never a flaky spec presented as the acceptance criterion.

## Out of scope

Hiding the tinnlab repository row (item 4, withdrawn) · adding server-side kill
switches for the six UI-only hidden features · rewriting the user-profile
widget's imperative hover/focus styling · any macOS build.
