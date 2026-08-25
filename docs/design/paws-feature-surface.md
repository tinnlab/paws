# Design — reduce the paws feature surface

**Status:** draft for review · **Scope:** ziee server + UI (paws instance)

## Problem

paws is a **separate instance** from ziee, aimed at a narrower audience. It
inherits ziee's full feature set, most of which is noise or a support burden for
this audience. Users should not see or be able to use those features.

## The two levers (the owner's own distinction)

The task list distinguishes **disable** from **hide**, and the codebase supports
both cleanly. They are not interchangeable:

- **Disable** — the capability is genuinely OFF. The server does not register the
  MCP server / does not serve the route. Nothing to reach.
- **Hide** — the UI module is not loaded. **The API remains reachable.**

⚠ **Hiding is not a security control.** A hidden module's REST endpoints still
answer to a user who knows the URL and holds the permission. For a reduced-clutter
instance that is acceptable; if any item on this list must be genuinely
unreachable, it needs a server-side switch, several of which do not exist yet
(see the table). **State this explicitly rather than implying hidden == off.**

## Mechanism

**Hiding (UI):** every module declares a manifest predicate —
`shouldLoad: (ctx) => ctx.isAuthenticated` today. Hiding is that predicate
returning false. One uniform lever, one line per module, no bespoke gating.
Do NOT hide by deleting slot registrations, route entries, or components
individually — that is twelve different hacks with twelve regression surfaces.

**Disabling (server):** deploy-level kill switches that already exist —
`web_search`, `lit_search`, `voice`, `js_tool`, `bio_mcp` (`core/config.rs`).
Semantic search is an admin-settings flag, not a config switch:
`file_rag_admin_settings.semantic_enabled`.

## The items

| # | item | lever | mechanism | server switch exists? |
|---|---|---|---|---|
| 1 | web search | hide + disable | `shouldLoad` + config `web_search.enabled = false` | ✅ |
| 2 | literature | hide + disable | `shouldLoad` + config `lit_search.enabled = false` | ✅ |
| 3 | semantic search | disable | `file_rag_admin_settings.semantic_enabled = false` | ✅ (settings) |
| 4 | voice dictation | hide + disable | `shouldLoad` + config `voice.enabled = false` | ✅ |
| 5 | programmatic tools | hide + disable | `shouldLoad` + config `js_tool` | ✅ |
| 6 | workflow | hide | `shouldLoad` | ❌ UI-only |
| 7 | scheduler | hide | `shouldLoad` | ❌ UI-only |
| 8 | citations | hide | `shouldLoad` | ❌ UI-only |
| 9 | knowledge base | hide | `shouldLoad` | ❌ UI-only |
| 10 | document RAG | hide | `shouldLoad` on `file-rag` | ❌ UI-only |
| 11 | hub | hide | `shouldLoad` | ❌ UI-only |
| 12 | assistant templates | remove | the template surface only — **NOT** the whole assistant module | n/a |
| 13 | project citations/references | remove | the `knowledge_kinds` "References" project-extension entry | n/a |

Items 6–11 are **UI-only**: hidden, not disabled. Recorded as a limitation, not
glossed.

**Amendment (owner, during implementation) — items 1 and 2 gained the `hide`
lever.** They were originally written as `disable` alone, on the reading that a
server switch was enough. It is not: with the capability off, the four settings
pages those modules register ("Web Search", "Web Search Keys", "Literature
Search", "Literature Keys") stay in the menu and invite a user to configure
something that cannot run. The owner's ruling is that a disabled feature keeps no
menu entry, so both modules are now hidden as well — which also drops their chat
extensions, correct here because the server never mounts either MCP router. This
is the only lever available: the implementation brief forbids removing a module's
slot registrations one at a time.

## Invariants

- **INV-1**: A hidden feature's UI is **absent** — no nav entry, no route, no
  slot contribution, no composer affordance. Not merely visually suppressed.
- **INV-2**: Hiding a module **must not break** the modules that remain. Chat,
  onboarding, settings and projects keep working with every listed module absent.
- **INV-3**: A disabled capability is **genuinely off server-side** — its MCP
  server is not registered and the model cannot call its tools.
- **INV-4**: Hiding is achieved through the **existing `shouldLoad` manifest
  predicate**, uniformly. No per-module bespoke gating, no deleted slot
  registrations, no commented-out routes.
- **INV-5**: The reduction is **reversible by configuration or a single
  predicate**, not by deleting code — paws may want a feature back.
- **INV-6**: Nothing in this change weakens an existing permission or auth check.

## Decisions for the implementer to make and record

1. **Where does the hide list live?** A single shared constant the predicates read
   (recommended — one place to audit and revert, satisfies INV-5), or per-module
   literals. Basis: prefer one source.
2. **Item 12** — is "no assistant template" the template *picker*, seeded template
   rows, or both? Inspect and record.
3. **Item 13** — the project References entry only, or the whole citations
   project-extension?
4. **Do hidden-but-not-disabled modules (6–11) also need their permissions
   revoked** from the default group, so the API is not merely undiscoverable?
   Recommended if cheap; record either way.

## Test strategy (enumerated at phase 3)

- **e2e is the load-bearing tier**: log in as an ordinary user and assert each
  hidden feature's nav entry, route and affordances are **absent** (INV-1), while
  chat / onboarding / settings / projects still work (INV-2).
- **integration**: a disabled capability's MCP server is not registered and its
  tools are not offered to the model (INV-3).
- **unit**: the predicate/constant returns the expected set.
- An `[acceptance]` test per invariant. INV-2's is the one that matters most —
  it must FAIL if hiding a module breaks a surviving surface.

## Out of scope

- The pathway-analysis skill + assistant (additive, needs domain content — its own task).
- Deleting any feature's code.
- Adding server-side kill switches for items 6–11 (a larger change; record as follow-up).
