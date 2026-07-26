# DECISIONS — live-ui-audit-fixes

Every human/product input the implementation needs, resolved up front.

### DEC-1: Batch or join — how is the by-conversation N+1 removed?
**Resolution:** a dedicated batch endpoint `POST /api/projects/by-conversations`
(ids in, `links[]` out), NOT a `project_id` column added to
`ConversationResponse`.
**Basis:** codebase — `ConversationResponse` is chat-owned and project-unaware by
DESIGN (CLAUDE.md §Chat Projects: "chat's core code has zero project imports").
Adding `project_id` to it would invert that decoupling and would still not carry
the project NAME the trailing badge renders. The reverse-lookup already exists as
its own route (`/projects/by-conversation/{id}`, contributed by the project↔chat
extension); the batch form is its exact sibling and keeps the inversion intact.

### DEC-2: Method + shape of the batch endpoint?
**Resolution:** `POST` with a JSON body `{ conversation_ids: [uuid] }`, response
`{ links: [{ conversation_id, project }] }` — a LIST of pairs, and conversations
with no project are simply ABSENT (no null entries).
**Basis:** convention — a GET cannot carry 200 uuids in a URL (the practical
limit is ~2 KB); POST-for-batch-read is the standard escape and the endpoint
still gates on the READ permission `projects::read` (CODING_GUIDELINES §1
"read endpoints use a `*::read` perm"). A list of pairs (not a map) because a
map keyed by uuid serialises to `additionalProperties` and would depend on how
`emit_ts.rs` renders an open record — a `Vec<struct>` is unambiguous in the
golden generator. "Absent = unfiled" mirrors the singular endpoint's `null`.

### DEC-3: Batch id cap — fixed constant or admin-configurable setting?
**Resolution:** a fixed constant `MAX_CONVERSATIONS_PER_LOOKUP = 200` in
`project/types.rs`, over-cap → **422**.
**Basis:** convention — this is a request-VALIDATION bound (a payload-size
guard on one read), not an operational tunable an operator would ever want to
tune; it mirrors the existing project file cap (100 files/project, 422 over cap,
CLAUDE.md §Chat Projects) which is likewise a plain constant. It is declared as
a named `pub const` (not an inline magic number) so it can be promoted to a
settings row later without a rewrite, per the phase-4 configurable-settings rule.

### DEC-4: Client batching window?
**Resolution:** a 20 ms collection window opened by the FIRST pending id (a
fixed window, not a debounce — later ids join it, they do not extend it),
chunked at the 200-id cap, one request per chunk.
**Basis:** convention — a virtualized list mounts its rows across a few animation
frames, so a `queueMicrotask`/`setTimeout(0)` flush would still split the burst
into several requests; 20 ms (~1.2 frames) covers one mount wave while staying
imperceptible. A debounce is explicitly rejected: under continuous scrolling it
would starve the badge indefinitely.

### DEC-5: Shared LLM-model catalog — cache policy?
**Resolution:** in-flight coalescing PLUS a 2 000 ms freshness TTL, with an
explicit `{ force: true }` bypass and an exported `invalidateLlmModelCatalog()`.
**Basis:** convention/codebase — in-flight coalescing alone (the pattern the
projects extension already uses via `inflightProjectLookups`) only collapses
genuinely OVERLAPPING calls, and the three home-load callers are three separate
store inits that may land microseconds apart rather than overlapping. A 2 s TTL
deterministically collapses one page-load burst while being far shorter than any
human edit-then-navigate loop, so no admin can observe a stale picker.
Provider-scoped loads (`llm-provider`'s `?provider_id=`) are deliberately NOT
routed through the catalog — they are the mutation-adjacent path.

### DEC-6: Does the client-side capability filter change what a picker shows?
**Resolution:** no — the client filter is `capabilities?.[cap] === true`,
byte-for-byte the server's rule.
**Basis:** codebase — `llm_model/handlers/models.rs` filters with
`serde_json::to_value(&m.capabilities)…get(cap).and_then(as_bool)
.unwrap_or(false)`; an absent/false/non-bool flag excludes the model. The
catalog fetches `page=1&perPage=200`, the same page size every migrated caller
already requested (ProjectDefaultsForm asked for 100 — 200 is a superset).

### DEC-7: Accent swatch — which variant does the swatch preview?
**Resolution:** the RESOLVED theme's variant (`def[resolvedTheme].primary` for
the fill, `def[resolvedTheme].fg` for the selected check), replacing the fixed
`def.light.primary` + `text-white`.
**Basis:** codebase/design — `ACCENT_PRESETS` documents "Each preset gives a
light + dark variant with a foreground tuned for AA contrast on that fill", and
`applyAccent` applies exactly `def[isDark ? 'dark' : 'light']`. A picker that
previews a colour the click will NOT produce is simply wrong, and it is what the
audit measured as palette-drift. The inline `style` + `data-allow-custom-color`
stay: a colour swatch is the documented genuinely-dynamic-colour exception.

### DEC-8: The `:1520` geometry findings do not reproduce — fix, or report?
**Resolution:** REPORT with measurements + root cause, and ship a regression
guard; do not invent a source change.
**Basis:** measured evidence (PLAN_AUDIT §Evidence). The `:1520` bundle links a
27 KB CSS chunk containing none of `.sr-only`/`.fixed`/`.min-w-0`/`.flex-1`; a
correct build of the same source measures `body.scrollWidth === 390` with zero
overflowing elements. Changing source to "fix" a stale-artifact symptom would be
a fabricated fix (INV-5).

### DEC-9: The audit's remaining HIGH `429` console-errors — in scope?
**Resolution:** OUT of scope for this feature; triaged + reported with evidence,
not fixed here.
**Basis:** the `429`s are on `GET /api/sync/subscribe` and `GET /api/chat/stream`
and are the documented per-user SSE connection cap (`sync/registry.rs`: 512
global / **12 per-user**) being hit because the battery drives 6+ browser
contexts as ONE user in quick succession. It is a property of the audit's own
drive pattern against a shared long-lived server, not of any of the four
findings under repair; a genuine fix (faster registry pruning on client
disconnect) is a separate, sync-module-owned change with its own blast radius.
Recorded in TEST_RESULTS.md as a triaged non-fix with the before/after counts.

### DEC-10: Is the audit skill itself modified to stop flagging the 7
non-selected accent swatches?
**Resolution:** NO.
**Basis:** `feature-lifecycle` B3 — never edit shared test/audit infrastructure
to route around your own feature's finding. The residual is reported honestly as
a detector false-positive class inherent to a colour PICKER (the repo's own
`lint:colors` carves it out via `data-allow-custom-color`; the runtime detector
does not read that marker).
