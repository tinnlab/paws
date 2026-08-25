# HUMAN_FEEDBACK — paws-feature-surface

Every human critique received on this branch, and what was done about it. Written
as the record phase 9 asks for, not as a summary of the work.

---

## HF-1 — "Desktop is the target"

**When**: phase 1, in answer to the plan's open question about which bundle the
reduction is for.

**Critique**: the plan treated web as the primary surface and desktop as a
follow-on.

**Why it mattered**: the two loaders are not symmetric. `loader.desktop.ts`
eager-globs every core `module.tsx` and never evaluates `shouldLoad`, so on
desktop the manifest predicate — the whole hiding mechanism — does nothing. Only
`CORE_MODULE_BLOCKLIST` has any effect there. Had this gone unasked, the branch
would have hidden everything on web and shipped every feature visible on the
platform that was actually being targeted.

**Resolution**: both workspaces are treated as first-class. `PAWS_HIDDEN_MODULE_NAMES`
is spread into `CORE_MODULE_BLOCKLIST`, and `desktop/ui/src/modules/loader.test.ts`
asserts every hidden name is blocked there (TEST-7). Recorded as the reason that
test exists, in the test itself.

---

## HF-2 — four decisions taken by the owner at phase 1

**Critique/direction**, in answer to the plan's open questions:

| question | ruling |
|---|---|
| how to disable | flip the Rust `default_*_enabled()` to `false` |
| a hidden route | genuine **404**, not `ForbiddenResult` |
| hidden features' e2e | **delete** the suites |
| target | desktop (HF-1) |

**Resolution**: all four implemented. The 404 ruling is `loader.ts`'s
`isPathModuleForbidden` returning false for a hidden module, so the router falls
through to not-found instead of rendering a 403 that would advertise the
feature's existence.

One tension was flagged back rather than silently accepted: deleting the e2e
suites sits against INV-5 ("reversible by configuration, not by deleting code"),
since a later re-enable brings the feature back with no coverage and nothing
fails to say so. The owner kept the deletion. It stands, and the affected paths
are listed in the PR body so a restore is mechanical.

---

## HF-3 — migration prefix correction

**When**: phase 1, via `paws-feature-surface.CORRECTION-1.md`.

**Critique**: the plan's migration prefix was wrong.

**Resolution**: re-measured against both sequences rather than trusting
`CLAUDE.md`'s documented max, which is stale. Landed on `202607210300` after
`origin/main` took `202607210200` in the interim — the number moved twice, which
is the argument for measuring it at write time every time.

---

## HF-4 — the sdk submodule moves to the `paws` branch

