# FIX_ROUND-2 — blind audit of the FIX diff (`cd7b68979..25f3443c0`)

HEAVY tier requires the full loop, so round 1's fixes were themselves audited
blind (angle: **correctness + guard-efficacy**), with an explicit brief to BREAK
the new guard. It did, twice, and found two independent defects the fix round
introduced.

## Defects introduced by round 1 — all fixed

| # | severity | finding | fix |
|---|---|---|---|
| 1 | **medium-high** | `TEST-6` planted its fixture in a FIXED `src-app/ui/scripts/local/` and `finally`-removed the WHOLE directory. `mkdirSync(recursive)` succeeds on an existing dir, so a developer's untracked files there were destroyed — silently, while the test reported PASS, on every `npm run check` in BOTH workspaces. The guard's own comment names `scripts/local` as the missed evasion, making it a plausible directory for someone to create. | `mkdtempSync` — a unique dir that cannot pre-exist, so cleanup can only remove what the test made. Verified: a pre-existing `scripts/local/my-real-helper.mjs` now survives a full run. |
| 2 | medium | `TEST-1`'s zero-surface floor regex anchored the count on `(`, so it **never applied to the overlay generator** — the one whose fail-open case the adjacent comment cites. The overlay banner is `overlay gate OK — 38 overlay surfaces (…)`; the only `(`-prefixed number is `37 hosts`. Measured: floor APPLIED for coverage + state-matrix, SKIPPED (NaN) for all three overlay runs including a literal 0. | anchor on `(?:—|\()`, so the floor now applies to all three. |
| 3 | low | The diff deleted `src-app/ui/src/dev/gallery/RUNTIME_FINDINGS.md` — a file the web workspace **deliberately commits** (its `.gitignore` says so explicitly; only the `.jsonl` is ignored). Swept in by `git add -A` after a killed `gate:ui` deleted it pre-run. | restored from `origin/main` (156 lines). Not gitignored — the auditor's suggestion to ignore it would contradict the workspace's stated policy. |

## Guard efficacy — 10 of 13 evasions worked; all now closed

The auditor planted real files and ran the suite. Every one below was **EVADED**
by round 1's guard and is **CAUGHT** now (each verified by planting the fixture,
running the suite, and removing it):

`var X =` · `export { impl as X }` · class method `async X(page) {}` ·
`export default { X: async p => … }` · **`.ts` with a type annotation
(`export const X: Enum = …`)** · `.tsx` · `.jsx` · a copy inside `.lifecycle/`
(which is COMMITTED on a feature branch) · a copy inside `dist/` · a
`gallery-surfaces-legacy.mjs` sibling **inside the shared package**.

The `.ts`-with-annotation case is the one that mattered most: this repo already
has a TS surface counterpart (`src/dev/gallery/surfaces.ts`), so a TS port is the
most plausible way the enumeration really gets re-forked, and `(const|let)\s+X\s*=`
cannot match across a `: Type`.

Fixes: a `definesFn()` covering five definition forms (never a call site, or every
legitimate consumer would be flagged); `.tsx`/`.jsx` added; `WALK_SKIP` cut to
`node_modules` + `.git` only (a skip list is a hiding place); and a new
**TEST-3 "the SHARED package holds exactly ONE enumeration"** closing the blanket
safe-harbour — previously anything under `sdk/.../scripts/` was trusted.

## Deliberately NOT broadened

The auditor also proposed matching a template-assembled artifact name
(`` `${NAME}.generated.ts` ``). I tried it and reverted: a generic
`.generated.(ts|json)` match flags every legitimate per-workspace generator
(`gen-crawl-cassette.mjs`, `gen-override-registry.mjs`, …), and those SHOULD be
per-workspace — the invariant is about these six, not "no workspace may generate
anything". The limit is now stated in the code: the enumeration-API arm is the
broad net; the artifact arm is a narrower second one, and tightening it further
needs real parsing rather than a longer regex — the lesson this area has already
paid for twice.

## Accepted, not fixed

- **The exemption list is abusable for NEW paths.** The auditor added a verbatim
  fork at a new path with a >40-char excuse and the guard went green. Layering is
  real (the six KNOWN names cannot be exempted away — `generatorForkViolations`
  still reds them), and every exemption is re-verified as still-discovered, but
  nothing structurally stops a new reasoned entry. Only review does. This is
  inherent to the `NOT_A_COPY` idiom this file already uses.

## Confirmed strengths (worth keeping in the record)

- A copy reachable only through a **symlinked directory is CAUGHT** — the
  `fs.statSync`-not-`dirent` choice is load-bearing, and a symlink **cycle** fails
  CLOSED (terminates on `ELOOP`, reports the paths) rather than hanging.
- Both **stale-exemption checks fire**, proven by mutation (delete an exempted
  file → RED; break its match → RED).
- The round-1 corrections to the e2e (`waitForFunction`, `before.interactions.length + 1`),
  TEST-7's all-specifiers regex, and the config-comment rewrite were each verified
  correct and strictly better.

## Termination

Round 2 produced 3 introduced defects + 10 evasions, all closed and each
re-verified by re-running the auditor's own fixtures. The profile decayed
(round 1: 1 high + 6 medium; round 2: 0 high, 1 medium-high, 2 medium — and the
medium-high is a self-inflicted regression now covered by a test). No round
concentrated ≥60% of findings on one guard file in the guard-substitution sense:
round 2's findings split across the guard, the spec, the docs and a deleted
artifact.

**New confirmed findings:** 0
