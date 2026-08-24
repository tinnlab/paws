# DESIGN_FIDELITY — paws-feature-surface

One verdict per invariant declared in `PLAN.md` `## Invariants`, lifted verbatim
from `docs/design/paws-feature-surface.md`. `fidelity ∈ UPHELD | AT-RISK |
DROPPED`. These are the author's own verdicts and therefore the least
informative evidence in the lifecycle — the binding checks are the blind
`design-conformance` angle (phase 6) and the `[acceptance]` tests (phase 8).

- **INV-1** — fidelity: AT-RISK — the module predicate alone does NOT deliver
  this, which is the central finding of the plan audit. Three registries bypass
  the module system: the chat-extension glob (composer pills, toolbar status
  rows, panel renderers, rail steps), the project-extension glob (the citations
  "References" entry), and the two chat-owned affordances
  `chat/extensions/{schedule,voice}`. ITEM-4 and ITEM-5 close those, and ITEM-6
  turns the residual 403 route into a genuine 404. It stays AT-RISK rather than
  UPHELD until the phase-8 absence sweep actually runs against a built app,
  because "no affordance anywhere" is a claim about a whole surface and I have
  only audited the discovery mechanisms I found. A fourth registry I have not
  found would fail this invariant silently.

- **INV-2** — fidelity: AT-RISK — this is the invariant the change can most
  plausibly break, and the acceptance test is deliberately a POSITIVE journey
  (chat send, onboarding, settings navigation, a project's knowledge section)
  rather than an absence check, because an absence-only test passes vacuously
  when the app fails to boot at all. Known live hazards, all enumerated in the
  plan audit: two static imports from survivors into hidden modules
  (`ScheduleLoopDialog` → scheduler store, `DownloadIndicatorWidget` → hub
  store), the chat rail's contribution ordering, and `PanelRendererMap`
  degenerating when augmenters disappear. Each is either verified safe in source
  or assigned to ITEM-13 to be settled by RUNNING it. AT-RISK until then.

- **INV-3** — fidelity: UPHELD — and the plan strengthens it. ITEM-7 makes the
  four capabilities off by default rather than relying on a deployment editing
  YAML that no committed config file contains. The audit found `web_search`
  genuinely violating this today: its chat-extension factory discards the config
  and `should_attach` reads only DB rows, so a stale `mcp_servers` row keeps the
  tools reachable by the model with the switch off. ITEM-8 fixes that; without
  it, ticking item 1 would have been a false claim.

- **INV-4** — fidelity: UPHELD, with one deviation named rather than hidden —
  hiding is the `shouldLoad` predicate, applied uniformly to all 13 module
  manifests, and no slot registration, route entry or component is deleted to
  achieve it. The deviation is that the design's *decision #1* recommends the
  predicates read a single shared constant, and they provably cannot: the
  manifest plugin lifts each predicate's source verbatim into the entry chunk
  and hard-fails on any free identifier besides `ctx`/`Permissions`
  (`vite-plugin-module-manifest.js:81-101`). The single constant still exists and
  is still the revert point; the per-module literals are bound back to it by a
  test. That is decision #1's *intent* (one place to audit and revert) satisfied
  by the only means the build permits. Recorded as DEC-1.
  ITEM-4/ITEM-5 are not per-module bespoke gating either: each is ONE central
  predicate at a shared registry/discovery site, reading the same list.

- **INV-5** — fidelity: AT-RISK — the reduction itself is reversible by editing
  one list (and, for the server half, by a config key), which is the invariant's
  substance. The tension is ITEM-12: deleting the hidden features' e2e suites is
  deleting code, and if paws re-enables a feature its tests are gone and the
  coverage hole is silent. I raised exactly this with the owner, offered
  relocation as a same-cost alternative that preserves reversibility, and the
  owner reaffirmed deletion. It is a recorded human decision, not a silent
  reframing — but it is honestly AT-RISK against the invariant's wording, and it
  is recorded that way rather than being written up as UPHELD.

- **INV-6** — fidelity: UPHELD — nothing here weakens a permission or auth
  check. Every change is strictly restrictive: capabilities default off, an
  auto-attach path that ignored its kill switch now honours it, a desktop
  override that overrode operator config is removed, and DEC-4 REVOKES
  user-facing grants rather than adding any. No permission constant, gate,
  extractor or route guard is removed or loosened. The one route-behaviour change
  (ITEM-6, 403 → 404) alters what an already-denied user is TOLD, never what they
  can reach — the module's code is not delivered in either case.
