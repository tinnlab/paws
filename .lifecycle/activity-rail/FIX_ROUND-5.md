# FIX_ROUND-5 — Activity Rail

Round 5. A fresh blind re-audit of **FIX_ROUND-4's own diff**, by two auditors
splitting the angle roster. It found **two HIGH defects FIX_ROUND-4 introduced**,
and it **reversed one disposition I made in round 4 on the facts**.

**New confirmed findings:** 20

20 confirmed and fixed; 3 `accepted-open` with rationale. All in `LEDGER.jsonl`
with `"round": 5`.

---

## 0. The round-4 disposition that was wrong

FR4-18 — "`withSegmentationKey` pins `key` but not `consumed`/`blocking`" — I
**rejected**, reasoning that shape is read from the segments array and never from
a re-resolved descriptor. That reasoning was wrong, and the auditor supplied the
file:line that disproves it:

```
ActivityRail.tsx:65   const steps = segmented.map(p => ({ index: p.index, step: resolveStep(p) }))
                      …passes THAT to renderStepDetail
ChatMessage.tsx:191   chatExtensionRegistry.renderRailDetail(…, placed.step.consumed)
```

`segmentRail` **clamps** `consumed` at the first `RAIL_EXCLUDED_TYPES` block after
the anchor — the ITEM-5 guard against a contribution swallowing the prose answer —
and re-resolution handed the contribution's **unclamped** value straight to the
detail renderer. So an over-reporting contribution had its clamp bypassed and its
body redrew blocks the segmentation loop had already rendered: the exact "span
says N, renders M" class ITEM-5 exists to make impossible.

Renamed to **`withSegmentationShape`**; it now pins `key`, `consumed` **and**
`blocking`. Recorded here rather than quietly amended: a rejection that turns out
to be wrong is the most expensive kind of audit outcome, because it closes the
finding.

## 1. HIGH — the focus fix stole focus on MOUNT

Both auditors, independently. `wasResolved` was seeded `null`, so **any** mount
where `resolved !== null` satisfied `resolved && !wasResolved.current` and called
`focus()`. The transcript is virtualized (`@tanstack/react-virtual`), and this
card's resolved state is *designed* to survive a remount — the file says so — so
merely **scrolling an answered approval back into view** yanked focus out of the
composer, and `focus()`'s scroll-into-view fought the virtualizer's own anchoring.

Seeded with the first-render value: only a genuine `null → resolved` **transition**
moves focus.

## 2. HIGH — the "unresolvable" fix created a permanent dead-end, and was a regression

`resolveFailed` fed `unresolvable`, which **both** disabled the buttons **and**
gated `resolve()` — so the `setResolveFailed(false)` reset *inside* `resolve()`
became unreachable. One failed POST disabled the card for the life of the mount.
**Before FIX_ROUND-4 the same failure left the buttons clickable and reset on the
next attempt**, so the "fix" was strictly worse than what it replaced.

The root cause was collapsing two genuinely different states into one boolean.
Replaced with `elicitationBlockedReason() → 'no-transport' | 'resolve-failed' | null`:

| state | controls | message | why |
|---|---|---|---|
| `no-transport` | **disabled** (+ tooltip + `aria-describedby`) | "the approval channel is unavailable… it will become answerable on its own" | nothing can carry the decision; clicking would silently no-op |
| `resolve-failed` | **enabled** | "That didn't go through — try again." | a rejected POST is transient; retrying is the point |

## 3. MEDIUM — a client transport condition had been written into message CONTENT

FIX_ROUND-4 stamped `unresolvable: !registered` into the `run_js_approval`
block's `content`. That is a transient CLIENT condition recorded in the message
**content vocabulary**, snapshotted once and never correctable — the block is
deduped by `elicitation_id` and never rewritten. And it was reachable: mcp's
`initialize` **awaits a dynamic import before installing the transport**, so a
frame landing in that window latched the card permanently disabled even after mcp
finished wiring, leaving the suspended script unresumable.

Removed from the block. The card **reconciles against the live seam and
self-heals**: once a transport exists and the entry is missing, it re-registers.
The failure repairs itself instead of being recorded as content.

## 4. HIGH (test) — the anti-vacuity guard sat below the count it was guarding

`files.len() > 100`, while the module dirs **alone** already yield 101 (101 + 8 SDK
+ 5 desktop = 114). Dropping the SDK roots leaves 101; dropping desktop leaves
109. **Both still passed** — the guard could not detect either regression it was
raised for. Now asserted **per root**: each group must contribute files.

## 5. MEDIUM (test) — every FIX_ROUND-4 parser change was UNFALSIFIABLE

