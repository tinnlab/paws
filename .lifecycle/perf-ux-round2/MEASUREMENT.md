# perf-ux-round2 — MEASUREMENT (the design source)

This round has **no upstream product design doc**: its subject is the app's own
measured behaviour. Per the feature-lifecycle rule ("if there is genuinely no
prior design doc, WRITE one first and name it"), **this file IS the design
source**. Every ITEM in `PLAN.md` traces to a number recorded here, and the
`## Invariants` are lifted verbatim from **Non-negotiables** below.

Nothing here is an opinion. Every row is produced by a committed, re-runnable
probe against a **production build of this branch** served from a private
instance.

---

## 0. Rig

| Thing | Value |
|---|---|
| Branch | `feat/perf-ux-round2` @ base `origin/feat/agent-core` `a49d48271` |
| Backend | `src-app/target/debug/ziee`, `CONFIG_FILE=config/dev.yaml`, port **29411**, embedded PG **54401**, data dir `/data/pbya/ziee/tmp/perf-ux-data` |
| Frontend | `src-app/ui` → `npx vite build --mode production` → `src-app/dist/ui` |
| Serving | `node /data/pbya/ziee/tmp/perf-ux-serve.mjs` on **1571** → 29411 |
| Model | LiteLLM bridge `127.0.0.1:4000`, `qwen3.6-35b-a3b`, provider `local-qwen`, assigned to both groups |
| Probes | `.lifecycle/perf-ux-round2/perf-probe.mjs` (`bundle` / `boot` / `boot-slow` / `stream`) |
| Audit | `live-ui-audit.mjs` (agent-kit skill snapshot), 3 viewports × 2 themes × all JTBD flows + RBAC personas |

**Stale-build guard.** `perf-probe --dist=<dist>` asserts every asset the page
loads exists in the dist this branch just built. The run recorded
`distVerified: true`, so no finding here is the phantom "27 surfaces broken at
390px" class of artefact.

### Measurement classes — which numbers survive a busy box

| Class | Examples | Load-sensitive? |
|---|---|---|
| **Deterministic** | critical-path bytes, chunk counts, source-map attribution, `index.html` preload set | **No** — pure build output. Valid regardless of box load. |
| **Timing** | FCP, composer-interactive, CPU profile, `gate:ui` wall time | **Yes** — must be captured on a quiet box. |
| **Audit findings** | the 7 live-audit dimensions | Partly — geometry/colour/a11y are stable; `network/*`, `stuck-loading`, `console-error` are load- and rig-sensitive. |

Every number below is tagged with its class. **§2/§3 timing numbers were captured
before a concurrent full-suite e2e run started on this box and MUST be
re-measured on a quiet box before any before→after claim is made** (see
`## Status` at the end).

---

## 1. Bundle — critical path *(deterministic)*

The **entry chunk size alone is not the critical path.** `index.html` also
`modulepreload`s 18 further chunks and 2 stylesheets; the browser fetches and
parses all of them before first paint.

```
critical-path total : 1,276,893 B raw / 366,238 B gzip across 21 assets
  JS                : 1,047,651 B raw / 336,237 B gzip (19 chunks)
  CSS               :   229,242 B raw /  30,001 B gzip (2 sheets)
  entry chunk alone :    56,046 B raw /  16,854 B gzip   ← the previously-reported win
```

| bytes | gzip | asset | source-map attribution |
|---|---|---|---|
| 495,459 | 157,078 | `vendor-*.js` | react-dom, @base-ui/react, react-router, floating-ui |
| 305,546 | 95,040 | `src-*.js` | `@ziee/kit` barrel + react-hook-form, overlayscrollbars, sonner, virtual-core, zod, cmdk |
| 214,975 | 31,424 | `index-*.css` | Tailwind |
| **82,022** | **24,586** | **`date-picker-*.js`** | **react-day-picker + date-fns + @date-fns/tz** |
| 56,046 | 16,854 | `index-*.js` | shell + module loader |
| 35,457 | 10,974 | `lucide-react-*.js` | icons |

Desktop workspace, same build settings:
`1,579,936 B raw / 450,520 B gzip across 38 assets` — and it preloads the
**same** `date-picker-*.js`.

### FINDING B-1 (HIGH, perf) — the "lazy date picker" is not lazy *(deterministic, PROVEN)*

`src-app/ui/src/components/common/LazyDatePicker.tsx` exists precisely so
react-day-picker + date-fns stay out of the eager graph; its doc-comment states
it "is the ONLY app import of the DatePicker". It is — but
`sdk/packages/kit/src/index.ts:186-187` **re-exports `DatePicker` from the kit
barrel**, and the barrel is in the eager graph, so rolldown must make the barrel
chunk import the date-picker chunk to re-export the symbol.

Evidence chain:
1. `index.html`: `<link rel="modulepreload" href="/assets/date-picker-DzD1OXVB.js">`.
2. `grep date-picker-DzD1OXVB src-F5JwJF9f.js` →
   `import{a as Ve,…}from"./date-picker-DzD1OXVB.js"` — the **preloaded kit chunk
   statically imports it**.
3. Source-map attribution of that chunk: react-day-picker 159,485 B,
   date-fns 140,547 B, @date-fns/tz 24,869 B.
4. The only prod consumer is the lazy wrapper (dynamic `import()`); the only
   barrel consumer is `src/dev/gallery/stories/controls.story.tsx`, and the
   gallery is proven absent from prod (**0 gallery source bytes across all 2,040
   prod chunk source-maps**).
5. `@ziee/kit` already declares `sideEffects: ["*.css"]`, so this is not a
   side-effect-retention problem — it is the barrel re-export itself.
6. **Direct experiment**: deleting the two barrel lines and rebuilding removes
   `date-picker-*.js` from the preload list; critical path
   1,279,228 → 1,202,569 B raw (**−76,659 B raw ≈ −23 KB gzip, −6.3 % of the
   gzip critical path**), in **both** workspaces. Change reverted; recorded here
   as the proof.

### FINDING B-2 (MEDIUM, perf) — 2,040 chunks, median 650 B *(deterministic)*

The prod build emits **2,040 JS chunks**; **1,306 < 2 KiB, 1,145 < 1 KiB**,
median **650 B**. Classified by dominant source dir:

| chunks | share | bytes | class |
|---|---|---|---|
| 614 | 45 % | 268,806 | **store-action leaves** (avg 438 B each) |
| 396 | 29 % | 16,171,896 | vendor |
| 315 | 23 % | 1,515,914 | module code |
| 11 | <1 % | 390,364 | sdk |

Home boot **executes 198–228** of them (1.59–1.90 MiB). 32 of the boot set are
store-action leaves.

**A grouping fix was tried and MEASURED AS A REGRESSION — do not do it.**
Adding a rolldown `codeSplitting` group that merges each store's action leaves
into one chunk per store cut the build from 2,040 → **833** chunks, but made
boot *worse*: executed chunks 198 → **229**, executed bytes 1,593 → **2,110
KiB**, and throttled composer-interactive 5,041 → **7,227 ms** — because
touching one action now drags in every sibling action of that store. Recorded so
the next round does not re-derive it.

---

## 2. Boot — first paint + request waterfall *(timing — re-measure on a quiet box)*

Loopback, 1280×900, authenticated, landing on `/`:

| run | FCP | DCL | composer interactive | executed chunks | executed bytes | exec depth | /api | /api depth |
|---|---|---|---|---|---|---|---|---|
| a | 520 ms | 59 ms | 468 ms | 198 | 1,593 KiB | 20 | 22 | 9 |
| b | 596 ms | 93 ms | 562 ms | 198 | 1,593 KiB | 23 | 22 | 9 |

Emulated **100 ms RTT / 10 Mbps down** (`--probes=boot-slow`), 4 runs:

| run | FCP | DCL | composer interactive |
|---|---|---|---|
| 1 | 2,936 ms | 1,251 ms | 5,041 ms |
| 2 | 2,836 ms | 1,277 ms | 5,508 ms |
| 3 | 2,848 ms | 1,270 ms | 6,790 ms |
| 4 | 3,024 ms | 1,281 ms | 5,092 ms |
| **mean** | **2,911 ms** (σ ≈ 75) | 1,270 ms | **5,608 ms** (σ ≈ 700) |

### FINDING B-3 (HIGH, perf — characterisation, not fixed this round)

On loopback the composer is interactive in **~0.5 s**; at a realistic **100 ms
RTT it is 5.6 s**, with FCP at 2.9 s. The cost is dominated by **request count
and dependency depth**, not by bytes: 1.59 MiB at 10 Mbps is ~1.3 s of transfer,
and the executed-chunk chain is 8 levels deep under throttling (~0.8 s of pure
latency) on top of a 5-deep `/api` chain (~0.5 s).

**Metric discipline learned here:** FCP is stable (σ 75 ms) and usable as a
before→after signal; composer-interactive is **not** (σ 700 ms, 14 %) and must
not be used to prove a change smaller than its noise. B-1's −23 KB gzip is worth
~65 ms of transfer at 10 Mbps — well inside that noise — so **B-1 is proven by
the deterministic byte metric, never by a timing metric.**

Also observed and **verified as a metric artefact, not a finding**: `wallMs` in
the loopback run never settles because `networkidle` cannot fire while the
`/api/sync/subscribe` SSE stream is open.

---

## 3. Streaming — CPU profile of a real reply *(timing — re-measure)*

Real composer → real `/api/chat/stream` → real `qwen3.6-35b-a3b`, V8 CPU profile
at 200 µs sampling, 7,416 rendered characters:

```
wall 16,555 ms · main thread idle 12,723 ms (76.1 %) · busy ≈ 3.8 s (24 %)
top self-time (none above 0.7 % of wall):
   104 ms  Tr @ src-*.js (kit)      97 ms  (anon) @ vendor-*.js
    88 ms  (anon) @ src-*.js        79 ms  po @ vendor-*.js (react-dom commit)
    78 ms  N  @ extension-*.js
```

**No hot spot, no quadratic growth, flat profile.** The O(n²) reducer fix and
rAF-coalesced streaming from the previous round are confirmed effective.
**Verify-then-skip — nothing to fix.**

---

## 4. `gate:ui` — runtime-health baseline *(timing/env — re-run)*

```
$ cd src-app/ui && npm run gate:ui -- --skip-visual
✅ tsc — clean
✅ lint — clean
✅ runtime-health — 205 surfaces clean
--- per-surface runtime verdict: 205/205 PASS ---
=== gate summary === PASS tsc · PASS lint · PASS runtime-health · PASS visual
✅ GATE PASSED
```

The regenerated `RUNTIME_FINDINGS.md` reports **0 gating HIGH** (the copy
committed on the base is stale and claims 917), 221 MEDIUM (all deliberate
error-state injections), 4 `a11y-name`, 441 informational `spacing-grid`.

The gallery is clean, so any defect this round finds is a **live-app** defect
the mock-API gallery cannot reach — exactly the gap `live-ui-audit` covers.

---

## 5. Live UI audit — 7 dimensions *(INVALIDATED TWICE; must be re-run)*

Two full baseline attempts were run and both had to be **discarded**, each for a
rig defect that the audit correctly surfaced as app findings. Both are recorded
because each is a real lesson about the measurement rig, and because the second
one nearly shipped as a false HIGH.

### Attempt 1 — contaminated by the per-IP rate limiter

`server.rate_limit` (50/s sustained, 500 burst) applied to the whole audit,
whose four parallel shards each drive full SPA cold-loads. Result: 503 deduped
findings on one shard alone, of which **267 HIGH `console-error` and 189
`network/failure` were `429 Too Many Requests`** on `/api/auth/me` and
`/api/app/setup/status` — pure self-inflicted throttling, plus the retry storm
slowed the run by more than an order of magnitude. Fixed by
`rate_limit.enabled: false` for the audit rig (verified: 80 rapid requests →
80 × 200).

### Attempt 2 — contaminated by an SSE-slot leak in the *test proxy*

The re-run produced 1,296 deduped findings (HIGH 62 / MEDIUM 961 / LOW 273),
and **every single HIGH plus all 396 `network/failure` rows were 429s** on
`/api/sync/subscribe` (286) and `/api/chat/stream` (110) — i.e. the per-user SSE
connection caps (12 / 24).

This looks exactly like the `sse-slot-leak` defect. It is not. Applying the
skill's own discipline — *probe sequentially with zero concurrency, and probe as
a freshly created user* — gave a definitive split:

| probe (sequential, zero concurrency, quiet box) | result |
|---|---|
| incumbent `admin`, **direct to backend** `:29411`, 15 opens | `429` × 15 |
| fresh user, **direct to backend** `:29411`, 15 opens | `200` × 15 |
| fresh user, **through the test proxy** `:1571`, 15 opens | `200` × 12 then `429` × 3 — stops at exactly the cap |
| fresh user, then **direct** again | `429` — slots stay burnt |

So the backend reclaims slots correctly on abort; the **proxy** never tore down
the UPSTREAM request when the downstream client vanished, so every browser
context that ever opened an SSE stream burnt a slot **permanently**. Root cause:
`proxyRes.pipe(res)` alone does not abort `proxyReq` on `res` close.

Fix applied to the rig (`/data/pbya/ziee/tmp/perf-ux-serve.mjs`):
`res.on('close', () => { proxyRes.destroy(); proxyReq.destroy() })` plus the
pre-header `req.on('aborted')` twin. Verified: **20/20 → 200** through the
patched proxy.

> **This bug is in the SHARED helper `/data/pbya/ziee/tmp/serve-dist.mjs`**, from
> which every dist-serving rig on this box was copied — including the one behind
> `:1520`. Any audit or e2e run through an unpatched copy will manufacture
> `sync/subscribe` + `chat/stream` 429s and attribute them to the app.

### Attempt 3 — started, then stopped

Relaunched against the fixed rig; stopped ~2 cells in when the coordinator
reported a concurrent full-suite e2e run on the same worktree and box. No
findings from it are usable. **The 7-dimension inventory is therefore still
OUTSTANDING** and is the gating input for the UI/UX half of this round.

---

## Non-negotiables (lifted verbatim into `PLAN.md` `## Invariants`)

- **Every change in this round must be justified by a number in this document,
  and proven by re-running the same probe that produced that number.**
- **A lazily-imported dependency must not appear in `index.html`'s
  `modulepreload` set.**
- **A change must be proven by a metric whose run-to-run noise is smaller than
  the effect claimed.**
- **A finding is not reported against the app until the measurement rig has been
  excluded as its cause.**
- **No fix may regress the `gate:ui` runtime-health baseline of 205/205 surfaces
  clean.**
- **A finding already fixed in a previous round is verified against current code
  and recorded as "already fixed", never re-fixed.**

---

## Status

| Input | State |
|---|---|
| §1 bundle / chunk analysis (deterministic) | **VALID** — B-1 proven, B-2 characterised, grouping fix disproven |
| §2 boot timing | provisional — re-measure on a quiet box |
| §3 stream CPU profile | provisional — re-measure on a quiet box |
| §4 `gate:ui` | re-run on a quiet box |
| §5 live UI audit (7 dimensions) | **OUTSTANDING** — rig now correct, run not yet completed |

`PLAN.md` is written against the VALID inputs only. Items that depend on the
outstanding audit are carried as explicitly-deferred and must not be invented.
