# INFRA_INTEGRATION — subsystems each item touches

## ITEM-1/2 (fixture rebuild)

| subsystem | checked |
|---|---|
| chat content-renderer registry | `elicitation_request` is registered by the mcp chat extension (`mcp/chat-extension/extension.tsx:1070`). VERIFIED BY RUNNING, and the run found a defect — see DRIFT-1.4. |
| activity rail | a BLOCKING step is a breakout, not a row (`ChatMessage.tsx` "It renders through the ORDINARY content path"), so the card really is inline in the clamp. Confirmed live: 3 breakouts + 3 cards + 1 rail step. |
| gallery deep-surface loader | the surface loads a `DeepBundle` by conversation id; the bundle shape (`conversation`/`messages`/`branches`) is unchanged. |
| runtime-health crawl | the surface's rendered component set changed (elicitation cards in, thinking/tool cards were already out). `gate:ui` re-run end to end rather than assumed. |
| state-matrix / gallery-coverage generators | both are inputs to `npm run check`; regenerated (`gen:state-matrix`) and re-run. The regen was pure line-number drift — no new conditional state. |

## ITEM-4/5/6 (overlays resolver)

| subsystem | checked |
|---|---|
| kit overlay primitives (base-ui + Radix) | measured where each portals: OUTSIDE `gallery-root`, as a body descendant. Both engines behave the same here. |
| gallery stories | a story may render an overlay PANEL inline; that is legitimate and must not be mistaken for an open overlay. This is the whole basis of the fix. |
| `assertLayoutSane` | now receives the genuinely-opened overlay for `select`/`combobox`, where it previously audited the composer picker. Ran clean for all nine cases in both themes. |
| `gate:ui` visual step | reads pass/fail from this config; no change to `gallery.config.json`'s `visualSpecs`. |

## Entity-lifecycle walk (the surfaces this touches)

- **A content block whose extension has not registered yet** — ADD path only
  (blocks are seeded, never removed, on a gallery surface). Previously it rendered
  `Unknown content type: …` PERMANENTLY. Now it re-renders when the extension
  arrives. Proven by running: 14/14 clean loads after, 1 bad in 14 before.
- **A rail step whose contribution has not registered yet** — same shape one level
  up: the message was segmented once and kept raw cards forever. Same fix, proven
  under 16-way concurrent load.
- **An overlay that fails to close** — previously consumed the whole 60s budget and
  reported against the NEXT case; now bounded at 5s and best-effort as written.