An auditor re-implemented the parser and replayed it over all 114 real files:
identical index map and `owner_leading == 2` **with or without** the block-comment
strip, the uppercase name extraction, the `CONCURRENTLY` trim and the `FILTERED`
correction. The corpus contains no lowercase `create index`, no
`DROP INDEX CONCURRENTLY`, and no `ALTER TABLE` on `mcp_tool_calls`. So the round-4
"negative controls" proved the *assertion* could fire; they never proved the
*parser branches* could.

Fixed structurally: the parser is extracted as
`replay_index_ddl(sources, table, refuse)` and three new unit tests feed it
**synthetic SQL** covering every branch — lowercase DDL, `CREATE UNIQUE INDEX`,
`CONCURRENTLY` on both CREATE and DROP, multi-target `DROP INDEX a, b`, line- and
block-commented DDL, a glob inside a line comment, constraint-backed indexes in
all three spellings, the legitimate `PRIMARY KEY (id)`, and a single-column index
on **each** of the five filtered columns.

### 5a. And the block-comment stripper was actively wrong

It ran **before** `--` stripping and is not comment-aware, so a `/*` inside a line
comment opened a block that never closed and **discarded the rest of the file**.
Live in the corpus today: `notification/202607144180` has the glob
`…/migrations/*_notification_schema.sql` in a header comment. Harmless for that
file, but it makes the owner-leading guard **silently vacuous** for any future
migration whose prose mentions a glob path. (The round-4 rationale's claim that a
migration "already uses block comments" was also false.) Line comments are
stripped first now, pinned by a synthetic test.

### 5b. And the `ALTER TABLE` refusal false-fired on the real corpus

It matched `mcp_tool_calls` **anywhere** in the statement and `UNIQUE` as a bare
substring — so `ALTER TABLE other_tbl … REFERENCES mcp_tool_calls(id)`, a
`DROP CONSTRAINT foo_unique`, and `ADD COLUMN unique_key` would all have panicked
with misleading advice. It also missed `PRIMARY KEY` / `EXCLUDE`, which create
backing indexes and contain no `UNIQUE` token — and the corpus has
`ADD CONSTRAINT mcp_tool_calls_pkey PRIMARY KEY (id)`, which made the first cut of
this round **fail the suite on a legitimate migration**.

Rewritten to **model** constraints as indexes rather than refuse them, scoped to
the altered table and to `ADD` only. The ordinary owner-leading rule then decides:
a PK on `id` passes (no filtered column), a `UNIQUE (message_id)` is flagged.
Refusal is reserved for a column list the parser genuinely cannot read.

Three further parser defects fixed alongside: the offset was derived from
`flat.len()` while the trim ran on `upper` (`to_uppercase()` is not
length-preserving, so non-ASCII could slice at a non-char boundary or underflow);
`$$ … $$` bodies mentioning the table are now refused rather than split
mid-body; and `DROP INDEX a, b` now removes both names.

**Negative controls re-run against the REAL corpus walk:** a single-column index
on `is_built_in` → RED; a lowercase `create index` on `tool_use_id` → RED; an
`ALTER TABLE … ADD CONSTRAINT … UNIQUE (message_id)` → RED. Green on removal.

## 6. MEDIUM — the twin seam, a third time

- **The FIX_ROUND-4 hardening of `setRailLiveSource` had NO test at all** — there
  was no `liveSteps.test.ts` in the tree, so reverting the refuse-the-install
  guard turned nothing red. Worse, `transport.test.ts`'s own header *claimed*
  liveSteps was already unit-tested through the same reset helper. It was not.
  New `liveSteps.test.ts` (6 tests) mirrors `transport.test.ts`; the false claim
  is corrected.
- `__resetRailLiveSourceForTests` still had the bare unsubscribe its twin got
  guarded in round 4 — same leak, same file, same commit that claimed to harden
  "in step".

## 7. MEDIUM — the extraction did not pin what it was extracted to pin

`withSegmentationShape` was covered in isolation, but the revert that matters is
at the **call site** (`ChatMessage.resolveStep` returning the registry step
directly), and nothing observed it — the divergence only shows on a message that
replays a `tool_use_id`, and this runner cannot mount JSX. The bug had moved from
"unpinned inline" to "unpinned at the seam."

Added a **source-level seam guard** in `railIsolation.test.ts`, labelled as one in
the test itself: it asserts `ChatMessage` still routes through the helper and does
**not** contain the revert shape. It asserts a structural property, not behaviour,
and says so.

## 8. The rest, fixed