**When**: phase 5, via `NOTE-sdk.md` then `NOTE-sdk2.md` (the second superseding
the first's conditional).

**Direction**: point the sdk submodule at `paws`; do **not** edit `.gitmodules`,
because PR #10 owns that line.

**Resolution**: submodule moved to `paws` and pushed to `ziee-ai/sdk`;
`.gitmodules` untouched — the pin arrived from main when #10 merged, and this
branch's diff against main on that file is empty.

**Process note on my part, recorded because the owner paid for it**: I spent
several turns re-examining the sdk decision after it had already been made, and
was told to stop. The instruction that ended it — *"keep the pointer on paws, I
thought that we are already cleared about using paws"* — was correct: a settled
decision is an input, not an open question.

---

## HF-5 — "is your branch working? have you finished the plan?"

**When**: phase 5.

**Critique**: a direct question about the actual state.

**Why it mattered**: at that point only planning artifacts existed. The honest
answer was no, and giving it immediately was the right move; the branch's real
implementation began after it.

**Resolution**: no code change. Recorded because it is the point where reporting
switched from progress-shaped to state-shaped.

---

## HF-6 — a disabled feature must also leave the MENU  ← the substantive one

**When**: after the merge of `origin/main`, with phases 1–6 green.

**Critique**, verbatim in substance: *for things I told you to hide or disable,
hide them from the menu too — users can still see Literature Keys and Web Search
Keys in settings, and there are more like that.*

**What I had done and why it was wrong.** The design's item table lists rows 1
(web search) and 2 (literature) under the lever `disable`, against rows 4 and 5
which read `hide + disable`. I took that distinction literally: flipped the
server switches, left both UI modules loaded, and recorded in
`pawsHiddenModules.ts` and in the desktop loader test that their admin pages
"remain" — treating the table's wording as the specification of intent.

It was not. A capability that cannot run does not become harmless by being
unreachable through its own tool; its settings pages stay in the menu and invite
a user to configure something that will never work. Two of the four were
`settingsUserPages`, so an ordinary non-admin user saw them. The owner found them
by using the app — which is where this class of defect surfaces, and it is worth
noting that no artifact on this branch would have caught it: every test agreed
with the wrong reading, including one written specifically to assert those
modules survive.

**Resolution.** Audited every settings and sidebar slot registration in the tree
against the 13 items, rather than fixing only the two entries named:

- `web-search` and `literature` are now hidden modules — the only available
  lever, since removing a module's slot registrations one at a time is out of
  bounds per the implementation brief. This also drops both chat-extensions,
  which is correct: the server mounts neither MCP router.
- **One further leak, not reported by the owner**: the `knowledge_base` built-in
  was missing from the System MCP page's exclusion set, so a hidden feature's row
  was still listed for admins. Every other hidden feature's built-in was already
  excluded. Fixed in both the rows query and the count query.
- Verified clean, so the sweep is on record as having a boundary: sidebar nav,
  onboarding steps, the chat MCP status row (it filters `is_built_in`),
  user-group widgets, chat citation chips, model-capabilities section.

**Design amended, not quietly overridden**: `docs/design/paws-feature-surface.md`
rows 1 and 2 now read `hide + disable`, with a note saying the amendment came
from the owner during implementation and why the original reading failed.

**Still open, flagged to the owner rather than decided unilaterally**: Admin →
User Groups → the permission picker enumerates the whole generated permission
catalog, so `workflow::*`, `citations::use`, `knowledge_base::use`, `hub::*`,
`voice::*`, `js_tool::use`, `web_search::use` and `lit_search::use` remain listed
and assignable. It is admin-only, and an admin can type any token into the
Advanced JSON editor regardless, so filtering it is cosmetic rather than a
containment boundary. Not changed without a ruling.

### HF-6a — six pre-existing spec failures the same sweep uncovered

Not part of the owner's report, found while tracing what hiding these two modules
would break, and listed here because they were latent on the branch **before**
this feedback:

Specs that assert a HIDDEN feature's behaviour, deleted per HF-2's ruling:
`chat/run-js-tool-scripting`, `chat/run-js-real-llm`,
`chat/workflow-workspace-run-card`, `14-split-chat/workflow-export-per-pane`,
`projects/bibliography-manage-panel`, plus the `literature/**`,
`settings/web-search-*` and `sync/{web-search,lit-search,literature}-*` suites.

Specs that test a SURVIVING feature but used a hidden one as their vehicle —
**retargeted, not deleted**, since deleting them would have thrown away coverage
of something paws still ships:

| spec | vehicle before | after |
|---|---|---|
| `chat/right-panel-resize` | literature panel | file panel |
| `chat/activity-rail-seeded` | KB step labels | the file + code_sandbox labels it already asserted |
| `chat/activity-rail-detail` | KB card body | the sibling FILE case, same delegation contract |
| `settings/permission-visibility` | `web-search` entry | `users` entry |

The last of those is the one worth naming: with web-search hidden, the entry is
absent for **every** user, so the assertion would have kept passing while proving
nothing about permission filtering — the only thing that spec exists to prove.
That is the same failure shape as the vacuous-absence problem the 17-paws-surface
suite was built to avoid, arriving from the opposite direction.

The chat gallery's two literature right-panel surfaces were handled the same way:
the single-tab one dropped, the multi-tab one given a second FILE so the tab
strip the A8/I5 detectors need stays real rather than silently degrading to a
single tab.

---

## Escalated to the owner — NOT fixed on this branch

Both are behavioural leaks where a hidden feature still reaches the **model**,
which is sharper than the design's stated limitation ("a user who knows the
URL"). Both are recorded here and repeated in the PR body.

1. **The citations built-in auto-attaches to every tool-capable chat**
   (`mcp/chat_extension/mcp.rs` — "always available, no admin enable"). The model
   receives six citation tools, calls them unprompted, and writes a bibliography
   the user has no surface to view.
2. **`control_mcp` defaults ON and builds its catalog from the live router**, so
   the model can `list_capabilities` → `invoke_capability` against workflow,
   scheduler, knowledge-base, citations, file-rag and hub.

Neither fix is in scope. Each needs either a server-side kill switch for a
feature the design deliberately scopes as UI-only, or the permission revokes
withdrawn in round 1 because they broke chat for every non-admin (DEC-4,
reversed). They are the owner's call.