- disabled controls take the NATIVE `disabled` (via `useSurface` →
  `nativeDisabled`) and so leave the tab order — a keyboard user met no control
  and no reason. Tooltip + `aria-describedby` added, per the kit Button's own
  documented convention.
- `outline-none` on the focus target made the programmatic focus move invisible;
  now a `focus-visible` ring.
- `quiet()` stubbed only `console.error` while round 4 moved the no-transport
  diagnostics to `warn`, so they leaked into the suite output.
- my own round-4 follow-up test had a "RECOVERY" assertion that was a **verbatim
  duplicate** of its healthy case — vacuous. Gone; the property is expressed by
  the two-state classifier's test.
- the e2e collapse leg **cannot execute** in this spec's configuration (the stream
  is still open at the approval moment, so the rail is force-open and
  non-toggleable). Round 4 documented that instead of acting on it. Removed, with
  the deterministic proof attributed to the mocked sibling that can guarantee a
  settled rail.
- the sibling probe was narrowed on ONE side only; it now evaluates from the
  breakout outward, so both sides share a parent by construction.
- the comment claiming `desktop/tauri/migrations` is part of the server's merged
  set was wrong (desktop composes its own); corrected to deliberate
  over-inclusion.

## 9. Dispositioned without a code change

- **FR5-21 `accepted-open`** — `hasElicitationTransport()` is read in render but
  is not part of the `useSyncExternalStore` snapshot. Not incidental: `bump()` on
  install **and** clear is the seam's published contract and is asserted by
  `transport.test.ts`. Folding `transport !== null` into the snapshot would give
  one seam two snapshot sources. Both auditors independently verified the
  reactivity holds today.
- **FR5-22 `accepted-open`** — a card that mounts ALREADY blocked has its live
  region enter the tree carrying text. Inherent to a live region for a state that
  can be true at first paint; deferring the text by a tick trades a real
  announcement for a flicker and a timer. The state is now transient anyway (the
  card self-heals).
- **FR5-23 `accepted-open`** — `setToolCallProgress` mints a new Map per progress
  frame, so a busy stream still bumps at frame cadence. Correct: the narrowing
  removes UNRELATED-mutation wakeups and cannot remove progress-frame wakeups,
  which are a genuine change to what the rail renders. Only round 4's framing
  overstated it.

## 10. What the auditors independently confirmed CLEAN

- the `FILTERED` column list, re-checked column-by-column against the real SQL;
- the walked roots really do match `build.rs::compose_merged_migrations`;
- the mcp `subscribe` narrowing is **sound AND complete** — one auditor traced
  every write to `toolCalls` (`addToolCall`/`updateToolCall`/`setToolCallProgress`/
  `clearToolCalls`, all immer `.set`/`.clear`) and confirmed the only two live-seam
  consumers read nothing else;
- `warn`-not-`error` is correct against `runtime-health.mjs` (`console.error` is
  recorded unconditionally and gates; a warning is recorded only when it matches
  `REACT_WARNING`, and is MEDIUM/non-gating);
- the `data-rail-shape="rail"` e2e scoping is a genuine fidelity fix — DEC-3's
  quiet-single really does render at full bubble width, so round 3's comparison
  would have gone red on a conformant render;
- the always-mounted empty `role="status"` is the correct ARIA pattern for the
  resolve transition;
- the `serverParenLabel` rename is a real decoupling with no stale references;
- design-system conformance: semantic tokens, 4px scale, logical direction — with
  `lint:colors`, `lint:logical-direction`, `lint:hooks`, `lint:guardrails`,
  `check:testid-registry` and `check:state-matrix` all green.

## 11. Observed results (this round)

| suite | observed |
|---|---|
| Rust lib — `mcp::tool_calls::` (incl. 3 new parser tests) | **21 passed, 0 failed** |
| Index guard — 3 negative controls vs the REAL corpus | `is_built_in` → RED, lowercase DDL → RED, `ALTER TABLE … UNIQUE` → RED; green on removal |
| `liveSteps.test.ts` (new) | **6 passed, 0 failed** |
| `transport.test.ts` | **8 passed, 0 failed** |
| `railIsolation.test.ts` (incl. the new seam guard) | **6 passed, 0 failed** |
| `railSegmentation.test.ts` | **14 passed, 0 failed** |
| chat unit family | **341 tests, 337 pass, 4 fail** — the same pre-existing loader failures |
| `npm run check` (ui) | **exit 0** |
| `npm run check` (desktop/ui) | **exit 0** |
| `cargo check --workspace` (lib + bin) | **exit 0** |
| e2e — rail family + `run-js-inner-approval`, bridge ON | **21 passed, 0 failed** |
